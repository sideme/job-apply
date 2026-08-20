import {
  EXTRACTOR_SOURCE_IDS,
  sourceLabel as getExtractorSourceLabel,
} from "@shared/extractors";
import type { Job } from "@shared/types";
import { stripHtmlTags } from "@shared/utils/string";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// --- CSS ---
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Dates ---
const parseDateInput = (dateStr: string): Date | null => {
  const trimmed = dateStr.trim();
  const numericTimestamp = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  const parsed = new Date(
    numericTimestamp == null
      ? trimmed.includes("T")
        ? trimmed
        : trimmed.replace(" ", "T")
      : numericTimestamp < 10_000_000_000
        ? numericTimestamp * 1000
        : numericTimestamp,
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatDate = (dateStr?: string | null) => {
  if (!dateStr) return null;
  try {
    const parsed = parseDateInput(dateStr);
    if (!parsed) return dateStr;
    return parsed.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return dateStr;
  }
};

export type PostingDateTime = {
  label: string;
  hasTime: boolean;
};

export const formatPostingDateTime = (
  dateStr?: string | null,
): PostingDateTime | null => {
  if (!dateStr) return null;
  const parsed = parseDateInput(dateStr);
  if (!parsed) return { label: dateStr, hasTime: false };

  const dateLabel = parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const trimmed = dateStr.trim();
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const isMidnightUtc =
    parsed.getUTCHours() === 0 &&
    parsed.getUTCMinutes() === 0 &&
    parsed.getUTCSeconds() === 0 &&
    parsed.getUTCMilliseconds() === 0;

  if (isDateOnly || isMidnightUtc) {
    return { label: dateLabel, hasTime: false };
  }

  const timeLabel = parsed.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return { label: `${dateLabel}, ${timeLabel} UTC`, hasTime: true };
};

export const formatDiscoveryDate = (
  dateStr?: string | null,
  timeZone = "America/Toronto",
): string | null => {
  if (!dateStr) return null;
  const parsed = parseDateInput(dateStr);
  if (!parsed) return null;
  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  });
};

export const formatTimestamp = (value?: number | null) => {
  if (!value) return "No due date";
  return new Date(value * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

export const formatTimestampWithTime = (value?: number | null) => {
  if (!value) return "No date";
  const date = new Date(value * 1000);
  const dateLabel = formatTimestamp(value);
  const timeLabel = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dateLabel} ${timeLabel}`;
};

export const formatDateTime = (dateStr?: string | null) => {
  if (!dateStr) return null;
  try {
    const normalized = dateStr.includes("T")
      ? dateStr
      : dateStr.replace(" ", "T");
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return dateStr;
    const date = parsed.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const time = parsed.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${date} ${time}`;
  } catch {
    return dateStr;
  }
};

// --- DOM & Clipboard ---
export async function copyTextToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!ok) {
    throw new Error("Copy failed");
  }
}

// --- Text Processing ---
export const stripHtml = (value: string) => stripHtmlTags(value);

export const safeFilenamePart = (value: string) => {
  const cleaned = value.replace(/[^a-z0-9]/gi, "_");
  if (cleaned.replace(/_/g, "") === "") return "Unknown";
  return cleaned || "Unknown";
};

// --- Comparisons & Math ---
export function arraysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function clampInt(value: number, min: number, max: number) {
  const int = Math.floor(value);
  if (Number.isNaN(int)) return min;
  return Math.min(max, Math.max(min, int));
}

// --- Job Specific Helpers ---
export const formatJobForWebhook = (job: Job) => {
  return JSON.stringify(
    {
      event: "job.completed",
      sentAt: new Date().toISOString(),
      job,
    },
    null,
    2,
  );
};

export const sourceLabel: Record<Job["source"], string> =
  EXTRACTOR_SOURCE_IDS.reduce(
    (acc, source) => {
      acc[source] = getExtractorSourceLabel(source);
      return acc;
    },
    {} as Record<Job["source"], string>,
  );
