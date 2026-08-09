import type { JobListItem } from "@shared/types.js";
import { CalendarClock } from "lucide-react";
import { cn, formatPostingDateTime } from "@/lib/utils";
import { defaultStatusToken, statusTokens } from "./constants";

interface JobRowContentProps {
  job: JobListItem;
  isSelected?: boolean;
  showStatusDot?: boolean;
  statusDotClassName?: string;
  className?: string;
}

function getSuitabilityScoreTone(score: number): string {
  if (score >= 70) return "text-emerald-400/90";
  if (score >= 50) return "text-foreground/60";
  return "text-muted-foreground/60";
}

export const JobRowContent = ({
  job,
  isSelected = false,
  showStatusDot = true,
  statusDotClassName,
  className,
}: JobRowContentProps) => {
  const hasScore = job.suitabilityScore != null;
  const statusToken = statusTokens[job.status] ?? defaultStatusToken;
  const suitabilityTone = getSuitabilityScoreTone(job.suitabilityScore ?? 0);
  const datePosted = formatPostingDateTime(job.datePosted);

  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-3", className)}>
      <span
        className={cn(
          "h-2 w-2 rounded-full shrink-0",
          statusToken.dot,
          !isSelected && "opacity-70",
          statusDotClassName,
          !showStatusDot && "hidden",
        )}
        title={statusToken.label}
      />

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-sm leading-tight",
            isSelected ? "font-semibold" : "font-medium",
          )}
        >
          {job.title}
        </div>
        <div className="truncate text-xs text-muted-foreground mt-0.5">
          {job.employer}
          {job.location && (
            <span className="before:content-['_in_']">{job.location}</span>
          )}
        </div>
        {datePosted && (
          <div
            className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground"
            title={`Source posting date and time: ${datePosted.label}${datePosted.hasTime ? "" : " (time not provided)"}`}
          >
            <CalendarClock className="h-3 w-3 shrink-0" />
            <span>Posted {datePosted.label}</span>
          </div>
        )}
        {job.salary?.trim() && (
          <div className="truncate text-xs text-muted-foreground mt-0.5">
            {job.salary}
          </div>
        )}
      </div>

      {hasScore && (
        <div className="shrink-0 text-right">
          <span className={cn("text-xs tabular-nums", suitabilityTone)}>
            {job.suitabilityScore}
          </span>
        </div>
      )}
    </div>
  );
};
