# LinkedIn Circuit Breaker & WhatsApp Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-site failure isolation and a LinkedIn-specific cooldown/circuit-breaker to the JobSpy extractor, relay job-ops's existing pipeline webhooks to WhatsApp, and get a first real pipeline run configured for nationwide Canada discovery.

> Status (2026-08-09): retained only as the original TDD execution record. The unchecked boxes and relay commands below are historical and must not be followed. WhatsApp now sends directly from the server, and recurring discovery uses the optional `scheduler` Docker profile. Use the root README for current setup.

**Architecture:** `scrape_jobs.py` scrapes each JobSpy site independently and reports per-site failures via a new `site_error` progress event instead of crashing the whole process. The TS wrapper (`run.ts`) aggregates these into `JobSpyResult.siteErrors`, which the `jobspy` manifest passes through unchanged. `discoverJobsStep` (the one orchestrator-level place that already knows about all sources) checks a `linkedinCooldownUntil` setting before running LinkedIn, and after a run, trips the breaker (sets the cooldown + notifies) if a LinkedIn `site_error` came back — without failing the rest of the pipeline. Notifications go out through job-ops's existing webhook mechanism to a small local relay script that forwards to WhatsApp via CallMeBot.

**Tech Stack:** TypeScript (orchestrator, Node 22, vitest), Python 3 (JobSpy extractor), Node built-in `http`/`fetch` for the notification relay, system cron/launchd for scheduling.

Reference: [design doc](../specs/2026-08-07-canada-job-search-adoption-plan-design.md).

---

### Task 1: Add `linkedinCooldownUntil` setting

