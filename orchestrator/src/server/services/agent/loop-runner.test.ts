import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentTurnRequestOptions, AgentTurnResponse } from "../llm/types";
import {
  type AgentTool,
  type AgentTurnClient,
  runAgentLoop,
} from "./loop-runner";

function createTool(
  execute: AgentTool["execute"] = vi.fn(async () => ({
    result: { ok: true },
  })),
): AgentTool {
  return {
    definition: {
      name: "echo",
      description: "Echo one value",
      parameters: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
        additionalProperties: false,
      },
    },
    schema: z.object({ value: z.string() }).strict(),
    execute,
  };
}

function response(
  toolCalls: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>,
): AgentTurnResponse {
  return {
    success: true,
    data: {
      message: { role: "assistant", content: null, toolCalls },
      finishReason: "tool_calls",
      usage: { inputTokens: 20, outputTokens: 5 },
    },
  };
}

function budgets(
  overrides: Partial<Parameters<typeof runAgentLoop>[0]["budgets"]> = {},
) {
  return {
    maxIterations: 3,
    maxToolCalls: 3,
    maxInputTokens: 10_000,
    maxOutputTokens: 100,
    maxToolResultChars: 1_000,
    requestTimeoutMs: 1_000,
    ...overrides,
  };
}

describe("runAgentLoop", () => {
  it("preserves the assistant tool-call message and matching tool_call_id", async () => {
    const requests: AgentTurnRequestOptions[] = [];
    const terminalTool = createTool(
      vi.fn(async (args) => ({ result: args, terminalValue: "done" })),
    );
    terminalTool.terminal = true;
    const client: AgentTurnClient = {
      callAgentTurn: async (request) => {
        requests.push(request);
        return response([
          {
            id: "call-1",
            type: "function",
            function: { name: "echo", arguments: '{"value":"ok"}' },
          },
        ]);
      },
    };

    const result = await runAgentLoop({
      client,
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "start" }],
      tools: [terminalTool],
      budgets: budgets(),
    });

    expect(result.stopReason).toBe("terminal_tool");
    expect(result.terminalValue).toBe("done");
    expect(result.messages.at(-2)).toMatchObject({
      role: "assistant",
      toolCalls: [expect.objectContaining({ id: "call-1" })],
    });
    expect(result.messages.at(-1)).toEqual({
      role: "tool",
      toolCallId: "call-1",
      content: '{"value":"ok"}',
    });
    expect(requests[0]?.maxOutputTokens).toBe(100);
  });

  it("rejects extra arguments before executing a tool", async () => {
    const execute = vi.fn(async () => ({ result: { ok: true } }));
    const client: AgentTurnClient = {
      callAgentTurn: async () =>
        response([
          {
            id: "call-1",
            type: "function",
            function: {
              name: "echo",
              arguments: '{"value":"ok","apiKey":"secret"}',
            },
          },
        ]),
    };

    const result = await runAgentLoop({
      client,
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "start" }],
      tools: [createTool(execute)],
      budgets: budgets(),
    });

    expect(result.stopReason).toBe("invalid_tool_call");
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a multi-call response that exceeds the remaining tool budget", async () => {
    const execute = vi.fn(async () => ({ result: { ok: true } }));
    const client: AgentTurnClient = {
      callAgentTurn: async () =>
        response([
          {
            id: "call-1",
            type: "function",
            function: { name: "echo", arguments: '{"value":"one"}' },
          },
          {
            id: "call-2",
            type: "function",
            function: { name: "echo", arguments: '{"value":"two"}' },
          },
        ]),
    };

    const result = await runAgentLoop({
      client,
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "start" }],
      tools: [createTool(execute)],
      budgets: budgets({ maxToolCalls: 1 }),
    });

    expect(result.stopReason).toBe("tool_call_budget_exhausted");
    expect(execute).not.toHaveBeenCalled();
  });

  it("stops before the request when the complete input exceeds budget", async () => {
    const callAgentTurn = vi.fn<AgentTurnClient["callAgentTurn"]>();
    const result = await runAgentLoop({
      client: { callAgentTurn },
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "x".repeat(1_000) }],
      tools: [createTool()],
      budgets: budgets({ maxInputTokens: 10 }),
    });

    expect(result.stopReason).toBe("input_token_budget_exhausted");
    expect(callAgentTurn).not.toHaveBeenCalled();
  });
});
