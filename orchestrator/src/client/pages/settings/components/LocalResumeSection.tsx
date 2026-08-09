import * as api from "@client/api";
import type React from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";

type LocalResumeSectionProps = {
  isLoading: boolean;
  isSaving: boolean;
};

function formatSize(sizeBytes: number | null): string {
  if (sizeBytes === null) return "Not uploaded";
  return `${(sizeBytes / 1024 / 1024).toFixed(2)} MB`;
}

export const LocalResumeSection: React.FC<LocalResumeSectionProps> = ({
  isLoading,
  isSaving,
}) => {
  const [status, setStatus] = useState<api.LocalResumeStatus | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    let active = true;
    void api
      .getLocalResumeStatus()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch((error) => {
        if (active) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Failed to load local resume status",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      toast.error("Please choose a PDF file.");
      return;
    }

    setIsUploading(true);
    try {
      const next = await api.uploadLocalResume(file);
      setStatus(next);
      toast.success("Local resume PDF uploaded");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to upload resume PDF",
      );
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <AccordionItem value="local-resume" className="border rounded-lg px-4">
      <AccordionTrigger className="hover:no-underline py-4">
        <span className="flex min-w-0 items-center gap-3">
          <span className="text-base font-semibold">Local PDF Resume</span>
          {status?.configured && (
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              Uploaded · {formatSize(status.sizeBytes)}
            </span>
          )}
        </span>
      </AccordionTrigger>
      <AccordionContent className="pb-4">
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Upload the PDF resume used for applications. Its text is used to
            score jobs, and the file is copied unchanged into each application.
          </p>
          <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Current file</span>
              <span className="font-mono">
                {status?.filename ?? "resume.pdf"}
              </span>
            </div>
            <div className="mt-1 flex justify-between gap-4">
              <span className="text-muted-foreground">Status</span>
              <span>
                {status?.configured
                  ? formatSize(status.sizeBytes)
                  : "Not configured"}
              </span>
            </div>
          </div>
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-md border border-dashed border-border/70 p-4 transition-colors hover:bg-muted/30">
            <span>
              <span className="block font-medium">Choose PDF resume</span>
              <span className="text-xs text-muted-foreground">
                PDF only, maximum 15 MB
              </span>
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={isLoading || isSaving || isUploading}
              asChild
            >
              <span>{isUploading ? "Uploading..." : "Upload"}</span>
            </Button>
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(event) => void handleUpload(event)}
              disabled={isLoading || isSaving || isUploading}
            />
          </label>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
};