**Files:**
- Modify: `shared/src/settings-registry.ts:153` (insert after the `jobCompleteWebhookUrl` entry, before `resumeProjects`)
- Test: `shared/src/settings-registry.test.ts` (create if it doesn't already cover this pattern — check first with `find shared/src -iname "settings-registry.test.ts"`; if it exists, add to it instead of creating a new file)

- [ ] **Step 1: Check for an existing settings-registry test file**

Run: `find /Users/Side/code/job-apply/shared/src -iname "settings-registry.test.ts"`

If it exists, open it and note the existing test pattern (how another `"typed"` string setting like `pipelineWebhookUrl` is tested) before writing Step 2. If it doesn't exist, Step 2 creates it fresh, modeled on the `settingsRegistry.pipelineWebhookUrl` shape read directly from `shared/src/settings-registry.ts`.

- [ ] **Step 2: Write the failing test**

Add to `shared/src/settings-registry.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { settingsRegistry } from "./settings-registry";

describe("settingsRegistry.linkedinCooldownUntil", () => {
  it("defaults to an empty string", () => {
    expect(settingsRegistry.linkedinCooldownUntil.default()).toBe("");
  });

  it("parses a non-empty ISO string and rejects empty/undefined", () => {
    const iso = "2026-08-07T12:00:00.000Z";
    expect(settingsRegistry.linkedinCooldownUntil.parse(iso)).toBe(iso);
    expect(settingsRegistry.linkedinCooldownUntil.parse("")).toBeNull();
    expect(settingsRegistry.linkedinCooldownUntil.parse(undefined)).toBeNull();
  });

  it("serializes a value back to itself, and null/undefined to null", () => {
    expect(settingsRegistry.linkedinCooldownUntil.serialize("2026-08-07T12:00:00.000Z")).toBe(
      "2026-08-07T12:00:00.000Z",
    );
    expect(settingsRegistry.linkedinCooldownUntil.serialize(null)).toBeNull();
    expect(settingsRegistry.linkedinCooldownUntil.serialize(undefined)).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

There is a single, central vitest config for the whole monorepo: `orchestrator/vite.config.ts`'s `test.include` covers `src/**/*.test.ts` (orchestrator), `../shared/src/**/*.test.ts`, and `../extractors/**/tests/**/*.test.ts` — all run together via `npm --workspace orchestrator run test:run`. `shared/` and `extractors/jobspy/` have no `test:run` script of their own (in fact `extractors/jobspy` has no `package.json` at all — it's not a separate npm workspace). Every test command in this plan therefore runs from the `orchestrator` workspace with a `--` filter pattern, regardless of which directory the test file physically lives in.

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- settings-registry`

Expected: FAIL — `settingsRegistry.linkedinCooldownUntil` is `undefined`.

- [ ] **Step 4: Add the registry entry**

In `shared/src/settings-registry.ts`, insert immediately after the `jobCompleteWebhookUrl` entry closes (after the line `  },` that follows `parse: parseNonEmptyStringOrNull,` / `serialize: ...` for `jobCompleteWebhookUrl`, i.e. right before the `resumeProjects:` key):

```typescript
  linkedinCooldownUntil: {
    kind: "typed" as const,
    schema: z.string().trim().max(64),
    default: (): string => "",
    parse: parseNonEmptyStringOrNull,
    serialize: (value: string | null | undefined): string | null =>
      value ?? null,
  },
```

This stores an ISO-8601 timestamp string (or is absent/empty when not in cooldown) — same shape/handling as the existing webhook URL settings, so `getSetting`/`setSetting`/`getAllSettings` in `orchestrator/src/server/repositories/settings.ts` work with it for free via the existing `SettingKey` type.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- settings-registry`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/Side/code/job-apply
git add shared/src/settings-registry.ts shared/src/settings-registry.test.ts
git commit -m "feat: add linkedinCooldownUntil setting for circuit breaker"
```

---

### Task 2: Per-site isolation in the JobSpy Python scraper

**Files:**
- Modify: `extractors/jobspy/scrape_jobs.py`

There is no existing Python test suite in this extractor (`extractors/jobspy/tests/run.test.ts` tests the TS wrapper, not the Python script), so this task is verified by direct manual invocation rather than TDD — matches how this file is currently validated (it's a thin script around the third-party `jobspy` library, not unit-tested today).

- [ ] **Step 1: Replace the site-grouping logic with a per-site loop with isolated error handling**

In `extractors/jobspy/scrape_jobs.py`, replace the block from `frames: list[pd.DataFrame] = []` (currently line 144) through the `jobs = pd.concat(...)` line (currently line 189) with:

```python
    frames: list[pd.DataFrame] = []
    site_errors: list[dict[str, str]] = []

    for site in sites:
        site_location = location
        if site == "glassdoor" and _is_country_level_location(location, country_indeed):
            fallback_city = _glassdoor_city_for_country(country_indeed, location)
            if fallback_city:
                site_location = fallback_city
                print(
                    "jobspy: Glassdoor location matched country; using city fallback "
                    f"({fallback_city})"
                )
            else:
                print(
                    "jobspy: Glassdoor location matched country; keeping original location"
                )

        try:
            frame = _scrape_for_sites(
                sites=[site],
                search_term=search_term,
                location=site_location,
                results_wanted=results_wanted,
                hours_old=hours_old,
                country_indeed=country_indeed,
                linkedin_fetch_description=linkedin_fetch_description,
                is_remote=is_remote,
            )
            frames.append(frame)
        except Exception as exc:  # noqa: BLE001 - deliberately broad: isolate one site's failure from the rest
            error_message = f"{type(exc).__name__}: {exc}"[:500]
            print(f"jobspy: site '{site}' failed: {error_message}")
            site_errors.append({"site": site, "error": error_message})
            _emit_progress(
                "site_error",
                {
                    "termIndex": term_index,
                    "termTotal": term_total,
                    "searchTerm": search_term,
                    "site": site,
                    "error": error_message,
                },
            )

    jobs = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
```

This changes behavior in three ways: (1) each site is now scraped in its own `scrape_jobs()` call instead of batching `indeed`+`linkedin` together, so a LinkedIn-specific failure can no longer take down Indeed results for the same term; (2) any exception from the underlying `jobspy` library is caught per-site instead of crashing the whole process (which previously would abort the entire multi-term `runJobSpy` loop in `run.ts` on any single failure); (3) a new `site_error` progress event reports exactly which site failed and why, distinct from "this site legitimately returned zero new postings."

- [ ] **Step 2: Manually verify the script still runs end-to-end for a working site**

Run (from `extractors/jobspy/`, with `requirements.txt` installed in a venv):

```bash
cd /Users/Side/code/job-apply/extractors/jobspy
JOBSPY_SITES=indeed JOBSPY_SEARCH_TERM="backend engineer" JOBSPY_LOCATION=Canada \
JOBSPY_RESULTS_WANTED=5 JOBSPY_HOURS_OLD=72 JOBSPY_COUNTRY_INDEED=Canada \
JOBSPY_OUTPUT_CSV=/tmp/jobops-test.csv JOBSPY_OUTPUT_JSON=/tmp/jobops-test.json \
python3 scrape_jobs.py
```

Expected: exits 0, prints `Found N jobs`, writes `/tmp/jobops-test.json` with up to 5 rows. (If Python deps aren't installed yet, `pip install -r requirements.txt` first, ideally in a venv.)

- [ ] **Step 3: Manually verify a simulated site failure is isolated, not fatal**

Temporarily set `JOBSPY_SITES=bogus_site,indeed` and re-run the same command — `_parse_sites`/`site_name` validation inside the underlying `jobspy` library should reject `bogus_site`; confirm the process still exits 0, still prints `Found N jobs` from the `indeed` results, and prints a `jobspy: site 'bogus_site' failed: ...` line plus a `JOBOPS_PROGRESS {"event": "site_error", ...}` line. This stands in for a real LinkedIn block, since deliberately triggering a real LinkedIn CAPTCHA on demand isn't practical for a dev-time check.

- [ ] **Step 4: Commit**

```bash
cd /Users/Side/code/job-apply
git add extractors/jobspy/scrape_jobs.py
git commit -m "feat: isolate per-site JobSpy failures instead of crashing whole run"
```

---

### Task 3: Aggregate `site_error` events in the JobSpy TS wrapper

**Files:**
- Modify: `extractors/jobspy/src/run.ts`
- Test: `extractors/jobspy/tests/run.test.ts`

- [ ] **Step 1: Read the existing test file first**

Run: `sed -n '1,60p' /Users/Side/code/job-apply/extractors/jobspy/tests/run.test.ts` to confirm the exact mocking style used for `spawn`/child process output before adding to it (it already tests `parseJobSpyProgressLine` and/or `runJobSpy`; match its existing conventions for the new test rather than introducing a different style).

- [ ] **Step 2: Write the failing test for progress-line parsing**

Add to `extractors/jobspy/tests/run.test.ts`:

```typescript
import { parseJobSpyProgressLine } from "../src/run";

describe("parseJobSpyProgressLine - site_error", () => {
  it("parses a site_error progress line", () => {
    const line =
      'JOBOPS_PROGRESS {"event":"site_error","termIndex":1,"termTotal":1,"searchTerm":"backend engineer","site":"linkedin","error":"HTTPError: 429"}';
    const event = parseJobSpyProgressLine(line);
    expect(event).toEqual({
      type: "site_error",
      termIndex: 1,
      termTotal: 1,
      searchTerm: "backend engineer",
      site: "linkedin",
      error: "HTTPError: 429",
    });
  });

  it("returns null for a site_error line missing the site field", () => {
    const line =
      'JOBOPS_PROGRESS {"event":"site_error","termIndex":1,"termTotal":1,"searchTerm":"x","error":"boom"}';
    expect(parseJobSpyProgressLine(line)).toBeNull();
  });
});
```

(Adjust the `import`/`describe` wrapper to match whatever this file already imports at the top — if it already imports `parseJobSpyProgressLine` and vitest globals, don't re-import; just add the new `describe` block.)

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- extractors/jobspy/tests/run.test.ts` (per the note in Task 1 — `extractors/jobspy` has no `package.json`/workspace of its own; its tests run through orchestrator's central vitest config, which includes `../extractors/**/tests/**/*.test.ts`)

Expected: FAIL — `type: "site_error"` doesn't exist yet / returns `null` unexpectedly for the first case.

- [ ] **Step 4: Extend the progress event type and parser**

In `extractors/jobspy/src/run.ts`, extend the `JobSpyProgressEvent` union (currently ends after the `term_complete` variant, around line 32):

```typescript
export type JobSpyProgressEvent =
  | {
      type: "term_start";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
    }
  | {
      type: "term_complete";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      jobsFoundTerm: number;
    }
  | {
      type: "site_error";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      site: string;
      error: string;
    };
```

Then extend `parseJobSpyProgressLine` (after the existing `if (eventName === "term_complete") { ... }` block, before the final `return null;`):

```typescript
  if (eventName === "site_error") {
    const site = toStringOrNull(parsed.site);
    const errorMessage = toStringOrNull(parsed.error);
    if (!site || !errorMessage) return null;
    return {
      type: "site_error",
      termIndex,
      termTotal,
      searchTerm,
      site,
      error: errorMessage,
    };
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- extractors/jobspy/tests/run.test.ts`

Expected: PASS

- [ ] **Step 6: Write the failing test for `runJobSpy` aggregating site errors**

Add to the same test file (mirror however the file already mocks `node:child_process` `spawn` for `runJobSpy` tests — if it doesn't yet test `runJobSpy` directly because it shells out to a real subprocess, add this as an integration-style test gated the same way existing `runJobSpy` tests are; if no `runJobSpy` test exists yet, skip Steps 6-8 and instead add a plain unit test of a small extracted aggregation helper — see Step 7's note):

```typescript
it("JobSpyResult includes siteErrors aggregated from progress events", () => {
  // If runJobSpy already has subprocess-mocked tests in this file, add a
  // case here that feeds a stdout line containing a site_error JOBOPS_PROGRESS
  // event through the mocked child process and asserts the returned
  // JobSpyResult.siteErrors contains { site: "linkedin", error: "..." }.
});
```

- [ ] **Step 7: Add a `siteErrors` accumulator inside `runJobSpy`**

In `extractors/jobspy/src/run.ts`, inside `runJobSpy` (around where `const jobs: CreateJobInput[] = [];` and `const seenJobUrls = new Set<string>();` are declared, currently lines 170-171), add:

```typescript
    const siteErrors: Array<{ site: string; error: string }> = [];
```

Inside the `handleLine` closure (currently lines 222-229), after the existing `if (event) { options.onProgress?.(event); return; }`, add a branch before that check so `site_error` events are both forwarded to `options.onProgress` (already happens via the existing line) and captured locally:

```typescript
          const handleLine = (line: string, stream: NodeJS.WriteStream) => {
            const event = parseJobSpyProgressLine(line);
            if (event) {
              if (event.type === "site_error") {
                siteErrors.push({ site: event.site, error: event.error });
              }
              options.onProgress?.(event);
              return;
            }
            stream.write(`${line}\n`);
          };
```

Update the `JobSpyResult` interface (currently lines 138-142):

```typescript
export interface JobSpyResult {
  success: boolean;
  jobs: CreateJobInput[];
  siteErrors: Array<{ site: string; error: string }>;
  error?: string;
}
```

Update both `return` statements in `runJobSpy` to include `siteErrors`:

```typescript
    return { success: true, jobs, siteErrors };
```

(replacing `return { success: true, jobs };` at the end of the try block), and:

```typescript
    return { success: false, jobs: [], siteErrors, error: message };
```

(replacing `return { success: false, jobs: [], error: message };` in the catch block — keep `siteErrors` collected so far even on a hard failure, so callers still learn which sites had already failed before the fatal error).

Also update the early return for empty search terms (currently `if (searchTerms.length === 0) { return { success: true, jobs: [] }; }`) to `return { success: true, jobs: [], siteErrors: [] };`.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- extractors/jobspy/tests/run.test.ts`

Expected: PASS (all tests in the file, not just the new ones — check for regressions from the `JobSpyResult` shape change)

- [ ] **Step 9: Commit**

```bash
cd /Users/Side/code/job-apply
git add extractors/jobspy/src/run.ts extractors/jobspy/tests/run.test.ts
git commit -m "feat: aggregate per-site JobSpy errors into JobSpyResult.siteErrors"
```

---

### Task 4: Pass `siteErrors` through the shared extractor type and the JobSpy manifest

**Files:**
- Modify: `shared/src/types/extractors.ts:28-32`
- Modify: `extractors/jobspy/manifest.ts`

- [ ] **Step 1: Extend `ExtractorRunResult`**

In `shared/src/types/extractors.ts`, change:

```typescript
export interface ExtractorRunResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}
```

to:

```typescript
export interface ExtractorRunResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
  siteErrors?: Array<{ site: string; error: string }>;
}
```

Kept optional (rather than required) because every other extractor manifest (`gradcracker`, `adzuna`, `hiringcafe`, `startupjobs`, `ukvisajobs`) also implements this interface and has no notion of per-site sub-results — making it required would force unrelated changes across all of them for no benefit.

- [ ] **Step 2: Pass it through in the JobSpy manifest**

In `extractors/jobspy/manifest.ts`, in the final `return { success: true, jobs: result.jobs };` (currently lines 67-70), change to:

```typescript
    return {
      success: true,
      jobs: result.jobs,
      siteErrors: result.siteErrors,
    };
```

Also add it to the failure branch (currently lines 59-65):

```typescript
    if (!result.success) {
      return {
        success: false,
        jobs: [],
        error: result.error,
        siteErrors: result.siteErrors,
      };
    }
```

- [ ] **Step 3: Run the existing jobspy manifest/type checks**

`extractors/jobspy` has its own `tsconfig.json` but is not wired into any `check:types*` npm script in this repo (unlike `gradcracker`/`ukvisajobs`, which are — see `AGENTS.md`'s CI-parity list). Check it directly against its own tsconfig, plus the shared package it depends on:

Run: `cd /Users/Side/code/job-apply/extractors/jobspy && npx tsc --noEmit` and `cd /Users/Side/code/job-apply && npm run check:types:shared`

Expected: PASS — no type errors. There's no dedicated manifest.ts test file today (confirm with `find extractors/jobspy -iname "manifest*.test.ts"`); if the type-checks pass and Task 3's `run.test.ts` still passes, this task is verified — a behavioral test for this passthrough is covered indirectly by Task 6's `discover-jobs.test.ts` additions, which mock the manifest's `run()` return value directly.

- [ ] **Step 4: Commit**

```bash
cd /Users/Side/code/job-apply
git add shared/src/types/extractors.ts extractors/jobspy/manifest.ts
git commit -m "feat: surface per-site errors through ExtractorRunResult"
```

---

### Task 5: LinkedIn circuit breaker module

**Files:**
- Create: `orchestrator/src/server/pipeline/linkedin-circuit-breaker.ts`
- Test: `orchestrator/src/server/pipeline/linkedin-circuit-breaker.test.ts`

- [ ] **Step 1: Write the failing test**

Create `orchestrator/src/server/pipeline/linkedin-circuit-breaker.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@server/repositories/settings", () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

import * as settingsRepo from "@server/repositories/settings";
import {
  LINKEDIN_COOLDOWN_MS,
  isLinkedInInCooldown,
  recordLinkedInFailure,
} from "./linkedin-circuit-breaker";

describe("linkedin circuit breaker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("isLinkedInInCooldown", () => {
    it("is false when no cooldown is set", () => {
      expect(isLinkedInInCooldown(undefined)).toBe(false);
      expect(isLinkedInInCooldown("")).toBe(false);
    });

    it("is true when the stored cooldown timestamp is in the future", () => {
      expect(isLinkedInInCooldown("2026-08-07T13:00:00.000Z")).toBe(true);
    });

    it("is false when the stored cooldown timestamp is in the past", () => {
      expect(isLinkedInInCooldown("2026-08-07T11:00:00.000Z")).toBe(false);
    });

    it("is false when the stored value is not a parseable date", () => {
      expect(isLinkedInInCooldown("not-a-date")).toBe(false);
    });
  });

  describe("recordLinkedInFailure", () => {
    it("sets a cooldown LINKEDIN_COOLDOWN_MS in the future and reports a new trip when not already cooling down", async () => {
      vi.mocked(settingsRepo.getSetting).mockResolvedValue(null);

      const result = await recordLinkedInFailure();

      expect(result.isNewTrip).toBe(true);
      expect(settingsRepo.setSetting).toHaveBeenCalledWith(
        "linkedinCooldownUntil",
        new Date(Date.now() + LINKEDIN_COOLDOWN_MS).toISOString(),
      );
    });

    it("extends the cooldown but reports no new trip when already cooling down", async () => {
      vi.mocked(settingsRepo.getSetting).mockResolvedValue(
        "2026-08-07T12:30:00.000Z",
      );

      const result = await recordLinkedInFailure();

      expect(result.isNewTrip).toBe(false);
      expect(settingsRepo.setSetting).toHaveBeenCalledWith(
        "linkedinCooldownUntil",
        new Date(Date.now() + LINKEDIN_COOLDOWN_MS).toISOString(),
      );
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- linkedin-circuit-breaker`

Expected: FAIL — `./linkedin-circuit-breaker` module doesn't exist.

- [ ] **Step 3: Implement the module**

Create `orchestrator/src/server/pipeline/linkedin-circuit-breaker.ts`:

```typescript
import { logger } from "@infra/logger";
import * as settingsRepo from "@server/repositories/settings";

/** How long LinkedIn discovery is skipped after a suspected block/rate-limit. */
export const LINKEDIN_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Whether LinkedIn discovery should currently be skipped, given the raw
 * `linkedinCooldownUntil` setting value (an ISO timestamp string, or
 * empty/undefined when not cooling down).
 */
export function isLinkedInInCooldown(
  cooldownUntilRaw: string | undefined,
): boolean {
  if (!cooldownUntilRaw) return false;
  const cooldownUntil = new Date(cooldownUntilRaw).getTime();
  if (Number.isNaN(cooldownUntil)) return false;
  return cooldownUntil > Date.now();
}

/**
 * Record a LinkedIn discovery failure: (re)sets the cooldown window and
 * reports whether this is a *new* trip (breaker was not already open),
 * so callers only fire a notification once per trip rather than on every
 * run during an active cooldown.
 */
export async function recordLinkedInFailure(): Promise<{
  isNewTrip: boolean;
  cooldownUntil: string;
}> {
  const existing = await settingsRepo.getSetting("linkedinCooldownUntil");
  const wasAlreadyInCooldown = isLinkedInInCooldown(existing ?? undefined);
  const cooldownUntil = new Date(Date.now() + LINKEDIN_COOLDOWN_MS).toISOString();

  await settingsRepo.setSetting("linkedinCooldownUntil", cooldownUntil);

  logger.warn("LinkedIn circuit breaker tripped", {
    cooldownUntil,
    wasAlreadyInCooldown,
  });

  return { isNewTrip: !wasAlreadyInCooldown, cooldownUntil };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- linkedin-circuit-breaker`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/Side/code/job-apply
git add orchestrator/src/server/pipeline/linkedin-circuit-breaker.ts orchestrator/src/server/pipeline/linkedin-circuit-breaker.test.ts
git commit -m "feat: add LinkedIn circuit breaker cooldown module"
```

---

### Task 6: Widen the pipeline webhook event type for circuit-breaker notifications

**Files:**
- Modify: `orchestrator/src/server/pipeline/steps/notify-webhook.ts`
- Test: `orchestrator/src/server/pipeline/steps/notify-webhook.test.ts` (new file — none exists today)

- [ ] **Step 1: Write the failing test**

Create `orchestrator/src/server/pipeline/steps/notify-webhook.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@server/repositories/settings", () => ({
  getSetting: vi.fn(),
}));

import * as settingsRepo from "@server/repositories/settings";
import { notifyPipelineWebhookStep } from "./notify-webhook";

describe("notifyPipelineWebhookStep", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts a linkedin.circuit_breaker_tripped event with the cooldown detail", async () => {
    vi.mocked(settingsRepo.getSetting).mockResolvedValue(
      "https://example.com/hook",
    );

    await notifyPipelineWebhookStep("linkedin.circuit_breaker_tripped", {
      cooldownUntil: "2026-08-07T18:00:00.000Z",
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.com/hook",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("linkedin.circuit_breaker_tripped"),
      }),
    );
    const body = JSON.parse(
      vi.mocked(global.fetch).mock.calls[0][1]!.body as string,
    );
    expect(body.cooldownUntil).toBe("2026-08-07T18:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- notify-webhook`

Expected: FAIL — TypeScript rejects `"linkedin.circuit_breaker_tripped"` as not assignable to the current `"pipeline.completed" | "pipeline.failed"` union, and `cooldownUntil` isn't in the sanitized payload.

- [ ] **Step 3: Widen the event union and payload passthrough**

In `orchestrator/src/server/pipeline/steps/notify-webhook.ts`, change the function signature:

```typescript
export async function notifyPipelineWebhookStep(
  event:
    | "pipeline.completed"
    | "pipeline.failed"
    | "linkedin.circuit_breaker_tripped",
  payload: Record<string, unknown>,
): Promise<void> {
```

And extend the `sanitizedPayload` construction to carry through the new field alongside the existing ones (keep all existing fields as-is):

```typescript
    const sanitizedPayload = sanitizeWebhookPayload({
      event,
      sentAt: new Date().toISOString(),
      pipelineRunId: payload.pipelineRunId,
      jobsDiscovered: payload.jobsDiscovered,
      jobsScored: payload.jobsScored,
      jobsProcessed: payload.jobsProcessed,
      error: payload.error,
      cooldownUntil: payload.cooldownUntil,
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- notify-webhook`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/Side/code/job-apply
git add orchestrator/src/server/pipeline/steps/notify-webhook.ts orchestrator/src/server/pipeline/steps/notify-webhook.test.ts
git commit -m "feat: support linkedin.circuit_breaker_tripped pipeline webhook event"
```

---

### Task 7: Wire the circuit breaker into discovery

**Files:**
- Modify: `orchestrator/src/server/pipeline/steps/discover-jobs.ts`
- Modify: `orchestrator/src/server/pipeline/steps/discover-jobs.test.ts`

- [ ] **Step 1: Write the failing test for pre-run filtering**

Add to `orchestrator/src/server/pipeline/steps/discover-jobs.test.ts` (it already mocks `@server/repositories/settings` with only `getAllSettings` — extend that mock's return value per-test rather than adding a second `vi.mock` call for the same module):

```typescript
it("skips linkedin when the circuit breaker cooldown is active", async () => {
  const settingsRepo = await import("@server/repositories/settings");
  const registryModule = await import("@server/extractors/registry");

  const jobspyManifest = {
    id: "jobspy",
    displayName: "JobSpy",
    providesSources: ["indeed", "linkedin", "glassdoor"],
    run: vi.fn().mockResolvedValue({
      success: true,
      jobs: [],
      siteErrors: [],
    }),
  };

  vi.mocked(settingsRepo.getAllSettings).mockResolvedValue({
    searchTerms: JSON.stringify(["engineer"]),
    linkedinCooldownUntil: new Date(Date.now() + 60_000).toISOString(),
  } as any);

  vi.mocked(registryModule.getExtractorRegistry).mockResolvedValue({
    manifests: new Map([["jobspy", jobspyManifest as any]]),
    manifestBySource: new Map([
      ["indeed", jobspyManifest as any],
      ["linkedin", jobspyManifest as any],
      ["glassdoor", jobspyManifest as any],
    ]),
    availableSources: ["indeed", "linkedin", "glassdoor"],
  } as any);

  await discoverJobsStep({
    mergedConfig: { ...baseConfig, sources: ["indeed", "linkedin"] },
  });

  expect(jobspyManifest.run).toHaveBeenCalledWith(
    expect.objectContaining({ selectedSources: ["indeed"] }),
  );
});
```

- [ ] **Step 2: Write the failing test for post-run circuit-breaker tripping**

Add to the same file:

```typescript
it("trips the linkedin circuit breaker and notifies once when a linkedin site_error comes back", async () => {
  const settingsRepo = await import("@server/repositories/settings");
  const registryModule = await import("@server/extractors/registry");
  const circuitBreaker = await import("../linkedin-circuit-breaker");
  const notifyWebhook = await import("./notify-webhook");

  vi.spyOn(circuitBreaker, "recordLinkedInFailure").mockResolvedValue({
    isNewTrip: true,
    cooldownUntil: "2026-08-07T18:00:00.000Z",
  });
  vi.spyOn(notifyWebhook, "notifyPipelineWebhookStep").mockResolvedValue();

  const jobspyManifest = {
    id: "jobspy",
    displayName: "JobSpy",
    providesSources: ["indeed", "linkedin", "glassdoor"],
    run: vi.fn().mockResolvedValue({
      success: true,
      jobs: [],
      siteErrors: [{ site: "linkedin", error: "HTTPError: 429" }],
    }),
  };

  vi.mocked(settingsRepo.getAllSettings).mockResolvedValue({
    searchTerms: JSON.stringify(["engineer"]),
  } as any);

  vi.mocked(registryModule.getExtractorRegistry).mockResolvedValue({
    manifests: new Map([["jobspy", jobspyManifest as any]]),
    manifestBySource: new Map([
      ["indeed", jobspyManifest as any],
      ["linkedin", jobspyManifest as any],
    ]),
    availableSources: ["indeed", "linkedin"],
  } as any);

  await discoverJobsStep({
    mergedConfig: { ...baseConfig, sources: ["indeed", "linkedin"] },
  });

  expect(circuitBreaker.recordLinkedInFailure).toHaveBeenCalledOnce();
  expect(notifyWebhook.notifyPipelineWebhookStep).toHaveBeenCalledWith(
    "linkedin.circuit_breaker_tripped",
    expect.objectContaining({ cooldownUntil: "2026-08-07T18:00:00.000Z" }),
  );
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- discover-jobs`

Expected: FAIL — `selectedSources` still includes `linkedin` in the first new test; `recordLinkedInFailure`/`notifyPipelineWebhookStep` are never called in the second.

- [ ] **Step 4: Implement the pre-run filter**

In `orchestrator/src/server/pipeline/steps/discover-jobs.ts`, add the import:

```typescript
import { isLinkedInInCooldown, recordLinkedInFailure } from "../linkedin-circuit-breaker";
import { notifyPipelineWebhookStep } from "./notify-webhook";
```

Immediately after the existing `compatibleSources` computation (currently right after `const compatibleSources = args.mergedConfig.sources.filter(...)`), add:

```typescript
  const linkedinInCooldown = isLinkedInInCooldown(settings.linkedinCooldownUntil);
  const runnableSources = linkedinInCooldown
    ? compatibleSources.filter((source) => source !== "linkedin")
    : compatibleSources;

  if (linkedinInCooldown && compatibleSources.includes("linkedin")) {
    logger.info("Skipping linkedin: circuit breaker cooldown active", {
      step: "discover-jobs",
      cooldownUntil: settings.linkedinCooldownUntil,
    });
  }
```

Then replace the two later uses of `compatibleSources` that build the run plan — `const skippedSources = args.mergedConfig.sources.filter((source) => !compatibleSources.includes(source));` and the `for (const source of compatibleSources) {` loop that builds `groupedByManifest` — so both read `runnableSources` instead of `compatibleSources`. (Leave the earlier `if (args.mergedConfig.sources.length > 0 && compatibleSources.length === 0)` guard reading `compatibleSources`, not `runnableSources` — that check is about "no sources exist for this country at all," a different condition than "linkedin specifically is cooling down.")

- [ ] **Step 5: Implement the post-run trip check**

Still in `discover-jobs.ts`, find the `run: async () => { ... }` closure inside the `sourceTasks.push({...})` block (the one that calls `manifest.run(...)` and returns `{ discoveredJobs, sourceErrors }`). After the existing `if (!result.success) { ... }` block and before the final `return { discoveredJobs: result.jobs, sourceErrors: [] };`, add:

```typescript
        const linkedinSiteError = result.siteErrors?.find(
          (siteError) => siteError.site === "linkedin",
        );
        if (linkedinSiteError) {
          const { isNewTrip, cooldownUntil } = await recordLinkedInFailure();
          if (isNewTrip) {
            await notifyPipelineWebhookStep("linkedin.circuit_breaker_tripped", {
              cooldownUntil,
              error: linkedinSiteError.error,
            });
          }
        }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- discover-jobs`

Expected: PASS (all tests in the file, including the pre-existing ones — check for regressions)

- [ ] **Step 7: Run full orchestrator type check and test suite**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run check:types && npm --workspace orchestrator run test:run`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
cd /Users/Side/code/job-apply
git add orchestrator/src/server/pipeline/steps/discover-jobs.ts orchestrator/src/server/pipeline/steps/discover-jobs.test.ts
git commit -m "feat: wire LinkedIn circuit breaker into discovery step"
```

---

### Task 8: Allow the standalone pipeline runner to accept a source list

Needed so cron can later run a "LinkedIn-inclusive, low frequency" job and a "everything except LinkedIn, higher frequency" job with different source sets (see Task 10) — today `orchestrator/src/server/pipeline/run.ts` only reads `PIPELINE_TOP_N`/`PIPELINE_MIN_SCORE` from env; `sources` isn't parameterized at all and always falls back to `DEFAULT_CONFIG.sources` in `orchestrator.ts`.

**Files:**
- Modify: `orchestrator/src/server/pipeline/run.ts`

No test file exists for this standalone script (it's an entry point, not a unit-testable module — `runPipeline` itself is already tested elsewhere), so this is verified by manual invocation.

- [ ] **Step 1: Add `PIPELINE_SOURCES` parsing**

In `orchestrator/src/server/pipeline/run.ts`, change the `runPipeline(...)` call:

```typescript
  const result = await runPipeline({
    topN: parseInt(process.env.PIPELINE_TOP_N || "10", 10),
    minSuitabilityScore: parseInt(process.env.PIPELINE_MIN_SCORE || "50", 10),
    ...(process.env.PIPELINE_SOURCES
      ? {
          sources: process.env.PIPELINE_SOURCES.split(",")
            .map((s) => s.trim())
            .filter(Boolean) as PipelineConfig["sources"],
        }
      : {}),
  });
```

Add the type import at the top of the file:

```typescript
import type { PipelineConfig } from "@shared/types";
```

When `PIPELINE_SOURCES` is unset, behavior is unchanged (falls back to `DEFAULT_CONFIG.sources` inside `runPipeline`, exactly as today).

- [ ] **Step 2: Verify types**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run check:types`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/Side/code/job-apply
git add orchestrator/src/server/pipeline/run.ts
git commit -m "feat: allow PIPELINE_SOURCES env override for the standalone pipeline runner"
```

---

### Task 9: WhatsApp notification relay (CallMeBot)

**Files:**
- Create: `scripts/whatsapp-notify-relay.mjs`

This is a small standalone Node script (matches the existing pattern of `scripts/set-orchestrator-version.mjs` — plain `.mjs`, not part of the TypeScript workspaces/CI checks in `AGENTS.md`, since it's an ops utility that runs outside the orchestrator process). No test framework is wired up for `scripts/`; this task is verified by a manual curl call.

- [ ] **Step 1: Get a CallMeBot API key**

From Side's own phone: send `I allow callmebot to send me messages` to the CallMeBot WhatsApp number (+34 644 51 95 23), following the current instructions at callmebot.com/blog/free-api-whatsapp-messages — this is a one-time manual step, not automatable, and yields a personal `apikey` plus confirms the phone number to use.

- [ ] **Step 2: Write the relay script**

Create `scripts/whatsapp-notify-relay.mjs`:

```javascript
import { createServer } from "node:http";

const PORT = process.env.WHATSAPP_RELAY_PORT
  ? parseInt(process.env.WHATSAPP_RELAY_PORT, 10)
  : 8787;
const CALLMEBOT_PHONE = process.env.CALLMEBOT_PHONE;
const CALLMEBOT_API_KEY = process.env.CALLMEBOT_API_KEY;

if (!CALLMEBOT_PHONE || !CALLMEBOT_API_KEY) {
  console.error(
    "CALLMEBOT_PHONE and CALLMEBOT_API_KEY must be set in the environment",
  );
  process.exit(1);
}

function formatMessage(payload) {
  const event = payload.event ?? "unknown_event";
  if (event === "linkedin.circuit_breaker_tripped") {
    return `job-ops: LinkedIn circuit breaker tripped (cooldown until ${payload.cooldownUntil}). ${payload.error ?? ""}`.trim();
  }
  if (event === "pipeline.failed") {
    return `job-ops: pipeline run failed. ${payload.error ?? ""}`.trim();
  }
  if (event === "pipeline.completed") {
    return `job-ops: pipeline run completed — discovered ${payload.jobsDiscovered ?? "?"}, processed ${payload.jobsProcessed ?? "?"}.`;
  }
  return `job-ops: ${event}`;
}

async function forwardToWhatsApp(message) {
  const url = new URL("https://api.callmebot.com/whatsapp.php");
  url.searchParams.set("phone", CALLMEBOT_PHONE);
  url.searchParams.set("text", message);
  url.searchParams.set("apikey", CALLMEBOT_API_KEY);

  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`CallMeBot request failed: ${response.status} ${body.slice(0, 200)}`);
  }
}

const server = createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405).end("Method Not Allowed");
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", async () => {
    try {
      const payload = JSON.parse(body || "{}");
      const message = formatMessage(payload);
      await forwardToWhatsApp(message);
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({ ok: true }),
      );
    } catch (error) {
      console.error("whatsapp-notify-relay error:", error);
      res.writeHead(502, { "Content-Type": "application/json" }).end(
        JSON.stringify({ ok: false, error: String(error) }),
      );
    }
  });
});

