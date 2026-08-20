import * as api from "@client/api";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import type React from "react";
import { useState } from "react";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const AgentRunsSection: React.FC = () => {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const runsQuery = useQuery({
    queryKey: ["agent-runs", 20, 0],
    queryFn: () => api.getAgentRuns(20, 0),
  });
  const stepsQuery = useQuery({
    queryKey: ["agent-runs", selectedRunId, "steps"],
    queryFn: () => api.getAgentRunSteps(selectedRunId ?? "", 100, 0),
    enabled: Boolean(selectedRunId),
  });

  return (
    <AccordionItem value="agent-runs" className="border rounded-lg px-4">
      <AccordionTrigger className="hover:no-underline py-4">
        <span className="text-base font-semibold">Agent Runs</span>
      </AccordionTrigger>
      <AccordionContent className="space-y-3 pb-4">
        <p className="text-xs text-muted-foreground">
          Recent sanitized runs. Prompts, full résumés, full JDs and API keys
          are not stored in this trace.
        </p>
        {runsQuery.isLoading && (
          <div className="text-sm text-muted-foreground">Loading runs…</div>
        )}
        {runsQuery.error && (
          <div className="text-sm text-destructive">Could not load runs.</div>
        )}
        {runsQuery.data?.runs.length === 0 && (
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            No Agent runs yet. Both features are off by default.
          </div>
        )}
        <div className="space-y-2">
          {runsQuery.data?.runs.map((run) => (
            <div key={run.id} className="rounded-md border p-3">
              <Button
                type="button"
                variant="ghost"
                className="h-auto w-full justify-start p-0 text-left"
                onClick={() =>
                  setSelectedRunId((current) =>
                    current === run.id ? null : run.id,
                  )
                }
              >
                <ChevronRight
                  className={`mr-2 h-4 w-4 transition-transform ${selectedRunId === run.id ? "rotate-90" : ""}`}
                />
                <span className="flex flex-1 flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {run.kind === "fit_judge" ? "Fit Judge" : "Search Planner"}
                  </span>
                  <Badge variant="outline">{run.status}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(run.startedAt).toLocaleString()} ·{" "}
                    {run.inputTokens}/{run.outputTokens} tokens
                  </span>
                </span>
              </Button>
              {selectedRunId === run.id && (
                <div className="mt-3 space-y-2 border-t pt-3">
                  <div className="text-xs text-muted-foreground">
                    Stop: {run.stopReason ?? "—"} · Searches: {run.searchesUsed}{" "}
                    · Judgments: {run.judgmentsUsed}
                  </div>
                  {stepsQuery.isLoading && (
                    <div className="text-xs text-muted-foreground">
                      Loading trace…
                    </div>
                  )}
                  {stepsQuery.data?.steps.map((step) => (
                    <div
                      key={step.id}
                      className="rounded bg-muted/50 p-2 font-mono text-[11px]"
                    >
                      #{step.sequence} {step.stepType}
                      {step.toolName ? ` · ${step.toolName}` : ""}
                      {step.resultSummary ? ` · ${step.resultSummary}` : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
};
