import { SettingsInput } from "@client/pages/settings/components/SettingsInput";
import type { AgentValues } from "@client/pages/settings/types";
import type { UpdateSettingsInput } from "@shared/settings-schema";
import type React from "react";
import { Controller, useFormContext } from "react-hook-form";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";

type Props = {
  values: AgentValues;
  isLoading: boolean;
  isSaving: boolean;
};

const NUMBER_FIELDS: Array<{
  name:
    | "agentMaxRunsPerLocalDay"
    | "agentMaxSearchIterations"
    | "agentMaxSearchesPerRun"
    | "agentMaxLinkedinSearches"
    | "agentMaxAdzunaSearches"
    | "agentStopWhenNewBelow"
    | "agentMaxFitJudgments"
    | "agentFitPendingTtlDays"
    | "agentMaxInputTokensPerRun"
    | "agentMaxOutputTokensPerRun"
    | "agentMaxJdChars"
    | "agentRequestTimeoutMs";
  valueKey: keyof Omit<
    AgentValues,
    "model" | "discoveryEnabled" | "fitJudgeEnabled"
  >;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  {
    name: "agentMaxRunsPerLocalDay",
    valueKey: "maxRunsPerLocalDay",
    label: "Runs per local day (per agent)",
    min: 1,
    max: 5,
    step: 1,
  },
  {
    name: "agentMaxSearchIterations",
    valueKey: "maxSearchIterations",
    label: "Planner iterations",
    min: 1,
    max: 20,
    step: 1,
  },
  {
    name: "agentMaxSearchesPerRun",
    valueKey: "maxSearchesPerRun",
    label: "Searches per planner run",
    min: 1,
    max: 50,
    step: 1,
  },
  {
    name: "agentMaxLinkedinSearches",
    valueKey: "maxLinkedinSearches",
    label: "LinkedIn searches per run",
    min: 0,
    max: 10,
    step: 1,
  },
  {
    name: "agentMaxAdzunaSearches",
    valueKey: "maxAdzunaSearches",
    label: "Adzuna searches per run",
    min: 0,
    max: 20,
    step: 1,
  },
  {
    name: "agentStopWhenNewBelow",
    valueKey: "stopWhenNewBelow",
    label: "Low-yield stop threshold",
    min: 0,
    max: 100,
    step: 1,
  },
  {
    name: "agentMaxFitJudgments",
    valueKey: "maxFitJudgments",
    label: "Fit judgments per run",
    min: 1,
    max: 100,
    step: 1,
  },
  {
    name: "agentFitPendingTtlDays",
    valueKey: "fitPendingTtlDays",
    label: "Pending fit lifetime (days)",
    min: 1,
    max: 30,
    step: 1,
  },
  {
    name: "agentMaxInputTokensPerRun",
    valueKey: "maxInputTokensPerRun",
    label: "Input Token limit per run",
    min: 1000,
    max: 500000,
    step: 1000,
  },
  {
    name: "agentMaxOutputTokensPerRun",
    valueKey: "maxOutputTokensPerRun",
    label: "Output Token limit per run",
    min: 500,
    max: 100000,
    step: 500,
  },
  {
    name: "agentMaxJdChars",
    valueKey: "maxJdChars",
    label: "Maximum JD characters",
    min: 1000,
    max: 30000,
    step: 500,
  },
  {
    name: "agentRequestTimeoutMs",
    valueKey: "requestTimeoutMs",
    label: "LLM request timeout (ms)",
    min: 5000,
    max: 180000,
    step: 5000,
  },
];

export const AgentSettingsSection: React.FC<Props> = ({
  values,
  isLoading,
  isSaving,
}) => {
  const { control, register } = useFormContext<UpdateSettingsInput>();
  const disabled = isLoading || isSaving;

  return (
    <AccordionItem value="agents" className="border rounded-lg px-4">
      <AccordionTrigger className="hover:no-underline py-4">
        <span className="text-base font-semibold">Agentic Discovery</span>
      </AccordionTrigger>
      <AccordionContent className="space-y-5 pb-4">
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
          Both agents are off by default. They require a configured API key and
          a verified tool-calling model (currently DeepSeek V4 Flash,
          non-thinking). Local scoring and deterministic search continue when
          agents are unavailable.
        </div>

        <SettingsInput
          label="Agent model"
          inputProps={register("agentModel")}
          placeholder={values.model || "deepseek-v4-flash"}
          disabled={disabled}
          helper="Leave blank to inherit the scoring model."
          current={values.model}
        />

        {(
          [
            {
              name: "agenticDiscoveryEnabled" as const,
              label: "Enable Search Planner",
              description:
                "Lets the model choose bounded search queries. Existing country, city, source and cooldown rules still apply.",
              value: values.discoveryEnabled,
            },
            {
              name: "agenticFitJudgeEnabled" as const,
              label: "Enable Fit Judge",
              description:
                "Evaluates only newly imported, locally scored jobs. Historical jobs are not automatically queued.",
              value: values.fitJudgeEnabled,
            },
          ] as const
        ).map((item) => (
          <Controller
            key={item.name}
            name={item.name}
            control={control}
            render={({ field }) => (
              <div className="flex items-start justify-between gap-4 rounded-md border p-3">
                <div className="space-y-1">
                  <label htmlFor={item.name} className="text-sm font-medium">
                    {item.label}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {item.description}
                  </p>
                </div>
                <Switch
                  id={item.name}
                  checked={field.value ?? item.value.default}
                  onCheckedChange={field.onChange}
                  disabled={disabled}
                />
              </div>
            )}
          />
        ))}

        <div className="grid gap-4 md:grid-cols-2">
          {NUMBER_FIELDS.map((item) => {
            const value = values[item.valueKey];
            return (
              <Controller
                key={item.name}
                name={item.name}
                control={control}
                render={({ field }) => (
                  <SettingsInput
                    label={item.label}
                    type="number"
                    inputProps={{
                      ...field,
                      min: item.min,
                      max: item.max,
                      step: item.step,
                      value: field.value ?? value.default,
                      onChange: (event) => {
                        const parsed = Number.parseInt(event.target.value, 10);
                        field.onChange(Number.isNaN(parsed) ? null : parsed);
                      },
                    }}
                    disabled={disabled}
                    current={`Effective: ${value.effective} · Default: ${value.default}`}
                  />
                )}
              />
            );
          })}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
};
