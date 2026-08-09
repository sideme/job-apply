import { logger } from "@infra/logger";
import { sanitizeWebhookPayload } from "@infra/sanitize";
import * as settingsRepo from "@server/repositories/settings";
import { notifyWhatsAppEvent } from "@server/services/whatsapp";

export async function notifyPipelineWebhookStep(
  event:
    | "pipeline.completed"
    | "pipeline.failed"
    | "linkedin.circuit_breaker_tripped",
  payload: Record<string, unknown>,
): Promise<void> {
  const overridePipelineWebhookUrl =
    await settingsRepo.getSetting("pipelineWebhookUrl");
  const pipelineWebhookUrl = (
    overridePipelineWebhookUrl ||
    process.env.PIPELINE_WEBHOOK_URL ||
    process.env.WEBHOOK_URL ||
    ""
  ).trim();

  if (pipelineWebhookUrl) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const secret =
        (await settingsRepo.getSetting("webhookSecret")) ||
        process.env.WEBHOOK_SECRET;
      if (secret) headers.Authorization = `Bearer ${secret}`;

      const sanitizedPayload = sanitizeWebhookPayload({
        event,
        sentAt: new Date().toISOString(),
        pipelineRunId: payload.pipelineRunId,
        jobsDiscovered: payload.jobsDiscovered,
        jobsScored: payload.jobsScored,
        jobsProcessed: payload.jobsProcessed,
        error: payload.error,
        cooldownUntil: payload.cooldownUntil,
      });

      const response = await fetch(pipelineWebhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(sanitizedPayload),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        logger.warn("Pipeline webhook POST failed", {
          status: response.status,
        });
      }
    } catch (error) {
      logger.warn("Pipeline webhook POST failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  await notifyWhatsAppEvent(event, payload);
}
