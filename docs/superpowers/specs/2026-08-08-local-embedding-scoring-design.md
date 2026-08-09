# Local Embedding + Keyword Scoring — Design

> Safety amendment (2026-08-09): the shipped implementation keeps embedding scoring off by default and never inherits chat-model credentials. It requires an explicit embedding provider, base URL, model, and dedicated key. Job cache validity includes both the model and a hash of the exact truncated input. Automatic runs cap uncached job-vector requests (20 by default) while allowing unlimited cache hits; input is limited to 6,000 characters by default.

Date: 2026-08-08
Status: Implemented; retained as the scoring design reference

> Implementation note: the code, schema, settings, cache, local fallback, and opt-in deep-analysis endpoint described here are implemented. The matching implementation is covered by the local scoring and pipeline test suites.

## 1. Background & Motivation

Today job-apply scores every discovered job for resume fit by sending the profile + JD to an **LLM chat completion** (`scoreJobSuitability` in `orchestrator/src/server/services/scorer.ts`, driven from `scoreJobsStep`). That means a paid, slow, non-deterministic LLM call **per job, every run** — expensive at 50–200 jobs/day and requiring a chat API key just to get a ranking.

Side wants scoring that doesn't burn an LLM chat call per job, while still ranking jobs against his actual resume. The agreed direction:

