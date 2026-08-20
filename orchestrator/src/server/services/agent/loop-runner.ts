import type { AnyZodObject, z } from "zod";
import type {
  AgentMessage,
  AgentToolDefinition,
  AgentTurnRequestOptions,
  AgentTurnResponse,
} from "../llm/types";

export const AGENT_LOOP_STOP_REASONS = [
  "terminal_tool",
  "completed_without_tool",
  "iteration_budget_exhausted",
  "tool_call_budget_exhausted",
  "input_token_budget_exhausted",
  "output_token_budget_exhausted",
  "tool_result_too_large",
  "invalid_tool_call",
  "duplicate_tool_call_id",
  "tool_error",
  "request_failed",
  "request_timeout",
  "agent_unavailable",
  "cancelled",
] as const;

export type AgentLoopStopReason = (typeof AGENT_LOOP_STOP_REASONS)[number];

export type AgentToolExecution = {
  result: unknown;
  terminalValue?: unknown;
  stopLoop?: boolean;
};

export type AgentTool = {
  definition: AgentToolDefinition;
  schema: AnyZodObject;
  terminal?: boolean;
  execute: (
    args: Record<string, unknown>,
    context: { signal: AbortSignal; toolCallId: string },
  ) => Promise<AgentToolExecution>;
};

export type AgentLoopTrace = {
  iteration: number;
  sequence: number;
  stepType: "llm" | "tool" | "stop" | "error";
  toolName?: string;
  toolCallId?: string;
  argsSummary?: unknown;
  resultSummary?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
};

export type AgentTurnClient = {
  callAgentTurn: (
    options: AgentTurnRequestOptions,
  ) => Promise<AgentTurnResponse>;
};

export type AgentLoopOptions = {
  client: AgentTurnClient;
  model: string;
  messages: AgentMessage[];
  tools: AgentTool[];
  signal?: AbortSignal;
  jobId?: string;
  budgets: {
    maxIterations: number;
    maxToolCalls: number;
    maxInputTokens: number;
    maxOutputTokens: number;
    maxToolResultChars: number;
    requestTimeoutMs: number;
  };
  onTrace?: (trace: AgentLoopTrace) => Promise<void> | void;
};

export type AgentLoopResult = {
  status: "completed" | "partial" | "failed" | "cancelled" | "unavailable";
  stopReason: AgentLoopStopReason;
  terminalValue: unknown;
  finalContent: string | null;
  messages: AgentMessage[];
  iterations: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  error: string | null;
};

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 3);
}

function serializeToolResult(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("Tool result is not JSON serializable");
  }
  return serialized;
}

