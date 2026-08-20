import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { getTodayDateFilter } from "./date-filter";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthFormatter = new Intl.DateTimeFormat("en-CA", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const accessibleDateFormatter = new Intl.DateTimeFormat("en-CA", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function startOfMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function moveMonth(value: Date, amount: number): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + amount, 1),
  );
}

function buildMonthDays(
  month: Date,
): Array<{ key: string; date: Date | null }> {
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const leadingBlanks = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return [
    ...Array.from({ length: leadingBlanks }, (_, index) => ({
      key: `leading-${year}-${monthIndex}-${index}`,
      date: null,
    })),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const date = new Date(Date.UTC(year, monthIndex, index + 1));
      return { key: formatDateKey(date), date };
    }),
  ];
}

export function DiscoveredDatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const selectedDate = useMemo(() => parseDateKey(value), [value]);
  const todayKey = getTodayDateFilter();
  const today = useMemo(() => parseDateKey(todayKey), [todayKey]);
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(selectedDate),
  );

  useEffect(() => {
    if (open) setVisibleMonth(startOfMonth(selectedDate));
  }, [open, selectedDate]);

  const days = useMemo(() => buildMonthDays(visibleMonth), [visibleMonth]);
  const nextMonth = moveMonth(visibleMonth, 1);
  const canMoveForward = nextMonth.getTime() <= startOfMonth(today).getTime();

  const chooseDate = (date: Date) => {
    onChange(formatDateKey(date));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Choose discovered date, ${accessibleDateFormatter.format(selectedDate)}`}
          className="h-8 w-[154px] justify-start gap-2 px-2 text-xs font-normal"
        >
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{dateFormatter.format(selectedDate)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[292px] p-3">
        <div className="mb-3 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            className="h-8 w-8"
            onClick={() => setVisibleMonth((current) => moveMonth(current, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-sm font-medium">
            {monthFormatter.format(visibleMonth)}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Next month"
            className="h-8 w-8"
            disabled={!canMoveForward}
            onClick={() => setVisibleMonth((current) => moveMonth(current, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((weekday) => (
            <div
              key={weekday}
              className="flex h-7 items-center justify-center text-[11px] font-medium text-muted-foreground"
            >
              {weekday}
            </div>
          ))}
          {days.map((cell) =>
            cell.date ? (
              <Button
                key={cell.key}
                type="button"
                variant="ghost"
                size="icon"
                aria-label={accessibleDateFormatter.format(cell.date)}
                aria-pressed={formatDateKey(cell.date) === value}
                disabled={cell.date.getTime() > today.getTime()}
                onClick={() => chooseDate(cell.date as Date)}
                className={cn(
                  "h-8 w-8 text-xs font-normal",
                  formatDateKey(cell.date) === value &&
                    "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                )}
              >
                {cell.date.getUTCDate()}
              </Button>
            ) : (
              <div key={cell.key} className="h-8 w-8" />
            ),
          )}
        </div>

        {value !== todayKey && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 h-8 w-full text-xs"
            onClick={() => chooseDate(today)}
          >
            Back to today
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
