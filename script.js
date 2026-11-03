const views = ["home", "dashboard", "lesson-view", "quiz-view"];
const $ = (selector) => document.querySelector(selector);
let currentModule = 0;
let quizNickname = "";
let attemptId = "";
let quizSubmitting = false;
let activeQuestions = [];
let lastQuestionOrder = "";

const uiText = {
  practicalTip: "Practical takeaway",
  backDashboard: "← Back to dashboard",
  questionsCount: "questions",
  requestFailed: "The request could not be completed",
  correctAnswer: "Correct answer:",
  answerCorrect: "Your answer is correct.",
  yourAnswer: "Your answer:",
  quizValidation: "Answer every question before submitting.",
  quizSaving: "Saving your result…",
  savedSuccess: "Your result was saved.",
  savingFailed: "Your answers were scored, but the result could not be saved:",
  retryLater: " Retake the quiz when the service is available.",
  submitAnswers: "Submit answers"
};

function textFor(key) {
  return uiText[key] || key;
}

const modules = [
  {
    id: "threats",
    title: "Common Online Threats",
    lead: "Recognize phishing messages and avoid giving account or payment details to an impostor.",
    tip: "Pause before acting on an unexpected urgent message. Open the organization’s official site or app yourself.",
    sources: [
      {
        label: "CISA: Recognize and Report Phishing",
        url: "https://www.cisa.gov/secure-our-world/recognize-and-report-phishing"
      }
    ],
    sections: [
      {
        title: "What phishing tries to do",
        text: "A phishing message can imitate a familiar service and push you to reveal sign-in credentials or payment information."
      },
      {
        title: "Notice urgency",
        text: "Unexpected claims that you must act immediately—such as fixing a payment or account—are a reason to pause and verify."
      },
      {
        title: "Check who sent it",
        text: "Look closely at the sender’s email address or account. A message that looks familiar can still come from an address that does not belong to the real organization."
      },
      {
        title: "Avoid the message link",
        text: "Do not use a link in an unexpected message to sign in. Type the service’s known website address yourself or open its official app."
      },
      {
        title: "Report suspicious messages",
        text: "Use the reporting option provided by your email or messaging service. If a message claims to be from an organization, contact it through its official website."
      }
    ]
  },
  {
    id: "protect",
    title: "Protect Yourself",
    lead: "Use unique passwords, multi-factor authentication, and timely software updates to strengthen your accounts and devices.",
    tip: "Protect your email account especially well: it can be used to reset access to other accounts.",
    sources: [
      {
        label: "CISA: Use Strong Passwords",
        url: "https://www.cisa.gov/secure-our-world/use-strong-passwords"
      },
      {
        label: "CISA: Turn on MFA",
        url: "https://www.cisa.gov/secure-our-world/turn-mfa"
      },
      {
        label: "CISA: Update Software",
        url: "https://www.cisa.gov/secure-our-world/update-software"
      }
    ],
    sections: [
      {
        title: "Use a different password for every account",
        text: "Long, unique passwords reduce the risk that a password exposed in one breach will unlock another account."
      },
      {
        title: "Use a password manager",
        text: "A password manager can generate and store strong, unique passwords so you do not have to reuse or memorize them all."
      },
      {
        title: "Turn on multi-factor authentication",
        text: "MFA asks for an additional way to verify it is you, adding protection if someone learns your password. Enable it on important accounts, especially email."
      },
      {
        title: "Install software updates",
        text: "Updates fix security weaknesses. Install available updates promptly, especially for operating systems, browsers, and antivirus software."
      },
      {
        title: "Enable automatic updates",
        text: "Where available, turn on automatic updates so your devices can install updates as they become available."
      }
    ]
  },
  {
    id: "other",
    title: "Personal Information and Privacy",
    lead: "Understand exposure of personal information and the rights protected by the Philippine Data Privacy Act.",
    tip: "Before sharing personal information, ask what it will be used for and whether sharing it is necessary.",
    sources: [
      {
        label: "National Privacy Commission: Data Privacy Act of 2012",
        url: "https://privacy.gov.ph/data-privacy-act/"
      }
    ],
    sections: [
      {
        title: "What counts as personal information?",
        text: "The Act covers information that identifies a person, can reasonably identify them directly, or can identify them when combined with other information."
      },
      {
        title: "Processing includes more than collection",
        text: "The Act’s definition of processing includes recording, storing, using, updating, sharing, blocking, and deleting personal information."
      },
      {
        title: "Processing must follow principles",
        text: "Personal information should be processed transparently, for a legitimate purpose, and proportionately to that purpose."
      },
      {
        title: "Know your rights as a data subject",
        text: "Rights under the Act include being informed, accessing your information, correcting inaccurate information, and objecting in applicable cases."
      },
      {
        title: "Ask questions or raise a concern",
        text: "Ask the organization handling your information how it is used and how to exercise your rights. The National Privacy Commission administers the Act and monitors compliance."
      }
    ]
  }
];