server.listen(PORT, () => {
  console.log(`whatsapp-notify-relay listening on http://localhost:${PORT}`);
});
```

- [ ] **Step 3: Verify manually**

Start it: `CALLMEBOT_PHONE=<your number with country code> CALLMEBOT_API_KEY=<key from step 1> node scripts/whatsapp-notify-relay.mjs`

In another terminal:

```bash
curl -X POST http://localhost:8787 \
  -H "content-type: application/json" \
  -d '{"event":"pipeline.completed","jobsDiscovered":12,"jobsProcessed":3}'
```

Expected: `{"ok":true}` response, and a WhatsApp message arrives on Side's phone within a few seconds.

- [ ] **Step 4: Commit**

```bash
cd /Users/Side/code/job-apply
git add scripts/whatsapp-notify-relay.mjs
git commit -m "feat: add WhatsApp notification relay for pipeline webhooks"
```

---

### Task 10: Point job-ops at the relay and schedule recurring runs (ops, no new code)

**Files:** none — configuration and OS-level scheduling only.

- [ ] **Step 1: Run the relay as a persistent background process**

Use whatever the user is comfortable operating long-term on their machine (`launchd` on macOS is the native choice, or a simple `pm2`/`tmux` session) so `scripts/whatsapp-notify-relay.mjs` stays up. Concrete launchd setup can be a follow-up once the rest of this plan is verified working via manual runs — don't block on it.

- [ ] **Step 2: Set the webhook URLs in job-ops Settings**

In the job-ops UI → Settings → Webhooks, set both **Pipeline status webhook** and **Job completion webhook** to `http://localhost:8787` (or wherever the relay ends up running).

