import {
  EMPLOYMENT_TYPE_CATEGORIES,
  type EmploymentTypeCategory,
  JOB_LEVELS,
  type JobLevel,
  type JobSource,
} from "@shared/types.js";
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { JobSort, SalaryFilter, SalaryFilterMode } from "./constants";
import { DEFAULT_SORT } from "./constants";
import { getTodayDateFilter, isValidDateFilter } from "./date-filter";

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

  const todayDateFilter = getTodayDateFilter();
  const requestedDateFilter = searchParams.get("date");
  const discoveredDate = isValidDateFilter(requestedDateFilter)
    ? requestedDateFilter
    : todayDateFilter;
  const setDiscoveredDate = useCallback(
    (value: string) => {
      if (!isValidDateFilter(value)) return;
      setSearchParams(
        (prev) => {
          if (value === todayDateFilter) prev.delete("date");
          else prev.set("date", value);
          return prev;
        },
        { replace: true },
      );
    },
    [setSearchParams, todayDateFilter],
  );

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

  const jobLevelFilters = useMemo((): JobLevel[] => {
    const requested = new Set(
      (searchParams.get("level") ?? "")
        .split(",")
        .map((level) => level.trim())
        .filter((level) => JOB_LEVELS.includes(level as JobLevel)),
    );
    return JOB_LEVELS.filter((level) => requested.has(level));
  }, [searchParams]);
  const setJobLevelFilters = useCallback(
    (levels: JobLevel[]) => {
      setSearchParams(
        (prev) => {
          const normalized = JOB_LEVELS.filter((level) =>
            levels.includes(level),
          );
          if (normalized.length === 0) prev.delete("level");
          else prev.set("level", normalized.join(","));
          return prev;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const employmentTypeFilters = useMemo((): EmploymentTypeCategory[] => {
    const requested = new Set(
      (searchParams.get("employment") ?? "")
        .split(",")
        .map((employmentType) => employmentType.trim())
        .filter((employmentType) =>
          EMPLOYMENT_TYPE_CATEGORIES.includes(
            employmentType as EmploymentTypeCategory,
          ),
        ),
    );
    return EMPLOYMENT_TYPE_CATEGORIES.filter((employmentType) =>
      requested.has(employmentType),
    );
  }, [searchParams]);
  const setEmploymentTypeFilters = useCallback(
    (employmentTypes: EmploymentTypeCategory[]) => {
      setSearchParams(
        (prev) => {
          const normalized = EMPLOYMENT_TYPE_CATEGORIES.filter(
            (employmentType) => employmentTypes.includes(employmentType),
          );
          if (normalized.length === 0) prev.delete("employment");
          else prev.set("employment", normalized.join(","));
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
        prev.delete("level");
        prev.delete("employment");
        prev.delete("q");
        prev.delete("salaryMode");
        prev.delete("salaryMin");
        prev.delete("salaryMax");
        prev.delete("minSalary");
        prev.delete("sort");
        prev.delete("date");
        return prev;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  return {
    searchParams,
    discoveredDate,
    setDiscoveredDate,
    searchQuery,
    setSearchQuery,
    sourceFilter,
    setSourceFilter,
    jobLevelFilters,
    setJobLevelFilters,
    employmentTypeFilters,
    setEmploymentTypeFilters,
    salaryFilter,
    setSalaryFilter,
    sort,
    setSort,
    resetFilters,
  };
};
