import { SettingsInput } from "@client/pages/settings/components/SettingsInput";
import type { ModelValues } from "@client/pages/settings/types";
import {
  EMBEDDING_PROVIDER_DEFAULTS,
  EMBEDDING_PROVIDER_LABELS,
  EMBEDDING_PROVIDERS,
  formatSecretHint,
  getLlmProviderConfig,
  LLM_PROVIDER_LABELS,
  LLM_PROVIDERS,
} from "@client/pages/settings/utils";
import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import { Plus, Trash2 } from "lucide-react";
import type React from "react";
import { useEffect } from "react";
import { Controller, useFieldArray, useFormContext } from "react-hook-form";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

type ModelSettingsSectionProps = {
  values: ModelValues;
  isLoading: boolean;
  isSaving: boolean;
};

export const ModelSettingsSection: React.FC<ModelSettingsSectionProps> = ({
  values,
  isLoading,
  isSaving,
}) => {
  const {
    effective,
    default: defaultModel,
    scorer,
    tailoring,
    projectSelection,
    llmProvider,
    llmBaseUrl,
    llmApiKeyHint,
    embeddingProvider,
    embeddingBaseUrl,
    embeddingEnabled,
    embeddingMaxJobsPerRun,
    embeddingMaxInputChars,
    embeddingModel,
    embeddingApiKeyHint,
    companyModelRules,
  } = values;
  const {
    register,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<UpdateSettingsInput>();

  const selectedProvider = watch("llmProvider") || llmProvider || "openrouter";
  const providerConfig = getLlmProviderConfig(selectedProvider);
  const { showApiKey, showBaseUrl } = providerConfig;

  const llmBaseUrlValue = watch("llmBaseUrl");
  const {
    fields: companyRuleFields,
    append,
    remove,
  } = useFieldArray({
    control,
    name: "companyModelRules",
  });

  useEffect(() => {
    if (showBaseUrl) return;
    if (llmBaseUrlValue) {
      setValue("llmBaseUrl", "", { shouldDirty: true });
    }
  }, [setValue, showBaseUrl, llmBaseUrlValue]);

  const keyHint = formatSecretHint(llmApiKeyHint);
  const keyText = showApiKey ? keyHint || "Not set" : "Not required";
  const effectiveDefaultModel = effective || defaultModel || "—";
  const scoringModel = scorer || effectiveDefaultModel;
  const tailoringModel = tailoring || effectiveDefaultModel;
  const projectSelectionModel = projectSelection || effectiveDefaultModel;
  const modelPlaceholder =
    selectedProvider === "deepseek"
      ? "deepseek-v4-flash"
      : selectedProvider === "qwen"
        ? "qwen-plus"
        : defaultModel || "google/gemini-3-flash-preview";
  return (
    <AccordionItem value="model" className="border rounded-lg px-4">
      <AccordionTrigger className="hover:no-underline py-4">
        <span className="text-base font-semibold">Model</span>
      </AccordionTrigger>
      <AccordionContent className="pb-4">
        <div className="space-y-4">
          <div className="space-y-4">
            <div className="text-sm font-medium">LLM Provider</div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="llmProvider" className="text-sm font-medium">
                  Provider
                </label>
                <Controller
                  name="llmProvider"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={field.value ?? ""}
                      onValueChange={(value) => field.onChange(value)}
                      disabled={isLoading || isSaving}
                    >
                      <SelectTrigger id="llmProvider">
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {LLM_PROVIDERS.map((provider) => (
                          <SelectItem key={provider} value={provider}>
                            {LLM_PROVIDER_LABELS[provider]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.llmProvider?.message && (
                  <p className="text-xs text-destructive">
                    {errors.llmProvider.message as string}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Used for scoring, tailoring, and extraction.
                </p>
                <p className="text-xs text-muted-foreground">
                  {providerConfig.providerHint}
                </p>
              </div>
              {showBaseUrl && (
                <SettingsInput
                  label="LLM base URL"
                  inputProps={register("llmBaseUrl")}
                  placeholder={providerConfig.baseUrlPlaceholder}
                  disabled={isLoading || isSaving}
                  error={errors.llmBaseUrl?.message as string | undefined}
                  helper={providerConfig.baseUrlHelper}
                  current={llmBaseUrl || "—"}
                />
              )}
              {showApiKey && (
                <SettingsInput
                  label="LLM API key"
                  inputProps={register("llmApiKey")}
                  type="password"
                  placeholder="Enter new key"
                  disabled={isLoading || isSaving}
                  error={errors.llmApiKey?.message as string | undefined}
                  current={keyHint}
                />
              )}
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Embedding Scoring</div>
                <p className="text-xs text-muted-foreground">
                  Off by default. Keyword scoring remains available without API
                  usage.
                </p>
              </div>
              <Controller
                name="embeddingEnabled"
                control={control}
                render={({ field }) => (
                  <Switch
                    id="embeddingEnabled"
                    checked={field.value ?? embeddingEnabled.default}
                    onCheckedChange={field.onChange}
                    disabled={isLoading || isSaving}
                    aria-label="Enable embedding scoring"
                  />
                )}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Uses only the dedicated embedding provider and key below. It never
              inherits the chat-model API key.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label
                  htmlFor="embeddingProvider"
                  className="text-sm font-medium"
                >
                  Embedding provider
                </label>
                <Controller
                  name="embeddingProvider"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={field.value ?? ""}
                      onValueChange={(value) => {
                        field.onChange(value);
                        const preset = EMBEDDING_PROVIDER_DEFAULTS[value];
                        if (preset) {
                          setValue("embeddingBaseUrl", preset.baseUrl, {
                            shouldDirty: true,
                          });
                          setValue("embeddingModel", preset.model, {
                            shouldDirty: true,
                          });
                        }
                      }}
                      disabled={isLoading || isSaving}
                    >
                      <SelectTrigger id="embeddingProvider">
                        <SelectValue placeholder="Select embedding provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {EMBEDDING_PROVIDERS.map((provider) => (
                          <SelectItem key={provider} value={provider}>
                            {EMBEDDING_PROVIDER_LABELS[provider]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  {embeddingProvider
                    ? `Current: ${embeddingProvider}`
                    : "Select OpenAI, Qwen, or another compatible embedding provider."}
                </p>
              </div>
              <SettingsInput
                label="Embedding model"
                inputProps={register("embeddingModel")}
                placeholder={embeddingModel.default}
                disabled={isLoading || isSaving}
                current={embeddingModel.effective}
              />
              <SettingsInput
                label="Embedding base URL"
                inputProps={register("embeddingBaseUrl")}
                placeholder="https://api.openai.com/v1"
                disabled={isLoading || isSaving}
                current={embeddingBaseUrl || "Not set"}
              />
              <SettingsInput
                label="Embedding API key"
                type="password"
                inputProps={register("embeddingApiKey")}
                placeholder="Enter new key"
                disabled={isLoading || isSaving}
                current={formatSecretHint(embeddingApiKeyHint) || "Not set"}
              />
              <Controller
                name="embeddingMaxJobsPerRun"
                control={control}
                render={({ field }) => (
                  <SettingsInput
                    label="Maximum jobs per automatic run"
                    type="number"
                    inputProps={{
                      ...field,
                      min: 1,
                      max: 100,
                      step: 1,
                      value: field.value ?? embeddingMaxJobsPerRun.default,
                      onChange: (event) =>
                        field.onChange(Number.parseInt(event.target.value, 10)),
                    }}
                    disabled={isLoading || isSaving}
                    helper="Only uncached API requests count. Additional uncached jobs use keyword-only scoring for that run."
                    current={`Effective: ${embeddingMaxJobsPerRun.effective}`}
                  />
                )}
              />
              <Controller
                name="embeddingMaxInputChars"
                control={control}
                render={({ field }) => (
                  <SettingsInput
                    label="Maximum characters per embedding"
                    type="number"
                    inputProps={{
                      ...field,
                      min: 1000,
                      max: 20000,
                      step: 500,
                      value: field.value ?? embeddingMaxInputChars.default,
                      onChange: (event) =>
                        field.onChange(Number.parseInt(event.target.value, 10)),
                    }}
                    disabled={isLoading || isSaving}
                    helper="Text beyond this limit is not sent to the provider."
                    current={`Effective: ${embeddingMaxInputChars.effective}`}
                  />
                )}
              />
            </div>
          </div>

          <Separator />

          <SettingsInput
            label="Default model"
            inputProps={register("model")}
            placeholder={modelPlaceholder}
            disabled={isLoading || isSaving}
            error={errors.model?.message as string | undefined}
            helper="Leave blank to use the default from server env (`MODEL`)."
            current={effectiveDefaultModel}
          />

          <Separator />

          <div className="space-y-4">
            <div className="text-sm font-medium">Task-Specific Overrides</div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <SettingsInput
                label="Scoring Model"
                inputProps={register("modelScorer")}
                placeholder={effective || "inherit"}
                disabled={isLoading || isSaving}
                error={errors.modelScorer?.message as string | undefined}
                current={scoringModel}
              />

              <SettingsInput
                label="Tailoring Model"
                inputProps={register("modelTailoring")}
                placeholder={effective || "inherit"}
                disabled={isLoading || isSaving}
                error={errors.modelTailoring?.message as string | undefined}
                current={tailoringModel}
              />

              <SettingsInput
                label="Project Selection Model"
                inputProps={register("modelProjectSelection")}
                placeholder={effective || "inherit"}
                disabled={isLoading || isSaving}
                error={
                  errors.modelProjectSelection?.message as string | undefined
                }
                current={projectSelectionModel}
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Company Model Rules</div>
                <p className="text-xs text-muted-foreground">
                  First matching company or domain uses its task model. All
                  rules reuse the provider, base URL, and API key above.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  isLoading || isSaving || companyRuleFields.length >= 50
                }
                onClick={() =>
                  append({
                    company: "",
                    modelScorer: "",
                    modelTailoring: "",
                    modelProjectSelection: "",
                  })
                }
              >
                <Plus className="h-4 w-4" />
                Add rule
              </Button>
            </div>

            {companyRuleFields.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                No company rules. The task-specific and default models above
                apply to every company.
              </p>
            ) : (
              <div className="space-y-3">
                {companyRuleFields.map((field, index) => (
                  <div
                    key={field.id}
                    className="grid gap-3 rounded-md border border-border/60 p-3 md:grid-cols-2 xl:grid-cols-[1.1fr_1fr_1fr_1fr_auto]"
                  >
                    <SettingsInput
                      label="Company or domain contains"
                      inputProps={register(
                        `companyModelRules.${index}.company`,
                      )}
                      placeholder="Shopify or shopify.com"
                      disabled={isLoading || isSaving}
                      error={
                        errors.companyModelRules?.[index]?.company?.message as
                          | string
                          | undefined
                      }
                    />
                    <SettingsInput
                      label="Scoring model"
                      inputProps={register(
                        `companyModelRules.${index}.modelScorer`,
                      )}
                      placeholder="inherit"
                      disabled={isLoading || isSaving}
                    />
                    <SettingsInput
                      label="Tailoring model"
                      inputProps={register(
                        `companyModelRules.${index}.modelTailoring`,
                      )}
                      placeholder="inherit"
                      disabled={isLoading || isSaving}
                    />
                    <SettingsInput
                      label="Project model"
                      inputProps={register(
                        `companyModelRules.${index}.modelProjectSelection`,
                      )}
                      placeholder="inherit"
                      disabled={isLoading || isSaving}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="self-end"
                      aria-label={`Remove company rule ${index + 1}`}
                      disabled={isLoading || isSaving}
                      onClick={() => remove(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-3 text-sm">
            <div className="text-xs text-muted-foreground">Resolved config</div>
            <div className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-[160px_1fr]">
              <div className="text-muted-foreground">Provider</div>
              <div className="font-mono">{selectedProvider || "—"}</div>

              <div className="text-muted-foreground">Base URL</div>
              <div className="font-mono">{llmBaseUrl || "—"}</div>

              <div className="text-muted-foreground">API key</div>
              <div className="font-mono">{keyText}</div>

              <div className="text-muted-foreground">Default model</div>
              <div className="font-mono">{effectiveDefaultModel}</div>

              <div className="text-muted-foreground">Scoring model</div>
              <div className="font-mono">
                {scoringModel === effectiveDefaultModel
                  ? "inherits"
                  : scoringModel}
              </div>

              <div className="text-muted-foreground">Tailoring model</div>
              <div className="font-mono">
                {tailoringModel === effectiveDefaultModel
                  ? "inherits"
                  : tailoringModel}
              </div>

              <div className="text-muted-foreground">Project selection</div>
              <div className="font-mono">
                {projectSelectionModel === effectiveDefaultModel
                  ? "inherits"
                  : projectSelectionModel}
              </div>

              <div className="text-muted-foreground">Company rules</div>
              <div className="font-mono">
                {companyModelRules.length === 0
                  ? "none"
                  : `${companyModelRules.length} configured`}
              </div>
            </div>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
};