- **Default scoring = embedding semantic similarity + keyword coverage.** Embeddings are ~1–2 orders of magnitude cheaper than chat and use far fewer tokens (one short call per job, no generation), so per-job scoring cost becomes negligible.
- **The LLM chat "deep analysis" becomes opt-in per job** (a button), reserved for the few jobs Side actually cares about, producing a written rationale.
- This only replaces **scoring**. The other three LLM uses in the app — tailoring, ghostwriter, manual-job import — are left untouched (they generate/parse text, which embeddings can't do).

Embeddings run via a **cloud embedding API** (Side declined a local model). A cheap embedding key is acceptable; it is not the same as paying for a chat call per job.

## 2. Requirements

### 2.1 Functional

- Score each discovered job against the resume without an LLM chat call, producing a 0–100 `suitabilityScore` and a short human-readable `suitabilityReason`.
- Score = weighted blend of a **semantic score** (embedding cosine similarity between resume text and JD text) and a **keyword coverage score** (share of the JD's detected skills that appear in the resume).
- Surface, per job, the **missing keywords** (JD skills absent from the resume) — the "what to add to pass the ATS" signal.
- The blend weight is **configurable** in Settings (default 70% semantic / 30% keyword).
- A per-job **"deep analysis"** action runs the existing LLM chat scorer on demand and replaces that job's reason with the richer LLM rationale.
- **Graceful degradation by which keys are configured:**
  - No keys at all → keyword coverage only (free, offline).
  - Embedding key configured → semantic + keyword (default).
  - Chat key configured → the per-job deep-analysis button becomes available.
- Cheap **re-ranking**: changing the weight, or uploading a new resume, must not require re-embedding every JD.

### 2.2 Non-functional

- Embedding calls per pipeline run are bounded: each JD is embedded **at most once** (cached), and the resume is embedded once per resume-file change.
- No crash on embedding-API failure or missing key — fall back to keyword-only for that job and continue the pipeline.
- Deterministic given fixed inputs and model (same vectors → same score).

### 2.3 Non-goals

- **Not** replacing tailoring (`summary.ts` `generateTailoring`), ghostwriter (`services/ghostwriter.ts`), or manual-job import inference (`routes/manual-jobs.ts`). Those keep using the LLM as they do today (available when a chat key is set, otherwise unavailable — unchanged).
- **No** browser auto-fill / auto-submit (still out of scope, as always).
- **No** attempt at a perfect structured resume/JD parser. The semantic half is handled by embeddings (which need no parsing); the keyword half uses an approximate skills dictionary and only needs to be "good enough" for the coverage signal.
- Not deciding whether to eventually remove the now-semi-vestigial tailoring path — that is a separate future cleanup.

## 3. Tiered behavior (the core UX)

| Configured keys | Scoring behavior |
|---|---|
| none | keyword coverage only → `suitabilityScore` = keyword coverage; reason notes "keyword-only" |
| embedding key | semantic + keyword blended (default) |
| + chat key | above, plus a per-job "Deep analysis" button that runs the LLM |

## 4. Scoring model

### 4.1 Semantic score
- `cosine` = cosine similarity of `resumeVector` and `jobVector` (both L2-normalized embeddings of the respective plain texts).
- `semanticScore` = `round(clamp(cosine, 0, 1) * 100)`.
- Rationale for the simple clamp/scale: text-embedding cosine for related docs typically lands in ~0.2–0.8; a linear map to 0–100 is a reasonable, tunable first cut. Calibration curves are explicitly out of scope for v1.

### 4.2 Keyword coverage
- A curated **skills dictionary** maps canonical skills to alias sets (e.g. `kubernetes` ← {kubernetes, k8s}; `react` ← {react, reactjs, react.js}). Stored as data in `shared/src/skills/skills-dictionary.ts`.
- `resumeSkills` = canonical skills whose any alias appears (word-boundary, case-insensitive) in the resume text.
- `jobSkills` = canonical skills whose any alias appears in the JD text.
- `keywordCoverage` = `jobSkills.size === 0 ? null : round(|resumeSkills ∩ jobSkills| / |jobSkills| * 100)`.
- `keywordMissing` = `jobSkills − resumeSkills` (canonical names), stored for display.
- When `jobSkills` is empty (no known skills detected in the JD), keyword coverage is `null` and does not contribute to the blend (total = semantic only).

### 4.3 Blended total
Let `w` = `semanticScoreWeight` setting (0–1, default 0.7).
- Both available: `total = round(semanticScore * w + keywordCoverage * (1 - w))`.
- Embedding unavailable (no key / API error): `total = keywordCoverage` (or 0 if that is also null).
- Keyword coverage null: `total = semanticScore`.
- Neither available (e.g. empty resume text AND no JD skills): `total = 0`, reason flags "no resume text / no signal".

### 4.4 Local reason string
Free, informative, no LLM. Examples:
- `"Semantic 78 · keyword coverage 60% (6/10). Missing: kubernetes, grpc, terraform, argocd"`
- `"Keyword-only (no embedding key): coverage 50% (4/8). Missing: ..."`
Stored in `suitabilityReason`. The per-job LLM deep-analysis overwrites this with the LLM rationale (and the local reason is preserved separately, see §6).

## 5. Modules (each single-purpose, independently testable)

Files under `orchestrator/src/server/services/scoring/` unless noted.

- **`embedding-client.ts`** — `embedText(texts: string[]): Promise<number[][]>`. Resolves provider/model/key/baseUrl (see §7), calls the embedding API, returns L2-normalized vectors. Throws a typed error on failure; never called directly by the scorer without a try/catch fallback.
- **`skills/skills-dictionary.ts`** (in `shared`) — the canonical-skill → aliases data + a `detectSkills(text): Set<string>` helper. Pure, no I/O.
- **`keyword-scorer.ts`** — `scoreKeywords(resumeText, jobText) → { coverage: number | null, missing: string[], jobSkills: string[], resumeSkills: string[] }`. Pure function over the dictionary. Fully unit-testable, zero deps.
- **`resume-vector.ts`** — `getResumeVector(model): Promise<number[] | null>`. Reads local resume text (`extractLocalResumeText`), hashes it, returns the cached vector when `{hash, model}` matches; otherwise embeds and caches. Returns null if no resume text or embedding unavailable.
- **`local-scorer.ts`** — `scoreJobLocally(job, resumeText, resumeVector, settings) → { total, semanticScore, keywordCoverage, keywordMissing, reason, jobVector?, jobVectorModel? }`. Orchestrates: reuse or compute the JD vector (via `embedding-client`, cached on the job), compute cosine, call `keyword-scorer`, blend per §4, build the reason. Handles all degradation paths. This is what the pipeline calls.
- **`deep-analyze` endpoint** — `POST /api/jobs/:id/deep-analyze` in `routes/jobs.ts`: runs the existing `scoreJobSuitability` (LLM chat) for that one job, writes the LLM rationale. Requires a chat key; returns a clear error if none.

The existing `scoreJobSuitability` (LLM chat) stays in `scorer.ts` but is **no longer called by the pipeline** — only by the deep-analyze endpoint.

## 6. Data model & caching

### 6.1 Jobs table (new columns, Drizzle migration)
- `semanticScore` real, nullable
- `keywordCoverage` real, nullable
- `keywordMissing` text (JSON array), nullable
- `jobEmbedding` text (JSON float array), nullable — the cached JD vector
- `jobEmbeddingModel` text, nullable — which embedding model produced `jobEmbedding` (cache is valid only when this equals the current model)
- Reuse existing: `suitabilityScore` = blended total; `suitabilityReason` = local reason or LLM rationale
- Add `suitabilityReasonSource` text (`"local"` | `"llm"`), nullable — so a deep-analysis result is distinguishable and a re-score won't silently clobber an LLM rationale unless asked.

### 6.2 Resume vector cache
- Single-row table `resume_embedding` (`hash` text, `model` text, `vector` text JSON, `updatedAt` text). Recomputed when the resume PDF's text hash or the embedding model changes.

### 6.3 Re-ranking (the payoff of caching)
- **Weight changed:** recombine `semanticScore` + `keywordCoverage` already stored per job → pure local, zero API calls.
- **Resume changed:** re-embed the resume once (1 call), then for each job recompute cosine from the **cached `jobEmbedding`** (local) + recombine → no per-JD API calls.
- A "Rescore (recompute)" action triggers the appropriate path.

## 7. Settings

New settings (via the existing `settingsRegistry` pattern), all optional with sensible defaults:
- `semanticScoreWeight` (number 0–1, default `0.7`)
- `embeddingModel` (string, default `text-embedding-3-small`)
- `embeddingProvider` (string, optional) — **defaults to the chat `llmProvider`**
- `embeddingApiKey` (secret, optional) — **defaults to `llmApiKey`** when the provider matches
- `embeddingBaseUrl` (string, optional) — defaults to the provider's embedding endpoint / `llmBaseUrl`

Resolution rule: if no embedding-specific override is set, embeddings use the **same provider + key + base URL as the chat LLM** (many providers, e.g. OpenAI, serve both from one key). Overrides exist for the case where the chat provider has no embeddings API (e.g. DeepSeek) and a different embedding provider is needed.

## 8. Integration points

- `scoreJobsStep` (`pipeline/steps/score-jobs.ts`): replace the `scoreJobSuitability` call with `scoreJobLocally`. Keep the existing `autoSkipScoreThreshold`, cached-score short-circuit, and concurrency behavior.
- Resume vector is fetched once at the start of the step and passed into each per-job call (not re-fetched per job).
- Client: the job/Ready views show `semanticScore`, `keywordCoverage`, and `keywordMissing`; add a "Deep analysis" button (enabled only when a chat key is configured) that calls the new endpoint and refreshes the reason.
- Settings UI (`ScoringSettingsSection`): add the weight slider and the embedding provider/model/key fields.

## 9. Error handling & degradation

- `embedding-client` throws typed errors; `resume-vector` and `local-scorer` catch them and degrade to keyword-only for the affected job, logging a warning; the pipeline run continues.
- Empty resume text (e.g. scanned/image-only PDF): semantic unavailable and `resumeSkills` empty → keyword coverage compares against nothing → `total = 0` with reason `"No resume text extracted — upload a text-based PDF"`.
- Deep-analyze with no chat key configured → `400`/clear message, button disabled client-side.
- Model-mismatch on a cached `jobEmbedding` (`jobEmbeddingModel` ≠ current model) → treat as cache miss and re-embed.

## 10. Testing strategy

- **`keyword-scorer` / skills dictionary** — pure-function unit tests: alias normalization (react/reactjs/react.js → react), coverage math, missing-list, empty-JD-skills → null.
- **`local-scorer`** — with mocked embedding vectors: cosine + blend per §4, all degradation branches (no embedding, null coverage, empty resume), reason strings.
- **`resume-vector` / JD cache** — cache hit, miss, and model-invalidation.
- **`embedding-client`** — mocked HTTP, provider/key resolution, L2-normalization, error typing.
- **`scoreJobsStep` integration** — mocked embedding client: pipeline scores jobs locally, respects auto-skip threshold, doesn't call the LLM chat scorer.
- **deep-analyze endpoint** — calls the LLM scorer, writes `suitabilityReasonSource = "llm"`, errors cleanly with no chat key.

## 11. Scope / non-goals (restated)

- Replaces **scoring only**. Tailoring, ghostwriter, and manual-job import keep their current LLM usage untouched.
- No browser auto-fill / auto-submit.
- Skills dictionary is deliberately approximate; not a full ATS parser.
- Embedding model is cloud-based (no local model), per Side's decision.