export async function runAgentLoop(
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const messages = [...options.messages];
  const tools = new Map(
    options.tools.map((tool) => [tool.definition.name, tool]),
  );
  const toolDefinitions = options.tools.map((tool) => tool.definition);
  const seenToolCallIds = new Set<string>();
  const fallbackController = new AbortController();
  const signal = options.signal ?? fallbackController.signal;
  let sequence = 0;
  let iterations = 0;
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  const trace = async (
    value: Omit<AgentLoopTrace, "sequence">,
  ): Promise<void> => {
    sequence += 1;
    await options.onTrace?.({ ...value, sequence });
  };

  const finish = async (args: {
    status: AgentLoopResult["status"];
    stopReason: AgentLoopStopReason;
    terminalValue?: unknown;
    finalContent?: string | null;
    error?: string | null;
    traceType?: "stop" | "error";
  }): Promise<AgentLoopResult> => {
    await trace({
      iteration: iterations,
      stepType: args.traceType ?? "stop",
      resultSummary: {
        stopReason: args.stopReason,
        error: args.error ?? null,
      },
    });
    return {
      status: args.status,
      stopReason: args.stopReason,
      terminalValue: args.terminalValue ?? null,
      finalContent: args.finalContent ?? null,
      messages,
      iterations,
      toolCalls,
      inputTokens,
      outputTokens,
      error: args.error ?? null,
    };
  };

  while (iterations < Math.max(1, options.budgets.maxIterations)) {
    if (signal.aborted) {
      return finish({ status: "cancelled", stopReason: "cancelled" });
    }

    const estimatedInputTokens = estimateTokens({
      messages,
      tools: toolDefinitions,
    });
    if (
      inputTokens + estimatedInputTokens >
      Math.max(1, options.budgets.maxInputTokens)
    ) {
      return finish({
        status: toolCalls > 0 ? "partial" : "failed",
        stopReason: "input_token_budget_exhausted",
      });
    }

    const remainingOutputTokens =
      Math.max(1, options.budgets.maxOutputTokens) - outputTokens;
    if (remainingOutputTokens <= 0) {
      return finish({
        status: toolCalls > 0 ? "partial" : "failed",
        stopReason: "output_token_budget_exhausted",
      });
    }

    iterations += 1;
    const requestStartedAt = Date.now();
    const response = await options.client.callAgentTurn({
      model: options.model,
      messages,
      tools: toolDefinitions,
      maxOutputTokens: remainingOutputTokens,
      timeoutMs: options.budgets.requestTimeoutMs,
      signal,
      jobId: options.jobId,
    });

    if (!response.success) {
      if (signal.aborted) {
        return finish({ status: "cancelled", stopReason: "cancelled" });
      }
      const stopReason =
        response.code === "AGENT_UNAVAILABLE"
          ? "agent_unavailable"
          : response.code === "REQUEST_TIMEOUT"
            ? "request_timeout"
            : "request_failed";
      return finish({
        status:
          response.code === "AGENT_UNAVAILABLE" ? "unavailable" : "failed",
        stopReason,
        error: response.error,
        traceType: "error",
      });
    }

    const turnInputTokens =
      response.data.usage.inputTokens > 0
        ? response.data.usage.inputTokens
        : estimatedInputTokens;
    inputTokens += turnInputTokens;
    outputTokens += response.data.usage.outputTokens;
    messages.push(response.data.message);
    await trace({
      iteration: iterations,
      stepType: "llm",
      inputTokens: turnInputTokens,
      outputTokens: response.data.usage.outputTokens,
      durationMs: Date.now() - requestStartedAt,
      resultSummary: {
        finishReason: response.data.finishReason,
        toolCallCount: response.data.message.toolCalls?.length ?? 0,
        hasContent: Boolean(response.data.message.content),
      },
    });

    if (outputTokens > Math.max(1, options.budgets.maxOutputTokens)) {
      return finish({
        status: toolCalls > 0 ? "partial" : "failed",
        stopReason: "output_token_budget_exhausted",
      });
    }

    const requestedCalls = response.data.message.toolCalls ?? [];
    if (requestedCalls.length === 0) {
      return finish({
        status: "completed",
        stopReason: "completed_without_tool",
        finalContent: response.data.message.content,
      });
    }

    const remainingToolCalls =
      Math.max(0, options.budgets.maxToolCalls) - toolCalls;
    if (requestedCalls.length > remainingToolCalls) {
      return finish({
        status: toolCalls > 0 ? "partial" : "failed",
        stopReason: "tool_call_budget_exhausted",
      });
    }

    for (const call of requestedCalls) {
      if (signal.aborted) {
        return finish({ status: "cancelled", stopReason: "cancelled" });
      }
      if (seenToolCallIds.has(call.id)) {
        return finish({
          status: toolCalls > 0 ? "partial" : "failed",
          stopReason: "duplicate_tool_call_id",
          error: `Duplicate tool call ID: ${call.id}`,
          traceType: "error",
        });
      }
      seenToolCallIds.add(call.id);

      const tool = tools.get(call.function.name);
      if (!tool) {
        return finish({
          status: toolCalls > 0 ? "partial" : "failed",
          stopReason: "invalid_tool_call",
          error: `Unknown tool: ${call.function.name}`,
          traceType: "error",
        });
      }

      let rawArgs: unknown;
      try {
        rawArgs = JSON.parse(call.function.arguments);
      } catch {
        return finish({
          status: toolCalls > 0 ? "partial" : "failed",
          stopReason: "invalid_tool_call",
          error: `Invalid JSON arguments for tool: ${call.function.name}`,
          traceType: "error",
        });
      }
      const parsedArgs = tool.schema.safeParse(rawArgs);
      if (!parsedArgs.success) {
        return finish({
          status: toolCalls > 0 ? "partial" : "failed",
          stopReason: "invalid_tool_call",
          error: `Arguments failed validation for tool: ${call.function.name}`,
          traceType: "error",
        });
      }

      toolCalls += 1;
      const toolStartedAt = Date.now();
      try {
        const execution = await tool.execute(
          parsedArgs.data as z.infer<AnyZodObject>,
          { signal, toolCallId: call.id },
        );
        const content = serializeToolResult(execution.result);
        if (content.length > Math.max(1, options.budgets.maxToolResultChars)) {
          return finish({
            status: "partial",
            stopReason: "tool_result_too_large",
            error: `Tool result exceeded ${options.budgets.maxToolResultChars} characters`,
            traceType: "error",
          });
        }
        messages.push({ role: "tool", toolCallId: call.id, content });
        await trace({
          iteration: iterations,
          stepType: "tool",
          toolName: call.function.name,
          toolCallId: call.id,
          argsSummary: parsedArgs.data,
          resultSummary: execution.result,
          durationMs: Date.now() - toolStartedAt,
        });

        if (tool.terminal || execution.stopLoop) {
          return finish({
            status: "completed",
            stopReason: "terminal_tool",
            terminalValue: execution.terminalValue ?? execution.result,
          });
        }
      } catch (error) {
        if (signal.aborted) {
          return finish({ status: "cancelled", stopReason: "cancelled" });
        }
        return finish({
          status: "partial",
          stopReason: "tool_error",
          error:
            error instanceof Error ? error.message : "Tool execution failed",
          traceType: "error",
        });
      }
    }
  }

  return finish({
    status: toolCalls > 0 ? "partial" : "failed",
    stopReason: "iteration_budget_exhausted",
  });
}
