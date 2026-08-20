import { KbdHint } from "@client/components/KbdHint";
import { getDisplayKey, SHORTCUTS } from "@client/lib/shortcut-map";
import {
  EMPLOYMENT_TYPE_CATEGORIES,
  EMPLOYMENT_TYPE_LABELS,
  type EmploymentTypeCategory,
  JOB_LEVEL_LABELS,
  JOB_LEVELS,
  type JobLevel,
  type JobSource,
} from "@shared/types.js";
import { Filter, Search } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableMultiSelectDropdown } from "@/components/ui/searchable-multi-select-dropdown";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { sourceLabel } from "@/lib/utils";
import type {
  FilterTab,
  JobSort,
  SalaryFilter,
  SalaryFilterMode,
} from "./constants";
import { defaultSortDirection, orderedFilterSources, tabs } from "./constants";
import { DiscoveredDatePicker } from "./DiscoveredDatePicker";

interface OrchestratorFiltersProps {
  activeTab: FilterTab;
  onTabChange: (value: FilterTab) => void;
  counts: Record<FilterTab, number>;
  onOpenCommandBar: () => void;
  sourceFilter: JobSource | "all";
  onSourceFilterChange: (value: JobSource | "all") => void;
  jobLevelFilters: JobLevel[];
  onJobLevelFiltersChange: (values: JobLevel[]) => void;
  employmentTypeFilters: EmploymentTypeCategory[];
  onEmploymentTypeFiltersChange: (values: EmploymentTypeCategory[]) => void;
  discoveredDate: string;
  onDiscoveredDateChange: (value: string) => void;
  salaryFilter: SalaryFilter;
  onSalaryFilterChange: (value: SalaryFilter) => void;
  sourcesWithJobs: JobSource[];
  sort: JobSort;
  onSortChange: (sort: JobSort) => void;
  onResetFilters: () => void;
  filteredCount: number;
  isFiltersOpen?: boolean;
  onFiltersOpenChange?: (open: boolean) => void;
}

const salaryModeOptions: Array<{
  value: SalaryFilterMode;
  label: string;
}> = [
  { value: "at_least", label: "at least" },
  { value: "at_most", label: "at most" },
  { value: "between", label: "between" },
];

const jobLevelOptions = [
  ...JOB_LEVELS.map((level) => ({
    value: level,
    label: JOB_LEVEL_LABELS[level],
    searchText:
      level === "entry_level"
        ? "junior new graduate early career"
        : level === "lead"
          ? "staff principal technical lead"
          : level.replaceAll("_", " "),
  })),
];

const employmentTypeOptions = EMPLOYMENT_TYPE_CATEGORIES.map(
  (employmentType) => ({
    value: employmentType,
    label:
      employmentType === "full_time"
        ? "Full-time (permanence not stated)"
        : employmentType === "unknown"
          ? "Not stated"
          : EMPLOYMENT_TYPE_LABELS[employmentType],
    searchText: employmentType.replaceAll("_", " "),
  }),
);

const sortFieldOrder: JobSort["key"][] = [
  "score",
  "discoveredAt",
  "salary",
  "title",
  "employer",
];

const sortFieldLabels: Record<JobSort["key"], string> = {
  score: "Score",
  discoveredAt: "Posted",
  salary: "Salary",
  title: "Title",
  employer: "Company",
};

const getDirectionOptions = (
  key: JobSort["key"],
): Array<{ value: JobSort["direction"]; label: string }> => {
  if (key === "discoveredAt") {
    return [
      { value: "desc", label: "newest first" },
      { value: "asc", label: "oldest first" },
    ];
  }
  if (key === "score" || key === "salary") {
    return [
      { value: "desc", label: "largest first" },
      { value: "asc", label: "smallest first" },
    ];
  }
  return [
    { value: "asc", label: "A to Z" },
    { value: "desc", label: "Z to A" },
  ];
};

