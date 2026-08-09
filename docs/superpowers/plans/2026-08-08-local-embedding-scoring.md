# Local Embedding + Keyword Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-job LLM chat scorer with a cheap default scorer (embedding cosine similarity + keyword coverage), and demote the LLM to an opt-in per-job "deep analysis".

> Status (2026-08-08): implementation tasks are complete. The unchecked boxes below are retained as the original TDD execution record; the current behavior and setup are documented in the repository README.

**Architecture:** A new `scoring/` module computes a blended `suitabilityScore` from (a) cosine similarity of the resume's and JD's embeddings and (b) coverage of the JD's detected skills by the resume. Embeddings come from an OpenAI-compatible cloud API, are L2-normalized, and are cached (resume vector by text hash; JD vector on the job row, tagged by model) so re-ranking is cheap. The pipeline's scoring step calls the local scorer; the existing LLM `scoreJobSuitability` stays but is only invoked by a new `POST /api/jobs/:id/deep-analyze` endpoint.

**Tech Stack:** TypeScript (orchestrator, Node 22, vitest), Drizzle + better-sqlite3, React client, Zod settings registry. No new runtime dependency — embeddings use `fetch` against an OpenAI-compatible `/embeddings` endpoint.

## Global Constraints

- All server error/logging follows `AGENTS.md`: structured `logger` from `@infra/logger`, no `console.*` in core paths, sanitize before logging.
- Settings are declared in `shared/src/settings-registry.ts` and consumed via `getEffectiveSettings()` / `getSetting()`.
- Tests run through the single central vitest config: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- <filter>`. Shared and orchestrator tests both run from the `orchestrator` workspace.
- Embeddings target an **OpenAI-compatible** `/embeddings` endpoint only in v1 (covers OpenAI, `openai-compatible`, Qwen/DashScope-compatible base URLs). Gemini's native embedding shape is explicitly out of v1.
- Embedding vectors are **L2-normalized at the client boundary**, so cosine similarity == dot product everywhere downstream.
- After finishing all code tasks, the running app must be rebuilt (`docker compose up -d --build`), not just restarted — the image bakes source at build time.

---

### Task 1: Skills dictionary + `detectSkills`

**Files:**
- Create: `shared/src/skills/skills-dictionary.ts`
- Test: `shared/src/skills/skills-dictionary.test.ts`

**Interfaces:**
- Produces: `SKILLS_DICTIONARY: Record<string, string[]>` (canonical skill → alias list); `detectSkills(text: string): Set<string>` (returns canonical names whose any alias appears in `text`, whole-word, case-insensitive).

- [ ] **Step 1: Write the failing test**

Create `shared/src/skills/skills-dictionary.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { detectSkills, SKILLS_DICTIONARY } from "./skills-dictionary";

