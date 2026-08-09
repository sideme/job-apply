import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@server/config/dataDir";

const DEFAULT_TTL_MS = 30 * 60_000;
const KEY_FILE = "application-fill-session.key";
const IV_BYTES = 12;
const TAG_BYTES = 16;
let cachedKey: Buffer | null = null;

type FillSessionPayload = {
  jobId: string;
  expiresAt: number;
};

function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  if (process.env.NODE_ENV === "test") {
    cachedKey = Buffer.alloc(32, 7);
    return cachedKey;
  }

  const configured = (process.env.APPLICATION_FILL_SESSION_SECRET || "").trim();
  if (configured) {
    cachedKey = createHash("sha256").update(configured).digest();
    return cachedKey;
  }

  const keyPath = join(getDataDir(), KEY_FILE);
  if (existsSync(keyPath)) {
    const stored = readFileSync(keyPath, "utf8").trim();
    if (/^[a-f0-9]{64}$/i.test(stored)) {
      cachedKey = Buffer.from(stored, "hex");
      return cachedKey;
    }
  }

  cachedKey = randomBytes(32);
  writeFileSync(keyPath, cachedKey.toString("hex"), { mode: 0o600 });
  return cachedKey;
}

export function createApplicationFillSession(
  jobId: string,
  options: { now?: number; ttlMs?: number } = {},
): { code: string; expiresAt: string } {
  const now = options.now ?? Date.now();
  const expiresAt = now + (options.ttlMs ?? DEFAULT_TTL_MS);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify({ jobId, expiresAt }));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const code = Buffer.concat([iv, tag, encrypted]).toString("base64url");
  return { code, expiresAt: new Date(expiresAt).toISOString() };
}

export function resolveApplicationFillSession(
  code: string,
  now = Date.now(),
): { jobId: string; expiresAt: string } | null {
  try {
    const bytes = Buffer.from(code, "base64url");
    if (bytes.length <= IV_BYTES + TAG_BYTES) return null;
    const iv = bytes.subarray(0, IV_BYTES);
    const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const encrypted = bytes.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(plaintext) as Partial<FillSessionPayload>;
    if (
      typeof payload.jobId !== "string" ||
      !payload.jobId ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt <= now
    ) {
      return null;
    }
    return {
      jobId: payload.jobId,
      expiresAt: new Date(payload.expiresAt).toISOString(),
    };
  } catch {
    return null;
  }
}

export function clearApplicationFillSessionsForTests(): void {
  cachedKey = null;
}
