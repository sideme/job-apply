import { logger } from "@infra/logger";
import * as settingsRepo from "@server/repositories/settings";
import { settingsRegistry } from "@shared/settings-registry";
import type { AppSettings } from "@shared/types";
import { getEnvSettingsData } from "./envSettings";
import { getProfile } from "./profile";
import {
  extractProjectsFromProfile,
  resolveResumeProjectsSettings,
} from "./resumeProjects";

function resolveDefaultLlmBaseUrl(provider: string): string {
  const normalized = provider.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "ollama") return "http://localhost:11434";
  if (normalized === "lmstudio") return "http://localhost:1234";
  if (normalized === "openai") {
    return "https://api.openai.com";
  }
  if (normalized === "openai_compatible") {
    return "https://api.openai.com";
  }
  if (normalized === "gemini") {
    return "https://generativelanguage.googleapis.com";
  }
  if (normalized === "deepseek") return "https://api.deepseek.com";
  if (normalized === "qwen") {
    return "https://dashscope.aliyuncs.com/compatible-mode/v1";
  }
  return "https://openrouter.ai";
}

/**
 * Get the effective app settings, combining environment variables and database overrides.
 */
export async function getEffectiveSettings(): Promise<AppSettings> {
  const overrides = await settingsRepo.getAllSettings();

  const profile: Record<string, unknown> = await getProfile().catch((error) => {
    logger.warn("Failed to load resume profile for settings", { error });
    return {};
  });

  const envSettings = await getEnvSettingsData(overrides);

  const result: Partial<AppSettings> = {
    ...envSettings,
  };

  const rawModel = overrides.model;
  const modelDef = settingsRegistry.model;
  const overrideModel = modelDef.parse(rawModel);
  const modelValue = overrideModel ?? modelDef.default();

  for (const [key, def] of Object.entries(settingsRegistry)) {
    if (def.kind === "typed") {
      let rawOverride = overrides[key as settingsRepo.SettingKey];
      if (key === "searchCities" && !rawOverride) {
        rawOverride = overrides.jobspyLocation; // legacy fallback
      }

      const override = def.parse(rawOverride);
      let defaultValue = def.default();

      if (key === "llmBaseUrl") {
        const providerOverride = settingsRegistry.llmProvider.parse(
          overrides.llmProvider,
        );
        const provider =
          providerOverride ?? settingsRegistry.llmProvider.default();
        defaultValue =
          process.env.LLM_BASE_URL || resolveDefaultLlmBaseUrl(provider);
      }

      if (key === "resumeProjects") {
        let catalog: AppSettings["profileProjects"] = [];
        if (Object.keys(profile).length > 0) {
          try {
            catalog = extractProjectsFromProfile(
              profile as Parameters<typeof extractProjectsFromProfile>[0],
            ).catalog;
          } catch (error) {
            logger.warn("Failed to extract projects from resume", { error });
          }
        }
        const resolved = resolveResumeProjectsSettings({
          catalog,
          overrideRaw: rawOverride ?? null,
        });
        result.profileProjects = resolved.profileProjects;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // biome-ignore lint/suspicious/noExplicitAny: dynamic assignment for settings building
        (result as any).resumeProjects = {
          value: resolved.resumeProjects,
          default: resolved.defaultResumeProjects,
          override: resolved.overrideResumeProjects,
        };
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // biome-ignore lint/suspicious/noExplicitAny: dynamic assignment for settings building
      (result as any)[key] = {
        value: override ?? defaultValue,
        default: defaultValue,
        override,
      };
    } else if (def.kind === "model") {
      const override = overrides[key as settingsRepo.SettingKey] ?? null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // biome-ignore lint/suspicious/noExplicitAny: dynamic assignment for settings building
      (result as any)[key] = { value: override || modelValue, override };
    } else if (def.kind === "string") {
      if (!("envKey" in def) || !def.envKey) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // biome-ignore lint/suspicious/noExplicitAny: dynamic assignment for settings building
        (result as any)[key] =
          overrides[key as settingsRepo.SettingKey] ?? null;
      }
    }
  }

  return result as AppSettings;
}
