import {
  AppError,
  badRequest,
  unprocessableEntity,
  upstreamError,
} from "@infra/errors";
import { asyncRoute, ok } from "@infra/http";
import { isDemoMode, sendDemoBlocked } from "@server/config/demo";
import { setBackupSettings } from "@server/services/backup/index";
import {
  getLocalResumeStatus,
  saveLocalResumePdf,
} from "@server/services/local-resume";
import { getEffectiveSettings } from "@server/services/settings";
import { applySettingsUpdates } from "@server/services/settings-update";
import { sendWhatsAppMessage } from "@server/services/whatsapp";
import { updateSettingsSchema } from "@shared/settings-schema";
import { type Request, type Response, Router } from "express";

export const settingsRouter = Router();

settingsRouter.get(
  "/local-resume",
  asyncRoute(async (_req: Request, res: Response) => {
    ok(res, await getLocalResumeStatus());
  }),
);

settingsRouter.post(
  "/local-resume",
  asyncRoute(async (req: Request, res: Response) => {
    if (!Buffer.isBuffer(req.body)) {
      throw badRequest("Upload a PDF file with Content-Type application/pdf.");
    }

    try {
      ok(res, await saveLocalResumePdf(req.body));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid PDF";
      throw unprocessableEntity(message);
    }
  }),
);

settingsRouter.post(
  "/whatsapp/test",
  asyncRoute(async (_req: Request, res: Response) => {
    if (isDemoMode()) {
      return sendDemoBlocked(
        res,
        "Sending test notifications is disabled in the public demo.",
        {
          route: "POST /api/settings/whatsapp/test",
        },
      );
    }

    try {
      const result = await sendWhatsAppMessage(
        "Job Apply: WhatsApp notifications are configured correctly.",
        { force: true },
      );
      if (!result.sent) {
        throw unprocessableEntity(
          "Add your WhatsApp phone number and CallMeBot API key before sending a test.",
        );
      }
      ok(res, { sent: true });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw upstreamError("Could not deliver the WhatsApp test notification.");
    }
  }),
);

/**
 * GET /api/settings - Get app settings (effective + defaults)
 */
settingsRouter.get(
  "/",
  asyncRoute(async (_req: Request, res: Response) => {
    const data = await getEffectiveSettings();
    ok(res, data);
  }),
);

/**
 * PATCH /api/settings - Update settings overrides
 */
settingsRouter.patch(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    if (isDemoMode()) {
      return sendDemoBlocked(
        res,
        "Saving settings is disabled in the public demo.",
        { route: "PATCH /api/settings" },
      );
    }

    const input = updateSettingsSchema.parse(req.body);
    const plan = await applySettingsUpdates(input);

    const data = await getEffectiveSettings();

    if (plan.shouldRefreshBackupScheduler) {
      setBackupSettings({
        enabled: data.backupEnabled.value,
        hour: data.backupHour.value,
        maxCount: data.backupMaxCount.value,
      });
    }
    ok(res, data);
  }),
);
