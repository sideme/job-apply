import { describe, expect, it } from "vitest";
import {
  parseCompanyModelRules,
  resolveCompanyModel,
} from "./company-model-rules";

const rules = [
  {
    company: "shopify",
    modelScorer: "deepseek-chat",
    modelTailoring: "qwen-plus",
    modelProjectSelection: "",
  },
];

describe("company model rules", () => {
  it("parses valid stored rules and rejects malformed data", () => {
    expect(parseCompanyModelRules(JSON.stringify(rules))).toEqual(rules);
    expect(parseCompanyModelRules('{"company":"shopify"}')).toBeNull();
  });

  it("uses the first matching company task model", () => {
    expect(
      resolveCompanyModel({
        companyName: "Shopify Inc.",
        task: "scoring",
        rules,
        fallbackModel: "default-model",
      }),
    ).toEqual({ model: "deepseek-chat", matchedCompany: "shopify" });
  });

  it("matches a company rule against the application domain", () => {
    expect(
      resolveCompanyModel({
        companyName: "Unrelated employer name",
        companyDomain: "https://jobs.shopify.com/careers/123",
        task: "tailoring",
        rules,
        fallbackModel: "default-model",
      }),
    ).toEqual({ model: "qwen-plus", matchedCompany: "shopify" });
  });

  it("falls back when a matched company has no model for the task", () => {
    expect(
      resolveCompanyModel({
        companyName: "shopify.com",
        task: "projectSelection",
        rules,
        fallbackModel: "default-model",
      }),
    ).toEqual({ model: "default-model", matchedCompany: null });
  });
});
