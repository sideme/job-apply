import { z } from "zod";

export const COMPANY_MODEL_TASKS = [
  "scoring",
  "tailoring",
  "projectSelection",
] as const;

export type CompanyModelTask = (typeof COMPANY_MODEL_TASKS)[number];

export const companyModelRuleSchema = z
  .object({
    company: z.string().trim().min(1).max(160),
    modelScorer: z.string().trim().max(200).optional().default(""),
    modelTailoring: z.string().trim().max(200).optional().default(""),
    modelProjectSelection: z.string().trim().max(200).optional().default(""),
  })
  .refine(
    (rule) =>
      Boolean(
        rule.modelScorer || rule.modelTailoring || rule.modelProjectSelection,
      ),
    { message: "Choose at least one task model for this company rule." },
  );

export const companyModelRulesSchema = z.array(companyModelRuleSchema).max(50);

export type CompanyModelRule = z.infer<typeof companyModelRuleSchema>;

export function parseCompanyModelRules(
  raw: string | undefined,
): CompanyModelRule[] | null {
  if (!raw) return null;
  try {
    return companyModelRulesSchema.safeParse(JSON.parse(raw)).data ?? null;
  } catch {
    return null;
  }
}

export function resolveCompanyModel(input: {
  companyName: string | null | undefined;
  companyDomain?: string | null | undefined;
  task: CompanyModelTask;
  rules: CompanyModelRule[];
  fallbackModel: string;
}): { model: string; matchedCompany: string | null } {
  const normalizedTarget = [input.companyName, input.companyDomain]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .toLocaleLowerCase();
  if (!normalizedTarget) {
    return { model: input.fallbackModel, matchedCompany: null };
  }

  for (const rule of input.rules) {
    const match = rule.company.trim().toLocaleLowerCase();
    if (!match || !normalizedTarget.includes(match)) continue;

    const model =
      input.task === "scoring"
        ? rule.modelScorer
        : input.task === "tailoring"
          ? rule.modelTailoring
          : rule.modelProjectSelection;
    if (model) return { model, matchedCompany: rule.company };
  }

  return { model: input.fallbackModel, matchedCompany: null };
}
