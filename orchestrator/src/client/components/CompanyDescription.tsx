import { type Job, resolveCompanyDescription } from "@shared/types.js";
import { Building2 } from "lucide-react";
import type React from "react";

type CompanyDescriptionProps = {
  job: Pick<Job, "employer" | "companyDescription" | "jobDescription">;
  compact?: boolean;
};

export const CompanyDescription: React.FC<CompanyDescriptionProps> = ({
  job,
  compact = false,
}) => {
  const resolved = resolveCompanyDescription(job);
  if (!resolved) return null;

  return (
    <section
      className={
        compact
          ? "rounded-lg border border-border/40 bg-muted/10 p-3"
          : "rounded-lg border border-border/50 bg-card p-5"
      }
      aria-label={`About ${job.employer}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 font-semibold text-foreground">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <h2 className={compact ? "text-sm" : "text-base"}>
            About {job.employer}
          </h2>
        </div>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {resolved.source === "source" ? "Source profile" : "From job post"}
        </span>
      </div>
      <p
        className={`${compact ? "mt-2 line-clamp-6 text-xs" : "mt-3 text-sm"} whitespace-pre-line leading-relaxed text-muted-foreground`}
      >
        {resolved.description}
      </p>
    </section>
  );
};
