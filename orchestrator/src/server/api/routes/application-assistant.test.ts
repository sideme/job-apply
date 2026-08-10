import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

const notifyWhatsAppEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@server/services/whatsapp", () => ({
  notifyWhatsAppEvent,
}));

describe.sequential("Application assistant API", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("records a confirmed browser submission once and sends one notification", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const { createApplicationFillSession } = await import(
      "@server/services/application-fill-session"
    );
    const job = await jobsRepo.createJob({
      source: "manual",
      title: "Platform Engineer",
      employer: "Example Co",
      jobUrl: "manual://application-assistant-test",
    });
    const session = createApplicationFillSession(job.id);

    const submit = () =>
      fetch(`${baseUrl}/api/application-assistant/submitted`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: session.code }),
      });

    const first = await submit();
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    expect(firstBody.data.recorded).toBe(true);

    const updated = await jobsRepo.getJobById(job.id);
    expect(updated?.status).toBe("applied");
    expect(notifyWhatsAppEvent).toHaveBeenCalledOnce();

    const second = await submit();
    const secondBody = await second.json();
    expect(second.status).toBe(200);
    expect(secondBody.data.alreadyApplied).toBe(true);
    expect(notifyWhatsAppEvent).toHaveBeenCalledOnce();
  });
});
