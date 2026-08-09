import { logger } from "@infra/logger";
import * as settingsRepo from "@server/repositories/settings";

/** How long LinkedIn discovery is skipped after a suspected block/rate-limit. */
export const LINKEDIN_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Whether LinkedIn discovery should currently be skipped, given the raw
 * `linkedinCooldownUntil` setting value (an ISO timestamp string, or
 * empty/undefined when not cooling down).
 */
export function isLinkedInInCooldown(
  cooldownUntilRaw: string | undefined,
): boolean {
  if (!cooldownUntilRaw) return false;
  const cooldownUntil = new Date(cooldownUntilRaw).getTime();
  if (Number.isNaN(cooldownUntil)) return false;
  return cooldownUntil > Date.now();
}

/**
 * Record a LinkedIn discovery failure: (re)sets the cooldown window and
 * reports whether this is a *new* trip (breaker was not already open),
 * so callers only fire a notification once per trip rather than on every
 * run during an active cooldown.
 */
export async function recordLinkedInFailure(): Promise<{
  isNewTrip: boolean;
  cooldownUntil: string;
}> {
  const existing = await settingsRepo.getSetting("linkedinCooldownUntil");
  const wasAlreadyInCooldown = isLinkedInInCooldown(existing ?? undefined);
  const cooldownUntil = new Date(
    Date.now() + LINKEDIN_COOLDOWN_MS,
  ).toISOString();

  await settingsRepo.setSetting("linkedinCooldownUntil", cooldownUntil);

  logger.warn("LinkedIn circuit breaker tripped", {
    cooldownUntil,
    wasAlreadyInCooldown,
  });

  return { isNewTrip: !wasAlreadyInCooldown, cooldownUntil };
}
