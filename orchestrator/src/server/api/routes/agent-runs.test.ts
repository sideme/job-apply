import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe.sequential("Agent Runs API routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("returns paginated runs and sanitized trace steps", async () => {
    const repository = await import("@server/repositories/agent-runs");
    const run = await repository.createAgentRun({
      kind: "search_planner",
      localDate: "2026-08-13",
      timeZone: "America/Toronto",
    });
    await repository.appendAgentRunStep({
      agentRunId: run.id,
      iteration: 1,
      sequence: 1,
      stepType: "tool",
      toolName: "run_search",
      argsSummary: { query: "backend", apiKey: "hidden" },
      resultSummary: { found: 2 },
    });

    const runsResponse = await fetch(`${baseUrl}/api/agent-runs?limit=10`);
    const runsBody = await runsResponse.json();
    expect(runsBody.ok).toBe(true);
    expect(runsBody.data.total).toBe(1);
    expect(runsBody.data.runs[0].id).toBe(run.id);
    expect(typeof runsBody.meta.requestId).toBe("string");

    const stepsResponse = await fetch(
      `${baseUrl}/api/agent-runs/${run.id}/steps?limit=10`,
    );
    const stepsBody = await stepsResponse.json();
    expect(stepsBody.ok).toBe(true);
    expect(stepsBody.data.steps[0].argsSummary).toContain("[REDACTED]");
    expect(stepsBody.data.steps[0].argsSummary).not.toContain("hidden");
  });
});