const questions = [
  {
    prompt: "Which message is the clearest reason to pause and check for phishing?",
    options: [
      "A message you expected that contains no request",
      "An unexpected urgent message asking you to sign in through its link",
      "A saved contact sending a message you already verified"
    ],
    answer: 1,
    explanation: "CISA describes urgent unexpected requests to sign in or resolve a payment as a phishing warning sign."
  },
  {
    prompt: "A message unexpectedly asks you to log in. What is the safer next step?",
    options: [
      "Open the service’s known website yourself or use its official app",
      "Use the message link because it looks familiar",
      "Reply with your password to confirm your identity"
    ],
    answer: 0,
    explanation: "CISA recommends typing the retailer’s website directly instead of clicking a link in an unexpected message."
  },
  {
    prompt: "Which password practice best protects multiple accounts?",
    options: [
      "Reuse one memorable password everywhere",
      "Use a long, unique password for each account",
      "Use a short password and change one character per account"
    ],
    answer: 1,
    explanation: "CISA recommends long, unique passwords and a password manager to create and store them."
  },
  {
    prompt: "What does multi-factor authentication add to an account?",
    options: [
      "An additional way to verify it is you",
      "A guarantee that a password can never be stolen",
      "A replacement for installing software updates"
    ],
    answer: 0,
    explanation: "MFA adds another verification step, helping protect an account even if its password is compromised."
  },
  {
    prompt: "What should you do when a security update is available?",
    options: [
      "Ignore it until the device stops working",
      "Install it as soon as possible and enable automatic updates when available",
      "Install updates only for apps you use every day"
    ],
    answer: 1,
    explanation: "CISA advises installing updates promptly and turning on automatic updates when available."
  },
  {
    prompt: "Which principles does the Data Privacy Act require when processing personal information?",
    options: [
      "Transparency, legitimate purpose, and proportionality",
      "Unlimited collection for any future use",
      "Keeping all processing purposes secret"
    ],
    answer: 0,
    explanation: "Section 11 of the Data Privacy Act sets out transparency, legitimate purpose, and proportionality."
  },
  {
    prompt: "Which is a right of a data subject under the Data Privacy Act?",
    options: [
      "To demand that every organization publish all customer records",
      "To prevent all processing in every circumstance",
      "To be informed about and access personal information, subject to the Act"
    ],
    answer: 2,
    explanation: "The Act recognizes rights including being informed and accessing personal information, subject to its provisions."
  },
  {
    prompt: "You discover that an organization holds incorrect information about you. Which right may apply?",
    options: [
      "The right to require the organization to disclose other people’s information",
      "The right to request correction of inaccurate personal information",
      "The right to remove any public information about anyone"
    ],
    answer: 1,
    explanation: "The Data Privacy Act includes the right to dispute and have inaccurate personal information corrected."
  },
  {
    prompt: "What information can qualify as personal information under the Data Privacy Act?",
    options: [
      "Information that can identify someone directly or when combined with other information",
      "Only a person’s password",
      "Information that can never be linked to an individual"
    ],
    answer: 0,
    explanation: "The Act includes information that identifies a person, can reasonably identify them, or can identify them when combined with other information."
  },
  {
    prompt: "Where can you start when you have a question about how an organization uses your personal information?",
    options: [
      "Post your account details publicly to request help",
      "Ask the organization handling the information about its use and your rights",
      "Share your password with someone claiming to be a privacy officer"
    ],
    answer: 1,
    explanation: "The Act recognizes data-subject rights and the National Privacy Commission’s role in administering the law."
  }
];

function randomizeQuestions() {
  const shuffled = questions.map((question, sourceIndex) => ({ ...question, sourceIndex }));
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  let order = shuffled.map((question) => question.sourceIndex).join(",");
  if (order === lastQuestionOrder && shuffled.length > 1) {
    [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
    order = shuffled.map((question) => question.sourceIndex).join(",");
  }
  lastQuestionOrder = order;
  return shuffled;
}

function showView(id, scroll = true) {
  const previousView = views.find((viewId) => !document.getElementById(viewId).hidden);
  for (const viewId of views) {
    const element = document.getElementById(viewId);
    if (element) element.hidden = viewId !== id;
  }
  $("#primary-nav").classList.remove("is-open");
  $("#menu-toggle").setAttribute("aria-expanded", "false");
  document.body.classList.toggle("app-mode", id !== "home");
  if (previousView !== id) {
    const page = { "lesson-view": "lesson", "quiz-view": "quiz" }[id] || id;
    trackPageView(page);
  }
  if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
}

function trackPageView(page) {
  fetch("/api/visit", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ page })
  })
    .then(() => recordVisitorHeartbeat())
    .catch((error) => console.error("CyBook visit tracking failed:", error));
}

