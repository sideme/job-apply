import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe.sequential("Jobs API routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("lists jobs and supports status filtering", async () => {
    const { createJob } = await import("@server/repositories/jobs");
    const job = await createJob({
      source: "manual",
      title: "Test Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/1",
      jobDescription: "Test description",
    });

    const listRes = await fetch(`${baseUrl}/api/jobs`);
    const listBody = await listRes.json();
    expect(listBody.ok).toBe(true);
    expect(listBody.data.total).toBe(1);
    expect(listBody.data.jobs[0].id).toBe(job.id);
    expect(typeof listBody.data.revision).toBe("string");

    const filteredRes = await fetch(`${baseUrl}/api/jobs?status=skipped`);
    const filteredBody = await filteredRes.json();
    expect(filteredBody.data.total).toBe(0);
    expect(typeof filteredBody.data.revision).toBe("string");
  });

  it("filters the same posting discovered through different sources", async () => {
    const { createJobs } = await import("@server/repositories/jobs");
    const result = await createJobs([
      {
        source: "indeed",
        title: "Senior Software Developer",
        employer: "Acme Inc.",
        location: "Toronto, ON, CA",
        datePosted: "1786060800000",
        jobUrl: "https://ca.indeed.com/viewjob?jk=dedupe-role",
      },
      {
        source: "linkedin",
        title: "Senior Software Developer",
        employer: "Acme Incorporated",
        location: "Toronto, Ontario, Canada",
        datePosted: "1786060800000",
        jobUrl: "https://linkedin.com/jobs/view/123456",
      },
    ]);

    expect(result).toMatchObject({ created: 1, skipped: 1 });
    expect(result.createdJobIds).toHaveLength(1);
    const listRes = await fetch(`${baseUrl}/api/jobs`);
    const listBody = await listRes.json();
    expect(listBody.data.total).toBe(1);
  });

  it("selects unscored jobs only from the current import IDs", async () => {
    const { createJob, getUnscoredDiscoveredJobs } = await import(
      "@server/repositories/jobs"
    );
    const historical = await createJob({
      source: "indeed",
      title: "Historical Role",
      employer: "Old Corp",
      jobUrl: "https://example.com/jobs/historical",
    });
    const newlyImported = await createJob({
      source: "linkedin",
      title: "New Role",
      employer: "New Corp",
      jobUrl: "https://example.com/jobs/new",
    });

    const selected = await getUnscoredDiscoveredJobs({
      ids: [newlyImported.id],
    });

    expect(selected.map((job) => job.id)).toEqual([newlyImported.id]);
    expect(selected.map((job) => job.id)).not.toContain(historical.id);
    await expect(getUnscoredDiscoveredJobs({ ids: [] })).resolves.toEqual([]);
  });

  it("searches jobs server-side and returns the total match count", async () => {
    const { createJob } = await import("@server/repositories/jobs");
    await createJob({
      source: "manual",
      title: "Backend Platform Engineer",
      employer: "Northwind",
      location: "Toronto",
      jobUrl: "https://example.com/job/search-backend",
    });
    await createJob({
      source: "manual",
      title: "Product Designer",
      employer: "Contoso",
      location: "Toronto",
      jobUrl: "https://example.com/job/search-design",
    });
    await createJob({
      source: "manual",
      title: "Infrastructure Engineer",
      employer: "Backend Labs",
      location: "Vancouver",
      jobUrl: "https://example.com/job/search-employer",
    });

    const response = await fetch(`${baseUrl}/api/jobs?q=backend`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.total).toBe(2);
    expect(body.data.jobs).toHaveLength(2);
    expect(
      body.data.jobs.map((job: { employer: string }) => job.employer),
    ).toEqual(expect.arrayContaining(["Northwind", "Backend Labs"]));
    expect(body.data.jobs[0]).not.toHaveProperty("jobDescription");
  });

  it("uses prefix full-text search and paginates matching jobs", async () => {
    const { createJob } = await import("@server/repositories/jobs");
    await createJob({
      source: "manual",
      title: "Platform Engineer",
      employer: "Northwind",
      location: "Montréal",
      jobUrl: "https://example.com/job/fts-platform-1",
    });
    await createJob({
      source: "manual",
      title: "Platform Developer",
      employer: "Contoso",
      location: "Toronto",
      jobUrl: "https://example.com/job/fts-platform-2",
    });

    const firstPage = await fetch(
      `${baseUrl}/api/jobs?q=plat&limit=1&offset=0`,
    );
    const firstBody = await firstPage.json();
    expect(firstPage.status).toBe(200);
    expect(firstBody.data.jobs).toHaveLength(1);
    expect(firstBody.data.total).toBe(2);
    expect(firstBody.data).toMatchObject({
      limit: 1,
      offset: 0,
      hasMore: true,
    });

    const secondPage = await fetch(
      `${baseUrl}/api/jobs?q=plat&limit=1&offset=1`,
    );
    const secondBody = await secondPage.json();
    expect(secondBody.data.jobs).toHaveLength(1);
    expect(secondBody.data).toMatchObject({
      limit: 1,
      offset: 1,
      hasMore: false,
    });
    expect(secondBody.data.jobs[0].id).not.toBe(firstBody.data.jobs[0].id);
  });

  it("normalizes and filters job levels server-side", async () => {
    const { createJob } = await import("@server/repositories/jobs");
    await createJob({
      source: "manual",
      title: "Platform Engineer",
      employer: "Northwind",
      jobLevel: "mid-senior level",
      jobUrl: "https://example.com/job/level-explicit",
    });
    await createJob({
      source: "manual",
      title: "Junior Product Developer",
      employer: "Contoso",
      jobUrl: "https://example.com/job/level-inferred",
    });
    await createJob({
      source: "manual",
      title: "Software Engineer",
      employer: "Fabrikam",
      jobUrl: "https://example.com/job/level-unknown",
    });

    const seniorResponse = await fetch(
      `${baseUrl}/api/jobs?view=list&level=senior`,
    );
    const seniorBody = await seniorResponse.json();
    expect(seniorResponse.status).toBe(200);
    expect(seniorBody.data.total).toBe(1);
    expect(seniorBody.data.jobs[0]).toMatchObject({
      employer: "Northwind",
      jobLevelCategory: "senior",
    });

    const entryResponse = await fetch(
      `${baseUrl}/api/jobs?view=list&level=entry_level`,
    );
    const entryBody = await entryResponse.json();
    expect(entryBody.data.total).toBe(1);
    expect(entryBody.data.jobs[0]).toMatchObject({
      employer: "Contoso",
      jobLevelCategory: "entry_level",
    });

    const combinedResponse = await fetch(
      `${baseUrl}/api/jobs?view=list&level=senior,entry_level`,
    );
    const combinedBody = await combinedResponse.json();
    expect(combinedBody.data.total).toBe(2);
    expect(
      combinedBody.data.jobs.map(
        (job: { jobLevelCategory: string }) => job.jobLevelCategory,
      ),
    ).toEqual(expect.arrayContaining(["senior", "entry_level"]));
  });

  it("rejects invalid job level filters", async () => {
    const response = await fetch(`${baseUrl}/api/jobs?level=senior,wizard`);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("supports lightweight and full jobs list views", async () => {
    const { createJob } = await import("@server/repositories/jobs");
    await createJob({
      source: "manual",
      title: "List View Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/list-view",
      jobDescription: "Heavy description that should not be in list mode",
    });

    const listRes = await fetch(`${baseUrl}/api/jobs?view=list`);
    const listBody = await listRes.json();
    expect(listRes.status).toBe(200);
    expect(listBody.ok).toBe(true);
    expect(typeof listBody.meta.requestId).toBe("string");
    expect(listBody.data.jobs[0].id).toBeTruthy();
    expect(listBody.data.jobs[0].title).toBe("List View Role");
    expect(listBody.data.jobs[0]).not.toHaveProperty("jobDescription");
    expect(typeof listBody.data.revision).toBe("string");

    const fullRes = await fetch(`${baseUrl}/api/jobs?view=full`);
    const fullBody = await fullRes.json();
    expect(fullRes.status).toBe(200);
    expect(fullBody.ok).toBe(true);
    expect(fullBody.data.jobs[0].title).toBe("List View Role");
    expect(fullBody.data.jobs[0]).toHaveProperty("jobDescription");
    expect(typeof fullBody.data.revision).toBe("string");

    const defaultRes = await fetch(`${baseUrl}/api/jobs`);
    const defaultBody = await defaultRes.json();
    expect(defaultRes.status).toBe(200);
    expect(defaultBody.ok).toBe(true);
    expect(defaultBody.data.jobs[0]).not.toHaveProperty("jobDescription");
    expect(typeof defaultBody.data.revision).toBe("string");
  });

  it("returns jobs revision and supports status filtering", async () => {
    const { createJob, updateJob } = await import("@server/repositories/jobs");
    const readyJob = await createJob({
      source: "manual",
      title: "Ready Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/revision-ready",
      jobDescription: "Ready description",
    });
    const appliedJob = await createJob({
      source: "manual",
      title: "Applied Role",
      employer: "Beta",
      jobUrl: "https://example.com/job/revision-applied",
      jobDescription: "Applied description",
    });
    await updateJob(readyJob.id, { status: "ready" });
    await updateJob(appliedJob.id, { status: "applied" });

    const allRes = await fetch(`${baseUrl}/api/jobs/revision`);
    const allBody = await allRes.json();

    expect(allRes.status).toBe(200);
    expect(allBody.ok).toBe(true);
    expect(typeof allBody.meta.requestId).toBe("string");
    expect(typeof allBody.data.revision).toBe("string");
    expect(allBody.data.total).toBe(2);
    expect(allBody.data.latestUpdatedAt).toBeTruthy();
    expect(allBody.data.statusFilter).toBeNull();

    const filteredRes = await fetch(
      `${baseUrl}/api/jobs/revision?status=applied,ready`,
    );
    const filteredBody = await filteredRes.json();

    expect(filteredRes.status).toBe(200);
    expect(filteredBody.ok).toBe(true);
    expect(filteredBody.data.total).toBe(2);
    expect(filteredBody.data.statusFilter).toBe("applied,ready");
    expect(typeof filteredBody.data.revision).toBe("string");
  });

  it("rejects invalid jobs list view query", async () => {
    const res = await fetch(`${baseUrl}/api/jobs?view=compact`);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(typeof body.meta.requestId).toBe("string");
  });

  it("returns 404 for missing jobs", async () => {
    const res = await fetch(`${baseUrl}/api/jobs/missing-id`);
    expect(res.status).toBe(404);
  });

  it("updates core job detail fields", async () => {
    const { createJob } = await import("@server/repositories/jobs");
    const job = await createJob({
      source: "manual",
      title: "Original Title",
      employer: "Original Employer",
      jobUrl: "https://example.com/job/core-fields",
      jobDescription: "Original description",
    });

    const res = await fetch(`${baseUrl}/api/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Updated Title",
        employer: "Updated Employer",
        jobUrl: "https://example.com/job/core-fields-updated",
        applicationLink: "https://example.com/apply/core-fields-updated",
        location: "London, UK",
        salary: "GBP 100k",
        deadline: "2026-03-31",
        jobDescription: "Updated description",
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.title).toBe("Updated Title");
    expect(body.data.employer).toBe("Updated Employer");
    expect(body.data.jobUrl).toBe(
      "https://example.com/job/core-fields-updated",
    );
    expect(body.data.applicationLink).toBe(
      "https://example.com/apply/core-fields-updated",
    );
    expect(body.data.location).toBe("London, UK");
    expect(body.data.salary).toBe("GBP 100k");
    expect(body.data.deadline).toBe("2026-03-31");
    expect(body.data.jobDescription).toBe("Updated description");
    expect(typeof body.meta.requestId).toBe("string");
  });

  it("returns 404 when patching a missing job", async () => {
    const res = await fetch(`${baseUrl}/api/jobs/missing-id`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated Title" }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(typeof body.meta.requestId).toBe("string");
  });

  it("prefers JOBOPS_PUBLIC_BASE_URL over forwarded headers for generate-pdf origin", async () => {
    const { createJob } = await import("@server/repositories/jobs");
    const { generateFinalPdf } = await import("@server/pipeline/index");
    const job = await createJob({
      source: "manual",
      title: "Origin Test",
      employer: "Example Co",
      jobUrl: "https://example.com/job/origin-test",
      jobDescription: "Test description",
    });

    const previousBaseUrl = process.env.JOBOPS_PUBLIC_BASE_URL;
    process.env.JOBOPS_PUBLIC_BASE_URL = "https://canonical.jobops.example";

    try {
      const res = await fetch(`${baseUrl}/api/jobs/${job.id}/generate-pdf`, {
        method: "POST",
        headers: {
          "x-forwarded-proto": "http",
          "x-forwarded-host": "attacker.example",
        },
      });

      expect(res.status).toBe(200);
      expect(vi.mocked(generateFinalPdf)).toHaveBeenCalledWith(job.id, {
        requestOrigin: "https://canonical.jobops.example",
      });
    } finally {
      if (previousBaseUrl === undefined) {
        delete process.env.JOBOPS_PUBLIC_BASE_URL;
      } else {
        process.env.JOBOPS_PUBLIC_BASE_URL = previousBaseUrl;
      }
    }
  });

  it("returns 409 when patching to a duplicate job URL", async () => {
    const { createJob } = await import("@server/repositories/jobs");
    const first = await createJob({
      source: "manual",
      title: "First",
      employer: "Acme",
      jobUrl: "https://example.com/job/first",
      jobDescription: "First description",
    });
    const second = await createJob({
      source: "manual",
      title: "Second",
      employer: "Acme",
      jobUrl: "https://example.com/job/second",
      jobDescription: "Second description",
    });

    const res = await fetch(`${baseUrl}/api/jobs/${second.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobUrl: first.jobUrl }),
    });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("CONFLICT");
    expect(typeof body.meta.requestId).toBe("string");
  });

  it("validates job updates and supports skip/delete flow", async () => {
    const { createJob } = await import("@server/repositories/jobs");
    const job = await createJob({
      source: "manual",
      title: "Test Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/2",
      jobDescription: "Test description",
    });

    const badRes = await fetch(`${baseUrl}/api/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suitabilityScore: 1000 }),
    });
    const badBody = await badRes.json();
    expect(badRes.status).toBe(400);
    expect(badBody.ok).toBe(false);
    expect(badBody.error.code).toBe("INVALID_REQUEST");
    expect(typeof badBody.meta.requestId).toBe("string");

    const invalidCoreRes = await fetch(`${baseUrl}/api/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employer: "   " }),
    });
    const invalidCoreBody = await invalidCoreRes.json();
    expect(invalidCoreRes.status).toBe(400);
    expect(invalidCoreBody.ok).toBe(false);
    expect(invalidCoreBody.error.code).toBe("INVALID_REQUEST");
    expect(typeof invalidCoreBody.meta.requestId).toBe("string");

    const patchRes = await fetch(`${baseUrl}/api/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suitabilityScore: 77 }),
    });
    const patchBody = await patchRes.json();
    expect(patchRes.status).toBe(200);
    expect(patchBody.ok).toBe(true);
    expect(patchBody.data.suitabilityScore).toBe(77);
    expect(typeof patchBody.meta.requestId).toBe("string");

    const skipRes = await fetch(`${baseUrl}/api/jobs/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "skip", jobIds: [job.id] }),
    });
    const skipBody = await skipRes.json();
    expect(skipBody.data.results).toHaveLength(1);
    expect(skipBody.data.results[0].ok).toBe(true);
    expect(skipBody.data.results[0].job.status).toBe("skipped");

    const deleteRes = await fetch(`${baseUrl}/api/jobs/status/skipped`, {
      method: "DELETE",
    });
    const deleteBody = await deleteRes.json();
    expect(deleteBody.data.count).toBe(1);
  });

  it("runs skip action with partial failures", async () => {
    const { createJob } = await import("@server/repositories/jobs");
    const discovered = await createJob({
      source: "manual",
      title: "Discovered Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/action-discovered",
      jobDescription: "Test description",
    });
    const ready = await createJob({
      source: "manual",
      title: "Ready Role",
      employer: "Beta",
      jobUrl: "https://example.com/job/action-ready",
      jobDescription: "Test description",
    });
    const applied = await createJob({
      source: "manual",
      title: "Applied Role",
      employer: "Gamma",
      jobUrl: "https://example.com/job/action-applied",
      jobDescription: "Test description",
    });
    const { updateJob } = await import("@server/repositories/jobs");
    await updateJob(ready.id, { status: "ready" });
    await updateJob(applied.id, { status: "applied" });

    const res = await fetch(`${baseUrl}/api/jobs/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "skip",
        jobIds: [discovered.id, ready.id, applied.id, "missing-id"],
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.meta.requestId).toBeTruthy();
    expect(body.data.requested).toBe(4);
    expect(body.data.succeeded).toBe(2);
    expect(body.data.failed).toBe(2);
    const failures = body.data.results.filter((r: any) => !r.ok);
    expect(failures).toHaveLength(2);
    expect(failures.map((r: any) => r.error.code).sort()).toEqual([
      "INVALID_REQUEST",
      "NOT_FOUND",
    ]);
  });

  it("runs move_to_ready action and rejects ineligible statuses", async () => {
    const { createJob, updateJob } = await import("@server/repositories/jobs");
    const discovered = await createJob({
      source: "manual",
      title: "New Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/action-ready-1",
      jobDescription: "Test description",
    });
    const ready = await createJob({
      source: "manual",
      title: "Already Ready",
      employer: "Acme",
      jobUrl: "https://example.com/job/action-ready-2",
      jobDescription: "Test description",
    });
    await updateJob(ready.id, { status: "ready" });
    const { processJob } = await import("@server/pipeline/index");
    const previousBaseUrl = process.env.JOBOPS_PUBLIC_BASE_URL;
    process.env.JOBOPS_PUBLIC_BASE_URL = "https://canonical.jobops.example";

    try {
      const res = await fetch(`${baseUrl}/api/jobs/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "move_to_ready",
          jobIds: [discovered.id, ready.id],
        }),
      });
      const body = await res.json();

      expect(body.ok).toBe(true);
      expect(body.data.succeeded).toBe(1);
      expect(body.data.failed).toBe(1);
      expect(vi.mocked(processJob)).toHaveBeenCalledWith(discovered.id, {
        force: false,
        requestOrigin: "https://canonical.jobops.example",
      });
      expect(
        body.data.results.find((r: any) => r.jobId === ready.id).error.code,
      ).toBe("INVALID_REQUEST");
    } finally {
      if (previousBaseUrl === undefined) {
        delete process.env.JOBOPS_PUBLIC_BASE_URL;
      } else {
        process.env.JOBOPS_PUBLIC_BASE_URL = previousBaseUrl;
      }
    }
  });

  it("supports legacy move_to_ready endpoint", async () => {
    const { createJob } = await import("@server/repositories/jobs");
    const { processJob } = await import("@server/pipeline/index");
    const job = await createJob({
      source: "manual",
      title: "Legacy Ready Route",
      employer: "Acme",
      jobUrl: "https://example.com/job/legacy-process-1",
      jobDescription: "Test description",
    });

    const previousBaseUrl = process.env.JOBOPS_PUBLIC_BASE_URL;
    process.env.JOBOPS_PUBLIC_BASE_URL = "https://canonical.jobops.example";
    try {
      const res = await fetch(`${baseUrl}/api/jobs/${job.id}/process`, {
        method: "POST",
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(vi.mocked(processJob)).toHaveBeenCalledWith(job.id, {
        force: false,
        requestOrigin: "https://canonical.jobops.example",
      });
    } finally {
      if (previousBaseUrl === undefined) {
        delete process.env.JOBOPS_PUBLIC_BASE_URL;
      } else {
        process.env.JOBOPS_PUBLIC_BASE_URL = previousBaseUrl;
      }
    }
  });

  it("runs rescore action with partial failures", async () => {
    const { createJob, updateJob } = await import("@server/repositories/jobs");
    const { calculateLocalJobScore } = await import(
      "@server/services/scoring/local-score-job"
    );
    const { getProfile } = await import("@server/services/profile");

    vi.mocked(getProfile).mockResolvedValue({});
    vi.mocked(calculateLocalJobScore).mockResolvedValue({
      total: 81,
      semanticScore: 85,
      keywordCoverage: 72,
      keywordMissing: ["kafka"],
      reason: "Updated fit from local rescore",
      reasonSource: "local",
      jobVector: null,
      jobVectorModel: null,
    });

    const discovered = await createJob({
      source: "manual",
      title: "Discovered Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/action-rescore-1",
      jobDescription: "Test description",
    });
    const ready = await createJob({
      source: "manual",
      title: "Ready Role",
      employer: "Beta",
      jobUrl: "https://example.com/job/action-rescore-2",
      jobDescription: "Test description",
    });
    const processing = await createJob({
      source: "manual",
      title: "Processing Role",
      employer: "Gamma",
      jobUrl: "https://example.com/job/action-rescore-3",
      jobDescription: "Test description",
    });
    await updateJob(ready.id, { status: "ready" });
    await updateJob(processing.id, { status: "processing" });

    const res = await fetch(`${baseUrl}/api/jobs/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "rescore",
        jobIds: [discovered.id, ready.id, processing.id, "missing-id"],
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.meta.requestId).toBeTruthy();
    expect(body.data.requested).toBe(4);
    expect(body.data.succeeded).toBe(2);
    expect(body.data.failed).toBe(2);
    expect(
      body.data.results.find((r: any) => r.jobId === discovered.id).job
        .suitabilityScore,
    ).toBe(81);
    expect(
      body.data.results.find((r: any) => r.jobId === ready.id).job
        .suitabilityScore,
    ).toBe(81);
    expect(
      body.data.results.find((r: any) => r.jobId === processing.id).error.code,
    ).toBe("INVALID_REQUEST");
    expect(
      body.data.results.find((r: any) => r.jobId === "missing-id").error.code,
    ).toBe("NOT_FOUND");
    expect(vi.mocked(getProfile)).toHaveBeenCalledTimes(1);
  });

  it("streams job action progress with done counters", async () => {
    const { createJob, updateJob } = await import("@server/repositories/jobs");
    const discovered = await createJob({
      source: "manual",
      title: "Discovered Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/action-stream-1",
      jobDescription: "Test description",
    });
    const ready = await createJob({
      source: "manual",
      title: "Ready Role",
      employer: "Beta",
      jobUrl: "https://example.com/job/action-stream-2",
      jobDescription: "Test description",
    });
    const applied = await createJob({
      source: "manual",
      title: "Applied Role",
      employer: "Gamma",
      jobUrl: "https://example.com/job/action-stream-3",
      jobDescription: "Test description",
    });
    await updateJob(ready.id, { status: "ready" });
    await updateJob(applied.id, { status: "applied" });

    const res = await fetch(`${baseUrl}/api/jobs/actions/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "skip",
        jobIds: [discovered.id, ready.id, applied.id],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;

    const decoder = new TextDecoder();
    const events: any[] = [];
    let buffer = "";
    let hasCompleted = false;

    try {
      while (!hasCompleted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let separatorIndex = buffer.indexOf("\n\n");
        while (separatorIndex !== -1) {
          const frame = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);

          const dataLines = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .filter(Boolean);

          for (const line of dataLines) {
            const event = JSON.parse(line);
            events.push(event);
            if (event.type === "completed") {
              hasCompleted = true;
            }
          }

          separatorIndex = buffer.indexOf("\n\n");
        }
      }
    } finally {
      await reader.cancel();
    }

    expect(events[0].type).toBe("started");
    expect(events[0].completed).toBe(0);
    expect(events[0].requested).toBe(3);
    expect(events.filter((event) => event.type === "progress")).toHaveLength(3);
    expect(events.at(-1)?.type).toBe("completed");
    expect(events.at(-1)?.completed).toBe(3);
    expect(events.at(-1)?.succeeded).toBe(2);
    expect(events.at(-1)?.failed).toBe(1);
  });

  it("validates job action payloads", async () => {
    const tooManyIds = Array.from(
      { length: 101 },
      (_, index) => `job-${index}`,
    );
    const res = await fetch(`${baseUrl}/api/jobs/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "skip",
        jobIds: tooManyIds,
      }),
    });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(body.meta.requestId).toBeTruthy();
  });

  it("applies a job", async () => {
    const { createJob } = await import("@server/repositories/jobs");
    const job = await createJob({
      source: "manual",
      title: "Test Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/3",
      jobDescription: "Test description",
    });

    const res = await fetch(`${baseUrl}/api/jobs/${job.id}/apply`, {
      method: "POST",
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("applied");
    expect(body.data.appliedAt).toBeTruthy();
  });

  it("creates a conservative application fill plan without submitting", async () => {
    const { createJob } = await import("@server/repositories/jobs");
    const job = await createJob({
      source: "manual",
      title: "Form Review Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/fill-plan",
      jobDescription: "Test description",
    });

    const res = await fetch(
      `${baseUrl}/api/jobs/${job.id}/application-fill-plan`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questions: [
            {
              label: "Are you legally authorized to work in Canada?",
              type: "radio",
              options: ["Yes", "No"],
            },
          ],
        }),
      },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.jobId).toBe(job.id);
    expect(body.data.unresolved).toHaveLength(1);
    expect(body.data.submission).toEqual({
      allowed: false,
      requiresConfirmation: true,
      reason: "unresolved_questions",
    });
    expect(body.meta.requestId).toBeTruthy();
  });

  it("rescoring a job updates the suitability fields", async () => {
    const { createJob } = await import("@server/repositories/jobs");
    const { calculateLocalJobScore } = await import(
      "@server/services/scoring/local-score-job"
    );
    const { getProfile } = await import("@server/services/profile");

    vi.mocked(getProfile).mockResolvedValue({});
    vi.mocked(calculateLocalJobScore).mockResolvedValue({
      total: 77,
      semanticScore: null,
      keywordCoverage: 77,
      keywordMissing: [],
      reason: "Updated local fit",
      reasonSource: "local",
      jobVector: null,
      jobVectorModel: null,
    });

    const job = await createJob({
      source: "manual",
      title: "Test Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/5",
      jobDescription: "Test description",
    });

    const { updateJob } = await import("@server/repositories/jobs");
    await updateJob(job.id, {
      suitabilityScore: 55,
      suitabilityReason: "Old fit",
    });

    const res = await fetch(`${baseUrl}/api/jobs/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rescore", jobIds: [job.id] }),
    });
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.data.results).toHaveLength(1);
    expect(body.data.results[0].ok).toBe(true);
    expect(body.data.results[0].job.suitabilityScore).toBe(77);
    expect(body.data.results[0].job.suitabilityReason).toBe(
      "Updated local fit",
    );
  });

  it("runs LLM scoring only for explicit deep analysis", async () => {
    const { createJob } = await import("@server/repositories/jobs");
    const { scoreJobSuitability } = await import("@server/services/scorer");
    const { getProfile } = await import("@server/services/profile");

    process.env.LLM_API_KEY = "test-chat-key";
    vi.mocked(getProfile).mockResolvedValue({});
    vi.mocked(scoreJobSuitability).mockResolvedValue({
      score: 88,
      reason: "Strong backend match",
    });
    const job = await createJob({
      source: "manual",
      title: "Backend Engineer",
      employer: "Acme",
      jobUrl: "https://example.com/job/deep-analysis",
      jobDescription: "TypeScript and React",
    });

    const res = await fetch(`${baseUrl}/api/jobs/${job.id}/deep-analyze`, {
      method: "POST",
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.suitabilityScore).toBe(88);
    expect(body.data.suitabilityReason).toBe("Strong backend match");
    expect(body.data.suitabilityReasonSource).toBe("llm");
    expect(vi.mocked(scoreJobSuitability)).toHaveBeenCalledWith(job, {});
  });

  it("deletes jobs below a score threshold (excluding applied)", async () => {
    const { createJob, updateJob } = await import("@server/repositories/jobs");

    // Create jobs with different scores and statuses
    const lowScoreJob = await createJob({
      source: "manual",
      title: "Low Score Job",
      employer: "Company A",
      jobUrl: "https://example.com/job/low",
      jobDescription: "Test description",
    });
    await updateJob(lowScoreJob.id, { suitabilityScore: 30 });

    const mediumScoreJob = await createJob({
      source: "manual",
      title: "Medium Score Job",
      employer: "Company B",
      jobUrl: "https://example.com/job/medium",
      jobDescription: "Test description",
    });
    await updateJob(mediumScoreJob.id, { suitabilityScore: 60 });

    const boundaryScoreJob = await createJob({
      source: "manual",
      title: "Boundary Score Job",
      employer: "Company Boundary",
      jobUrl: "https://example.com/job/boundary",
      jobDescription: "Test description",
    });
    await updateJob(boundaryScoreJob.id, { suitabilityScore: 50 });

    const highScoreJob = await createJob({
      source: "manual",
      title: "High Score Job",
      employer: "Company C",
      jobUrl: "https://example.com/job/high",
      jobDescription: "Test description",
    });
    await updateJob(highScoreJob.id, { suitabilityScore: 90 });

    const appliedLowScoreJob = await createJob({
      source: "manual",
      title: "Applied Low Score Job",
      employer: "Company D",
      jobUrl: "https://example.com/job/applied-low",
      jobDescription: "Test description",
    });
    await updateJob(appliedLowScoreJob.id, {
      suitabilityScore: 30,
      status: "applied",
    });

    // Delete jobs below score 50
    const deleteRes = await fetch(`${baseUrl}/api/jobs/score/50`, {
      method: "DELETE",
    });
    const deleteBody = await deleteRes.json();

    expect(deleteBody.ok).toBe(true);
    expect(deleteBody.data.count).toBe(1);
    expect(deleteBody.data.threshold).toBe(50);

    // Verify only the low score non-applied job was deleted
    const listRes = await fetch(`${baseUrl}/api/jobs`);
    const listBody = await listRes.json();

    const remainingJobIds = listBody.data.jobs.map((j: any) => j.id);
    expect(remainingJobIds).not.toContain(lowScoreJob.id);
    expect(remainingJobIds).toContain(boundaryScoreJob.id);
    expect(remainingJobIds).toContain(mediumScoreJob.id);
    expect(remainingJobIds).toContain(highScoreJob.id);
    expect(remainingJobIds).toContain(appliedLowScoreJob.id); // Applied job preserved
  });

  it("rejects invalid score thresholds", async () => {
    // Test invalid threshold (above 100)
    const invalidRes = await fetch(`${baseUrl}/api/jobs/score/150`, {
      method: "DELETE",
    });
    expect(invalidRes.status).toBe(400);
    const invalidBody = await invalidRes.json();
    expect(invalidBody.ok).toBe(false);
    expect(invalidBody.error.code).toBe("INVALID_REQUEST");

    // Test invalid threshold (below 0)
    const negativeRes = await fetch(`${baseUrl}/api/jobs/score/-10`, {
      method: "DELETE",
    });
    expect(negativeRes.status).toBe(400);

    // Test non-numeric threshold
    const nanRes = await fetch(`${baseUrl}/api/jobs/score/abc`, {
      method: "DELETE",
    });
    expect(nanRes.status).toBe(400);
  });

  describe("Application Tracking", () => {
    let jobId: string;

    beforeEach(async () => {
      const { createJob } = await import("@server/repositories/jobs");
      const job = await createJob({
        source: "manual",
        title: "Tracking Test",
        employer: "Test Corp",
        jobUrl: "https://example.com/tracking",
      });
      jobId = job.id;
    });

    it("transitions stages and retrieves events", async () => {
      // 1. Initial transition to applied
      const trans1 = await fetch(`${baseUrl}/api/jobs/${jobId}/stages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStage: "applied" }),
      });
      const body1 = await trans1.json();
      expect(body1.ok).toBe(true);
      expect(body1.data.toStage).toBe("applied");
      const eventId = body1.data.id;

      // 2. Transition to recruiter_screen with metadata
      await fetch(`${baseUrl}/api/jobs/${jobId}/stages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toStage: "recruiter_screen",
          metadata: { note: "Called by recruiter" },
        }),
      });

      // 3. Get events
      const eventsRes = await fetch(`${baseUrl}/api/jobs/${jobId}/events`);
      const eventsBody = await eventsRes.json();
      expect(eventsBody.ok).toBe(true);
      expect(eventsBody.data).toHaveLength(2);
      expect(eventsBody.data[0].toStage).toBe("applied");
      expect(eventsBody.data[1].toStage).toBe("recruiter_screen");
      expect(eventsBody.data[1].metadata.note).toBe("Called by recruiter");

      // 4. Patch an event
      const patchRes = await fetch(
        `${baseUrl}/api/jobs/${jobId}/events/${eventId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata: { note: "Updated note" } }),
        },
      );
      expect(patchRes.status).toBe(200);

      const eventsRes2 = await fetch(`${baseUrl}/api/jobs/${jobId}/events`);
      const eventsBody2 = await eventsRes2.json();
      expect(eventsBody2.data[0].metadata.note).toBe("Updated note");

      // 5. Delete an event
      const deleteRes = await fetch(
        `${baseUrl}/api/jobs/${jobId}/events/${eventId}`,
        {
          method: "DELETE",
        },
      );
      expect(deleteRes.status).toBe(200);

      const eventsRes3 = await fetch(`${baseUrl}/api/jobs/${jobId}/events`);
      const eventsBody3 = await eventsRes3.json();
      expect(eventsBody3.data).toHaveLength(1);
    });

    it("manages application tasks", async () => {
      const { db, schema } = await import("@server/db/index");
      const { eq } = await import("drizzle-orm");
      const { tasks } = schema;

      // 1. Initial state
      const res1 = await fetch(`${baseUrl}/api/jobs/${jobId}/tasks`);
      const body1 = await res1.json();
      expect(body1.ok).toBe(true);
      expect(body1.data).toEqual([]);

      // 2. Insert a task
      await (db as any)
        .insert(tasks)
        .values({
          id: "task-1",
          applicationId: jobId,
          type: "todo",
          title: "Complete test task",
          isCompleted: false,
        })
        .run();

      const res2 = await fetch(`${baseUrl}/api/jobs/${jobId}/tasks`);
      const body2 = await res2.json();
      expect(body2.data).toHaveLength(1);
      expect(body2.data[0].title).toBe("Complete test task");

      // 3. Test filtering (completed vs non-completed)
      await (db as any)
        .update(tasks)
        .set({ isCompleted: true })
        .where(eq(tasks.id, "task-1"))
        .run();

      const res3 = await fetch(`${baseUrl}/api/jobs/${jobId}/tasks`);
      const body3 = await res3.json();
      expect(body3.data).toHaveLength(0); // includeCompleted defaults to false

      const res4 = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks?includeCompleted=true`,
      );
      const body4 = await res4.json();
      expect(body4.data).toHaveLength(1);
    });

    it("updates job outcome", async () => {
      const res = await fetch(`${baseUrl}/api/jobs/${jobId}/outcome`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome: "rejected" }),
      });
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.outcome).toBe("rejected");
      expect(body.data.closedAt).toBeTruthy();
    });
  });
});
