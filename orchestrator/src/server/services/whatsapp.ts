import { logger } from "@infra/logger";
import * as settingsRepo from "@server/repositories/settings";

type WhatsAppConfig = {
  enabled: boolean;
  phone: string | null;
  apiKey: string | null;
};

export type WhatsAppEvent =
  | "pipeline.completed"
  | "pipeline.failed"
  | "linkedin.circuit_breaker_tripped";

function parseEnabled(value: string | null | undefined): boolean {
  return value === "1" || value === "true";
}

export async function getWhatsAppConfig(): Promise<WhatsAppConfig> {
  const [enabledOverride, phoneOverride, apiKeyOverride] = await Promise.all([
    settingsRepo.getSetting("whatsappEnabled"),
    settingsRepo.getSetting("whatsappPhone"),
    settingsRepo.getSetting("whatsappApiKey"),
  ]);

  return {
    enabled: parseEnabled(enabledOverride ?? process.env.WHATSAPP_ENABLED),
    phone: (phoneOverride ?? process.env.CALLMEBOT_PHONE ?? "").trim() || null,
    apiKey:
      (apiKeyOverride ?? process.env.CALLMEBOT_API_KEY ?? "").trim() || null,
  };
}

export function formatWhatsAppEvent(
  event: WhatsAppEvent,
  payload: Record<string, unknown>,
): string {
  if (event === "pipeline.completed") {
    return `Job Apply: scheduled search completed. ${payload.jobsDiscovered ?? 0} new jobs, ${payload.jobsProcessed ?? 0} prepared.`;
  }
  if (event === "pipeline.failed") {
    const error =
      typeof payload.error === "string" ? payload.error : "Unknown error";
    return `Job Apply: scheduled search failed. ${error.slice(0, 200)}`;
  }
  return `Job Apply: LinkedIn search paused by the safety circuit breaker until ${payload.cooldownUntil ?? "later"}.`;
}

export async function sendWhatsAppMessage(
  message: string,
  options: { force?: boolean } = {},
): Promise<{ sent: boolean; reason?: "disabled" | "not_configured" }> {
  const config = await getWhatsAppConfig();
  if (!config.enabled && !options.force) {
    return { sent: false, reason: "disabled" };
  }
  if (!config.phone || !config.apiKey) {
    return { sent: false, reason: "not_configured" };
  }

  const url = new URL("https://api.callmebot.com/whatsapp.php");
  url.searchParams.set("phone", config.phone);
  url.searchParams.set("text", message.slice(0, 1000));
  url.searchParams.set("apikey", config.apiKey);

  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text().catch(() => "");
  if (!response.ok || /\bERROR\b/i.test(body)) {
    logger.warn("WhatsApp notification provider rejected request", {
      provider: "callmebot",
      status: response.status,
    });
    throw new Error("WhatsApp provider rejected the notification");
  }

  return { sent: true };
}

export async function notifyWhatsAppEvent(
  event: WhatsAppEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await sendWhatsAppMessage(formatWhatsAppEvent(event, payload));
  } catch (error) {
    logger.warn("WhatsApp notification failed", {
      event,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