function recordVisitorHeartbeat() {
  if (document.visibilityState !== "visible") return;
  fetch("/api/heartbeat", {
    method: "POST",
    credentials: "same-origin"
  }).then((response) => {
    if (!response.ok) throw new Error(`Heartbeat failed (${response.status}).`);
  }).catch((error) => console.error("CyBook visitor heartbeat failed:", error));
}

function openDashboard() { showView("dashboard"); }

function renderModule(index, changeView = true) {
  currentModule = (index + modules.length) % modules.length;
  const module = modules[currentModule];
  $("#lesson-kicker").textContent = `Module ${currentModule + 1} out of ${modules.length}`;
  $("#lesson-title").textContent = module.title;
  $("#lesson-lead").textContent = module.lead;
  const container = $("#lesson-content");
  container.replaceChildren();
  module.sections.forEach((section) => {
    const article = document.createElement("section");
    article.className = "lesson-slide";
    const heading = document.createElement("h2");
    const description = document.createElement("p");
    heading.textContent = section.title;
    description.textContent = section.text;
    article.append(heading, description);
    if (section.bullets) {
      const list = document.createElement("ul");
      for (const item of section.bullets) {
        const li = document.createElement("li");
        li.textContent = item;
        list.append(li);
      }
      article.append(list);
    }
    container.append(article);
  });
  const sources = document.createElement("section");
  sources.className = "module-sources";
  const sourcesHeading = document.createElement("h2");
  const sourcesList = document.createElement("ul");
  sourcesHeading.textContent = "Sources";
  for (const source of module.sources) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = source.label;
    item.append(link);
    sourcesList.append(item);
  }
  sources.append(sourcesHeading, sourcesList);
  container.append(sources);
  const tip = document.createElement("aside");
  const tipHeading = document.createElement("strong");
  const tipText = document.createElement("p");
  tip.className = "tip-box";
  tipHeading.textContent = textFor("practicalTip");
  tipText.textContent = module.tip;
  tip.append(tipHeading, tipText);
  container.append(tip);
  $("#previous-module").textContent = currentModule === 0
    ? textFor("backDashboard")
    : "← Previous module";
  $("#next-module").textContent = currentModule === modules.length - 1
    ? "Finish modules →"
    : "Next module →";
  if (changeView) showView("lesson-view");
}

function resetQuiz() {
  quizSubmitting = false;
  attemptId = "";
  $("#quiz-form").reset();
  $("#quiz-error").textContent = "";
  $("#nickname-error").textContent = "";
  $("#nickname-panel").hidden = false;
  $("#questions-panel").hidden = true;
  $("#quiz-result").hidden = true;
  $("#nickname").value = "";
}

function renderQuestions(preserveAnswers = false) {
  const previousAnswers = preserveAnswers
    ? activeQuestions.map((_, index) => document.querySelector(`input[name="question-${index}"]:checked`)?.value)
    : [];
  const list = $("#question-list");
  list.replaceChildren();
  $("#question-count").textContent = `${activeQuestions.length} ${textFor("questionsCount")}`;
  activeQuestions.forEach((question, index) => {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "question-card";
    const legend = document.createElement("legend");
    legend.textContent = `${index + 1}. ${question.prompt}`;
    legend.className = "question-legend";
    fieldset.append(legend);
    question.options.forEach((option, optionIndex) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      const text = document.createElement("span");
      label.className = "answer-option";
      input.type = "radio";
      input.name = `question-${index}`;
      input.value = String(optionIndex);
      input.required = true;
      input.checked = previousAnswers[index] === String(optionIndex);
      text.textContent = option;
      label.append(input, text);
      fieldset.append(label);
    });
    list.append(fieldset);
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) throw new Error(payload.error || `${textFor("requestFailed")} (${response.status}).`);
  return payload;
}

