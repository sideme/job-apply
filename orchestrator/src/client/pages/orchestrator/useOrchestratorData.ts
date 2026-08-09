import * as api from "@client/api";
import { subscribeToEventSource } from "@client/lib/sse";
import type { Job, JobListItem, JobStatus } from "@shared/types";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { queryKeys } from "@/client/lib/queryKeys";

const initialStats: Record<JobStatus, number> = {
  discovered: 0,
  processing: 0,
  ready: 0,
  applied: 0,
  in_progress: 0,
  skipped: 0,
  expired: 0,
};

const isDocumentVisible = () =>
  typeof document === "undefined" || document.visibilityState === "visible";
const JOBS_PAGE_SIZE = 60;

const statusesForTab = (tab: "ready" | "discovered" | "applied" | "all") => {
  if (tab === "ready") return ["ready", "processing"];
  if (tab === "discovered") return ["discovered", "processing"];
  if (tab === "applied") return ["applied"];
  return undefined;
};

type PipelineProgressStep =
  | "idle"
  | "crawling"
  | "importing"
  | "scoring"
  | "processing"
  | "completed"
  | "cancelled"
  | "failed";

type PipelineProgressEvent = {
  step: PipelineProgressStep;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

type PipelineTerminalStatus = "completed" | "cancelled" | "failed";

type PipelineTerminalEvent = {
  status: PipelineTerminalStatus;
  errorMessage: string | null;
  token: number;
};

type PipelineTerminalSnapshot = {
  status: PipelineTerminalStatus;
  errorMessage: string | null;
  signature: string;
};

const ACTIVE_PIPELINE_STEPS: ReadonlySet<PipelineProgressStep> = new Set([
  "crawling",
  "importing",
  "scoring",
  "processing",
]);

const TERMINAL_PIPELINE_STEPS: ReadonlySet<PipelineProgressStep> = new Set([
  "completed",
  "cancelled",
  "failed",
]);

const buildTerminalSignature = ({
  status,
  startedAt,
  completedAt,
  runId,
}: {
  status: PipelineTerminalStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  runId?: string | null;
}) => {
  if (startedAt || completedAt) {
    return `${status}:${startedAt ?? ""}:${completedAt ?? ""}`;
  }
  return `${status}:run:${runId ?? "unknown"}`;
};

export const useOrchestratorData = (
  selectedJobId: string | null,
  searchQuery = "",
  activeTab: "ready" | "discovered" | "applied" | "all" = "all",
) => {
  const queryClient = useQueryClient();
  const [jobListItems, setJobListItems] = useState<JobListItem[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [stats, setStats] = useState<Record<JobStatus, number>>(initialStats);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreJobs, setHasMoreJobs] = useState(false);
  const [totalJobs, setTotalJobs] = useState(0);
  const [isPipelineRunning, setIsPipelineRunning] = useState(false);
  const [isPipelineSseConnected, setIsPipelineSseConnected] = useState(false);
  const [pipelineTerminalEvent, setPipelineTerminalEvent] =
    useState<PipelineTerminalEvent | null>(null);
  const [isRefreshPaused, setIsRefreshPaused] = useState(false);
  const requestSeqRef = useRef(0);
  const latestAppliedSeqRef = useRef(0);
  const pendingLoadCountRef = useRef(0);
  const selectedJobRequestSeqRef = useRef(0);
  const selectedJobCacheRef = useRef<Map<string, Job>>(new Map());
  const lastRevisionRef = useRef<string | null>(null);
  const loadedJobsCountRef = useRef(0);
  const lastSseRefreshAtRef = useRef(0);
  const hasHydratedPipelineStateRef = useRef(false);
  const seenRunningThisSessionRef = useRef(false);
  const baselineTerminalSignatureRef = useRef<string | null>(null);
  const lastTerminalSignatureRef = useRef<string | null>(null);
  const terminalEventTokenRef = useRef(0);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const normalizedSearchQuery = debouncedSearchQuery.startsWith("@")
    ? ""
    : debouncedSearchQuery;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const publishPipelineTerminal = useCallback(
    (status: PipelineTerminalStatus, errorMessage: string | null) => {
      terminalEventTokenRef.current += 1;
      setPipelineTerminalEvent({
        status,
        errorMessage,
        token: terminalEventTokenRef.current,
      });
    },
    [],
  );

  const observePipelineState = useCallback(
    (snapshot: {
      isRunning: boolean;
      terminal: PipelineTerminalSnapshot | null;
    }) => {
      setIsPipelineRunning(snapshot.isRunning);
      if (snapshot.isRunning) {
        seenRunningThisSessionRef.current = true;
      }

      if (!snapshot.terminal) {
        if (!hasHydratedPipelineStateRef.current) {
          hasHydratedPipelineStateRef.current = true;
        }
        return;
      }

      const signature = snapshot.terminal.signature;
      const isFirstPipelineObservation = !hasHydratedPipelineStateRef.current;

      if (isFirstPipelineObservation) {
        hasHydratedPipelineStateRef.current = true;
        baselineTerminalSignatureRef.current = signature;
        lastTerminalSignatureRef.current = signature;
        return;
      }

      if (signature === lastTerminalSignatureRef.current) {
        return;
      }

      lastTerminalSignatureRef.current = signature;
      if (!seenRunningThisSessionRef.current) {
        return;
      }

      if (signature === baselineTerminalSignatureRef.current) {
        return;
      }

      seenRunningThisSessionRef.current = false;
      publishPipelineTerminal(
        snapshot.terminal.status,
        snapshot.terminal.errorMessage,
      );
    },
    [publishPipelineTerminal],
  );

  const loadSelectedJob = useCallback(
    async (jobId: string) => {
      const seq = ++selectedJobRequestSeqRef.current;
      try {
        const fullJob = await queryClient.fetchQuery({
          queryKey: queryKeys.jobs.detail(jobId),
          queryFn: () => api.getJob(jobId),
          staleTime: 0,
        });
        selectedJobCacheRef.current.set(jobId, fullJob);
        if (
          selectedJobId === jobId &&
          seq === selectedJobRequestSeqRef.current
        ) {
          setSelectedJob(fullJob);
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to load selected job details";
        toast.error(message);
      }
    },
    [queryClient, selectedJobId],
  );

  const loadJobs = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    pendingLoadCountRef.current += 1;
    try {
      setIsLoading(true);
      const data = await api.getJobs({
        view: "list",
        statuses: statusesForTab(activeTab),
        ...(normalizedSearchQuery ? { search: normalizedSearchQuery } : {}),
        limit: JOBS_PAGE_SIZE,
        offset: 0,
      });
      queryClient.setQueryData(queryKeys.jobs.list({ view: "list" }), data);
      if (seq >= latestAppliedSeqRef.current) {
        latestAppliedSeqRef.current = seq;
        setJobListItems(data.jobs);
        loadedJobsCountRef.current = data.jobs.length;
        setStats(data.byStatus);
        setTotalJobs(data.total);
        setHasMoreJobs(data.hasMore ?? data.jobs.length < data.total);
        lastRevisionRef.current = data.revision;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load jobs";
      toast.error(message);
    } finally {
      pendingLoadCountRef.current = Math.max(
        0,
        pendingLoadCountRef.current - 1,
      );
      if (pendingLoadCountRef.current === 0) {
        setIsLoading(false);
      }
    }
  }, [activeTab, normalizedSearchQuery, queryClient]);

  const loadMoreJobs = useCallback(async () => {
    if (isLoadingMore || !hasMoreJobs) return;
    setIsLoadingMore(true);
    try {
      const data = await api.getJobs({
        view: "list",
        statuses: statusesForTab(activeTab),
        ...(normalizedSearchQuery ? { search: normalizedSearchQuery } : {}),
        limit: JOBS_PAGE_SIZE,
        offset: loadedJobsCountRef.current,
      });
      setJobListItems((current) => {
        const knownIds = new Set(current.map((job) => job.id));
        const next = [
          ...current,
          ...data.jobs.filter((job) => !knownIds.has(job.id)),
        ];
        loadedJobsCountRef.current = next.length;
        return next;
      });
      setStats(data.byStatus);
      setTotalJobs(data.total);
      setHasMoreJobs(
        data.hasMore ??
          loadedJobsCountRef.current + data.jobs.length < data.total,
      );
      lastRevisionRef.current = data.revision;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load more jobs";
      toast.error(message);
    } finally {
      setIsLoadingMore(false);
    }
  }, [activeTab, hasMoreJobs, isLoadingMore, normalizedSearchQuery]);

  const checkPipelineStatus = useCallback(async () => {
    try {
      const status = await queryClient.fetchQuery({
        queryKey: queryKeys.pipeline.status(),
        queryFn: () => api.getPipelineStatus(),
        staleTime: 0,
      });
      const terminalStatus = status.lastRun?.status;

      if (status.isRunning) {
        observePipelineState({ isRunning: true, terminal: null });
        return;
      }

      if (
        !terminalStatus ||
        !TERMINAL_PIPELINE_STEPS.has(terminalStatus as PipelineProgressStep)
      ) {
        observePipelineState({ isRunning: false, terminal: null });
        return;
      }

      const terminal = terminalStatus as PipelineTerminalStatus;
      observePipelineState({
        isRunning: false,
        terminal: {
          status: terminal,
          errorMessage: status.lastRun?.errorMessage ?? null,
          signature: buildTerminalSignature({
            status: terminal,
            startedAt: status.lastRun?.startedAt ?? null,
            completedAt: status.lastRun?.completedAt ?? null,
            runId: status.lastRun?.id ?? null,
          }),
        },
      });
    } catch {
      // Ignore errors
    }
  }, [observePipelineState, queryClient]);

  const checkForJobChanges = useCallback(async () => {
    if (isRefreshPaused || !isDocumentVisible()) return;
    try {
      const revision = await queryClient.fetchQuery({
        queryKey: queryKeys.jobs.revision(),
        queryFn: () =>
          api.getJobsRevision({
            statuses: statusesForTab(activeTab),
            ...(normalizedSearchQuery ? { search: normalizedSearchQuery } : {}),
          }),
        staleTime: 0,
      });
      const previousRevision = lastRevisionRef.current;
      if (previousRevision === null) {
        lastRevisionRef.current = revision.revision;
        return;
      }
      if (revision.revision !== previousRevision) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.jobs.all,
        });
        await loadJobs();
      }
    } catch {
      // Ignore errors
    }
  }, [
    activeTab,
    isRefreshPaused,
    loadJobs,
    normalizedSearchQuery,
    queryClient,
  ]);

  useEffect(() => {
    void loadJobs();
    void checkPipelineStatus();
  }, [checkPipelineStatus, loadJobs]);

  useEffect(() => {
    if (!isPipelineRunning) return;
    seenRunningThisSessionRef.current = true;
  }, [isPipelineRunning]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!isDocumentVisible() || isRefreshPaused) return;
      void checkForJobChanges();
    }, 30000);

    return () => clearInterval(interval);
  }, [checkForJobChanges, isRefreshPaused]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!isDocumentVisible() || isRefreshPaused) return;
      void loadJobs();
    }, 600000);

    return () => clearInterval(interval);
  }, [isRefreshPaused, loadJobs]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const refreshFromVisibilitySignal = () => {
      if (!isDocumentVisible() || isRefreshPaused) return;
      void checkForJobChanges();
    };

    const onVisibilityChange = () => {
      if (!isDocumentVisible()) return;
      refreshFromVisibilitySignal();
    };

    window.addEventListener("focus", refreshFromVisibilitySignal);
    window.addEventListener("online", refreshFromVisibilitySignal);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", refreshFromVisibilitySignal);
      window.removeEventListener("online", refreshFromVisibilitySignal);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [checkForJobChanges, isRefreshPaused]);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;

    const unsubscribe = subscribeToEventSource<unknown>(
      "/api/pipeline/progress",
      {
        onOpen: () => {
          setIsPipelineSseConnected(true);
        },
        onMessage: (payload) => {
          if (!payload || typeof payload !== "object") return;
          const step = (payload as { step?: unknown }).step;
          if (typeof step !== "string") return;
          if (
            !ACTIVE_PIPELINE_STEPS.has(step as PipelineProgressStep) &&
            !TERMINAL_PIPELINE_STEPS.has(step as PipelineProgressStep) &&
            step !== "idle"
          ) {
            return;
          }

          const typedStep = step as PipelineProgressStep;
          const isActiveStep = ACTIVE_PIPELINE_STEPS.has(typedStep);
          if (isActiveStep) {
            observePipelineState({ isRunning: true, terminal: null });
          } else if (typedStep === "idle") {
            observePipelineState({ isRunning: false, terminal: null });
          }

          if (isActiveStep) {
            const now = Date.now();
            if (now - lastSseRefreshAtRef.current >= 2500) {
              lastSseRefreshAtRef.current = now;
              void checkForJobChanges();
            }
            return;
          }

          if (TERMINAL_PIPELINE_STEPS.has(typedStep)) {
            const eventPayload = payload as PipelineProgressEvent;
            const terminal = typedStep as PipelineTerminalStatus;
            observePipelineState({
              isRunning: false,
              terminal: {
                status: terminal,
                errorMessage: eventPayload.error ?? null,
                signature: buildTerminalSignature({
                  status: terminal,
                  startedAt: eventPayload.startedAt,
                  completedAt: eventPayload.completedAt,
                }),
              },
            });
            void loadJobs();
          }
        },
        onError: () => {
          setIsPipelineSseConnected(false);
        },
      },
    );

    return () => {
      unsubscribe();
    };
  }, [checkForJobChanges, loadJobs, observePipelineState]);

  useEffect(() => {
    if (isPipelineSseConnected) return;

    const interval = setInterval(() => {
      if (!isDocumentVisible() || isRefreshPaused) return;
      void checkPipelineStatus();
    }, 30000);

    return () => clearInterval(interval);
  }, [checkPipelineStatus, isPipelineSseConnected, isRefreshPaused]);

  useEffect(() => {
    if (!selectedJobId) {
      setSelectedJob(null);
      return;
    }

    const selectedJobListItem = jobListItems.find(
      (job) => job.id === selectedJobId,
    );

    const cached = selectedJobCacheRef.current.get(selectedJobId);
    if (
      cached &&
      (!selectedJobListItem ||
        cached.updatedAt === selectedJobListItem.updatedAt)
    ) {
      setSelectedJob(cached);
      return;
    }

    void loadSelectedJob(selectedJobId);
  }, [jobListItems, loadSelectedJob, selectedJobId]);

  return {
    jobs: jobListItems,
    selectedJob,
    stats,
    totalJobs,
    isLoading,
    isLoadingMore,
    hasMoreJobs,
    isPipelineRunning,
    setIsPipelineRunning,
    pipelineTerminalEvent,
    isRefreshPaused,
    setIsRefreshPaused,
    loadJobs,
    loadMoreJobs,
    checkForJobChanges,
    checkPipelineStatus,
  };
};
