import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MINUTE = 60_000;
const STATE_VERSION = 1;

function positiveMinutes(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseSchedulerState(raw) {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!value || value.version !== STATE_VERSION) return null;
    const lastCoreRunAt = Number(value.lastCoreRunAt);
    const lastLinkedInRunAt = Number(value.lastLinkedInRunAt);
    if (
      !Number.isFinite(lastCoreRunAt) ||
      !Number.isFinite(lastLinkedInRunAt)
    ) {
      return null;
    }
    return { version: STATE_VERSION, lastCoreRunAt, lastLinkedInRunAt };
  } catch {
    return null;
  }
}

export function dueSources(state, now, coreIntervalMs, linkedInIntervalMs) {
  const coreDue = now - state.lastCoreRunAt >= coreIntervalMs;
  const linkedInDue = now - state.lastLinkedInRunAt >= linkedInIntervalMs;
  const sources = coreDue ? ["indeed"] : [];
  if (linkedInDue) sources.push("linkedin");
  return { coreDue, linkedInDue, sources };
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
  return { version: STATE_VERSION, lastCoreRunAt: 0, lastLinkedInRunAt: 0 };
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
  const coreIntervalMs =
    positiveMinutes("PIPELINE_SCHEDULE_CORE_MINUTES", 60) * MINUTE;
  const linkedInIntervalMs =
    positiveMinutes("PIPELINE_SCHEDULE_LINKEDIN_MINUTES", 180) * MINUTE;
  const statePath =
    options.statePath ||
    process.env.PIPELINE_SCHEDULER_STATE_FILE ||
    join(defaultDataDir(), "pipeline-scheduler-state.json");
  const spawnProcess = options.spawnProcess || spawn;
  let state = await loadSchedulerState(statePath);
  let activeChild = null;
  let stopping = false;

  const runPipeline = async (sources) => {
    console.log("pipeline-scheduler: starting", {
      sources,
      at: new Date().toISOString(),
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
    const now = Date.now();
    const due = dueSources(state, now, coreIntervalMs, linkedInIntervalMs);
    if (due.sources.length === 0) return;

    state = {
      version: STATE_VERSION,
      lastCoreRunAt: due.coreDue ? now : state.lastCoreRunAt,
      lastLinkedInRunAt: due.linkedInDue ? now : state.lastLinkedInRunAt,
    };
    // Persist before spawning so a container restart cannot immediately repeat
    // the same scrape, especially the higher-risk LinkedIn source.
    await saveSchedulerState(statePath, state);
    await runPipeline(due.sources);
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
    coreSources: ["indeed"],
    coreIntervalMinutes: coreIntervalMs / MINUTE,
    linkedInIntervalMinutes: linkedInIntervalMs / MINUTE,
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
