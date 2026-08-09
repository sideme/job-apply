/**
 * Express server entry point.
 */

import "./config/env";
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import { createApp } from "./app";
import { initializeExtractorRegistry } from "./extractors/registry";
import * as pipelineRepo from "./repositories/pipeline";
import * as settingsRepo from "./repositories/settings";
import {
  getBackupSettings,
  setBackupSettings,
  startBackupScheduler,
} from "./services/backup/index";
import { initializeDemoModeServices } from "./services/demo-mode";
import { applyStoredEnvOverrides } from "./services/envSettings";

async function startServer() {
  await applyStoredEnvOverrides();
  const staleAfterMinutes = Math.max(
    5,
    Number.parseInt(process.env.PIPELINE_STALE_AFTER_MINUTES || "30", 10) || 30,
  );
  const recoveredRuns = await pipelineRepo.failStalePipelineRuns(
    new Date(Date.now() - staleAfterMinutes * 60_000).toISOString(),
  );
  if (recoveredRuns > 0) {
    logger.warn("Recovered interrupted pipeline runs", {
      recoveredRuns,
      staleAfterMinutes,
    });
  }
  try {
    await initializeExtractorRegistry();
  } catch (error) {
    const sanitizedError = sanitizeUnknown(error);
    logger.error("Failed to initialize extractor registry", {
      error: sanitizedError,
    });
    if (process.env.NODE_ENV === "production") {
      logger.error(
        "Extractor registry initialization failed in production. Shutting down server.",
      );
      process.exit(1);
    }

    logger.error(
      "Extractor registry initialization failed outside production. Server startup aborted.",
    );
    return;
  }

  const app = createApp();
  const PORT = process.env.PORT || 3001;

  // Start server
  app.listen(PORT, async () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 Job Ops Orchestrator                                 ║
║                                                           ║
║   Server running at: http://localhost:${PORT}               ║
║                                                           ║
║   API:     http://localhost:${PORT}/api                     ║
║   Health:  http://localhost:${PORT}/health                  ║
║   PDFs:    http://localhost:${PORT}/pdfs                    ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);

    // Initialize backup service (load settings and start scheduler if enabled)
    try {
      const backupEnabled = await settingsRepo.getSetting("backupEnabled");
      const backupHour = await settingsRepo.getSetting("backupHour");
      const backupMaxCount = await settingsRepo.getSetting("backupMaxCount");

      const parsedHour = backupHour ? parseInt(backupHour, 10) : NaN;
      const parsedMaxCount = backupMaxCount
        ? parseInt(backupMaxCount, 10)
        : NaN;
      const safeHour = Number.isNaN(parsedHour)
        ? 2
        : Math.min(23, Math.max(0, parsedHour));
      const safeMaxCount = Number.isNaN(parsedMaxCount)
        ? 5
        : Math.min(5, Math.max(1, parsedMaxCount));

      setBackupSettings({
        enabled: backupEnabled === "true" || backupEnabled === "1",
        hour: safeHour,
        maxCount: safeMaxCount,
      });

      startBackupScheduler();

      const settings = getBackupSettings();
      if (settings.enabled) {
        console.log(
          `✅ Backup scheduler started (hour: ${settings.hour}, max: ${settings.maxCount})`,
        );
      } else {
        console.log(
          "ℹ️ Backups disabled. Enable in settings to schedule automatic backups.",
        );
      }
    } catch (error) {
      logger.warn("Failed to initialize backup service", {
        error: sanitizeUnknown(error),
      });
    }

    try {
      await initializeDemoModeServices();
    } catch (error) {
      logger.warn("Failed to initialize demo mode services", {
        error: sanitizeUnknown(error),
      });
    }
  });
}

void startServer();
