import type { JobSource } from "@shared/types.js";
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { JobSort, SalaryFilter, SalaryFilterMode } from "./constants";
import { DEFAULT_SORT } from "./constants";

const allowedSalaryModes: SalaryFilterMode[] = [
  "at_least",
  "at_most",
  "between",
];
const allowedSortKeys: JobSort["key"][] = [
  "discoveredAt",
  "score",
  "salary",
  "title",
  "employer",
];
const allowedSortDirections: JobSort["direction"][] = ["asc", "desc"];

export const useOrchestratorFilters = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const searchQuery = searchParams.get("q") ?? "";
  const setSearchQuery = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const normalized = value.trim();
          if (normalized) prev.set("q", normalized);
          else prev.delete("q");
          return prev;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const sourceFilter =
    (searchParams.get("source") as JobSource | "all") || "all";
  const setSourceFilter = useCallback(
    (source: JobSource | "all") => {
      setSearchParams(
        (prev) => {
          if (source !== "all") prev.set("source", source);
          else prev.delete("source");
          return prev;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const salaryFilter = useMemo((): SalaryFilter => {
    const modeRaw = searchParams.get("salaryMode") ?? "at_least";
    const mode = allowedSalaryModes.includes(modeRaw as SalaryFilterMode)
      ? (modeRaw as SalaryFilterMode)
      : "at_least";

    const minRaw =
      searchParams.get("salaryMin") ?? searchParams.get("minSalary");
    const minParsed = minRaw == null ? Number.NaN : Number.parseInt(minRaw, 10);
    const min = Number.isFinite(minParsed) && minParsed > 0 ? minParsed : null;

    const maxRaw = searchParams.get("salaryMax");
    const maxParsed = maxRaw == null ? Number.NaN : Number.parseInt(maxRaw, 10);
    const max = Number.isFinite(maxParsed) && maxParsed > 0 ? maxParsed : null;

    return { mode, min, max };
  }, [searchParams]);

  const setSalaryFilter = useCallback(
    (value: SalaryFilter) => {
      setSearchParams(
        (prev) => {
          if (value.mode === "at_least") prev.delete("salaryMode");
          else prev.set("salaryMode", value.mode);

          if (value.min == null || value.min <= 0) prev.delete("salaryMin");
          else prev.set("salaryMin", String(value.min));

          if (value.max == null || value.max <= 0) prev.delete("salaryMax");
          else prev.set("salaryMax", String(value.max));

          prev.delete("minSalary");
          return prev;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const sort = useMemo((): JobSort => {
    const sortValue = searchParams.get("sort");
    if (!sortValue) return DEFAULT_SORT;

    const [key, direction] = sortValue.split("-");
    if (
      !allowedSortKeys.includes(key as JobSort["key"]) ||
      !allowedSortDirections.includes(direction as JobSort["direction"])
    ) {
      return DEFAULT_SORT;
    }

    return {
      key: key as JobSort["key"],
      direction: direction as JobSort["direction"],
    };
  }, [searchParams]);

  const setSort = useCallback(
    (newSort: JobSort) => {
      setSearchParams(
        (prev) => {
          if (
            newSort.key === DEFAULT_SORT.key &&
            newSort.direction === DEFAULT_SORT.direction
          ) {
            prev.delete("sort");
          } else {
            prev.set("sort", `${newSort.key}-${newSort.direction}`);
          }
          return prev;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const resetFilters = useCallback(() => {
    setSearchParams(
      (prev) => {
        prev.delete("source");
        prev.delete("q");
        prev.delete("salaryMode");
        prev.delete("salaryMin");
        prev.delete("salaryMax");
        prev.delete("minSalary");
        prev.delete("sort");
        return prev;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  return {
    searchParams,
    searchQuery,
    setSearchQuery,
    sourceFilter,
    setSourceFilter,
    salaryFilter,
    setSalaryFilter,
    sort,
    setSort,
    resetFilters,
  };
};
