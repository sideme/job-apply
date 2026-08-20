import { randomUUID } from "node:crypto";
import { sanitizeUnknown } from "@infra/sanitize";
import type {
  AgentDailyUsage,
  AgentRun,
  AgentRunKind,
  AgentRunStatus,
  AgentRunStep,
  AgentStepType,
} from "@shared/types";
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { db, getSqliteClient, schema } from "../db";

const { agentDailyUsage, agentRuns, agentRunSteps } = schema;
const MAX_TRACE_SUMMARY_CHARS = 8_000;
const MAX_ERROR_CHARS = 1_000;

function sanitizeTraceText(value: unknown, maxChars: number): string | null {
  if (value === null || value === undefined) return null;
  const sanitized = sanitizeUnknown(value, {
    depth: 4,
    maxItems: 20,
    maxString: Math.min(maxChars, 1_000),
  });
  const text =
    typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized);
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

function mapStep(row: typeof agentRunSteps.$inferSelect): AgentRunStep {
  return {
    ...row,
    stepType: row.stepType as AgentStepType,
  };
}

function mapRun(row: typeof agentRuns.$inferSelect): AgentRun {
  return {
    ...row,
    kind: row.kind as AgentRunKind,
    status: row.status as AgentRunStatus,
  };
}

export async function listAgentRuns(
  limit = 20,
  offset = 0,
): Promise<{ runs: AgentRun[]; total: number }> {
  const safeLimit = Math.min(100, Math.max(1, limit));
  const safeOffset = Math.max(0, offset);
  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(agentRuns)
      .orderBy(desc(agentRuns.startedAt))
      .limit(safeLimit)
      .offset(safeOffset),
    db.select({ count: sql<number>`count(*)` }).from(agentRuns),
  ]);
  return {
    runs: rows.map(mapRun),
    total: countRows[0]?.count ?? 0,
  };
}

