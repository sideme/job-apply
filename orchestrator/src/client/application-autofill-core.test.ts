import { beforeAll, beforeEach, describe, expect, it } from "vitest";

type AutofillApi = {
  capture(root: Document): {
    fields: unknown[];
    questions: Array<{ label: string; type: string; options?: string[] }>;
  };
  apply(
    root: Document,
    fields: unknown[],
    plan: {
      answers: Array<{ index: number; answer: { value: unknown } }>;
      unresolved: unknown[];
      submission?: { allowed: boolean };
    },
    resume: null,
  ): { filled: number; unresolved: number; resumeUploaded: boolean };
  reviewSubmission(root: Document): {
    allowed: boolean;
    requiredEmpty: string[];
    captchaDetected: boolean;
    candidates: string[];
  };
  confirmSubmit(root: Document): { submitted: boolean };
};

declare global {
  var JobApplyAutofill: AutofillApi;
}

beforeAll(async () => {
  // @ts-expect-error Browser-extension scripts intentionally ship without TS declarations.
  await import("../../../browser-extension/autofill-core.js");
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("browser application auto-fill core", () => {
  it("captures labelled fields and applies text and select answers", () => {
    document.body.innerHTML = `
      <label for="authorization">Are you authorized to work in Canada?</label>
      <select id="authorization" name="authorization">
        <option value="">Choose</option><option>Yes</option><option>No</option>
      </select>
      <label for="permit">Work permit type</label>
      <input id="permit" name="permit" />
    `;
    const captured = globalThis.JobApplyAutofill.capture(document);
    expect(captured.questions).toEqual([
      expect.objectContaining({
        label: "Are you authorized to work in Canada?",
        type: "select",
        options: ["Choose", "Yes", "No"],
      }),
      expect.objectContaining({ label: "Work permit type", type: "text" }),
    ]);

    const result = globalThis.JobApplyAutofill.apply(
      document,
      captured.fields,
      {
        answers: [
          { index: 0, answer: { value: "Yes" } },
          { index: 1, answer: { value: "Open work permit" } },
        ],
        unresolved: [],
      },
      null,
    );

    expect(result.filled).toBe(2);
    expect(
      (document.getElementById("authorization") as HTMLSelectElement).value,
    ).toBe("Yes");
    expect((document.getElementById("permit") as HTMLInputElement).value).toBe(
      "Open work permit",
    );
  });

  it("uses native setters so React-style controlled fields receive input events", () => {
    document.body.innerHTML = `<label for="email">Email</label><input id="email" type="email" />`;
    const input = document.getElementById("email") as HTMLInputElement;
    let inputEvents = 0;
    input.addEventListener("input", () => {
      inputEvents += 1;
    });
    const captured = globalThis.JobApplyAutofill.capture(document);
    globalThis.JobApplyAutofill.apply(
      document,
      captured.fields,
      {
        answers: [{ index: 0, answer: { value: "ada@example.com" } }],
        unresolved: [],
        submission: { allowed: true },
      },
      null,
    );
    expect(input.value).toBe("ada@example.com");
    expect(inputEvents).toBe(1);
  });

  it("requires one submit button, no CAPTCHA, and no empty required fields", () => {
    document.body.innerHTML = `
      <label for="name">Full name</label><input id="name" required value="Ada Lovelace" />
      <button type="button" id="submit">Submit application</button>
    `;
    let clicked = false;
    document.getElementById("submit")?.addEventListener("click", () => {
      clicked = true;
    });

    expect(globalThis.JobApplyAutofill.reviewSubmission(document)).toEqual({
      allowed: true,
      requiredEmpty: [],
      captchaDetected: false,
      candidates: ["Submit application"],
    });
    expect(globalThis.JobApplyAutofill.confirmSubmit(document).submitted).toBe(
      true,
    );
    expect(clicked).toBe(true);
  });

  it("blocks submission when a required field or CAPTCHA remains", () => {
    document.body.innerHTML = `
      <label for="phone">Phone</label><input id="phone" required />
      <div>Verify you are human with CAPTCHA</div>
      <button type="button">Submit</button>
    `;
    const review = globalThis.JobApplyAutofill.reviewSubmission(document);
    expect(review.allowed).toBe(false);
    expect(review.requiredEmpty).toEqual(["Phone"]);
    expect(review.captchaDetected).toBe(true);
  });
});
