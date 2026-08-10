# Job Apply Auto-fill browser extension

This unpacked Chrome/Edge extension fills employer application forms from your
local Job Apply configuration. It never submits until required fields are
complete, no CAPTCHA is detected, exactly one final submit button is found, and
you approve both confirmation steps.

## Install

1. Clone or download the full `job-apply` repository and start the app at
   `http://localhost:3005`.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this `browser-extension` directory.
5. Pin **Job Apply Auto-fill** to the browser toolbar.

GitHub cannot install an unpacked extension directly from the repository page;
the folder must exist on your computer first.

## Use

1. Configure `data/application-answers.json` and upload your PDF resume in Job
   Apply Settings.
2. Open a job in Job Apply and choose **Prepare auto-fill**. Copy the encrypted
   code; it expires after 30 minutes.
3. Open the employer application form, then open the extension.
4. Paste the code and choose **Fill this page**.
5. Complete unresolved fields and any CAPTCHA manually, then choose **Recheck
   page**.
6. Tick the review checkbox and choose **Confirm and submit application**.
7. Accept the final browser confirmation. Job Apply records the submission and
   sends the configured WhatsApp notification after the submit action succeeds.

For multi-step forms, fill and review one page at a time. Cross-origin embedded
forms and unsupported custom controls remain manual by design.
