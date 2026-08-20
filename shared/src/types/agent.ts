export const AGENT_RUN_KINDS = ["search_planner", "fit_judge"] as const;
export type AgentRunKind = (typeof AGENT_RUN_KINDS)[number];

export const AGENT_RUN_STATUSES = [
  "running",
  "completed",
  "partial",
  "failed",
  "cancelled",
  "unavailable",
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const AGENT_STEP_TYPES = ["llm", "tool", "stop", "error"] as const;
export type AgentStepType = (typeof AGENT_STEP_TYPES)[number];

export const LLM_FIT_VERDICTS = ["strong", "possible", "weak"] as const;
export type LlmFitVerdict = (typeof LLM_FIT_VERDICTS)[number];

export const LLM_FIT_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped_stale",
] as const;
export type LlmFitStatus = (typeof LLM_FIT_STATUSES)[number];

export type AgentRun = {
  id: string;
  pipelineRunId: string | null;
  kind: AgentRunKind;
  status: AgentRunStatus;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  startedAt: string;
  completedAt: string | null;
  localDate: string;
  timeZone: string;
  stopReason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  searchesUsed: number;
  judgmentsUsed: number;
  inputTokens: number;
  outputTokens: number;
};

export type AgentRunStep = {
  id: string;
  agentRunId: string;
  jobId: string | null;
  iteration: number;
  sequence: number;
  stepType: AgentStepType;
  toolName: string | null;
  toolCallId: string | null;
  argsSummary: string | null;
  resultSummary: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  createdAt: string;
};

export type AgentDailyUsage = {
  kind: AgentRunKind;
  localDate: string;
  timeZone: string;
  runsStarted: number;
  inputTokens: number;
  outputTokens: number;
  searchesUsed: number;
  judgmentsUsed: number;
  updatedAt: string;
};

export type AgentRunsPage = {
  runs: AgentRun[];
  total: number;
  limit: number;
  offset: number;
};

export type AgentRunStepsPage = {
  steps: AgentRunStep[];
  limit: number;
  offset: number;
};
