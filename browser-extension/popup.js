const codeInput = document.getElementById("code");
const apiBaseInput = document.getElementById("apiBase");
const fillButton = document.getElementById("fill");
const status = document.getElementById("status");
const reviewPanel = document.getElementById("reviewPanel");
const reviewButton = document.getElementById("review");
const reviewStatus = document.getElementById("reviewStatus");
const confirmCheckbox = document.getElementById("confirm");
const submitButton = document.getElementById("submit");
let activeTabId = null;
let lastReviewAllowed = false;

chrome.storage.local.get(["apiBase"], (saved) => {
  if (saved.apiBase) apiBaseInput.value = saved.apiBase;
});

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

function updateSubmitState() {
  submitButton.disabled = !(lastReviewAllowed && confirmCheckbox.checked);
}

async function reviewSubmission() {
  if (!activeTabId) throw new Error("Fill the page before reviewing it.");
  reviewButton.disabled = true;
  reviewStatus.textContent =
    "Checking required fields and the final submit button…";
  try {
    const response = await sendToTab(activeTabId, {
      type: "JOB_APPLY_REVIEW_SUBMISSION",
    });
    if (!response?.ok) throw new Error("Could not review this page.");
    const { review } = response;
    lastReviewAllowed = Boolean(review.allowed);
    confirmCheckbox.checked = false;
    if (review.captchaDetected) {
      reviewStatus.textContent =
        "A CAPTCHA was detected. Complete it manually, then recheck.";
    } else if (review.planBlocked) {
      reviewStatus.textContent =
        "Some captured questions are unresolved. Review and complete them manually; submission remains blocked for this fill plan.";
    } else if (review.requiredEmpty.length > 0) {
      reviewStatus.textContent = `Required fields still empty: ${review.requiredEmpty.slice(0, 4).join(", ")}.`;
    } else if (review.candidates.length !== 1) {
      reviewStatus.textContent = `Expected one final Submit button, found ${review.candidates.length}. Submit manually.`;
    } else {
      reviewStatus.textContent = `Ready to submit using “${review.candidates[0]}”. Check the confirmation box below.`;
    }
    updateSubmitState();
  } finally {
    reviewButton.disabled = false;
  }
}

confirmCheckbox.addEventListener("change", updateSubmitState);
reviewButton.addEventListener("click", () => {
  reviewSubmission().catch((error) => {
    reviewStatus.textContent =
      error instanceof Error ? error.message : "Review failed.";
  });
});

submitButton.addEventListener("click", async () => {
  if (!activeTabId || !lastReviewAllowed || !confirmCheckbox.checked) return;
  if (
    !window.confirm(
      "Submit this job application now? This action cannot be undone.",
    )
  ) {
    return;
  }
  submitButton.disabled = true;
  reviewStatus.textContent = "Submitting application…";
  try {
    const response = await sendToTab(activeTabId, {
      type: "JOB_APPLY_CONFIRM_SUBMIT",
      confirmation: "confirmed",
    });
    if (!response?.ok) {
      throw new Error(response?.error || "The page blocked submission.");
    }
    reviewStatus.textContent =
      "Submission action sent. Verify the employer confirmation page.";
  } catch (error) {
    reviewStatus.textContent =
      error instanceof Error ? error.message : "Submission failed.";
    updateSubmitState();
  }
});

fillButton.addEventListener("click", async () => {
  const code = codeInput.value.trim();
  const apiBase = apiBaseInput.value.trim().replace(/\/+$/, "");
  if (!code) {
    status.textContent = "Paste an auto-fill code first.";
    return;
  }

  fillButton.disabled = true;
  status.textContent = "Inspecting form…";
  try {
    await chrome.storage.local.set({ apiBase });
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) throw new Error("No active application tab found.");
    activeTabId = tab.id;
    const captured = await sendToTab(tab.id, { type: "JOB_APPLY_CAPTURE" });
    if (!captured?.ok || captured.questions.length === 0) {
      throw new Error("No supported form fields were found on this page.");
    }

    status.textContent = `Resolving ${captured.questions.length} fields…`;
    const response = await fetch(`${apiBase}/api/application-assistant/fill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, questions: captured.questions }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload?.error?.message || "Auto-fill request failed.");
    }

    const applied = await sendToTab(tab.id, {
      type: "JOB_APPLY_APPLY",
      plan: payload.data.plan,
      resume: payload.data.resume,
    });
    if (!applied?.ok) throw new Error("The page rejected the fill operation.");
    status.textContent = `${applied.result.filled} fields filled; ${applied.result.unresolved} need review.`;
    reviewPanel.hidden = false;
    lastReviewAllowed = false;
    confirmCheckbox.checked = false;
    updateSubmitState();
    await reviewSubmission();
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : "Auto-fill failed.";
  } finally {
    fillButton.disabled = false;
  }
});
