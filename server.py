import argparse
import hashlib
import hmac
import json
import logging
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
DATABASE_PATH = ROOT / "cybook.sqlite3"
PASSWORD_ITERATIONS = 600_000
SESSION_LIFETIME = 8 * 60 * 60
VISITOR_LIFETIME = 180 * 24 * 60 * 60
ONLINE_VISITOR_WINDOW_SECONDS = 90
MAX_REQUEST_BYTES = 32_768
ADMIN_USERNAME = "DanDB"
QUIZ_ANSWERS = (1, 0, 1, 0, 1, 0, 2, 1, 0, 1)
TRACKED_PAGES = {"home", "dashboard", "lesson", "quiz"}
NICKNAME_PATTERN = re.compile(r"^[\w -]{1,24}$", re.UNICODE)
LOGIN_FAILURES = {}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOGGER = logging.getLogger("cybook")


def password_digest(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)


class RequestError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class Database:
    def __init__(self, path):
        self.path = Path(path)

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS admins (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    username TEXT NOT NULL UNIQUE,
                    password_salt BLOB NOT NULL,
                    password_hash BLOB NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS admin_sessions (
                    token_hash TEXT PRIMARY KEY,
                    expires_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS admin_sessions_expiry
                    ON admin_sessions (expires_at);
                CREATE TABLE IF NOT EXISTS quiz_results (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    attempt_id TEXT NOT NULL UNIQUE,
                    nickname TEXT NOT NULL,
                    score INTEGER NOT NULL,
                    total INTEGER NOT NULL,
                    submitted_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS quiz_results_date
                    ON quiz_results (submitted_at DESC);
                CREATE TABLE IF NOT EXISTS visits (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    visitor_hash TEXT NOT NULL,
                    session_hash TEXT NOT NULL,
                    page TEXT NOT NULL,
                    visited_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS visits_visitor
                    ON visits (visitor_hash);
                CREATE INDEX IF NOT EXISTS visits_session
                    ON visits (session_hash);
                CREATE TABLE IF NOT EXISTS visitor_activity (
                    session_hash TEXT PRIMARY KEY,
                    visitor_hash TEXT NOT NULL,
                    last_seen TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS visitor_activity_last_seen
                    ON visitor_activity (last_seen);
                """
            )
            connection.execute("BEGIN IMMEDIATE")
            admin = connection.execute("SELECT id FROM admins LIMIT 1").fetchone()
            if admin:
                return None

            password = secrets.token_urlsafe(24)
            salt = secrets.token_bytes(16)
            connection.execute(
                """
                INSERT INTO admins (id, username, password_salt, password_hash, created_at)
                VALUES (1, ?, ?, ?, ?)
                """,
                (
                    ADMIN_USERNAME,
                    salt,
                    password_digest(password, salt),
                    datetime.now(timezone.utc).isoformat(timespec="seconds"),
                ),
            )
            return ADMIN_USERNAME, password

    def authenticate(self, username, password):
        if not isinstance(password, str) or len(password) > 128:
            return False
        with self.connect() as connection:
            admin = connection.execute(
                "SELECT username, password_salt, password_hash FROM admins WHERE id = 1"
            ).fetchone()
        salt = admin["password_salt"] if admin else bytes(16)
        expected = admin["password_hash"] if admin else bytes(32)
        try:
            candidate = password_digest(password, salt)
        except UnicodeEncodeError:
            return False
        valid = hmac.compare_digest(candidate, expected)
        return bool(admin and admin["username"] == username and valid)

    def create_session(self):
        token = secrets.token_urlsafe(32)
        expiry = int(time.time()) + SESSION_LIFETIME
        with self.connect() as connection:
            connection.execute("DELETE FROM admin_sessions WHERE expires_at <= ?", (int(time.time()),))
            connection.execute(
                "INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)",
                (hashlib.sha256(token.encode("ascii")).hexdigest(), expiry),
            )
        return token

    def session_is_valid(self, token):
        if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{40,64}", token):
            return False
        token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
        now = int(time.time())
        with self.connect() as connection:
            connection.execute("DELETE FROM admin_sessions WHERE expires_at <= ?", (now,))
            return connection.execute(
                "SELECT 1 FROM admin_sessions WHERE token_hash = ? AND expires_at > ?",
                (token_hash, now),
            ).fetchone() is not None

    def revoke_session(self, token):
        if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{40,64}", token):
            return
        with self.connect() as connection:
            connection.execute(
                "DELETE FROM admin_sessions WHERE token_hash = ?",
                (hashlib.sha256(token.encode("ascii")).hexdigest(),),
            )

    def change_password(self, password):
        salt = secrets.token_bytes(16)
        with self.connect() as connection:
            connection.execute(
                "UPDATE admins SET password_salt = ?, password_hash = ? WHERE id = 1",
                (salt, password_digest(password, salt)),
            )
            connection.execute("DELETE FROM admin_sessions")

    def record_visit(self, visitor_token, session_token, page):
        visitor_hash = hashlib.sha256(visitor_token.encode("ascii")).hexdigest()
        session_hash = hashlib.sha256(session_token.encode("ascii")).hexdigest()
        visited_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO visits (visitor_hash, session_hash, page, visited_at)
                VALUES (?, ?, ?, ?)
                """,
                (visitor_hash, session_hash, page, visited_at),
            )
            self._update_visitor_activity(connection, visitor_hash, session_hash, visited_at)

    def record_activity(self, visitor_token, session_token):
        visitor_hash = hashlib.sha256(visitor_token.encode("ascii")).hexdigest()
        session_hash = hashlib.sha256(session_token.encode("ascii")).hexdigest()
        last_seen = datetime.now(timezone.utc)
        with self.connect() as connection:
            self._update_visitor_activity(
                connection,
                visitor_hash,
                session_hash,
                last_seen.isoformat(timespec="seconds"),
            )
            expiry = (last_seen - timedelta(minutes=10)).isoformat(timespec="seconds")
            connection.execute(
                "DELETE FROM visitor_activity WHERE last_seen < ?",
                (expiry,),
            )

    @staticmethod
    def _update_visitor_activity(connection, visitor_hash, session_hash, last_seen):
        connection.execute(
            """
            INSERT INTO visitor_activity (session_hash, visitor_hash, last_seen)
            VALUES (?, ?, ?)
            ON CONFLICT(session_hash) DO UPDATE SET
                visitor_hash = excluded.visitor_hash,
                last_seen = excluded.last_seen
            """,
            (session_hash, visitor_hash, last_seen),
        )

    def visitor_stats(self):
        local_now = datetime.now().astimezone()
        today_start = local_now.replace(
            hour=0, minute=0, second=0, microsecond=0
        ).astimezone(timezone.utc)
        tomorrow_start = (
            local_now.replace(hour=0, minute=0, second=0, microsecond=0)
            + timedelta(days=1)
        ).astimezone(timezone.utc)
        online_since = datetime.now(timezone.utc) - timedelta(
            seconds=ONLINE_VISITOR_WINDOW_SECONDS
        )
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT COUNT(*) AS page_views,
                       COUNT(DISTINCT session_hash) AS sessions,
                       COUNT(DISTINCT visitor_hash) AS unique_visitors,
                       (
                           SELECT COUNT(*)
                           FROM (
                               SELECT visitor_hash, MIN(visited_at) AS first_seen
                               FROM visits
                               GROUP BY visitor_hash
                           )
                           WHERE first_seen >= ? AND first_seen < ?
                       ) AS new_visitors_today,
                       (
                           SELECT COUNT(DISTINCT visitor_hash)
                           FROM visitor_activity
                           WHERE last_seen >= ?
                       ) AS online_now,
                       (SELECT COUNT(*) FROM quiz_results) AS quiz_attempts
                FROM visits
                """,
                (
                    today_start.isoformat(timespec="seconds"),
                    tomorrow_start.isoformat(timespec="seconds"),
                    online_since.isoformat(timespec="seconds"),
                ),
            ).fetchone()
        stats = dict(row)
        stats["total_visitors"] = stats["unique_visitors"]
        return stats

    def save_quiz_result(self, attempt_id, nickname, answers):
        score = sum(answer == expected for answer, expected in zip(answers, QUIZ_ANSWERS))
        submitted_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with self.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO quiz_results (attempt_id, nickname, score, total, submitted_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(attempt_id) DO NOTHING
                """,
                (attempt_id, nickname, score, len(QUIZ_ANSWERS), submitted_at),
            )
            if cursor.rowcount == 0:
                raise RequestError(409, "This quiz attempt has already been submitted.")
        return {"score": score, "total": len(QUIZ_ANSWERS)}

    def quiz_results(self):
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT nickname, score, total, submitted_at
                FROM quiz_results
                ORDER BY submitted_at DESC, id DESC
                """
            ).fetchall()
        return [dict(row) for row in rows]


class CyBookHandler(BaseHTTPRequestHandler):
    database = Database(DATABASE_PATH)
    server_version = "CyBookLocal"
    sys_version = ""

    def log_message(self, format_string, *args):
        LOGGER.info("%s - %s", self.address_string(), format_string % args)

    def send_bytes(self, status, body=b"", content_type="text/plain; charset=utf-8", headers=()):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; base-uri 'none'; form-action 'self'; "
            "frame-ancestors 'none'; object-src 'none'; connect-src 'self'; "
            "style-src 'self'; script-src 'self'",
        )
        self.send_header("Cache-Control", "no-store")
        for name, value in headers:
            self.send_header(name, value)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def send_json(self, status, payload, headers=()):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_bytes(status, body, "application/json; charset=utf-8", headers)

    def send_page(self, filename, status=200):
        body = (ROOT / filename).read_bytes()
        self.send_bytes(status, body, "text/html; charset=utf-8")

    def send_redirect(self, location):
        self.send_bytes(303, headers=(("Location", location),))

    def cookie_value(self, name):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except (TypeError, ValueError):
            return ""
        morsel = cookie.get(name)
        return morsel.value if morsel else ""

    def admin_token(self):
        return self.cookie_value("cybook_admin_session")

    def is_admin(self):
        return self.database.session_is_valid(self.admin_token())

    def valid_local_host(self):
        host = self.headers.get("Host", "").lower()
        return host in {
            f"127.0.0.1:{self.server.server_port}",
            f"localhost:{self.server.server_port}",
        }

    def same_origin(self):
        if not self.valid_local_host():
            return False
        origin = self.headers.get("Origin")
        if not origin:
            return True
        parsed = urlsplit(origin)
        return (
            parsed.scheme == "http"
            and parsed.hostname in {"127.0.0.1", "localhost"}
            and parsed.port == self.server.server_port
            and parsed.path == ""
            and not parsed.query
            and not parsed.fragment
        )

    def read_json(self):
        if not self.headers.get("Content-Type", "").lower().startswith("application/json"):
            raise RequestError(415, "Send the request as JSON.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise RequestError(400, "Invalid request body.") from error
        if length < 1 or length > MAX_REQUEST_BYTES:
            raise RequestError(413, "Request body is empty or too large.")
        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise RequestError(400, "Invalid request body.") from error
        if not isinstance(payload, dict):
            raise RequestError(400, "Invalid request body.")
        return payload

    def do_GET(self):
        path = urlsplit(self.path).path
        try:
            if path in {"/", "/index.html"}:
                self.send_page("index.html")
            elif path == "/style.css":
                self.send_bytes(200, (ROOT / "style.css").read_bytes(), "text/css; charset=utf-8")
            elif path == "/script.js":
                self.send_bytes(
                    200,
                    (ROOT / "script.js").read_bytes(),
                    "text/javascript; charset=utf-8",
                )
            elif path == "/admin.js":
                self.send_bytes(
                    200,
                    (ROOT / "admin.js").read_bytes(),
                    "text/javascript; charset=utf-8",
                )
            elif path == "/admin/login":
                self.send_page("admin-login.html")
            elif path == "/admin":
                if self.is_admin():
                    self.send_page("admin-dashboard.html")
                else:
                    self.send_redirect("/admin/login")
            elif path == "/api/admin/session":
                self.send_json(200, {"authenticated": self.is_admin()})
            elif path == "/api/admin/stats":
                if not self.is_admin():
                    self.send_json(401, {"error": "Admin authentication is required."})
                else:
                    self.send_json(200, self.database.visitor_stats())
            elif path == "/api/admin/quiz-results":
                if not self.is_admin():
                    self.send_json(401, {"error": "Admin authentication is required."})
                else:
                    self.send_json(200, {"results": self.database.quiz_results()})
            else:
                self.send_json(404, {"error": "Not found."})
        except OSError:
            LOGGER.exception("Unable to read a local CyBook page.")
            self.send_json(500, {"error": "A local page could not be read."})
        except sqlite3.Error:
            LOGGER.exception("Database request failed.")
            self.send_json(500, {"error": "The local database request failed."})

    def do_POST(self):
        path = urlsplit(self.path).path
        try:
            if not self.same_origin():
                raise RequestError(403, "Request origin was not accepted.")
            if path == "/api/visit":
                self.record_visit()
            elif path == "/api/heartbeat":
                self.record_heartbeat()
            elif path == "/api/quiz":
                self.submit_quiz()
            elif path == "/api/admin/login":
                self.login()
            elif path == "/api/admin/logout":
                self.logout()
            elif path == "/api/admin/password":
                self.update_password()
            else:
                self.send_json(404, {"error": "Not found."})
        except RequestError as error:
            self.send_json(error.status, {"error": str(error)})
        except sqlite3.Error:
            LOGGER.exception("Database request failed.")
            self.send_json(500, {"error": "The local database request failed."})

    def record_visit(self):
        payload = self.read_json()
        page = payload.get("page")
        if not isinstance(page, str) or page not in TRACKED_PAGES:
            raise RequestError(400, "The page value is invalid.")

        visitor = self.cookie_value("cybook_visitor")
        new_visitor = not visitor or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", visitor)
        if new_visitor:
            visitor = secrets.token_urlsafe(32)
        session = self.cookie_value("cybook_visit_session")
        new_session = not session or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", session)
        if new_session:
            session = secrets.token_urlsafe(32)
        self.database.record_visit(visitor, session, page)

        headers = []
        if new_visitor:
            headers.append(
                (
                    "Set-Cookie",
                    f"cybook_visitor={visitor}; Path=/; Max-Age={VISITOR_LIFETIME}; "
                    "HttpOnly; SameSite=Lax",
                )
            )
        if new_session:
            headers.append(
                (
                    "Set-Cookie",
                    f"cybook_visit_session={session}; Path=/; HttpOnly; SameSite=Lax",
                )
            )
        self.send_json(201, {"recorded": True}, headers)

    def record_heartbeat(self):
        visitor = self.cookie_value("cybook_visitor")
        session = self.cookie_value("cybook_visit_session")
        if (
            re.fullmatch(r"[A-Za-z0-9_-]{32,128}", visitor)
            and re.fullmatch(r"[A-Za-z0-9_-]{32,128}", session)
        ):
            self.database.record_activity(visitor, session)
        self.send_json(200, {"recorded": True})

    def submit_quiz(self):
        payload = self.read_json()
        attempt_id = payload.get("attempt_id")
        nickname = payload.get("nickname")
        answers = payload.get("answers")
        if not isinstance(attempt_id, str) or not re.fullmatch(
            r"[0-9a-fA-F-]{36}", attempt_id
        ):
            raise RequestError(400, "The quiz attempt identifier is invalid.")
        if not isinstance(nickname, str) or not NICKNAME_PATTERN.fullmatch(nickname.strip()):
            raise RequestError(
                400,
                "Nickname must be 1–24 letters, numbers, spaces, hyphens, or underscores.",
            )
        if not isinstance(answers, list) or len(answers) != len(QUIZ_ANSWERS):
            raise RequestError(400, "Please submit answers to all 10 questions.")
        if any(type(answer) is not int or answer not in {0, 1, 2} for answer in answers):
            raise RequestError(400, "One or more submitted answers are invalid.")
        self.send_json(
            201,
            self.database.save_quiz_result(attempt_id, nickname.strip(), answers),
        )

    def login(self):
        payload = self.read_json()
        username = payload.get("username")
        password = payload.get("password")
        if (
            not isinstance(username, str)
            or not isinstance(password, str)
            or len(username) > 128
            or not 1 <= len(password) <= 128
        ):
            raise RequestError(400, "Username or password is invalid.")
        address = self.client_address[0]
        now = time.time()
        failures, updated = LOGIN_FAILURES.get(address, (0, now))
        if now - updated > 15 * 60:
            failures = 0
        if failures >= 8:
            raise RequestError(429, "Too many sign-in attempts. Try again in 15 minutes.")
        if not self.database.authenticate(username, password):
            LOGIN_FAILURES[address] = (failures + 1, now)
            raise RequestError(401, "Incorrect username or password.")
        LOGIN_FAILURES.pop(address, None)
        token = self.database.create_session()
        self.send_json(
            200,
            {"authenticated": True},
            (
                (
                    "Set-Cookie",
                    f"cybook_admin_session={token}; Path=/; Max-Age={SESSION_LIFETIME}; "
                    "HttpOnly; SameSite=Strict",
                ),
            ),
        )

    def logout(self):
        token = self.admin_token()
        if self.database.session_is_valid(token):
            self.database.revoke_session(token)
        self.send_json(
            200,
            {"authenticated": False},
            (
                (
                    "Set-Cookie",
                    "cybook_admin_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict",
                ),
            ),
        )

    def update_password(self):
        if not self.is_admin():
            raise RequestError(401, "Admin authentication is required.")
        payload = self.read_json()
        current_password = payload.get("current_password")
        new_password = payload.get("new_password")
        if (
            not isinstance(current_password, str)
            or len(current_password) > 128
            or not isinstance(new_password, str)
        ):
            raise RequestError(400, "Current and new passwords are required.")
        if len(new_password) < 14 or len(new_password) > 128:
            raise RequestError(400, "The new password must be 14–128 characters long.")
        try:
            new_password.encode("utf-8")
        except UnicodeEncodeError as error:
            raise RequestError(400, "The new password contains invalid characters.") from error
        admin = self.database.authenticate(ADMIN_USERNAME, current_password)
        if not admin:
            raise RequestError(401, "The current password is incorrect.")
        self.database.change_password(new_password)
        self.send_json(
            200,
            {"password_changed": True},
            (
                (
                    "Set-Cookie",
                    "cybook_admin_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict",
                ),
            ),
        )


def main():
    parser = argparse.ArgumentParser(description="Run CyBook locally.")
    parser.add_argument("--port", type=int, default=8000, help="Local HTTP port (default: 8000)")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")

    database = Database(DATABASE_PATH)
    credentials = database.initialize()
    CyBookHandler.database = database
    server = ThreadingHTTPServer(("127.0.0.1", args.port), CyBookHandler)
    server.daemon_threads = True
    print(f"CyBook is available at http://127.0.0.1:{server.server_port}/", flush=True)
    if credentials:
        print(f"One-time admin username: {credentials[0]}", flush=True)
        print(f"One-time admin password: {credentials[1]}", flush=True)
        print("Save this password now; it is stored only as a salted hash.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping CyBook.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
