import { describe, expect, it } from "vitest";
import { settingsRegistry } from "./settings-registry";

describe("settingsRegistry helpers", () => {
  describe("string parsing (parseNonEmptyStringOrNull)", () => {
    it("returns null for undefined", () => {
      expect(settingsRegistry.model.parse(undefined)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(settingsRegistry.searchCities.parse("")).toBeNull();
    });

    it("returns the string for non-empty string", () => {
      expect(settingsRegistry.searchCities.parse("London")).toBe("London");
    });
  });

  describe("number parsing and clamping", () => {
    it("returns null for empty/invalid values", () => {
      expect(settingsRegistry.adzunaMaxJobsPerTerm.parse("")).toBeNull();
      expect(settingsRegistry.adzunaMaxJobsPerTerm.parse("abc")).toBeNull();
      expect(settingsRegistry.adzunaMaxJobsPerTerm.parse(undefined)).toBeNull();
    });

    it("parses valid numbers", () => {
      expect(settingsRegistry.adzunaMaxJobsPerTerm.parse("42")).toBe(42);
    });

    it("clamps backupHour to 0-23", () => {
      expect(settingsRegistry.backupHour.parse("25")).toBe(23);
      expect(settingsRegistry.backupHour.parse("-1")).toBe(0);
      expect(settingsRegistry.backupHour.parse("12")).toBe(12);
    });

    it("clamps backupMaxCount to 1-5", () => {
      expect(settingsRegistry.backupMaxCount.parse("10")).toBe(5);
      expect(settingsRegistry.backupMaxCount.parse("0")).toBe(1);
      expect(settingsRegistry.backupMaxCount.parse("3")).toBe(3);
    });

    it("clamps missingSalaryPenalty to 0-100", () => {
      expect(settingsRegistry.missingSalaryPenalty.parse("150")).toBe(100);
      expect(settingsRegistry.missingSalaryPenalty.parse("-10")).toBe(0);
      expect(settingsRegistry.missingSalaryPenalty.parse("50")).toBe(50);
    });

    it("parses and clamps the semantic scoring weight", () => {
      expect(settingsRegistry.semanticScoreWeight.default()).toBe(0.7);
      expect(settingsRegistry.semanticScoreWeight.parse("0")).toBe(0);
      expect(settingsRegistry.semanticScoreWeight.parse("1.5")).toBe(1);
      expect(settingsRegistry.semanticScoreWeight.parse("-1")).toBe(0);
      expect(settingsRegistry.semanticScoreWeight.parse("invalid")).toBeNull();
    });

    it("clamps embedding usage limits", () => {
      expect(settingsRegistry.embeddingMaxJobsPerRun.default()).toBe(20);
      expect(settingsRegistry.embeddingMaxJobsPerRun.parse("500")).toBe(100);
      expect(settingsRegistry.embeddingMaxInputChars.default()).toBe(6000);
      expect(settingsRegistry.embeddingMaxInputChars.parse("500")).toBe(1000);
      expect(settingsRegistry.embeddingMaxInputChars.parse("50000")).toBe(
        20000,
      );
    });
  });

  describe("boolean (bit-bool) parsing and serialization", () => {
    it("supports enabling WhatsApp notifications", () => {
      expect(settingsRegistry.whatsappEnabled.parse("1")).toBe(true);
      expect(settingsRegistry.whatsappEnabled.serialize(false)).toBe("0");
    });

    it("keeps embedding opt-in", () => {
      expect(settingsRegistry.embeddingEnabled.default()).toBe(false);
      expect(settingsRegistry.embeddingEnabled.parse("1")).toBe(true);
      expect(settingsRegistry.embeddingEnabled.serialize(false)).toBe("0");
    });
  });

  describe("JSON array parsing", () => {
    it("parses valid JSON arrays", () => {
      expect(settingsRegistry.searchTerms.parse('["dev", "engineer"]')).toEqual(
        ["dev", "engineer"],
      );
    });

    it("returns null for invalid JSON or non-arrays", () => {
      expect(settingsRegistry.searchTerms.parse('{"not": "array"}')).toBeNull();
      expect(settingsRegistry.searchTerms.parse("invalid json")).toBeNull();
      expect(settingsRegistry.searchTerms.parse("")).toBeNull();
      expect(settingsRegistry.searchTerms.parse(undefined)).toBeNull();
    });

    it("serializes arrays back to JSON", () => {
      expect(settingsRegistry.searchTerms.serialize(["dev", "engineer"])).toBe(
        '["dev","engineer"]',
      );
      expect(settingsRegistry.searchTerms.serialize(null)).toBeNull();
    });
  });

  describe("Resume projects settings", () => {
    it("parses and serializes resume projects", () => {
      const obj = {
        maxProjects: 10,
        lockedProjectIds: ["1", "2"],
        aiSelectableProjectIds: ["3"],
      };
      const json = JSON.stringify(obj);

      expect(settingsRegistry.resumeProjects.parse(json)).toEqual(obj);
      expect(settingsRegistry.resumeProjects.parse("invalid")).toBeNull();

      expect(settingsRegistry.resumeProjects.serialize(obj)).toBe(json);
      expect(settingsRegistry.resumeProjects.serialize(null)).toBeNull();
    });
  });

  describe("company model rules", () => {
    it("parses and serializes company-specific model choices", () => {
      const rules = [
        {
          company: "shopify",
          modelScorer: "deepseek-chat",
          modelTailoring: "",
          modelProjectSelection: "",
        },
      ];

      expect(
        settingsRegistry.companyModelRules.parse(JSON.stringify(rules)),
      ).toEqual(rules);
      expect(settingsRegistry.companyModelRules.parse("[]")).toEqual([]);
      expect(settingsRegistry.companyModelRules.parse("invalid")).toBeNull();
      expect(settingsRegistry.companyModelRules.serialize(rules)).toBe(
        JSON.stringify(rules),
      );
    });
  });

  describe("writing-style language settings", () => {
    it("defaults to manual english", () => {
      const previousLanguageMode = process.env.CHAT_STYLE_LANGUAGE_MODE;
      const previousManualLanguage = process.env.CHAT_STYLE_MANUAL_LANGUAGE;

      delete process.env.CHAT_STYLE_LANGUAGE_MODE;
      delete process.env.CHAT_STYLE_MANUAL_LANGUAGE;

      try {
        expect(settingsRegistry.chatStyleLanguageMode.default()).toBe("manual");
        expect(settingsRegistry.chatStyleManualLanguage.default()).toBe(
          "english",
        );
      } finally {
        if (previousLanguageMode === undefined) {
          delete process.env.CHAT_STYLE_LANGUAGE_MODE;
        } else {
          process.env.CHAT_STYLE_LANGUAGE_MODE = previousLanguageMode;
        }

        if (previousManualLanguage === undefined) {
          delete process.env.CHAT_STYLE_MANUAL_LANGUAGE;
        } else {
          process.env.CHAT_STYLE_MANUAL_LANGUAGE = previousManualLanguage;
        }
      }
    });

    it("parses and serializes supported language settings", () => {
      expect(settingsRegistry.chatStyleLanguageMode.parse("manual")).toBe(
        "manual",
      );
      expect(settingsRegistry.chatStyleLanguageMode.parse("match-resume")).toBe(
        "match-resume",
      );
      expect(settingsRegistry.chatStyleLanguageMode.parse("auto")).toBeNull();
      expect(settingsRegistry.chatStyleLanguageMode.parse("")).toBeNull();
      expect(
        settingsRegistry.chatStyleLanguageMode.serialize("match-resume"),
      ).toBe("match-resume");
      expect(settingsRegistry.chatStyleLanguageMode.serialize(null)).toBeNull();

      expect(settingsRegistry.chatStyleManualLanguage.parse("english")).toBe(
        "english",
      );
      expect(settingsRegistry.chatStyleManualLanguage.parse("german")).toBe(
        "german",
      );
      expect(
        settingsRegistry.chatStyleManualLanguage.parse("italian"),
      ).toBeNull();
      expect(settingsRegistry.chatStyleManualLanguage.parse("")).toBeNull();
      expect(
        settingsRegistry.chatStyleManualLanguage.serialize("spanish"),
      ).toBe("spanish");
      expect(
        settingsRegistry.chatStyleManualLanguage.serialize(null),
      ).toBeNull();
    });
  });

  describe("LLM provider parsing", () => {
    it("normalizes the documented openai-compatible alias", () => {
      expect(settingsRegistry.llmProvider.parse("openai-compatible")).toBe(
        "openai_compatible",
      );
      expect(settingsRegistry.llmProvider.parse("OPENAI-COMPATIBLE")).toBe(
        "openai_compatible",
      );
    });

    it("accepts DeepSeek and Qwen provider identifiers", () => {
      expect(settingsRegistry.llmProvider.parse("deepseek")).toBe("deepseek");
      expect(settingsRegistry.llmProvider.parse("qwen")).toBe("qwen");
    });
  });

  describe("settingsRegistry.linkedinCooldownUntil", () => {
    it("defaults to an empty string", () => {
      expect(settingsRegistry.linkedinCooldownUntil.default()).toBe("");
    });

    it("parses a non-empty ISO string and rejects empty/undefined", () => {
      const iso = "2026-08-07T12:00:00.000Z";
      expect(settingsRegistry.linkedinCooldownUntil.parse(iso)).toBe(iso);
      expect(settingsRegistry.linkedinCooldownUntil.parse("")).toBeNull();
      expect(
        settingsRegistry.linkedinCooldownUntil.parse(undefined),
      ).toBeNull();
    });

    it("serializes a value back to itself, and null/undefined to null", () => {
      expect(
        settingsRegistry.linkedinCooldownUntil.serialize(
          "2026-08-07T12:00:00.000Z",
        ),
      ).toBe("2026-08-07T12:00:00.000Z");
      expect(settingsRegistry.linkedinCooldownUntil.serialize(null)).toBeNull();
      expect(
        settingsRegistry.linkedinCooldownUntil.serialize(undefined),
      ).toBeNull();
    });
  });
});