export const OrchestratorFilters: React.FC<OrchestratorFiltersProps> = ({
  activeTab,
  onTabChange,
  counts,
  onOpenCommandBar,
  sourceFilter,
  onSourceFilterChange,
  jobLevelFilters,
  onJobLevelFiltersChange,
  employmentTypeFilters,
  onEmploymentTypeFiltersChange,
  discoveredDate,
  onDiscoveredDateChange,
  salaryFilter,
  onSalaryFilterChange,
  sourcesWithJobs,
  sort,
  onSortChange,
  onResetFilters,
  filteredCount,
  isFiltersOpen: isFiltersOpenProp,
  onFiltersOpenChange: onFiltersOpenChangeProp,
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const [sheetContent, setSheetContent] = useState<HTMLDivElement | null>(null);
  const isFiltersOpen = isFiltersOpenProp ?? internalOpen;
  const onFiltersOpenChange = onFiltersOpenChangeProp ?? setInternalOpen;

  const visibleSources = orderedFilterSources.filter((source) =>
    sourcesWithJobs.includes(source),
  );

  const activeFilterCount = useMemo(
    () =>
      Number(sourceFilter !== "all") +
      Number(jobLevelFilters.length > 0) +
      Number(employmentTypeFilters.length > 0) +
      Number(
        (typeof salaryFilter.min === "number" && salaryFilter.min > 0) ||
          (typeof salaryFilter.max === "number" && salaryFilter.max > 0),
      ),
    [
      sourceFilter,
      jobLevelFilters.length,
      employmentTypeFilters.length,
      salaryFilter.min,
      salaryFilter.max,
    ],
  );
  const showSalaryMin =
    salaryFilter.mode === "at_least" || salaryFilter.mode === "between";
  const showSalaryMax =
    salaryFilter.mode === "at_most" || salaryFilter.mode === "between";
  const commandShortcutLabel = getDisplayKey(SHORTCUTS.search);

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => onTabChange(value as FilterTab)}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 lg:w-auto">
          {tabs.map((tab, index) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="flex-1 flex items-center lg:flex-none gap-1.5"
            >
              <KbdHint shortcut={String(index + 1)} className="mr-0.5" />
              <span>{tab.label}</span>
              {counts[tab.id] > 0 && (
                <span className="text-[10px] mt-[2px] tabular-nums opacity-60">
                  {counts[tab.id]}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex lg:flex-nowrap flex-wrap items-center justify-end gap-2">
          {activeTab === "discovered" && (
            <DiscoveredDatePicker
              value={discoveredDate}
              onChange={onDiscoveredDateChange}
            />
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onOpenCommandBar}
            aria-label="Search jobs"
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground w-auto"
          >
            <Search className="h-3.5 w-3.5" />
            Search
            <span className="rounded border border-border/70 px-1 py-0.5 font-mono text-xs leading-none text-muted-foreground">
              {commandShortcutLabel}
            </span>
          </Button>

          <Sheet open={isFiltersOpen} onOpenChange={onFiltersOpenChange}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground w-auto"
              >
                <Filter className="h-3.5 w-3.5" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/20 px-1 text-[10px] font-semibold tabular-nums text-primary">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </SheetTrigger>

            <SheetContent
              ref={setSheetContent}
              side="right"
              className="w-full sm:max-w-2xl"
            >
              <div className="flex h-full min-h-0 flex-col">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    Filters
                    {activeFilterCount > 0 && (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/20 px-1 text-[11px] font-semibold tabular-nums text-primary">
                        {activeFilterCount}
                      </span>
                    )}
                  </SheetTitle>
                  <SheetDescription>
                    Refine sources, employment type, job level, salary, and
                    sorting.
                  </SheetDescription>
                </SheetHeader>

                <Separator className="my-4" />

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle>Sources</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={sourceFilter === "all" ? "default" : "outline"}
                        onClick={() => onSourceFilterChange("all")}
                      >
                        All sources
                      </Button>
                      {visibleSources.map((source) => (
                        <Button
                          key={source}
                          type="button"
                          size="sm"
                          variant={
                            sourceFilter === source ? "default" : "outline"
                          }
                          onClick={() => onSourceFilterChange(source)}
                        >
                          {sourceLabel[source]}
                        </Button>
                      ))}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle>Employment type</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <SearchableMultiSelectDropdown
                        values={employmentTypeFilters}
                        options={employmentTypeOptions}
                        onValuesChange={(values) =>
                          onEmploymentTypeFiltersChange(
                            values as EmploymentTypeCategory[],
                          )
                        }
                        placeholder="All employment types"
                        searchPlaceholder="Search employment types..."
                        emptyText="No matching employment type."
                        ariaLabel="Employment type filters"
                        triggerClassName="w-full"
                        contentClassName="w-[var(--radix-popover-trigger-width)]"
                        portalContainer={sheetContent}
                      />
                      <p className="text-xs text-muted-foreground">
                        Multiple selections are combined. Permanent full-time is
                        kept separate from full-time jobs whose permanence is
                        not stated.
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle>Job level</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <SearchableMultiSelectDropdown
                        values={jobLevelFilters}
                        options={jobLevelOptions}
                        onValuesChange={(values) =>
                          onJobLevelFiltersChange(values as JobLevel[])
                        }
                        placeholder="All job levels"
                        searchPlaceholder="Search job levels..."
                        emptyText="No matching job level."
                        ariaLabel="Job level filters"
                        triggerClassName="w-full"
                        contentClassName="w-[var(--radix-popover-trigger-width)]"
                        portalContainer={sheetContent}
                      />
                      <p className="text-xs text-muted-foreground">
                        Source labels are normalized; when missing, the job
                        title is used as a fallback.
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle>Salary</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span>Salary is</span>
                        <Select
                          value={salaryFilter.mode}
                          onValueChange={(value) => {
                            const nextMode = value as SalaryFilterMode;
                            if (nextMode === "at_least") {
                              onSalaryFilterChange({
                                mode: nextMode,
                                min: salaryFilter.min,
                                max: null,
                              });
                              return;
                            }
                            if (nextMode === "at_most") {
                              onSalaryFilterChange({
                                mode: nextMode,
                                min: null,
                                max: salaryFilter.max,
                              });
                              return;
                            }
                            onSalaryFilterChange({
                              mode: nextMode,
                              min: salaryFilter.min,
                              max: salaryFilter.max,
                            });
                          }}
                        >
                          <SelectTrigger
                            id="salary-mode"
                            aria-label="Salary range specifier"
                            className="h-8 w-[170px] text-foreground"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {salaryModeOptions.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div
                        className={
                          showSalaryMin && showSalaryMax
                            ? "grid gap-3 md:grid-cols-2"
                            : "space-y-3"
                        }
                      >
                        {showSalaryMin && (
                          <div className="space-y-1">
                            <Label htmlFor="salary-min-filter">Minimum</Label>
                            <Input
                              id="salary-min-filter"
                              value={
                                salaryFilter.min == null
                                  ? ""
                                  : String(salaryFilter.min)
                              }
                              onChange={(event) => {
                                const raw = event.target.value.trim();
                                const parsed = Number.parseInt(raw, 10);
                                onSalaryFilterChange({
                                  ...salaryFilter,
                                  min:
                                    Number.isFinite(parsed) && parsed > 0
                                      ? parsed
                                      : null,
                                });
                              }}
                              inputMode="numeric"
                              placeholder="e.g. 60000"
                            />
                          </div>
                        )}

                        {showSalaryMax && (
                          <div className="space-y-1">
                            <Label htmlFor="salary-max-filter">Maximum</Label>
                            <Input
                              id="salary-max-filter"
                              value={
                                salaryFilter.max == null
                                  ? ""
                                  : String(salaryFilter.max)
                              }
                              onChange={(event) => {
                                const raw = event.target.value.trim();
                                const parsed = Number.parseInt(raw, 10);
                                onSalaryFilterChange({
                                  ...salaryFilter,
                                  max:
                                    Number.isFinite(parsed) && parsed > 0
                                      ? parsed
                                      : null,
                                });
                              }}
                              inputMode="numeric"
                              placeholder="e.g. 100000"
                            />
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle>Sort</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center">
                        <div className="flex items-center gap-2">
                          <span className="whitespace-nowrap">Sort by</span>
                          <Select
                            value={sort.key}
                            onValueChange={(value) =>
                              onSortChange({
                                key: value as JobSort["key"],
                                direction:
                                  defaultSortDirection[value as JobSort["key"]],
                              })
                            }
                          >
                            <SelectTrigger
                              id="sort-key"
                              aria-label="Sort field"
                              className="h-8 flex-1 sm:w-[180px] text-foreground"
                            >
                              <SelectValue
                                placeholder={sortFieldLabels[sort.key]}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {sortFieldOrder.map((key) => (
                                <SelectItem key={key} value={key}>
                                  {sortFieldLabels[key]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="whitespace-nowrap">and</span>
                          <Select
                            value={sort.direction}
                            onValueChange={(value) =>
                              onSortChange({
                                ...sort,
                                direction: value as JobSort["direction"],
                              })
                            }
                          >
                            <SelectTrigger
                              id="sort-direction"
                              aria-label="Sort order"
                              className="h-8 flex-1 sm:w-[180px] text-foreground"
                            >
                              <SelectValue
                                placeholder={
                                  getDirectionOptions(sort.key).find(
                                    (option) => option.value === sort.direction,
                                  )?.label
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {getDirectionOptions(sort.key).map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="mt-3 flex shrink-0 items-center justify-between border-t border-border/60 bg-background pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onResetFilters}
                  >
                    Reset
                  </Button>
                  <Button
                    type="button"
                    onClick={() => onFiltersOpenChange?.(false)}
                  >
                    Show {filteredCount.toLocaleString()}{" "}
                    {filteredCount === 1 ? "job" : "jobs"}
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </Tabs>
  );
};