export async function createAgentRun(input: {
  pipelineRunId?: string | null;
  kind: AgentRunKind;
  provider?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  localDate: string;
  timeZone: string;
}): Promise<AgentRun> {
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  const row: typeof agentRuns.$inferInsert = {
    id,
    pipelineRunId: input.pipelineRunId ?? null,
    kind: input.kind,
    status: "running",
    provider: input.provider ?? null,
    model: input.model ?? null,
    promptVersion: input.promptVersion ?? null,
    startedAt,
    completedAt: null,
    localDate: input.localDate,
    timeZone: input.timeZone,
  };
  await db.insert(agentRuns).values(row);
  return {
    id,
    pipelineRunId: input.pipelineRunId ?? null,
    kind: input.kind,
    status: "running",
    provider: input.provider ?? null,
    model: input.model ?? null,
    promptVersion: input.promptVersion ?? null,
    startedAt,
    completedAt: null,
    localDate: input.localDate,
    timeZone: input.timeZone,
    stopReason: null,
    errorCode: null,
    errorMessage: null,
    searchesUsed: 0,
    judgmentsUsed: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
}

export async function completeAgentRun(input: {
  id: string;
  status: Exclude<AgentRunStatus, "running">;
  stopReason?: string | null;
  errorCode?: string | null;
  errorMessage?: unknown;
  searchesUsed: number;
  judgmentsUsed: number;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  await db
    .update(agentRuns)
    .set({
      status: input.status,
      completedAt: new Date().toISOString(),
      stopReason: sanitizeTraceText(input.stopReason, 500),
      errorCode: sanitizeTraceText(input.errorCode, 100),
      errorMessage: sanitizeTraceText(input.errorMessage, MAX_ERROR_CHARS),
      searchesUsed: Math.max(0, input.searchesUsed),
      judgmentsUsed: Math.max(0, input.judgmentsUsed),
      inputTokens: Math.max(0, input.inputTokens),
      outputTokens: Math.max(0, input.outputTokens),
    })
    .where(eq(agentRuns.id, input.id));
}

export async function appendAgentRunStep(input: {
  agentRunId: string;
  jobId?: string | null;
  iteration: number;
  sequence: number;
  stepType: AgentStepType;
  toolName?: string | null;
  toolCallId?: string | null;
  argsSummary?: unknown;
  resultSummary?: unknown;
  inputTokens?: number | null;
  outputTokens?: number | null;
  durationMs?: number | null;
}): Promise<AgentRunStep> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const jobId = input.jobId ?? null;
  const iteration = Math.max(0, input.iteration);
  const sequence = Math.max(0, input.sequence);
  const toolName = sanitizeTraceText(input.toolName, 100);
  const toolCallId = sanitizeTraceText(input.toolCallId, 200);
  const argsSummary = sanitizeTraceText(
    input.argsSummary,
    MAX_TRACE_SUMMARY_CHARS,
  );
  const resultSummary = sanitizeTraceText(
    input.resultSummary,
    MAX_TRACE_SUMMARY_CHARS,
  );
  const inputTokens = input.inputTokens ?? null;
  const outputTokens = input.outputTokens ?? null;
  const durationMs = input.durationMs ?? null;
  const row: typeof agentRunSteps.$inferInsert = {
    id,
    agentRunId: input.agentRunId,
    jobId,
    iteration,
    sequence,
    stepType: input.stepType,
    toolName,
    toolCallId,
    argsSummary,
    resultSummary,
    inputTokens,
    outputTokens,
    durationMs,
    createdAt,
  };
  await db.insert(agentRunSteps).values(row);
  return {
    id,
    agentRunId: input.agentRunId,
    jobId,
    iteration,
    sequence,
    stepType: input.stepType,
    toolName,
    toolCallId,
    argsSummary,
    resultSummary,
    inputTokens,
    outputTokens,
    durationMs,
    createdAt,
  };
}

export async function listAgentRunSteps(
  agentRunId: string,
  limit = 100,
  offset = 0,
): Promise<AgentRunStep[]> {
  const rows = await db
    .select()
    .from(agentRunSteps)
    .where(eq(agentRunSteps.agentRunId, agentRunId))
    .orderBy(asc(agentRunSteps.sequence))
    .limit(Math.min(100, Math.max(1, limit)))
    .offset(Math.max(0, offset));
  return rows.map(mapStep);
}

export function reserveDailyAgentRun(input: {
  kind: AgentRunKind;
  localDate: string;
  timeZone: string;
  maxRuns: number;
}): boolean {
  const sqlite = getSqliteClient();
  const reserve = sqlite.transaction(() => {
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO agent_daily_usage (
          kind, local_date, time_zone, runs_started, input_tokens,
          output_tokens, searches_used, judgments_used, updated_at
        ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?)`,
      )
      .run(input.kind, input.localDate, input.timeZone, now);

    const result = sqlite
      .prepare(
        `UPDATE agent_daily_usage
         SET runs_started = runs_started + 1, updated_at = ?
         WHERE kind = ? AND local_date = ? AND time_zone = ?
           AND runs_started < ?`,
      )
      .run(
        now,
        input.kind,
        input.localDate,
        input.timeZone,
        Math.max(1, input.maxRuns),
      );
    return result.changes === 1;
  });
  return reserve.immediate();
}

export function addDailyAgentUsage(input: {
  kind: AgentRunKind;
  localDate: string;
  timeZone: string;
  inputTokens: number;
  outputTokens: number;
  searchesUsed: number;
  judgmentsUsed: number;
}): void {
  const sqlite = getSqliteClient();
  sqlite
    .prepare(
      `UPDATE agent_daily_usage
       SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?,
           searches_used = searches_used + ?, judgments_used = judgments_used + ?,
           updated_at = ?
       WHERE kind = ? AND local_date = ? AND time_zone = ?`,
    )
    .run(
      Math.max(0, input.inputTokens),
      Math.max(0, input.outputTokens),
      Math.max(0, input.searchesUsed),
      Math.max(0, input.judgmentsUsed),
      new Date().toISOString(),
      input.kind,
      input.localDate,
      input.timeZone,
    );
}

export async function getDailyAgentUsage(input: {
  kind: AgentRunKind;
  localDate: string;
  timeZone: string;
}): Promise<AgentDailyUsage | null> {
  const [row] = await db
    .select()
    .from(agentDailyUsage)
    .where(
      and(
        eq(agentDailyUsage.kind, input.kind),
        eq(agentDailyUsage.localDate, input.localDate),
        eq(agentDailyUsage.timeZone, input.timeZone),
      ),
    );
  return row ? { ...row, kind: row.kind as AgentRunKind } : null;
}

export async function failStaleAgentRuns(
  startedBefore: string,
): Promise<number> {
  const result = await db
    .update(agentRuns)
    .set({
      status: "failed",
      completedAt: new Date().toISOString(),
      errorCode: "INTERRUPTED",
      errorMessage: "Interrupted before completion; recovered on startup.",
    })
    .where(
      and(
        eq(agentRuns.status, "running"),
        lt(agentRuns.startedAt, startedBefore),
      ),
    );
  return result.changes;
}
