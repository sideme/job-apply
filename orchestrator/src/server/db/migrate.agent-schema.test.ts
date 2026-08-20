import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function runMigration(dataDir: string): Promise<void> {
  await execFileAsync(
    resolve(process.cwd(), "../node_modules/.bin/tsx"),
    [resolve(process.cwd(), "src/server/db/migrate.ts")],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATA_DIR: dataDir, NODE_ENV: "test" },
      maxBuffer: 2_000_000,
    },
  );
}

describe("agent database migration", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("creates the agent tables and fit columns idempotently", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "job-ops-agent-schema-"));
    temporaryDirectories.push(dataDir);
    await runMigration(dataDir);
    await runMigration(dataDir);

    const database = new Database(join(dataDir, "jobs.db"), { readonly: true });
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'agent_%' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);
    const columns = database
      .prepare("PRAGMA table_info(jobs)")
      .all()
      .map((row) => (row as { name: string }).name);
    database.close();

    expect(tables).toEqual([
      "agent_daily_usage",
      "agent_run_steps",
      "agent_runs",
    ]);
    expect(columns).toEqual(
      expect.arrayContaining([
        "llm_fit_score",
        "llm_fit_status",
        "llm_fit_input_hash",
        "llm_fit_at",
      ]),
    );
  });

  it("promotes completed DeepSeek judgments to the primary ATS score", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "job-ops-agent-score-"));
    temporaryDirectories.push(dataDir);
    await runMigration(dataDir);

    const database = new Database(join(dataDir, "jobs.db"));
    database
      .prepare(
        `INSERT INTO jobs (
          id, source, title, employer, job_url, status,
          suitability_score, suitability_reason, suitability_reason_source,
          llm_fit_score, llm_fit_verdict, llm_fit_status,
          llm_fit_provider, llm_fit_model
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "deepseek-score-job",
        "linkedin",
        "Backend Engineer",
        "Acme",
        "https://example.com/deepseek-score-job",
        "discovered",
        52,
        "Local ATS 52",
        "local",
        87,
        "strong",
        "completed",
        "deepseek",
        "deepseek-v4-flash",
      );
    database.close();

    await runMigration(dataDir);

    const migrated = new Database(join(dataDir, "jobs.db"), { readonly: true });
    const job = migrated
      .prepare(
        `SELECT suitability_score AS score,
                suitability_reason AS reason,
                suitability_reason_source AS source
         FROM jobs WHERE id = ?`,
      )
      .get("deepseek-score-job");
    migrated.close();

    expect(job).toEqual({
      score: 87,
      reason: "DeepSeek ATS 87 · strong · deepseek-v4-flash",
      source: "llm",
    });
  });
});