function renderReview(answers) {
  const review = $("#answer-review");
  review.replaceChildren();
  activeQuestions.forEach((question, index) => {
    const item = document.createElement("article");
    item.className = "review-item";
    const heading = document.createElement("strong");
    const selected = answers[index];
    const answerLine = document.createElement("p");
    const explanation = document.createElement("p");
    heading.textContent = `${index + 1}. ${question.prompt}`;
    answerLine.className = selected === question.answer ? "review-correct" : "review-wrong";
    answerLine.textContent = `${textFor("correctAnswer")} ${question.options[question.answer]}${selected === question.answer ? ` — ${textFor("answerCorrect")}` : ` · ${textFor("yourAnswer")} ${question.options[selected]}`}`;
    explanation.textContent = question.explanation;
    item.append(heading, answerLine, explanation);
    review.append(item);
  });
}

$("#start-learning").addEventListener("click", openDashboard);
$("#nav-start").addEventListener("click", openDashboard);
document.querySelector('.brand[href="#home"]').addEventListener("click", (event) => {
  if (!$("#home").hidden) return;
  event.preventDefault();
  showView("home");
});
$("#menu-toggle").addEventListener("click", () => {
  const open = $("#primary-nav").classList.toggle("is-open");
  $("#menu-toggle").setAttribute("aria-expanded", String(open));
});
$("#back-home").addEventListener("click", () => showView("home"));
document.querySelectorAll(".open-module").forEach((button) => {
  button.addEventListener("click", () => {
    const index = modules.findIndex((module) => module.id === button.dataset.module);
    if (index >= 0) renderModule(index);
  });
});
$("#back-dashboard").addEventListener("click", openDashboard);
$("#previous-module").addEventListener("click", () => currentModule === 0 ? openDashboard() : renderModule(currentModule - 1));
$("#next-module").addEventListener("click", () => currentModule === modules.length - 1 ? openDashboard() : renderModule(currentModule + 1));

$("#begin-quiz").addEventListener("click", () => {
  resetQuiz();
  showView("quiz-view");
});
$("#quiz-back").addEventListener("click", () => { resetQuiz(); openDashboard(); });
$("#nickname-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const nickname = $("#nickname").value.trim();
  if (!nickname || nickname.length > 24 || !/^[\p{L}\p{N}_ -]+$/u.test(nickname)) {
    $("#nickname-error").textContent = "Enter 1–24 letters, numbers, spaces, hyphens, or underscores.";
    return;
  }
  quizNickname = nickname;
  attemptId = crypto.randomUUID();
  activeQuestions = randomizeQuestions();
  renderQuestions();
  $("#nickname-panel").hidden = true;
  $("#questions-panel").hidden = false;
});

$("#quiz-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (quizSubmitting) return;
  const selected = activeQuestions.map((_, index) => {
    const choice = document.querySelector(`input[name="question-${index}"]:checked`);
    return choice ? Number(choice.value) : null;
  });
  if (selected.some((answer) => answer === null)) {
    $("#quiz-error").textContent = textFor("quizValidation");
    const firstUnanswered = selected.findIndex((answer) => answer === null);
    document.querySelector(`input[name="question-${firstUnanswered}"]`).focus();
    return;
  }
  quizSubmitting = true;
  const submit = $("#quiz-form button[type=submit]");
  submit.disabled = true;
  submit.textContent = textFor("quizSaving");
  $("#quiz-error").textContent = "";
  try {
    const answers = Array(questions.length);
    activeQuestions.forEach((question, index) => {
      answers[question.sourceIndex] = selected[index];
    });
    const result = await requestJson("/api/quiz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attempt_id: attemptId, nickname: quizNickname, answers })
    });
    $("#result-title").textContent = `${result.score} out of ${result.total}`;
    $("#save-status").textContent = textFor("savedSuccess");
  } catch (error) {
    const score = selected.reduce((total, answer, index) => total + Number(answer === activeQuestions[index].answer), 0);
    $("#result-title").textContent = `${score} out of ${activeQuestions.length}`;
    $("#save-status").textContent = `${textFor("savingFailed")} ${error.message}${textFor("retryLater")}`;
  } finally {
    renderReview(selected);
    $("#questions-panel").hidden = true;
    $("#quiz-result").hidden = false;
    submit.disabled = false;
    submit.innerHTML = `${textFor("submitAnswers")} <span aria-hidden="true">→</span>`;
  }
});
$("#retake-quiz").addEventListener("click", () => { resetQuiz(); showView("quiz-view"); });
$("#result-dashboard").addEventListener("click", () => { resetQuiz(); openDashboard(); });

trackPageView("home");
window.setInterval(recordVisitorHeartbeat, 30000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") recordVisitorHeartbeat();
});
for (const link of document.querySelectorAll('.primary-nav a[href^="#"]')) {
  link.addEventListener("click", (event) => {
    if (!$("#home").hidden) return;
    event.preventDefault();
    showView("home", false);
    document.querySelector(link.getAttribute("href")).scrollIntoView({ behavior: "smooth" });
  });
}