import { asyncRoute, ok } from "@infra/http";
import * as agentRunsRepo from "@server/repositories/agent-runs";
import { Router } from "express";
import { z } from "zod";

const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const agentRunsRouter = Router();

agentRunsRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const page = pageSchema.parse(req.query);
    const result = await agentRunsRepo.listAgentRuns(page.limit, page.offset);
    ok(res, { ...result, ...page });
  }),
);

agentRunsRouter.get(
  "/:id/steps",
  asyncRoute(async (req, res) => {
    const page = pageSchema.parse(req.query);
    const steps = await agentRunsRepo.listAgentRunSteps(
      req.params.id,
      page.limit,
      page.offset,
    );
    ok(res, { steps, ...page });
  }),
);
