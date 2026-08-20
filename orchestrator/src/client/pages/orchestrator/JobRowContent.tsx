import {
  EMPLOYMENT_TYPE_LABELS,
  formatJobLevel,
  HIRING_ORGANIZATION_LABELS,
  type JobListItem,
} from "@shared/types.js";
import { CalendarClock } from "lucide-react";
import { cn, formatDiscoveryDate, formatPostingDateTime } from "@/lib/utils";
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

const employmentTypeClasses: Record<
  JobListItem["employmentTypeCategory"],
  string
> = {
  permanent_full_time:
    "border-emerald-500/35 bg-emerald-500/10 text-emerald-300",
  full_time: "border-cyan-500/35 bg-cyan-500/10 text-cyan-300",
  contract: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  temporary: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  part_time: "border-slate-500/40 bg-slate-500/10 text-slate-300",
  internship: "border-blue-500/35 bg-blue-500/10 text-blue-300",
  unknown: "",
};

const hiringOrganizationClasses: Record<
  JobListItem["hiringOrganizationCategory"],
  string
> = {
  staffing_agency: "border-fuchsia-500/35 bg-fuchsia-500/10 text-fuchsia-300",
  consulting_firm: "border-violet-500/35 bg-violet-500/10 text-violet-300",
  unknown: "",
};

export const JobRowContent = ({
  job,
  isSelected = false,
  showStatusDot = true,
  statusDotClassName,
  className,
}: JobRowContentProps) => {
  const hasScore = job.suitabilityScore != null;
  const scoreLabel =
    job.suitabilityReasonSource === "llm" ? "DeepSeek ATS" : "Local ATS";
  const statusToken = statusTokens[job.status] ?? defaultStatusToken;
  const suitabilityTone = getSuitabilityScoreTone(job.suitabilityScore ?? 0);
  const datePosted = formatPostingDateTime(job.datePosted);
  const discoveryDate = datePosted
    ? null
    : formatDiscoveryDate(job.discoveredAt);
  const jobLevel = formatJobLevel(job.jobLevelCategory);
  const showEmploymentType = job.employmentTypeCategory !== "unknown";
  const showHiringOrganization = job.hiringOrganizationCategory !== "unknown";

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
          {jobLevel && (
            <span className="before:content-['_·_']">{jobLevel}</span>
          )}
        </div>
        {(showEmploymentType || showHiringOrganization) && (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
            {showEmploymentType && (
              <span
                className={cn(
                  "inline-flex max-w-full items-center rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none",
                  employmentTypeClasses[job.employmentTypeCategory],
                )}
                title={
                  job.employmentTypeReason ??
                  EMPLOYMENT_TYPE_LABELS[job.employmentTypeCategory]
                }
              >
                {EMPLOYMENT_TYPE_LABELS[job.employmentTypeCategory]}
              </span>
            )}
            {showHiringOrganization && (
              <span
                className={cn(
                  "inline-flex max-w-full items-center rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none",
                  hiringOrganizationClasses[job.hiringOrganizationCategory],
                )}
                title={
                  job.hiringOrganizationReason ??
                  HIRING_ORGANIZATION_LABELS[job.hiringOrganizationCategory]
                }
              >
                {HIRING_ORGANIZATION_LABELS[job.hiringOrganizationCategory]}
              </span>
            )}
          </div>
        )}
        {datePosted && (
          <div
            className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground"
            title={`Source posting date and time: ${datePosted.label}${datePosted.hasTime ? "" : " (time not provided)"}`}
          >
            <CalendarClock className="h-3 w-3 shrink-0" />
            <span>Posted {datePosted.label}</span>
          </div>
        )}
        {discoveryDate && (
          <div
            className="mt-0.5 flex items-center gap-1 truncate text-xs text-amber-500/80"
            title={`Source posting date unavailable; collected ${discoveryDate}`}
          >
            <CalendarClock className="h-3 w-3 shrink-0" />
            <span>Found {discoveryDate} · post date unavailable</span>
          </div>
        )}
        {job.salary?.trim() && (
          <div className="truncate text-xs text-muted-foreground mt-0.5">
            {job.salary}
          </div>
        )}
      </div>

      {hasScore && (
        <div
          className="shrink-0 text-right"
          title={`${scoreLabel}: ${job.suitabilityScore}`}
        >
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground/60">
            {job.suitabilityReasonSource === "llm" ? "AI ATS" : "Local ATS"}
          </div>
          <span className={cn("text-xs tabular-nums", suitabilityTone)}>
            {job.suitabilityScore}
          </span>
        </div>
      )}
    </div>
  );
};
