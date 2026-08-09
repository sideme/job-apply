import type { Job } from "@shared/types.js";
import {
  ArrowUpRight,
  Calendar,
  CalendarClock,
  DollarSign,
  MapPin,
  RefreshCw,
  WandSparkles,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  cn,
  formatDate,
  formatPostingDateTime,
  sourceLabel,
} from "@/lib/utils";
import * as api from "../api/client";
import { getJobStatusIndicator, StatusIndicator } from "./StatusIndicator";

interface JobHeaderProps {
  job: Job;
  className?: string;
}

const ScoreMeter: React.FC<{ score: number | null }> = ({ score }) => {
  if (score == null) {
    return <span className="text-[10px] text-muted-foreground/60">-</span>;
  }

  return (
    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
      <div className="h-1 w-12 rounded-full bg-muted/30">
        <div
          className="h-1 rounded-full bg-primary/50"
          style={{ width: `${Math.max(4, Math.min(100, score))}%` }}
        />
      </div>
      <span className="tabular-nums">{score}</span>
    </div>
  );
};

export const JobHeader: React.FC<JobHeaderProps> = ({ job, className }) => {
  const [isPreparingAutofill, setIsPreparingAutofill] = useState(false);
  const [isRefreshingPostDate, setIsRefreshingPostDate] = useState(false);
  const jobStatus = getJobStatusIndicator(job.status);
  const { pathname } = useLocation();
  const isJobPage = pathname.startsWith("/job/");
  const datePosted = formatPostingDateTime(job.datePosted);
  const deadline = formatDate(job.deadline);
  const prepareAutofill = async () => {
    try {
      setIsPreparingAutofill(true);
      const session = await api.createApplicationFillSession(job.id);
      await navigator.clipboard.writeText(session.code);
      toast.success("Auto-fill code copied", {
        description:
          "Open the application page, click the Job Apply Auto-fill extension, and paste the code.",
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not prepare auto-fill",
      );
    } finally {
      setIsPreparingAutofill(false);
    }
  };
  const refreshPostingDate = async () => {
    try {
      setIsRefreshingPostDate(true);
      const result = await api.refreshJobPostingDate(job.id);
      if (result.enrichment.status === "updated") {
        toast.success("Exact posting time found");
        window.location.reload();
        return;
      }
      const message =
        result.enrichment.status === "unsupported"
          ? "This source does not support safe detail-page time extraction."
          : result.enrichment.status === "fetch_failed"
            ? "The listing page blocked or failed the request."
            : "The listing page only provides a date, not an exact time.";
      toast.info("No exact posting time found", { description: message });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not refresh the posting time",
      );
    } finally {
      setIsRefreshingPostDate(false);
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Detail header: lighter weight than list items */}
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0 w-full sm:w-auto sm:flex-1">
          <Link
            to={`/job/${job.id}`}
            className="block text-base font-semibold leading-snug text-foreground/90 underline-offset-2 break-words hover:underline"
          >
            {job.title}
          </Link>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{job.employer}</span>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <Badge
            variant="outline"
            className="text-[10px] uppercase tracking-wide text-muted-foreground border-border/50"
          >
            {sourceLabel[job.source]}
          </Badge>
          {job.isRemote === true && (
            <Badge
              variant="outline"
              className="text-[10px] uppercase tracking-wide text-muted-foreground border-border/50"
            >
              Remote
            </Badge>
          )}
          {!isJobPage && (
            <Button
              asChild
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px] uppercase tracking-wide"
            >
              <Link to={`/job/${job.id}`}>
                View
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[10px] uppercase tracking-wide"
            disabled={isPreparingAutofill}
            onClick={() => void prepareAutofill()}
            title="Copy a short-lived code for the browser auto-fill extension"
          >
            <WandSparkles className="h-3 w-3" />
            {isPreparingAutofill ? "Preparing…" : "Prepare auto-fill"}
          </Button>
        </div>
      </div>

      {/* Tertiary metadata - subdued */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/70">
        {job.location && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {job.location}
          </span>
        )}
        {datePosted && (
          <span className="flex items-center gap-1" title="Source posting date">
            <CalendarClock className="h-3 w-3" />
            Posted {datePosted.label}
            {!datePosted.hasTime && (
              <span className="text-muted-foreground/55">
                (time not provided)
              </span>
            )}
          </span>
        )}
        {(!datePosted || !datePosted.hasTime) && (
          <button
            type="button"
            className="inline-flex items-center gap-1 underline-offset-2 hover:underline disabled:opacity-50"
            disabled={isRefreshingPostDate}
            onClick={() => void refreshPostingDate()}
            title="Read the exact posting time from the listing detail page"
          >
            <RefreshCw
              className={cn("h-3 w-3", isRefreshingPostDate && "animate-spin")}
            />
            {isRefreshingPostDate ? "Checking time…" : "Find exact time"}
          </button>
        )}
        {deadline && (
          <span
            className="flex items-center gap-1"
            title="Application deadline"
          >
            <Calendar className="h-3 w-3" />
            Deadline {deadline}
          </span>
        )}
        {job.salary && (
          <span className="flex items-center gap-1">
            <DollarSign className="h-3 w-3" />
            {job.salary}
          </span>
        )}
      </div>

      {/* Status and score: single line, subdued */}
      <div className="flex items-center justify-between gap-2 py-1 border-y border-border/30">
        <div className="flex items-center gap-4">
          <StatusIndicator
            dotColor={jobStatus.dotColor}
            label={jobStatus.label}
          />
        </div>
        <ScoreMeter score={job.suitabilityScore} />
      </div>
    </div>
  );
};