describe("detectSkills", () => {
  it("normalizes aliases to the canonical skill", () => {
    expect(detectSkills("Built UIs with ReactJS and react.js")).toContain(
      "react",
    );
    expect(detectSkills("Deployed on K8s")).toContain("kubernetes");
  });

  it("matches whole words case-insensitively, not substrings", () => {
    // "java" must not match inside "javascript"
    const skills = detectSkills("Strong JavaScript background");
    expect(skills.has("javascript")).toBe(true);
    expect(skills.has("java")).toBe(false);
  });

  it("returns an empty set when no known skill appears", () => {
    expect(detectSkills("passionate team player").size).toBe(0);
  });

  it("every canonical key is listed among its own aliases", () => {
    for (const [canonical, aliases] of Object.entries(SKILLS_DICTIONARY)) {
      expect(aliases).toContain(canonical);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- skills-dictionary`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the dictionary and detector**

Create `shared/src/skills/skills-dictionary.ts`:

```typescript
/**
 * Curated skill → alias dictionary for keyword-coverage scoring. Approximate
 * by design: the semantic half of scoring handles nuance, so this only needs
 * to catch common tech skills and their obvious spellings. Extend freely.
 */
export const SKILLS_DICTIONARY: Record<string, string[]> = {
  javascript: ["javascript", "js"],
  typescript: ["typescript", "ts"],
  java: ["java"],
  python: ["python"],
  go: ["golang", "go"],
  rust: ["rust"],
  "c#": ["c#", "csharp"],
  react: ["react", "reactjs", "react.js"],
  angular: ["angular", "angularjs"],
  vue: ["vue", "vuejs", "vue.js"],
  "node.js": ["node.js", "nodejs", "node"],
  express: ["express", "expressjs"],
  spring: ["spring", "spring boot", "springboot"],
  django: ["django"],
  postgresql: ["postgresql", "postgres"],
  mysql: ["mysql"],
  mongodb: ["mongodb", "mongo"],
  redis: ["redis"],
  kafka: ["kafka"],
  rabbitmq: ["rabbitmq"],
  graphql: ["graphql"],
  rest: ["rest", "restful"],
  grpc: ["grpc"],
  docker: ["docker"],
  kubernetes: ["kubernetes", "k8s"],
  terraform: ["terraform"],
  aws: ["aws", "amazon web services"],
  gcp: ["gcp", "google cloud"],
  azure: ["azure"],
  "ci/cd": ["ci/cd", "cicd", "continuous integration"],
  microservices: ["microservices", "microservice"],
  tdd: ["tdd", "test driven development", "test-driven development"],
};

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Return the set of canonical skills whose any alias appears in `text` as a
 * whole token (so "java" does not match inside "javascript").
 */
export function detectSkills(text: string): Set<string> {
  const haystack = text.toLowerCase();
  const found = new Set<string>();
  for (const [canonical, aliases] of Object.entries(SKILLS_DICTIONARY)) {
    for (const alias of aliases) {
      const pattern = new RegExp(
        `(^|[^a-z0-9+#.])${escapeRegExp(alias.toLowerCase())}([^a-z0-9+#.]|$)`,
      );
      if (pattern.test(haystack)) {
        found.add(canonical);
        break;
      }
    }
  }
  return found;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- skills-dictionary`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/Side/code/job-apply
git add shared/src/skills/skills-dictionary.ts shared/src/skills/skills-dictionary.test.ts
git commit -m "feat: add skills dictionary and detectSkills"
```

---

### Task 2: `keyword-scorer`

**Files:**
- Create: `orchestrator/src/server/services/scoring/keyword-scorer.ts`
- Test: `orchestrator/src/server/services/scoring/keyword-scorer.test.ts`

**Interfaces:**
- Consumes: `detectSkills` from `@shared/skills/skills-dictionary` (Task 1).
- Produces: `scoreKeywords(resumeText: string, jobText: string): { coverage: number | null; missing: string[]; jobSkills: string[]; resumeSkills: string[] }`. `coverage` is 0–100 (percent of `jobSkills` present in `resumeSkills`) or `null` when `jobSkills` is empty. `missing` is `jobSkills − resumeSkills` (canonical names, sorted).

- [ ] **Step 1: Write the failing test**

Create `orchestrator/src/server/services/scoring/keyword-scorer.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { scoreKeywords } from "./keyword-scorer";

describe("scoreKeywords", () => {
  it("computes coverage as percent of JD skills present in the resume", () => {
    const resume = "Experienced with React, TypeScript and Node.js";
    const jd = "We use React, TypeScript, Kubernetes and gRPC";
    const result = scoreKeywords(resume, jd);
    // JD skills: react, typescript, kubernetes, grpc (4). Resume has react+typescript (2).
    expect(result.coverage).toBe(50);
    expect(result.missing).toEqual(["grpc", "kubernetes"]);
    expect(result.jobSkills.sort()).toEqual([
      "grpc",
      "kubernetes",
      "react",
      "typescript",
    ]);
  });

  it("returns null coverage when the JD has no detectable skills", () => {
    const result = scoreKeywords("React developer", "We want a team player");
    expect(result.coverage).toBeNull();
    expect(result.missing).toEqual([]);
  });

  it("is 100 with no missing when the resume covers every JD skill", () => {
    const result = scoreKeywords("react typescript", "react typescript");
    expect(result.coverage).toBe(100);
    expect(result.missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- keyword-scorer`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `orchestrator/src/server/services/scoring/keyword-scorer.ts`:

```typescript
import { detectSkills } from "@shared/skills/skills-dictionary";

export interface KeywordScore {
  coverage: number | null;
  missing: string[];
  jobSkills: string[];
  resumeSkills: string[];
}

export function scoreKeywords(
  resumeText: string,
  jobText: string,
): KeywordScore {
  const resumeSkills = detectSkills(resumeText);
  const jobSkills = detectSkills(jobText);

  if (jobSkills.size === 0) {
    return {
      coverage: null,
      missing: [],
      jobSkills: [],
      resumeSkills: [...resumeSkills].sort(),
    };
  }

  const missing = [...jobSkills].filter((s) => !resumeSkills.has(s)).sort();
  const matched = jobSkills.size - missing.length;
  const coverage = Math.round((matched / jobSkills.size) * 100);

  return {
    coverage,
    missing,
    jobSkills: [...jobSkills].sort(),
    resumeSkills: [...resumeSkills].sort(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- keyword-scorer`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/Side/code/job-apply
git add orchestrator/src/server/services/scoring/keyword-scorer.ts orchestrator/src/server/services/scoring/keyword-scorer.test.ts
git commit -m "feat: add keyword coverage scorer"
```

---

### Task 3: Scoring + embedding settings

**Files:**
- Modify: `shared/src/settings-registry.ts` (add entries near `autoSkipScoreThreshold` and the string/secret sections)
- Test: `shared/src/settings-registry.test.ts`

**Interfaces:**
- Produces settings keys: `semanticScoreWeight` (typed number 0–1, default `0.7`), `embeddingModel` (typed string, default `"text-embedding-3-small"`), `embeddingProvider` (string, env `EMBEDDING_PROVIDER`), `embeddingBaseUrl` (string, env `EMBEDDING_BASE_URL`), `embeddingApiKey` (secret, env `EMBEDDING_API_KEY`).

- [ ] **Step 1: Write the failing test**

Add to `shared/src/settings-registry.test.ts`:

```typescript
describe("scoring/embedding settings", () => {
  it("semanticScoreWeight defaults to 0.7 and clamps to 0..1", () => {
    expect(settingsRegistry.semanticScoreWeight.default()).toBe(0.7);
    expect(settingsRegistry.semanticScoreWeight.parse("0.5")).toBe(0.5);
    expect(settingsRegistry.semanticScoreWeight.parse("2")).toBe(1);
    expect(settingsRegistry.semanticScoreWeight.parse("-1")).toBe(0);
    expect(settingsRegistry.semanticScoreWeight.parse("")).toBeNull();
  });

  it("embeddingModel defaults to text-embedding-3-small", () => {
    expect(settingsRegistry.embeddingModel.default()).toBe(
      "text-embedding-3-small",
    );
  });

  it("embeddingApiKey is env-backed", () => {
    expect(settingsRegistry.embeddingApiKey.envKey).toBe("EMBEDDING_API_KEY");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- settings-registry`
Expected: FAIL — `settingsRegistry.semanticScoreWeight` is undefined.

- [ ] **Step 3: Add the registry entries**

In `shared/src/settings-registry.ts`, insert this typed entry immediately after the `autoSkipScoreThreshold` entry closes:

```typescript
  semanticScoreWeight: {
    kind: "typed" as const,
    schema: z.number().min(0).max(1),
    default: (): number => 0.7,
    parse: (raw: string | undefined): number | null => {
      if (raw === undefined || raw === "") return null;
      const parsed = Number.parseFloat(raw);
      if (Number.isNaN(parsed)) return null;
      return Math.min(1, Math.max(0, parsed));
    },
    serialize: (value: number | null | undefined): string | null =>
      value === null || value === undefined ? null : String(value),
  },
  embeddingModel: {
    kind: "typed" as const,
    schema: z.string().trim().max(200),
    default: (): string =>
      (typeof process !== "undefined" && process.env.EMBEDDING_MODEL) ||
      "text-embedding-3-small",
    parse: parseNonEmptyStringOrNull,
    serialize: (value: string | null | undefined): string | null =>
      value ?? null,
  },
```

Then add these string entries in the `// --- Simple Strings ---` section (next to `ukvisajobsEmail`):

```typescript
  embeddingProvider: {
    kind: "string" as const,
    envKey: "EMBEDDING_PROVIDER",
    schema: z.string().trim().max(200),
  },
  embeddingBaseUrl: {
    kind: "string" as const,
    envKey: "EMBEDDING_BASE_URL",
    schema: z.string().trim().max(2000),
  },
```

And this secret entry in the `// --- Secrets ---` section (next to `llmApiKey`):

```typescript
  embeddingApiKey: {
    kind: "secret" as const,
    envKey: "EMBEDDING_API_KEY",
    schema: z.string().trim().max(2000),
  },
```

Confirm `parseNonEmptyStringOrNull` is already imported/defined at the top of the file (it is — used by other typed string settings).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- settings-registry` then `npm run check:types`
Expected: PASS and clean types. (The `AppSettings` type and `EnvSettingsValues` are derived generically from the registry, so no manual type edits are needed for the new keys to be persistable; the client Settings UI is handled in Task 10.)

- [ ] **Step 5: Commit**

```bash
cd /Users/Side/code/job-apply
git add shared/src/settings-registry.ts shared/src/settings-registry.test.ts
git commit -m "feat: add semanticScoreWeight and embedding provider settings"
```

---

### Task 4: `embedding-client`

**Files:**
- Create: `orchestrator/src/server/services/scoring/embedding-client.ts`
- Test: `orchestrator/src/server/services/scoring/embedding-client.test.ts`

**Interfaces:**
- Consumes: `getEffectiveSettings` (`@server/services/settings`) for provider/key/baseUrl/model resolution.
- Produces:
  - `EmbeddingError` (class extends Error).
  - `resolveEmbeddingConfig(): Promise<{ provider: string; apiKey: string; baseUrl: string; model: string } | null>` — returns null when no usable key resolves.
  - `embedTexts(texts: string[], config: { apiKey: string; baseUrl: string; model: string }): Promise<number[][]>` — L2-normalized vectors; throws `EmbeddingError` on HTTP or shape failure.
  - `l2normalize(vec: number[]): number[]` and `cosine(a: number[], b: number[]): number` (exported helpers; with normalized inputs cosine is the dot product).

Resolution rule: use `embeddingProvider`/`embeddingApiKey`/`embeddingBaseUrl` overrides when set; otherwise fall back to `llmProvider`/`llmApiKey`/`llmBaseUrl`. `apiKey` is required — return null if neither an embedding nor an llm key is available. `baseUrl` defaults to `https://api.openai.com/v1` when unset.

- [ ] **Step 1: Write the failing test**

Create `orchestrator/src/server/services/scoring/embedding-client.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cosine, EmbeddingError, embedTexts, l2normalize } from "./embedding-client";

describe("embedding math", () => {
  it("l2normalize produces a unit vector", () => {
    const n = l2normalize([3, 4]);
    expect(Math.hypot(n[0], n[1])).toBeCloseTo(1, 6);
  });

  it("cosine of normalized identical vectors is 1", () => {
    const a = l2normalize([1, 2, 3]);
    expect(cosine(a, a)).toBeCloseTo(1, 6);
  });
});

describe("embedTexts", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts to {baseUrl}/embeddings and returns normalized vectors", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [3, 4] }] }),
    } as Response);

    const [vec] = await embedTexts(["hello"], {
      apiKey: "k",
      baseUrl: "https://api.openai.com/v1",
      model: "text-embedding-3-small",
    });

    expect(Math.hypot(vec[0], vec[1])).toBeCloseTo(1, 6);
    const call = vi.mocked(global.fetch).mock.calls[0];
    expect(call[0]).toBe("https://api.openai.com/v1/embeddings");
  });

  it("throws EmbeddingError on a non-ok response", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "bad key",
    } as Response);

    await expect(
      embedTexts(["x"], {
        apiKey: "k",
        baseUrl: "https://api.openai.com/v1",
        model: "m",
      }),
    ).rejects.toBeInstanceOf(EmbeddingError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- embedding-client`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `orchestrator/src/server/services/scoring/embedding-client.ts`:

```typescript
import { getEffectiveSettings } from "@server/services/settings";

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingError";
  }
}

export function l2normalize(vec: number[]): number[] {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vec.map(() => 0);
  return vec.map((v) => v / norm);
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

interface EmbeddingRunConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export async function resolveEmbeddingConfig(): Promise<
  (EmbeddingRunConfig & { provider: string }) | null
> {
  const settings = await getEffectiveSettings();
  const provider =
    settings.embeddingProvider || settings.llmProvider?.value || "openai";
  const apiKey = settings.embeddingApiKey ?? settings.llmApiKey ?? null;
  if (!apiKey) return null; // hint fields never carry the actual secret
  const baseUrl =
    settings.embeddingBaseUrl ||
    settings.llmBaseUrl?.value ||
    "https://api.openai.com/v1";
  const model = settings.embeddingModel?.value ?? "text-embedding-3-small";
  return { provider, apiKey, baseUrl, model };
}

export async function embedTexts(
  texts: string[],
  config: EmbeddingRunConfig,
): Promise<number[][]> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/embeddings`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, input: texts }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new EmbeddingError(
      `Embedding request failed: ${error instanceof Error ? error.message : "network error"}`,
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new EmbeddingError(
      `Embedding API ${response.status}: ${body.slice(0, 200)}`,
    );
  }
  const json = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  if (!json.data || json.data.length !== texts.length) {
    throw new EmbeddingError("Embedding API returned an unexpected shape");
  }
  return json.data.map((d) => {
    if (!Array.isArray(d.embedding)) {
      throw new EmbeddingError("Embedding API returned a missing vector");
    }
    return l2normalize(d.embedding);
  });
}
```

Note: `resolveEmbeddingConfig` reads `settings.embeddingApiKey`/`settings.llmApiKey` — these are the raw secret values on the effective settings object (secrets, not the `*Hint` display fields). Confirm `getEffectiveSettings()` exposes secrets to server callers by checking how `scorer.ts` / `LlmService` read `llmApiKey`; mirror that access exactly. If secrets are only exposed via `getSetting("llmApiKey")`, use `getSetting` for both keys instead and adjust the test's mock accordingly.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- embedding-client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/Side/code/job-apply
git add orchestrator/src/server/services/scoring/embedding-client.ts orchestrator/src/server/services/scoring/embedding-client.test.ts
git commit -m "feat: add OpenAI-compatible embedding client"
```

---

### Task 5: Schema + migration (job scoring columns + resume_embedding table)

**Files:**
- Modify: `orchestrator/src/server/db/schema.ts` (add columns to the `jobs` table def; add a `resumeEmbedding` table def)
- Modify: `orchestrator/src/server/db/migrate.ts` (append `ALTER TABLE` strings and a `CREATE TABLE`)

**Interfaces:**
- Produces (drizzle `jobs` columns): `semanticScore` (real), `keywordCoverage` (real), `keywordMissing` (text), `jobEmbedding` (text), `jobEmbeddingModel` (text), `suitabilityReasonSource` (text). New table `resumeEmbedding` with `hash` (text, pk), `model` (text), `vector` (text), `updatedAt` (text).

- [ ] **Step 1: Add drizzle column defs**

In `orchestrator/src/server/db/schema.ts`, in the `jobs` table definition, add alongside the existing `suitabilityScore`/`suitabilityReason` columns:

```typescript
  semanticScore: real("semantic_score"),
  keywordCoverage: real("keyword_coverage"),
  keywordMissing: text("keyword_missing"),
  jobEmbedding: text("job_embedding"),
  jobEmbeddingModel: text("job_embedding_model"),
  suitabilityReasonSource: text("suitability_reason_source"),
```

At the end of the file, add a new table (mirror the style of existing `sqliteTable` defs; import `sqliteTable`/`text` are already present):

```typescript
export const resumeEmbedding = sqliteTable("resume_embedding", {
  hash: text("hash").primaryKey(),
  model: text("model").notNull(),
  vector: text("vector").notNull(),
  updatedAt: text("updated_at").notNull(),
});
```

- [ ] **Step 2: Append migrations**

In `orchestrator/src/server/db/migrate.ts`, append to the `migrations` array (the runner already tolerates "duplicate column" errors, so these are safe to add):

```typescript
  `ALTER TABLE jobs ADD COLUMN semantic_score REAL`,
  `ALTER TABLE jobs ADD COLUMN keyword_coverage REAL`,
  `ALTER TABLE jobs ADD COLUMN keyword_missing TEXT`,
  `ALTER TABLE jobs ADD COLUMN job_embedding TEXT`,
  `ALTER TABLE jobs ADD COLUMN job_embedding_model TEXT`,
  `ALTER TABLE jobs ADD COLUMN suitability_reason_source TEXT`,
  `CREATE TABLE IF NOT EXISTS resume_embedding (
    hash TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    vector TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
```

- [ ] **Step 3: Verify migration + types**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run check:types`
Expected: clean.

Run the migration against a throwaway DB to confirm the SQL is valid:
```bash
cd /Users/Side/code/job-apply && DATA_DIR=$(mktemp -d) npx --workspace orchestrator tsx orchestrator/src/server/db/migrate.ts
```
Expected: prints migration applied/skipped lines and exits 0. (If `npx --workspace` is awkward, `cd orchestrator && DATA_DIR=$(mktemp -d) npx tsx src/server/db/migrate.ts`.)

- [ ] **Step 4: Commit**

```bash
cd /Users/Side/code/job-apply
git add orchestrator/src/server/db/schema.ts orchestrator/src/server/db/migrate.ts
git commit -m "feat: add scoring columns and resume_embedding table"
```

---

### Task 6: `resume-vector` cache

**Files:**
- Create: `orchestrator/src/server/services/scoring/resume-vector.ts`
- Test: `orchestrator/src/server/services/scoring/resume-vector.test.ts`

**Interfaces:**
- Consumes: `extractLocalResumeText` (`@server/services/local-resume`), `embedTexts`+`EmbeddingError` (Task 4), the `resumeEmbedding` drizzle table (Task 5) via `db`.
- Produces: `getResumeVector(config: { apiKey: string; baseUrl: string; model: string }): Promise<number[] | null>` — returns the cached vector when a row exists for `{hash of current resume text, model}`; otherwise embeds, upserts the cache, and returns it. Returns `null` when the resume has no extractable text. Also exports `hashText(text: string): string` (sha256 hex).

- [ ] **Step 1: Write the failing test**

Create `orchestrator/src/server/services/scoring/resume-vector.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@server/services/local-resume", () => ({
  extractLocalResumeText: vi.fn(),
}));
vi.mock("./embedding-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./embedding-client")>()),
  embedTexts: vi.fn(),
}));

import { extractLocalResumeText } from "@server/services/local-resume";
import { embedTexts } from "./embedding-client";
import { getResumeVector, hashText } from "./resume-vector";

const config = {
  apiKey: "k",
  baseUrl: "https://api.openai.com/v1",
  model: "text-embedding-3-small",
};

describe("getResumeVector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when there is no resume text", async () => {
    vi.mocked(extractLocalResumeText).mockResolvedValue("");
    expect(await getResumeVector(config)).toBeNull();
    expect(embedTexts).not.toHaveBeenCalled();
  });

  it("embeds once, then serves the cached vector on the next call", async () => {
    vi.mocked(extractLocalResumeText).mockResolvedValue("resume text");
    vi.mocked(embedTexts).mockResolvedValue([[0, 1]]);

    const first = await getResumeVector(config);
    const second = await getResumeVector(config);

    expect(first).toEqual([0, 1]);
    expect(second).toEqual([0, 1]);
    expect(embedTexts).toHaveBeenCalledTimes(1); // second call hits the cache
  });
});

describe("hashText", () => {
  it("is stable and content-dependent", () => {
    expect(hashText("a")).toBe(hashText("a"));
    expect(hashText("a")).not.toBe(hashText("b"));
  });
});
```

This test uses the real DB layer; the orchestrator test harness already provides an in-memory/temp SQLite via the migrate step used by other repo tests. If `db` is not initialized in this unit test context, mock the drizzle table access the same way `settings.test.ts` mocks repositories — check an existing repo-level test (e.g. `repositories/*.test.ts`) for the established pattern and follow it. Prefer the real-DB path if the harness supports it.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- resume-vector`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `orchestrator/src/server/services/scoring/resume-vector.ts`:

```typescript
import { createHash } from "node:crypto";
import { db, schema } from "@server/db/index";
import { extractLocalResumeText } from "@server/services/local-resume";
import { eq } from "drizzle-orm";
import { embedTexts } from "./embedding-client";

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function getResumeVector(config: {
  apiKey: string;
  baseUrl: string;
  model: string;
}): Promise<number[] | null> {
  const text = await extractLocalResumeText();
  if (!text) return null;

  const hash = hashText(text);
  const [cached] = await db
    .select()
    .from(schema.resumeEmbedding)
    .where(eq(schema.resumeEmbedding.hash, hash));

  if (cached && cached.model === config.model) {
    return JSON.parse(cached.vector) as number[];
  }

  const [vector] = await embedTexts([text], config);
  const now = new Date().toISOString();
  // Single-row cache: replace any prior resume vector.
  await db.delete(schema.resumeEmbedding);
  await db.insert(schema.resumeEmbedding).values({
    hash,
    model: config.model,
    vector: JSON.stringify(vector),
    updatedAt: now,
  });
  return vector;
}
```

Confirm the exact `db`/`schema` import path by matching an existing repository file (e.g. `repositories/settings.ts` imports `{ db, schema } from "../db/index"`). Adjust the import to the established alias.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- resume-vector`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/Side/code/job-apply
git add orchestrator/src/server/services/scoring/resume-vector.ts orchestrator/src/server/services/scoring/resume-vector.test.ts
git commit -m "feat: add cached resume embedding vector"
```

---

### Task 7: `local-scorer` (blend semantic + keyword)

**Files:**
- Create: `orchestrator/src/server/services/scoring/local-scorer.ts`
- Test: `orchestrator/src/server/services/scoring/local-scorer.test.ts`

**Interfaces:**
- Consumes: `cosine`, `embedTexts` (Task 4); `scoreKeywords` (Task 2).
- Produces: `scoreJobLocally(args): Promise<LocalScore>` where
  ```typescript
  interface LocalScore {
    total: number;                 // 0..100 blended
    semanticScore: number | null;  // 0..100 or null when embedding unavailable
    keywordCoverage: number | null;
    keywordMissing: string[];
    reason: string;
    reasonSource: "local";
    jobVector: number[] | null;      // to persist as job cache
    jobVectorModel: string | null;
  }
  ```
  `args`: `{ jobText: string; resumeText: string; resumeVector: number[] | null; cachedJobVector: number[] | null; cachedJobVectorModel: string | null; embeddingConfig: { apiKey: string; baseUrl: string; model: string } | null; semanticWeight: number }`.

Blend rule (spec §4.3): both present → `round(semantic*w + keyword*(1-w))`; embedding unavailable → keyword only (or 0 if keyword null); keyword null → semantic only; neither → 0.

- [ ] **Step 1: Write the failing test**

Create `orchestrator/src/server/services/scoring/local-scorer.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./embedding-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./embedding-client")>()),
  embedTexts: vi.fn(),
}));

import { embedTexts, l2normalize } from "./embedding-client";
import { scoreJobLocally } from "./local-scorer";

const cfg = { apiKey: "k", baseUrl: "https://api.openai.com/v1", model: "m" };

afterEach(() => vi.clearAllMocks());

describe("scoreJobLocally", () => {
  it("blends semantic and keyword coverage by the weight", async () => {
    // identical unit vectors → cosine 1 → semantic 100
    const v = l2normalize([1, 1]);
    const result = await scoreJobLocally({
      jobText: "react typescript kubernetes grpc", // 4 skills
      resumeText: "react typescript", // covers 2/4 → keyword 50
      resumeVector: v,
      cachedJobVector: v,
      cachedJobVectorModel: "m",
      embeddingConfig: cfg,
      semanticWeight: 0.7,
    });
    expect(result.semanticScore).toBe(100);
    expect(result.keywordCoverage).toBe(50);
    expect(result.total).toBe(85); // 100*0.7 + 50*0.3
    expect(result.keywordMissing).toEqual(["grpc", "kubernetes"]);
    expect(embedTexts).not.toHaveBeenCalled(); // used cached job vector
  });

  it("falls back to keyword-only when embedding is unavailable", async () => {
    const result = await scoreJobLocally({
      jobText: "react typescript",
      resumeText: "react typescript",
      resumeVector: null,
      cachedJobVector: null,
      cachedJobVectorModel: null,
      embeddingConfig: null,
      semanticWeight: 0.7,
    });
    expect(result.semanticScore).toBeNull();
    expect(result.keywordCoverage).toBe(100);
    expect(result.total).toBe(100);
  });

  it("embeds the JD when no valid cache and stores the vector", async () => {
    const v = l2normalize([1, 0]);
    vi.mocked(embedTexts).mockResolvedValue([v]);
    const result = await scoreJobLocally({
      jobText: "react",
      resumeText: "react",
      resumeVector: v,
      cachedJobVector: null,
      cachedJobVectorModel: null,
      embeddingConfig: cfg,
      semanticWeight: 0.7,
    });
    expect(embedTexts).toHaveBeenCalledOnce();
    expect(result.jobVector).toEqual(v);
    expect(result.jobVectorModel).toBe("m");
    expect(result.semanticScore).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- local-scorer`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `orchestrator/src/server/services/scoring/local-scorer.ts`:

```typescript
import { logger } from "@infra/logger";
import { scoreKeywords } from "./keyword-scorer";
import { cosine, embedTexts, EmbeddingError } from "./embedding-client";

export interface LocalScore {
  total: number;
  semanticScore: number | null;
  keywordCoverage: number | null;
  keywordMissing: string[];
  reason: string;
  reasonSource: "local";
  jobVector: number[] | null;
  jobVectorModel: string | null;
}

export interface ScoreJobLocallyArgs {
  jobText: string;
  resumeText: string;
  resumeVector: number[] | null;
  cachedJobVector: number[] | null;
  cachedJobVectorModel: string | null;
  embeddingConfig: { apiKey: string; baseUrl: string; model: string } | null;
  semanticWeight: number;
}

export async function scoreJobLocally(
  args: ScoreJobLocallyArgs,
): Promise<LocalScore> {
  const keyword = scoreKeywords(args.resumeText, args.jobText);

  let semanticScore: number | null = null;
  let jobVector: number[] | null = null;
  let jobVectorModel: string | null = null;

  if (args.embeddingConfig && args.resumeVector) {
    try {
      const model = args.embeddingConfig.model;
      const usableCache =
        args.cachedJobVector && args.cachedJobVectorModel === model;
      const vec = usableCache
        ? args.cachedJobVector
        : (await embedTexts([args.jobText], args.embeddingConfig))[0];
      jobVector = vec;
      jobVectorModel = model;
      const sim = cosine(args.resumeVector, vec);
      semanticScore = Math.round(Math.min(1, Math.max(0, sim)) * 100);
    } catch (error) {
      if (!(error instanceof EmbeddingError)) throw error;
      logger.warn("Embedding failed, scoring keyword-only for this job", {
        error: error.message,
      });
    }
  }

  const w = Math.min(1, Math.max(0, args.semanticWeight));
  const kw = keyword.coverage;

  let total: number;
  if (semanticScore !== null && kw !== null) {
    total = Math.round(semanticScore * w + kw * (1 - w));
  } else if (semanticScore !== null) {
    total = semanticScore;
  } else if (kw !== null) {
    total = kw;
  } else {
    total = 0;
  }

  const parts: string[] = [];
  if (semanticScore !== null) parts.push(`Semantic ${semanticScore}`);
  else parts.push("Keyword-only");
  if (kw !== null) {
    const matched = keyword.jobSkills.length - keyword.missing.length;
    parts.push(`coverage ${kw}% (${matched}/${keyword.jobSkills.length})`);
    if (keyword.missing.length > 0) {
      parts.push(`Missing: ${keyword.missing.join(", ")}`);
    }
  } else if (!args.resumeText) {
    parts.push("no resume text extracted");
  }

  return {
    total,
    semanticScore,
    keywordCoverage: kw,
    keywordMissing: keyword.missing,
    reason: parts.join(" · "),
    reasonSource: "local",
    jobVector,
    jobVectorModel,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- local-scorer`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/Side/code/job-apply
git add orchestrator/src/server/services/scoring/local-scorer.ts orchestrator/src/server/services/scoring/local-scorer.test.ts
git commit -m "feat: add local blended scorer (semantic + keyword)"
```

---

### Task 8: Wire the local scorer into `scoreJobsStep`

**Files:**
- Modify: `orchestrator/src/server/pipeline/steps/score-jobs.ts`
- Modify: `orchestrator/src/server/repositories/jobs.ts` (add an update that persists the new score fields)
- Modify: `orchestrator/src/server/pipeline/steps/score-jobs.test.ts` (adapt to the local scorer)

**Interfaces:**
- Consumes: `scoreJobLocally` (Task 7), `resolveEmbeddingConfig`/`getResumeVector` (Tasks 4/6), `getSetting("semanticScoreWeight")`.
- Produces: `scoreJobsStep` now scores locally. Persists `suitabilityScore` (= `total`), `suitabilityReason`, `suitabilityReasonSource="local"`, `semanticScore`, `keywordCoverage`, `keywordMissing` (JSON), `jobEmbedding` (JSON of `jobVector`), `jobEmbeddingModel`.

- [ ] **Step 1: Read the current step and its test**

Run: `sed -n '1,140p' orchestrator/src/server/pipeline/steps/score-jobs.ts` and `sed -n '1,80p' orchestrator/src/server/pipeline/steps/score-jobs.test.ts`. Note how it currently calls `scoreJobSuitability`, how it persists the result, and how the test mocks the scorer — you will mirror those exact seams.

- [ ] **Step 2: Add/confirm a jobs-repo update for the score fields**

In `orchestrator/src/server/repositories/jobs.ts`, ensure there is an update that writes the six score fields for a job id. If the existing `updateJob` already accepts a partial of the job columns, use it (the new drizzle columns are already part of the row type from Task 5) — no new function needed. If scoring currently uses a narrower dedicated setter, extend it to accept `{ suitabilityScore, suitabilityReason, suitabilityReasonSource, semanticScore, keywordCoverage, keywordMissing, jobEmbedding, jobEmbeddingModel }`. Confirm by reading the current persistence call in `score-jobs.ts` from Step 1.

- [ ] **Step 3: Write/adapt the failing test**

In `score-jobs.test.ts`, replace the LLM-scorer mock with the local path. Mock `@server/services/scoring/local-scorer`, `@server/services/scoring/embedding-client`, and `@server/services/scoring/resume-vector` so a run produces a deterministic score. Assert that after `scoreJobsStep`, a discovered job's persisted `suitabilityScore` equals the mocked `total` and `suitabilityReasonSource` is `"local"`, and that `scoreJobSuitability` (the LLM one) is **not** called. Model the mock structure on the existing test's setup found in Step 1.

```typescript
// sketch — align names with the existing test's imports/mocks from Step 1
vi.mock("@server/services/scoring/local-scorer", () => ({
  scoreJobLocally: vi.fn().mockResolvedValue({
    total: 82,
    semanticScore: 90,
    keywordCoverage: 60,
    keywordMissing: ["kubernetes"],
    reason: "Semantic 90 · coverage 60% (3/5) · Missing: kubernetes",
    reasonSource: "local",
    jobVector: [0, 1],
    jobVectorModel: "text-embedding-3-small",
  }),
}));
vi.mock("@server/services/scoring/resume-vector", () => ({
  getResumeVector: vi.fn().mockResolvedValue([0, 1]),
}));
vi.mock("@server/services/scoring/embedding-client", () => ({
  resolveEmbeddingConfig: vi
    .fn()
    .mockResolvedValue({ apiKey: "k", baseUrl: "u", model: "text-embedding-3-small" }),
}));
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- score-jobs`
Expected: FAIL (step still calls the LLM scorer / doesn't persist the new fields).

- [ ] **Step 5: Rewire the step**

In `score-jobs.ts`:
1. Replace the `scoreJobSuitability` import/call with the local flow. Near the top of the step (once per run): `const embeddingConfig = await resolveEmbeddingConfig();` and `const resumeVector = embeddingConfig ? await getResumeVector(embeddingConfig) : null;` and `const semanticWeight = Number(await getSetting("semanticScoreWeight")) || 0.7;`.
2. Per job (inside the existing `asyncPool` task, keeping the cached-score short-circuit and `autoSkipScoreThreshold` behavior): build `jobText` from the job's description/title (mirror what `buildScoringPrompt` used — job title + description), and:
```typescript
const local = await scoreJobLocally({
  jobText: `${job.title}\n${job.jobDescription ?? ""}`,
  resumeText: profileText, // see note below
  resumeVector,
  cachedJobVector: job.jobEmbedding ? JSON.parse(job.jobEmbedding) : null,
  cachedJobVectorModel: job.jobEmbeddingModel ?? null,
  embeddingConfig,
  semanticWeight,
});
```
3. `profileText`: `scoreJobsStep` currently receives a `profile: Record<string, unknown>`. The resume text is `profile.rawText` (set by `getProfile`, see `services/profile.ts`). Use `String((profile as { rawText?: string }).rawText ?? "")`.
4. Persist via the repo update from Step 2: `suitabilityScore: local.total`, `suitabilityReason: local.reason`, `suitabilityReasonSource: local.reasonSource`, `semanticScore: local.semanticScore`, `keywordCoverage: local.keywordCoverage`, `keywordMissing: JSON.stringify(local.keywordMissing)`, `jobEmbedding: local.jobVector ? JSON.stringify(local.jobVector) : null`, `jobEmbeddingModel: local.jobVectorModel`.
5. Keep pushing the scored job into `scoredJobs` with `suitabilityScore: local.total` so downstream selection is unchanged.

Remove the now-unused `scoreJobSuitability` import from this file (it stays exported from `scorer.ts` for Task 9).

- [ ] **Step 6: Run tests + type check**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- score-jobs` then `npm --workspace orchestrator run check:types`
Expected: PASS + clean.

- [ ] **Step 7: Commit**

```bash
cd /Users/Side/code/job-apply
git add orchestrator/src/server/pipeline/steps/score-jobs.ts orchestrator/src/server/pipeline/steps/score-jobs.test.ts orchestrator/src/server/repositories/jobs.ts
git commit -m "feat: score jobs locally (embedding + keyword) in the pipeline"
```

---

### Task 9: `POST /api/jobs/:id/deep-analyze` (opt-in LLM)

**Files:**
- Modify: `orchestrator/src/server/api/routes/jobs.ts`
- Modify: `orchestrator/src/server/api/routes/jobs.test.ts`

**Interfaces:**
- Consumes: `scoreJobSuitability` (`@server/services/scorer`), `getProfile` (`@server/services/profile`), the jobs repo update from Task 8.
- Produces: `POST /api/jobs/:id/deep-analyze` → runs the LLM scorer for one job, writes `suitabilityScore` (LLM score), `suitabilityReason` (LLM reason), `suitabilityReasonSource="llm"`; returns the updated job. Returns a clear error when no chat key is configured (mirror how existing LLM routes detect a missing key — reuse the same guard/error `scoreJobSuitability` already surfaces).

- [ ] **Step 1: Write the failing test**

In `jobs.test.ts`, add a test that mocks `@server/services/scorer`'s `scoreJobSuitability` to return `{ score: 88, reason: "Strong backend match" }` and `@server/services/profile`'s `getProfile`, POSTs to `/api/jobs/<seededId>/deep-analyze`, and asserts the response job has `suitabilityScore === 88`, `suitabilityReason === "Strong backend match"`, and `suitabilityReasonSource === "llm"`. Follow the seeding/request pattern already used by other tests in this file (find an existing POST-to-`/api/jobs/:id/...` test to mirror setup).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- routes/jobs`
Expected: FAIL — route not found (404).

- [ ] **Step 3: Implement the route**

In `jobs.ts`, add:

```typescript
jobsRouter.post("/:id/deep-analyze", async (req: Request, res: Response) => {
  try {
    const job = await jobsRepo.getJobById(req.params.id);
    if (!job) return fail(res, notFound("Job not found"));

    const profile = await getProfile();
    const { score, reason } = await scoreJobSuitability(job, profile);

    const updated = await jobsRepo.updateJob(job.id, {
      suitabilityScore: score,
      suitabilityReason: reason,
      suitabilityReasonSource: "llm",
    });
    ok(res, updated);
  } catch (error) {
    fail(res, toAppError(error));
  }
});
```

Match the actual imports already present in `jobs.ts` (`fail`, `ok`, `notFound`, `toAppError`, `jobsRepo`, `getProfile`, `scoreJobSuitability`) — add any missing import. `getProfile()` throwing "No resume configured" and the LLM layer throwing on a missing key both surface as clear errors via `toAppError`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run -- routes/jobs` then `npm --workspace orchestrator run check:types`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/Side/code/job-apply
git add orchestrator/src/server/api/routes/jobs.ts orchestrator/src/server/api/routes/jobs.test.ts
git commit -m "feat: add per-job deep-analyze (opt-in LLM scoring) endpoint"
```

---

### Task 10: Client — scoring display, deep-analyze button, settings

**Files:**
- Modify: `orchestrator/src/client/api/client.ts` (add `deepAnalyzeJob(id)`; ensure job type carries the new fields)
- Modify: the job detail / ready view that shows the suitability score (find with `grep -rl "suitabilityScore" orchestrator/src/client`) to render `semanticScore`, `keywordCoverage`, and `keywordMissing`, plus a "Deep analysis" button
- Modify: `orchestrator/src/client/pages/settings/components/ScoringSettingsSection.tsx` (weight slider) and `ModelSettingsSection.tsx` or a new embedding sub-section (embedding provider/model/key fields)
- Modify: the corresponding client tests

**Interfaces:**
- Consumes: `POST /api/jobs/:id/deep-analyze` (Task 9); settings keys `semanticScoreWeight`, `embeddingModel`, `embeddingProvider`, `embeddingBaseUrl`, `embeddingApiKey` (Task 3).

- [ ] **Step 1: API client method + types**

In `client.ts`, add `export async function deepAnalyzeJob(id: string): Promise<Job> { return fetchApi<Job>(\`/jobs/${id}/deep-analyze\`, { method: "POST" }); }`. Confirm the shared `Job` type includes the new columns (they come from the drizzle row type via `@shared/types`; if the client `Job`/`JobListItem` type is hand-maintained, add `semanticScore`, `keywordCoverage`, `keywordMissing`, `suitabilityReasonSource`). Run `npm --workspace orchestrator run check:types`.

- [ ] **Step 2: Scoring display + button (write test first)**

In the component test for the job/ready view, render a job with `suitabilityScore`, `semanticScore`, `keywordCoverage`, `keywordMissing: ["kubernetes"]` and assert the coverage and a "Missing: kubernetes" hint render, and that a "Deep analysis" button is present and disabled when no chat key is configured (mirror how other components read key presence from settings). Then implement the display + button (button calls `deepAnalyzeJob` and refreshes). Keep to the existing component's styling patterns.

- [ ] **Step 3: Settings fields (write test first)**

Add a weight control to `ScoringSettingsSection` (0–1, maps to `semanticScoreWeight`) and embedding provider/model/key fields (map to `embeddingProvider`/`embeddingModel`/`embeddingApiKey`/`embeddingBaseUrl`) in the model/environment settings area. Follow the existing form-field + dirty-field + save-payload pattern already used in `SettingsPage.tsx` for other settings (mirror an existing numeric setting for the weight and an existing secret for the key). Update `SettingsPage.test.tsx` fixtures accordingly.

- [ ] **Step 4: Run client tests + type check + biome**

Run: `cd /Users/Side/code/job-apply && npm --workspace orchestrator run test:run` (full suite) then `npm run check:types` then `./node_modules/.bin/biome ci .`
Expected: all pass (only the 0 known-failing baseline; there should be none now).

- [ ] **Step 5: Commit**

```bash
cd /Users/Side/code/job-apply
git add orchestrator/src/client
git commit -m "feat: show local scores + deep-analyze button + scoring/embedding settings"
```

---

### Task 11: Docs + rebuild

**Files:**
- Modify: `orchestrator/README.md` and/or root `README.md` (one line: scoring is embedding+keyword by default; LLM is opt-in per job)
- Modify: `.env.example` (document `EMBEDDING_API_KEY`, `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_BASE_URL`)

- [ ] **Step 1: Update docs/env**

Add the four `EMBEDDING_*` vars to `.env.example` with a short comment ("Optional — defaults to your LLM provider/key; only needed if your chat provider has no embeddings API"). Add one line to the README describing default scoring.

- [ ] **Step 2: Full verification**

Run: `cd /Users/Side/code/job-apply && npm run check:types && ./node_modules/.bin/biome ci . && npm --workspace orchestrator run test:run`
Expected: types clean, biome clean, all tests pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/Side/code/job-apply
git add README.md orchestrator/README.md .env.example
git commit -m "docs: document embedding scoring and EMBEDDING_* env vars"
```

- [ ] **Step 4: Rebuild the running app (per Global Constraints)**

```bash
docker compose -f /Users/Side/code/job-apply/docker-compose.yml --project-directory /Users/Side/code/job-apply up -d --build
```
Then confirm health: `curl -fsS http://localhost:3005/health`. (Manual/ops step — safe to run once all code tasks are merged.)

---

## Self-Review Notes

- **Spec coverage:** §3 tiered behavior → Tasks 4 (config resolve returns null → keyword-only), 7 (degradation), 8 (wiring), 9 (chat button). §4 scoring model → Tasks 1,2,7. §5 modules → Tasks 1,2,4,6,7,9. §6 schema/caching → Tasks 5,6,7,8. §7 settings → Task 3. §8 integration → Tasks 8,10. §9 error handling → Task 7 (embedding failure), Task 8 (empty resume via `profile.rawText=""`). §10 testing → each task is TDD. §11 non-goals → nothing touches tailoring/ghostwriter/manual-import (only `score-jobs.ts` and a new `jobs.ts` route).
- **Type consistency:** `LocalScore` fields (`total`, `semanticScore`, `keywordCoverage`, `keywordMissing`, `reason`, `reasonSource`, `jobVector`, `jobVectorModel`) are produced in Task 7 and consumed/persisted verbatim in Task 8. `scoreKeywords` return shape (`coverage`/`missing`/`jobSkills`/`resumeSkills`) is defined in Task 2 and used in Task 7. Embedding config shape `{apiKey, baseUrl, model}` is consistent across Tasks 4/6/7/8. DB column names (`semantic_score`, `keyword_coverage`, `keyword_missing`, `job_embedding`, `job_embedding_model`, `suitability_reason_source`) match between Task 5 migration and drizzle defs.
- **Known verify-at-execution seams (flagged in-task, not guessed):** exact secret access on `getEffectiveSettings` vs `getSetting` (Task 4 Step 3 note); the `db`/`schema` import alias (Task 6); the current persistence/mock seams in `score-jobs.ts` and `jobs.ts` (Tasks 8/9 read the file first). These are called out explicitly rather than assumed.
