// @vitest-environment node

import { createAppSettings } from "@shared/testing/factories";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTurnResponse } from "../llm/types";

const mocks = vi.hoisted(() => ({
  responses: [] as AgentTurnResponse[],
  discoverJobsStep: vi.fn(),
  appendStep: vi.fn(async () => undefined),
  completeRun: vi.fn(async () => undefined),
  settings: null as unknown,
}));

vi.mock("@server/services/settings", () => ({
  getEffectiveSettings: vi.fn(async () => mocks.settings),
}));

vi.mock("@server/repositories/settings", () => ({
  getAllSettings: vi.fn(async () => ({
    searchTerms: '["backend engineer"]',
    searchCities: "Toronto, ON",
    jobspyCountryIndeed: "canada",
  })),
}));

vi.mock("@server/repositories/jobs", () => ({
  listJobsForDuplicateIndex: vi.fn(async () => []),
}));

vi.mock("@server/repositories/agent-runs", () => ({
  reserveDailyAgentRun: vi.fn(() => true),
  createAgentRun: vi.fn(async () => ({ id: "agent-run-1" })),
  appendAgentRunStep: mocks.appendStep,
  addDailyAgentUsage: vi.fn(),
  completeAgentRun: mocks.completeRun,
}));

vi.mock("@server/pipeline/steps/discover-jobs", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@server/pipeline/steps/discover-jobs")
    >();
  return { ...actual, discoverJobsStep: mocks.discoverJobsStep };
});

vi.mock("../llm/service", () => ({
  LlmService: class {
    getProvider() {
      return "deepseek" as const;
    }

    getAgentAvailability() {
      return { available: true, reason: null };
    }

    async callAgentTurn(): Promise<AgentTurnResponse> {
      const next = mocks.responses.shift();
      if (!next) throw new Error("No scripted response");
      return next;
    }
  },
}));

function configuredSettings() {
  return createAppSettings({
    llmProvider: {
      value: "deepseek",
      default: "deepseek",
      override: "deepseek",
    },
    agentModel: { value: "deepseek-v4-flash", override: null },
    agenticDiscoveryEnabled: { value: true, default: false, override: true },
    agentMaxSearchesPerRun: { value: 3, default: 10, override: 3 },
    agentStopWhenNewBelow: { value: 1, default: 3, override: 1 },
  });
}

function toolResponse(
  calls: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>,
): AgentTurnResponse {
  return {
    success: true,
    data: {
      message: {
        role: "assistant",
        content: null,
        toolCalls: calls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: JSON.stringify(call.args),
          },
        })),
      },
      finishReason: "tool_calls",
      usage: { inputTokens: 20, outputTokens: 5 },
    },
  };
}

describe("Search Planner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.responses.length = 0;
    mocks.settings = configuredSettings();
    mocks.discoverJobsStep.mockResolvedValue({
      discoveredJobs: [
        {
          source: "indeed",
          title: "Backend Engineer",
          employer: "Acme",
          jobUrl: "https://example.com/job-1",
        },
      ],
      sourceErrors: [],
      sourcesUsed: ["indeed"],
    });
  });

  it("caches duplicate tool requests and only narrows approved sources", async () => {
    mocks.responses.push(
      toolResponse([
        {
          id: "call-1",
          name: "run_search",
          args: { query: "Backend Engineer", sourceHints: ["indeed"] },
        },
        {
          id: "call-2",
          name: "run_search",
          args: { query: " backend   engineer ", sourceHints: ["indeed"] },
        },
      ]),
      toolResponse([
        { id: "call-3", name: "finish", args: { reason: "enough" } },
      ]),
    );

    const { runSearchPlanner } = await import("./search-planner");
    const result = await runSearchPlanner({
      pipelineRunId: "pipeline-1",
      profile: { rawText: "Node TypeScript" },
      mergedConfig: {
        topN: 10,
        minSuitabilityScore: 50,
        sources: ["indeed", "linkedin"],
        outputDir: "/tmp/output",
      },
    });

    expect(result.fallbackToFixed).toBe(false);
    expect(result.searchesUsed).toBe(1);
    expect(result.cacheHits).toBe(1);
    expect(result.discoveredJobs).toHaveLength(1);
    expect(mocks.discoverJobsStep).toHaveBeenCalledTimes(1);
    expect(mocks.discoverJobsStep).toHaveBeenCalledWith(
      expect.objectContaining({
        mergedConfig: expect.objectContaining({ sources: ["indeed"] }),
        searchTermsOverride: ["backend engineer"],
      }),
    );
  });

  it("requests deterministic fallback when the agent is unavailable", async () => {
    mocks.responses.push({
      success: false,
      code: "AGENT_UNAVAILABLE",
      error: "API key missing",
    });

    const { runSearchPlanner } = await import("./search-planner");
    const result = await runSearchPlanner({
      pipelineRunId: "pipeline-2",
      profile: { rawText: "Node TypeScript" },
      mergedConfig: {
        topN: 10,
        minSuitabilityScore: 50,
        sources: ["indeed"],
        outputDir: "/tmp/output",
      },
    });

    expect(result.fallbackToFixed).toBe(true);
    expect(result.searchesUsed).toBe(0);
    expect(result.stopReason).toBe("agent_unavailable");
    expect(mocks.discoverJobsStep).not.toHaveBeenCalled();
  });

  it("falls back after a failed first search without retrying sources", async () => {
    mocks.discoverJobsStep.mockRejectedValue(new Error("all sources failed"));
    mocks.responses.push(
      toolResponse([
        {
          id: "call-1",
          name: "run_search",
          args: { query: "backend engineer", sourceHints: ["indeed"] },
        },
      ]),
    );

    const { runSearchPlanner } = await import("./search-planner");
    const result = await runSearchPlanner({
      pipelineRunId: "pipeline-3",
      profile: { rawText: "Node TypeScript" },
      mergedConfig: {
        topN: 10,
        minSuitabilityScore: 50,
        sources: ["indeed"],
        outputDir: "/tmp/output",
      },
    });

    expect(result.searchesUsed).toBe(1);
    expect(result.fallbackToFixed).toBe(true);
    expect(mocks.discoverJobsStep).toHaveBeenCalledTimes(1);
  });
});
