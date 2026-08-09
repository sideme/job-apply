import { toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { isDemoMode } from "@server/config/demo";
import { DEMO_PROJECT_CATALOG } from "@server/config/demo-defaults";
import { getLocalResumeStatus } from "@server/services/local-resume";
import { clearProfileCache, getProfile } from "@server/services/profile";
import { extractProjectsFromProfile } from "@server/services/resumeProjects";
import { type Request, type Response, Router } from "express";

export const profileRouter = Router();

/**
 * GET /api/profile/projects - Get all projects available in the base resume
 */
profileRouter.get("/projects", async (_req: Request, res: Response) => {
  try {
    if (isDemoMode()) {
      res.json({ success: true, data: DEMO_PROJECT_CATALOG });
      return;
    }
    const profile = await getProfile();
    const { catalog } = extractProjectsFromProfile(profile);
    ok(res, catalog);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

/**
 * GET /api/profile - Get the full base resume profile
 */
profileRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const profile = await getProfile();
    ok(res, profile);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

/**
 * GET /api/profile/status - Check if base resume is configured and accessible
 */
profileRouter.get("/status", async (_req: Request, res: Response) => {
  try {
    const status = await getLocalResumeStatus();
    if (!status.configured) {
      ok(res, {
        exists: false,
        error: "No resume uploaded. Upload a PDF resume in Settings.",
      });
      return;
    }
    ok(res, { exists: true, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    ok(res, { exists: false, error: message });
  }
});

/**
 * POST /api/profile/refresh - Clear profile cache and re-read the local resume
 */
profileRouter.post("/refresh", async (_req: Request, res: Response) => {
  try {
    clearProfileCache();
    const profile = await getProfile(true);
    ok(res, profile);
  } catch (error) {
    fail(res, toAppError(error));
  }
});
