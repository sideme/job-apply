import { readFile } from "node:fs/promises";
import { unauthorized } from "@infra/errors";
import { asyncRoute, ok } from "@infra/http";
import * as jobsRepo from "@server/repositories/jobs";
import { createApplicationFillPlan } from "@server/services/application-fill-plan";
import { resolveApplicationFillSession } from "@server/services/application-fill-session";
import {
  getLocalResumePdfPath,
  getLocalResumeStatus,
} from "@server/services/local-resume";
import { applicationQuestionSchema } from "@shared/types";
import { Router } from "express";
import { z } from "zod";

const fillRequestSchema = z.object({
  code: z.string().trim().min(20).max(200),
  questions: z.array(applicationQuestionSchema).min(1).max(100),
});

export const applicationAssistantRouter = Router();

applicationAssistantRouter.post(
  "/fill",
  asyncRoute(async (req, res) => {
    const input = fillRequestSchema.parse(req.body);
    const session = resolveApplicationFillSession(input.code);
    if (!session) {
      throw unauthorized("The auto-fill code is invalid or expired.");
    }

    const job = await jobsRepo.getJobById(session.jobId);
    if (!job) throw unauthorized("The auto-fill session is no longer valid.");

    const plan = createApplicationFillPlan(job.id, input.questions);
    const resumeStatus = await getLocalResumeStatus();
    const resume = resumeStatus.configured
      ? {
          filename: resumeStatus.filename,
          mimeType: "application/pdf" as const,
          contentBase64: (await readFile(getLocalResumePdfPath())).toString(
            "base64",
          ),
        }
      : null;

    ok(res, {
      job: { id: job.id, title: job.title, employer: job.employer },
      plan,
      resume,
      expiresAt: session.expiresAt,
    });
  }),
);
