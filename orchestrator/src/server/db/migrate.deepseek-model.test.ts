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

describe("DeepSeek model migration", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("migrates legacy direct-provider model IDs while preserving empty overrides", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "job-ops-deepseek-model-"));
    temporaryDirectories.push(dataDir);
    await runMigration(dataDir);

    const database = new Database(join(dataDir, "jobs.db"));
    const insert = database.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?)",
    );
    insert.run("llmProvider", "deepseek");
    insert.run("model", "deepseek-chat");
    insert.run("modelScorer", "deepseek-reasoner");
    insert.run("modelTailoring", "");
    database.close();

    await runMigration(dataDir);

    const migrated = new Database(join(dataDir, "jobs.db"), { readonly: true });
    const rows = Object.fromEntries(
      migrated
        .prepare(
          "SELECT key, value FROM settings WHERE key IN (?, ?, ?) ORDER BY key",
        )
        .all("model", "modelScorer", "modelTailoring")
        .map((row) => {
          const typed = row as { key: string; value: string };
          return [typed.key, typed.value];
        }),
    );
    migrated.close();

    expect(rows).toEqual({
      model: "deepseek-v4-flash",
      modelScorer: "deepseek-v4-flash",
      modelTailoring: "",
    });
  });

  it("does not rewrite similarly named models for another provider", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "job-ops-other-model-"));
    temporaryDirectories.push(dataDir);
    await runMigration(dataDir);

    const database = new Database(join(dataDir, "jobs.db"));
    database
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
      .run("llmProvider", "openrouter");
    database
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
      .run("model", "deepseek-chat");
    database.close();

    await runMigration(dataDir);

    const migrated = new Database(join(dataDir, "jobs.db"), { readonly: true });
    const value = (
      migrated
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get("model") as {
        value: string;
      }
    ).value;
    migrated.close();

    expect(value).toBe("deepseek-chat");
  });
});
