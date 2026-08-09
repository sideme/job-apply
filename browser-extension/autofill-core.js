(() => {
  const normalize = (value) =>
    String(value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  function collectRoots(root = document) {
    const roots = [root];
    const visited = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) {
      const current = roots[index];
      for (const element of current.querySelectorAll?.("*") ?? []) {
        if (element.shadowRoot && !visited.has(element.shadowRoot)) {
          visited.add(element.shadowRoot);
          roots.push(element.shadowRoot);
        }
        if (element instanceof HTMLIFrameElement) {
          try {
            const frameDocument = element.contentDocument;
            if (frameDocument && !visited.has(frameDocument)) {
              visited.add(frameDocument);
              roots.push(frameDocument);
            }
          } catch {
            // Cross-origin frames are intentionally left for manual review.
          }
        }
      }
    }
    return roots;
  }

  function directLabelFor(element) {
    const labels = Array.from(element.labels ?? [])
      .map((label) => label.textContent?.trim())
      .filter(Boolean);
    if (labels.length > 0) return labels.join(" ");
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const owner = element.ownerDocument ?? document;
      const text = labelledBy
        .split(/\s+/)
        .map((id) => owner.getElementById(id)?.textContent?.trim())
        .filter(Boolean)
        .join(" ");
      if (text) return text;
    }
    return element.getAttribute("aria-label") || "";
  }

  function labelFor(element) {
    const direct = directLabelFor(element);
    if (direct) return direct;
    const fieldset = element.closest?.("fieldset");
    const legend = fieldset
      ?.querySelector(":scope > legend")
      ?.textContent?.trim();
    if (legend) return legend;
    return (
      element.getAttribute("data-automation-label") ||
      element.getAttribute("placeholder") ||
      element.getAttribute("name") ||
      element.getAttribute("id") ||
      "Unlabelled field"
    );
  }

  function optionLabel(element) {
    return (
      directLabelFor(element) || element.value || element.textContent?.trim()
    );
  }

  function controlledOptions(element) {
    const owner = element.ownerDocument ?? document;
    const controlledId = element.getAttribute("aria-controls");
    const container = controlledId ? owner.getElementById(controlledId) : null;
    return Array.from((container ?? owner).querySelectorAll('[role="option"]'))
      .map((option) => option.textContent?.trim())
      .filter(Boolean);
  }

  function capture(root = document) {
    const elements = collectRoots(root).flatMap((candidateRoot) =>
      Array.from(
        candidateRoot.querySelectorAll(
          'input, select, textarea, [contenteditable="true"], [role="combobox"]',
        ),
      ),
    );
    const eligible = elements.filter((element) => {
      if (element.disabled || element.readOnly) return false;
      if (element instanceof HTMLInputElement) {
        return !["hidden", "submit", "button", "reset", "file"].includes(
          element.type,
        );
      }
      return true;
    });

    const fields = [];
    const consumedRadioNames = new Set();
    for (const element of eligible) {
      if (element instanceof HTMLInputElement && element.type === "radio") {
        const ownerKey = element.ownerDocument?.URL ?? "document";
        const name = `${ownerKey}:${element.name || `radio-${fields.length}`}`;
        if (consumedRadioNames.has(name)) continue;
        consumedRadioNames.add(name);
        const group = eligible.filter(
          (candidate) =>
            candidate instanceof HTMLInputElement &&
            candidate.type === "radio" &&
            candidate.name === element.name &&
            candidate.ownerDocument === element.ownerDocument,
        );
        fields.push({
          kind: "radio",
          elements: group,
          question: {
            label: labelFor(element),
            name: element.name || null,
            type: "radio",
            options: group.map(optionLabel).filter(Boolean),
          },
        });
        continue;
      }

      const isCustomSelect =
        !(element instanceof HTMLSelectElement) &&
        element.getAttribute("role") === "combobox";
      const options =
        element instanceof HTMLSelectElement
          ? Array.from(element.options)
              .filter((option) => option.value || option.textContent?.trim())
              .map((option) => option.textContent?.trim() || option.value)
          : isCustomSelect
            ? controlledOptions(element)
            : undefined;
      fields.push({
        kind:
          element instanceof HTMLSelectElement
            ? "select"
            : isCustomSelect
              ? "custom_select"
              : element instanceof HTMLInputElement &&
                  element.type === "checkbox"
                ? "checkbox"
                : element.getAttribute("contenteditable") === "true"
                  ? "contenteditable"
                  : "text",
        elements: [element],
        question: {
          label: labelFor(element),
          name: element.getAttribute("name"),
          type: isCustomSelect
            ? "select"
            : element instanceof HTMLInputElement
              ? element.type
              : element.tagName.toLowerCase(),
          ...(options?.length ? { options } : {}),
        },
      });
    }
    return { fields, questions: fields.map((field) => field.question) };
  }

  function dispatch(element) {
    element.dispatchEvent(
      new Event("input", { bubbles: true, composed: true }),
    );
    element.dispatchEvent(
      new Event("change", { bubbles: true, composed: true }),
    );
    element.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
  }

  function setNativeProperty(element, property, value) {
    const prototype =
      element instanceof HTMLInputElement
        ? globalThis.HTMLInputElement?.prototype
        : element instanceof HTMLTextAreaElement
          ? globalThis.HTMLTextAreaElement?.prototype
          : element instanceof HTMLSelectElement
            ? globalThis.HTMLSelectElement?.prototype
            : null;
    const setter = prototype
      ? Object.getOwnPropertyDescriptor(prototype, property)?.set
      : null;
    if (setter) setter.call(element, value);
    else element[property] = value;
  }

  function applyValue(field, value) {
    if (field.kind === "radio") {
      const target = field.elements.find(
        (element) => normalize(optionLabel(element)) === normalize(value),
      );
      if (!target) return false;
      setNativeProperty(target, "checked", true);
      target.click?.();
      dispatch(target);
      return true;
    }

    const element = field.elements[0];
    if (field.kind === "checkbox") {
      setNativeProperty(element, "checked", Boolean(value));
      dispatch(element);
      return true;
    }
    if (field.kind === "select") {
      const values = Array.isArray(value) ? value : [value];
      let matched = false;
      for (const option of element.options) {
        const selected = values.some(
          (item) =>
            normalize(option.textContent) === normalize(item) ||
            normalize(option.value) === normalize(item),
        );
        option.selected = selected;
        matched ||= selected;
      }
      if (matched) dispatch(element);
      return matched;
    }
    if (field.kind === "custom_select") {
      element.click?.();
      const values = Array.isArray(value) ? value : [value];
      const owner = element.ownerDocument ?? document;
      const target = Array.from(owner.querySelectorAll('[role="option"]')).find(
        (option) =>
          values.some(
            (item) => normalize(option.textContent) === normalize(item),
          ),
      );
      if (!target) return false;
      target.click?.();
      return true;
    }
    const text = Array.isArray(value) ? value.join(", ") : String(value);
    element.focus?.();
    if (field.kind === "contenteditable") element.textContent = text;
    else setNativeProperty(element, "value", text);
    dispatch(element);
    return true;
  }

  function uploadResume(root, resume) {
    if (!resume || typeof DataTransfer === "undefined") return false;
    const inputs = collectRoots(root).flatMap((candidateRoot) =>
      Array.from(candidateRoot.querySelectorAll('input[type="file"]')),
    );
    const input = inputs.find((candidate) => {
      const hint = normalize(
        `${candidate.name} ${candidate.id} ${candidate.accept} ${labelFor(candidate)}`,
      );
      return (
        hint.includes("resume") || hint.includes("cv") || hint.includes("pdf")
      );
    });
    if (!input) return false;
    const bytes = Uint8Array.from(atob(resume.contentBase64), (char) =>
      char.charCodeAt(0),
    );
    const file = new File([bytes], resume.filename, { type: resume.mimeType });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    dispatch(input);
    return true;
  }

  function apply(root, fields, plan, resume) {
    let filled = 0;
    const failed = [];
    for (const item of plan.answers) {
      const field = fields[item.index];
      if (field && applyValue(field, item.answer.value)) filled += 1;
      else failed.push(field?.question?.label ?? `Field ${item.index + 1}`);
    }
    return {
      filled,
      unresolved: plan.unresolved.length + failed.length,
      unresolvedLabels: [
        ...plan.unresolved.map((item) => item.question?.label).filter(Boolean),
        ...failed,
      ],
      resumeUploaded: uploadResume(root, resume),
      submissionAllowed:
        Boolean(plan.submission?.allowed) && failed.length === 0,
    };
  }

  function isEmptyRequired(element) {
    if (
      !(element.required || element.getAttribute("aria-required") === "true")
    ) {
      return false;
    }
    if (
      element instanceof HTMLInputElement &&
      ["checkbox", "radio"].includes(element.type)
    ) {
      return !element.checked;
    }
    return !String(element.value ?? element.textContent ?? "").trim();
  }

  function submitCandidates(root = document) {
    const candidates = collectRoots(root).flatMap((candidateRoot) =>
      Array.from(
        candidateRoot.querySelectorAll(
          'button, input[type="submit"], [role="button"]',
        ),
      ),
    );
    return Array.from(new Set(candidates)).filter((element) => {
      if (element.disabled || element.getAttribute("aria-disabled") === "true")
        return false;
      const label = normalize(
        element.value ||
          element.textContent ||
          element.getAttribute("aria-label"),
      );
      return /^(submit|submit application|send application|apply now|complete application)$/.test(
        label,
      );
    });
  }

  function reviewSubmission(root = document) {
    const requiredEmpty = collectRoots(root)
      .flatMap((candidateRoot) =>
        Array.from(
          candidateRoot.querySelectorAll(
            'input[required], select[required], textarea[required], [aria-required="true"]',
          ),
        ),
      )
      .filter(isEmptyRequired)
      .map(labelFor);
    const pageText = normalize(
      root.body?.innerText || root.body?.textContent || "",
    );
    const captchaDetected =
      /captcha|recaptcha|hcaptcha|verify you are human/.test(pageText);
    const candidates = submitCandidates(root);
    return {
      allowed:
        requiredEmpty.length === 0 &&
        !captchaDetected &&
        candidates.length === 1,
      requiredEmpty,
      captchaDetected,
      candidates: candidates.map((element) =>
        String(
          element.value ||
            element.textContent ||
            element.getAttribute("aria-label") ||
            "Submit",
        ).trim(),
      ),
    };
  }

  function confirmSubmit(root = document) {
    const review = reviewSubmission(root);
    if (!review.allowed) return { submitted: false, review };
    const [target] = submitCandidates(root);
    const form = target?.form ?? target?.closest?.("form");
    if (form?.requestSubmit && target instanceof HTMLButtonElement) {
      form.requestSubmit(target);
    } else {
      target?.click?.();
    }
    return { submitted: true, review };
  }

  globalThis.JobApplyAutofill = {
    capture,
    apply,
    reviewSubmission,
    confirmSubmit,
  };
})();
