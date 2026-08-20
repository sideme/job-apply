import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

describe.sequential("agent run repository", () => {
  let dataDir: string;
  let closeDb: (() => void) | null = null;

  beforeEach(async () => {
    vi.resetModules();
    dataDir = await mkdtemp(join(tmpdir(), "job-ops-agent-runs-"));
    process.env = { ...originalEnv, DATA_DIR: dataDir, NODE_ENV: "test" };
    await import("../db/migrate");
    closeDb = (await import("../db")).closeDb;
  });

  afterEach(async () => {
    closeDb?.();
    closeDb = null;
    process.env = { ...originalEnv };
    await rm(dataDir, { recursive: true, force: true });
  });

  it("atomically reserves the daily run limit and reconciles usage", async () => {
    const repository = await import("./agent-runs");
    const identity = {
      kind: "fit_judge" as const,
      localDate: "2026-08-13",
      timeZone: "America/Toronto",
    };

    expect(repository.reserveDailyAgentRun({ ...identity, maxRuns: 1 })).toBe(
      true,
    );
    expect(repository.reserveDailyAgentRun({ ...identity, maxRuns: 1 })).toBe(
      false,
    );
    repository.addDailyAgentUsage({
      ...identity,
      inputTokens: 120,
      outputTokens: 30,
      searchesUsed: 0,
      judgmentsUsed: 2,
    });

    expect(await repository.getDailyAgentUsage(identity)).toMatchObject({
      runsStarted: 1,
      inputTokens: 120,
      outputTokens: 30,
      searchesUsed: 0,
      judgmentsUsed: 2,
    });
  });

  it("persists sanitized bounded trace steps", async () => {
    const repository = await import("./agent-runs");
    const run = await repository.createAgentRun({
      kind: "search_planner",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      promptVersion: "search-v1",
      localDate: "2026-08-13",
      timeZone: "America/Toronto",
    });
    await repository.appendAgentRunStep({
      agentRunId: run.id,
      iteration: 1,
      sequence: 1,
      stepType: "tool",
      toolName: "run_search",
      toolCallId: "call-1",
      argsSummary: { query: "java", apiKey: "must-not-persist" },
      resultSummary: { found: 10 },
    });

    const [step] = await repository.listAgentRunSteps(run.id);
    expect(step.argsSummary).toContain("[REDACTED]");
    expect(step.argsSummary).not.toContain("must-not-persist");
    expect(step.resultSummary).toContain('"found":10');
  });

  it("marks interrupted runs as failed during startup recovery", async () => {
    const repository = await import("./agent-runs");
    const run = await repository.createAgentRun({
      kind: "fit_judge",
      localDate: "2026-08-13",
      timeZone: "America/Toronto",
    });

    expect(
      await repository.failStaleAgentRuns(
        new Date(Date.now() + 60_000).toISOString(),
      ),
    ).toBe(1);

    const { db, schema } = await import("../db");
    const { eq } = await import("drizzle-orm");
    const [recovered] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, run.id));
    expect(recovered).toMatchObject({
      status: "failed",
      errorCode: "INTERRUPTED",
    });
  });
});