- [ ] **Step 3: Add cron entries for differentiated cadence**

```bash
crontab -e
```

Add two lines (adjust the path to wherever `job-ops` actually is, and confirm `npm run pipeline:run` is the right invocation — check `orchestrator/package.json`'s scripts for the exact workspace-qualified command, e.g. it may need to be run as `npm --workspace orchestrator run pipeline:run` from the repo root):

```cron
# Every hour: Indeed + Adzuna (lower account risk, run more often)
0 * * * * cd /Users/Side/code/job-apply && PIPELINE_SOURCES=indeed,adzuna npm --workspace orchestrator run pipeline:run >> /tmp/jobops-cron-indeed.log 2>&1

# Every 3 hours: everything including LinkedIn (higher-risk source, run less often)
0 */3 * * * cd /Users/Side/code/job-apply && npm --workspace orchestrator run pipeline:run >> /tmp/jobops-cron-full.log 2>&1
```

Confirm `pipeline:run` exists as an npm script in `orchestrator/package.json` before relying on this — if it's named differently, use the actual script name.

- [ ] **Step 4: Verify one cron-triggered run manually before trusting the schedule**

Run the exact command from one of the crontab lines by hand once, check `/tmp/jobops-cron-*.log` for a clean exit, and check the job-ops dashboard's `discovered` column picked up new jobs.

---

### Task 11: First real configuration + validation run (ops, no new code)

**Files:** none.

- [ ] **Step 1:** `docker compose up -d` from `/Users/Side/code/job-apply`, complete onboarding (LLM provider key, hosted rxresu.me account, base resume built from [resume.pdf](../../../../../kingsoft_code/resume.pdf)).
- [ ] **Step 2:** In Settings → Environment & Accounts, add the Adzuna App ID/Key (from developer.adzuna.com).
- [ ] **Step 3:** In Pipeline Run (Automatic tab), set country to Canada, location `"Canada"`, search cities to `Toronto, Vancouver, Montreal, Ottawa, Calgary, Waterloo` (needed for Glassdoor, per the design doc's §5.4 workaround), sources = Indeed + LinkedIn + Glassdoor + Adzuna, `Fast` preset, and run once manually.
- [ ] **Step 4:** Review the `discovered` column results — confirm job relevance and freshness look right, then tune `JOBSPY_HOURS_OLD` and search terms accordingly (env var, or check whether Settings exposes it — if not, set it in the `.env` used by `docker compose`).
- [ ] **Step 5:** Once satisfied, proceed to Task 10's cron setup.

---

## Plan Self-Review Notes

- **Spec coverage:** §5.1 (recurring runs) → Tasks 8+10. §5.2 (LinkedIn circuit breaker) → Tasks 1,2,3,4,5,6,7. §5.3 (WhatsApp relay) → Tasks 9,10. §5.4 (Canada defaults/nationwide workaround) → Task 11. §6 (configuration plan) → Task 11. §5.5 (deferred auto-fill) → intentionally has no task, per the design doc.
- **Type consistency:** `siteErrors` is named identically across `run.ts` (`JobSpyResult.siteErrors`), `shared/src/types/extractors.ts` (`ExtractorRunResult.siteErrors`), `manifest.ts` (passthrough), and `discover-jobs.ts` (`result.siteErrors`) — same shape `Array<{ site: string; error: string }>` everywhere. `linkedinCooldownUntil` is the same setting key string in the registry (Task 1), the circuit-breaker module (Task 5, via `settingsRepo.getSetting("linkedinCooldownUntil")`), and `discover-jobs.ts`'s read of `settings.linkedinCooldownUntil` (Task 7) — matches the existing `getAllSettings()` → `Partial<Record<SettingKey, string>>` shape already used for `settings.searchTerms` etc. in the same file.
- **Known open item carried into Task 10:** the exact `pipeline:run` npm script invocation should be double-checked against `orchestrator/package.json` at execution time rather than assumed — flagged explicitly in that task rather than guessed silently.
