const $ = (selector) => document.querySelector(selector);

async function requestJson(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    if (response.ok) throw new Error("The server returned an invalid response.");
  }
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

function showStatus(element, message, kind = "") {
  element.textContent = message;
  element.className = `admin-status${kind ? ` admin-status-${kind}` : ""}`;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function renderQuizResults(results) {
  const body = $("#quiz-results");
  body.replaceChildren();
  if (results.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "admin-empty";
    cell.colSpan = 3;
    cell.textContent = "No quiz results have been submitted yet.";
    row.append(cell);
    body.append(row);
    return;
  }
  for (const result of results) {
    const row = document.createElement("tr");
    for (const value of [result.nickname, `${result.score} / ${result.total}`, formatDate(result.submitted_at)]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
}

let dashboardLoading = false;

async function loadDashboard() {
  const status = $("#dashboard-status");
  if (dashboardLoading) return;
  dashboardLoading = true;
  try {
    const [stats, results] = await Promise.all([
      requestJson("/api/admin/stats"),
      requestJson("/api/admin/quiz-results")
    ]);
    $("#total-visitors").textContent = stats.total_visitors.toLocaleString();
    $("#new-visitors").textContent = stats.new_visitors_today.toLocaleString();
    $("#online-now").textContent = stats.online_now.toLocaleString();
    $("#quiz-attempts").textContent = stats.quiz_attempts.toLocaleString();
    renderQuizResults(results.results);
    showStatus(status, `Updated ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    if (error.message.includes("(401)")) {
      window.location.replace("/admin/login");
      return;
    }
    showStatus(status, error.message, "error");
  } finally {
    dashboardLoading = false;
  }
}

const loginForm = $("#admin-login-form");
if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = loginForm.querySelector('button[type="submit"]');
    const status = $("#login-status");
    submit.disabled = true;
    showStatus(status, "Signing in…");
    try {
      await requestJson("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: $("#username").value,
          password: $("#password").value
        })
      });
      window.location.assign("/admin");
    } catch (error) {
      showStatus(status, error.message.includes("(401)")
        ? "Incorrect username or password."
        : error.message, "error");
      submit.disabled = false;
    }
  });
}

const signOut = $("#sign-out");
if (signOut) {
  loadDashboard();
  window.setInterval(() => {
    if (document.visibilityState === "visible") loadDashboard();
  }, 30000);
  signOut.addEventListener("click", async () => {
    signOut.disabled = true;
    try {
      await requestJson("/api/admin/logout", { method: "POST" });
      window.location.replace("/admin/login");
    } catch (error) {
      showStatus($("#dashboard-status"), error.message, "error");
      signOut.disabled = false;
    }
  });
}

const passwordForm = $("#password-form");
if (passwordForm) {
  passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = $("#password-status");
    const submit = passwordForm.querySelector('button[type="submit"]');
    const newPassword = $("#new-password").value;
    if (newPassword !== $("#confirm-password").value) {
      showStatus(status, "The new passwords do not match.", "error");
      return;
    }
    submit.disabled = true;
    try {
      await requestJson("/api/admin/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: $("#current-password").value,
          new_password: newPassword
        })
      });
      passwordForm.reset();
      showStatus(status, "Password changed. Please sign in with your new password.", "success");
      window.setTimeout(() => window.location.replace("/admin/login"), 1200);
    } catch (error) {
      showStatus(status, error.message, "error");
      submit.disabled = false;
    }
  });
}
