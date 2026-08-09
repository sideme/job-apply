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

describe("database migration embedding cache", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("preserves a cached job vector across a second startup migration", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "job-ops-migrate-cache-"));
    temporaryDirectories.push(dataDir);
    await runMigration(dataDir);

    const database = new Database(join(dataDir, "jobs.db"));
    database
      .prepare(
        `INSERT INTO jobs (
          id, source, title, employer, job_url, status,
          suitability_score, semantic_score, keyword_coverage,
          suitability_reason_source, job_embedding, job_embedding_model,
          job_embedding_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "cache-job",
        "indeed",
        "Backend Engineer",
        "Acme",
        "https://ca.indeed.com/viewjob?jk=cache-job",
        "discovered",
        88,
        91,
        81,
        "local",
        "[0.6,0.8]",
        "text-embedding-v3",
        "embedding-input-hash",
      );
    database.close();

    await runMigration(dataDir);

    const migrated = new Database(join(dataDir, "jobs.db"), {
      readonly: true,
    });
    const row = migrated
      .prepare(
        `SELECT job_embedding AS vector, job_embedding_model AS model,
          job_embedding_hash AS inputHash,
          semantic_score AS semanticScore, keyword_coverage AS keywordCoverage,
          suitability_reason_source AS reasonSource
         FROM jobs WHERE id = ?`,
      )
      .get("cache-job");
    migrated.close();

    expect(row).toEqual({
      vector: "[0.6,0.8]",
      model: "text-embedding-v3",
      inputHash: "embedding-input-hash",
      semanticScore: 91,
      keywordCoverage: 81,
      reasonSource: "local",
    });
  });
});
