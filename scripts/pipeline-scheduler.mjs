import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MINUTE = 60_000;
const STATE_VERSION = 2;
const DEFAULT_TIME_ZONE = "America/Toronto";
const SCHEDULE_START_HOUR = 10;
const SCHEDULE_END_HOUR = 19;
const SCHEDULE_INTERVAL_HOURS = 2;
const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);
const SUPPORTED_SOURCES = new Set(["adzuna", "indeed", "linkedin"]);

export const SCHEDULE_HOURS = Object.freeze([10, 12, 14, 16, 18]);

function configuredTimeZone() {
  const requested =
    process.env.PIPELINE_SCHEDULE_TIMEZONE?.trim() || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: requested }).format();
    return requested;
  } catch {
    console.warn("pipeline-scheduler: invalid timezone; using default", {
      requested,
      fallback: DEFAULT_TIME_ZONE,
    });
    return DEFAULT_TIME_ZONE;
  }
}

function configuredSources() {
  const requested = (process.env.PIPELINE_SCHEDULE_SOURCES || "indeed,linkedin")
    .split(",")
    .map((source) => source.trim().toLowerCase())
    .filter((source) => SUPPORTED_SOURCES.has(source));
  return [
    ...new Set(requested.length > 0 ? requested : ["indeed", "linkedin"]),
  ];
}

function zonedParts(now, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/**
 * Return the current two-hour weekday slot, or null outside the active window.
 * A slot remains active until the next slot so a short outage can catch up once.
 */
export function getScheduleSlot(now, timeZone = DEFAULT_TIME_ZONE) {
  const parts = zonedParts(now, timeZone);
  const hour = Number(parts.hour);
  if (
    !WEEKDAYS.has(parts.weekday) ||
    hour < SCHEDULE_START_HOUR ||
    hour >= SCHEDULE_END_HOUR
  ) {
    return null;
  }

  const slotHour =
    SCHEDULE_START_HOUR +
    Math.floor((hour - SCHEDULE_START_HOUR) / SCHEDULE_INTERVAL_HOURS) *
      SCHEDULE_INTERVAL_HOURS;
  if (!SCHEDULE_HOURS.includes(slotHour)) return null;

  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    key: `${localDate}T${String(slotHour).padStart(2, "0")}:00@${timeZone}`,
    localDate,
    hour: slotHour,
  };
}

export function parseSchedulerState(raw) {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!value || value.version !== STATE_VERSION) return null;
    if (value.lastRunSlot !== null && typeof value.lastRunSlot !== "string") {
      return null;
    }
    return { version: STATE_VERSION, lastRunSlot: value.lastRunSlot };
  } catch {
    return null;
  }
}

function defaultDataDir() {
  if (process.env.DATA_DIR?.trim()) return resolve(process.env.DATA_DIR);
  const cwd = process.cwd();
  if (basename(cwd) === "orchestrator" && existsSync(join(cwd, "..", "data"))) {
    return resolve(cwd, "..", "data");
  }
  return resolve(cwd, "data");
}

export async function loadSchedulerState(statePath) {
  try {
    const parsed = parseSchedulerState(await readFile(statePath, "utf8"));
    if (parsed) return parsed;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn("pipeline-scheduler: state read failed", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
  return { version: STATE_VERSION, lastRunSlot: null };
}

export async function saveSchedulerState(statePath, state) {
  await mkdir(dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, statePath);
}

export async function startScheduler(options = {}) {
  const timeZone = options.timeZone || configuredTimeZone();
  const sources = options.sources || configuredSources();
  const statePath =
    options.statePath ||
    process.env.PIPELINE_SCHEDULER_STATE_FILE ||
    join(defaultDataDir(), "pipeline-scheduler-state.json");
  const spawnProcess = options.spawnProcess || spawn;
  const now = options.now || Date.now;
  let state = await loadSchedulerState(statePath);
  let activeChild = null;
  let stopping = false;

  const runPipeline = async () => {
    console.log("pipeline-scheduler: starting", {
      sources,
      at: new Date().toISOString(),
      timeZone,
    });
    await new Promise((resolveRun) => {
      activeChild = spawnProcess(
        "npm",
        ["--workspace", "orchestrator", "run", "pipeline:run"],
        {
          cwd: "/app",
          env: { ...process.env, PIPELINE_SOURCES: sources.join(",") },
          stdio: "inherit",
        },
      );
      activeChild.once("error", (error) => {
        console.error("pipeline-scheduler: run failed to start", {
          message: error instanceof Error ? error.message : "Unknown error",
        });
        activeChild = null;
        resolveRun();
      });
      activeChild.once("exit", (code, signal) => {
        if (code === 0) console.log("pipeline-scheduler: run completed");
        else {
          console.error("pipeline-scheduler: run failed", { code, signal });
        }
        activeChild = null;
        resolveRun();
      });
    });
  };

  const tick = async () => {
    if (stopping || activeChild) return;
    const slot = getScheduleSlot(now(), timeZone);
    if (!slot || state.lastRunSlot === slot.key) return;

    state = { version: STATE_VERSION, lastRunSlot: slot.key };
    // Persist before spawning so a restart during the same two-hour slot cannot
    // trigger a duplicate search.
    await saveSchedulerState(statePath, state);
    await runPipeline();
  };

  const interval = setInterval(() => void tick(), MINUTE);
  const stop = async (signal = "SIGTERM") => {
    if (stopping) return;
    stopping = true;
    clearInterval(interval);
    if (activeChild) activeChild.kill(signal);
  };

  process.once("SIGTERM", () => void stop("SIGTERM"));
  process.once("SIGINT", () => void stop("SIGINT"));

  console.log("pipeline-scheduler: started", {
    sources,
    weekdays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    localHours: SCHEDULE_HOURS,
    activeUntilHour: SCHEDULE_END_HOUR,
    timeZone,
    statePath,
  });
  void tick();
  return { tick, stop, getState: () => ({ ...state }) };
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await startScheduler();
}
