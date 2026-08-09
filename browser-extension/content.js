(() => {
  let capturedFields = [];
  let serverAllowsSubmission = false;

  function showSummary(result) {
    document.getElementById("job-apply-autofill-summary")?.remove();
    const box = document.createElement("div");
    box.id = "job-apply-autofill-summary";
    box.style.cssText =
      "position:fixed;right:16px;top:16px;z-index:2147483647;max-width:340px;padding:14px 16px;border:1px solid #fb923c;border-radius:10px;background:#111827;color:#f9fafb;font:13px/1.45 system-ui;box-shadow:0 12px 30px rgba(0,0,0,.35)";
    box.textContent = `Job Apply filled ${result.filled} fields; ${result.unresolved} need review. Resume ${result.resumeUploaded ? "uploaded" : "not uploaded"}. Review the page before confirming submission.`;
    document.documentElement.appendChild(box);
    setTimeout(() => box.remove(), 12_000);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "JOB_APPLY_CAPTURE") {
      const capture = globalThis.JobApplyAutofill.capture(document);
      capturedFields = capture.fields;
      sendResponse({ ok: true, questions: capture.questions });
      return;
    }
    if (message?.type === "JOB_APPLY_APPLY") {
      const result = globalThis.JobApplyAutofill.apply(
        document,
        capturedFields,
        message.plan,
        message.resume,
      );
      serverAllowsSubmission = result.submissionAllowed;
      showSummary(result);
      sendResponse({ ok: true, result });
      return;
    }
    if (message?.type === "JOB_APPLY_REVIEW_SUBMISSION") {
      const review = globalThis.JobApplyAutofill.reviewSubmission(document);
      sendResponse({
        ok: true,
        review: {
          ...review,
          allowed: review.allowed && serverAllowsSubmission,
          planBlocked: !serverAllowsSubmission,
        },
      });
      return;
    }
    if (message?.type === "JOB_APPLY_CONFIRM_SUBMIT") {
      if (message.confirmation !== "confirmed" || !serverAllowsSubmission) {
        sendResponse({
          ok: false,
          error: "Submission confirmation is missing.",
        });
        return;
      }
      const result = globalThis.JobApplyAutofill.confirmSubmit(document);
      sendResponse({ ok: result.submitted, result });
    }
  });
})();
