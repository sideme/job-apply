import * as api from "@client/api";
import { useDemoInfo } from "@client/hooks/useDemoInfo";
import { useSettings } from "@client/hooks/useSettings";
import { SettingsInput } from "@client/pages/settings/components/SettingsInput";
import {
  getLlmProviderConfig,
  LLM_PROVIDER_LABELS,
  LLM_PROVIDERS,
  normalizeLlmProvider,
} from "@client/pages/settings/utils";
import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import { Check, X } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type ValidationState = {
  valid: boolean;
  message: string | null;
  checked: boolean;
};

type OnboardingFormData = {
  llmProvider: string;
  llmBaseUrl: string;
  llmApiKey: string;
};

const EMPTY_VALIDATION_STATE: ValidationState = {
  valid: false,
  message: null,
  checked: false,
};

export const OnboardingGate: React.FC = () => {
  const {
    settings,
    isLoading: settingsLoading,
    refreshSettings,
  } = useSettings();
  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validation, setValidation] = useState<ValidationState>(
    EMPTY_VALIDATION_STATE,
  );
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const demoMode = useDemoInfo()?.demoMode ?? false;

  const { control, watch, getValues, reset, setValue } =
    useForm<OnboardingFormData>({
      defaultValues: {
        llmProvider: "",
        llmBaseUrl: "",
        llmApiKey: "",
      },
    });

  const llmProvider = watch("llmProvider");
  const llmApiKeyDraft = watch("llmApiKey");
  const selectedProvider = normalizeLlmProvider(
    llmProvider || settings?.llmProvider?.value || "openrouter",
  );
  const providerConfig = getLlmProviderConfig(selectedProvider);
  const llmKeyHint = settings?.llmApiKeyHint ?? null;
  const hasLlmKey = Boolean(llmKeyHint);
  const llmConfigured = hasLlmKey || Boolean(llmApiKeyDraft.trim());
  const shouldValidate = providerConfig.requiresApiKey && llmConfigured;
  const llmValidated = shouldValidate ? validation.valid : true;
  const hasChecked = shouldValidate ? validation.checked : true;
  const shouldOpen =
    !demoMode &&
    Boolean(settings && !settingsLoading) &&
    hasChecked &&
    !llmValidated;

  const validateLlm = useCallback(async () => {
    const values = getValues();
    const config = getLlmProviderConfig(
      normalizeLlmProvider(
        values.llmProvider || settings?.llmProvider?.value || "openrouter",
      ),
    );
    setIsValidating(true);
    try {
      const result = await api.validateLlm({
        provider: config.normalizedProvider,
        baseUrl: config.showBaseUrl
          ? values.llmBaseUrl.trim() || undefined
          : undefined,
        apiKey: config.requiresApiKey
          ? values.llmApiKey.trim() || undefined
          : undefined,
      });
      setValidation({ ...result, checked: true });
      return result;
    } catch (error) {
      const result = {
        valid: false,
        message:
          error instanceof Error ? error.message : "LLM validation failed",
      };
      setValidation({ ...result, checked: true });
      return result;
    } finally {
      setIsValidating(false);
    }
  }, [getValues, settings?.llmProvider?.value]);

  const steps = useMemo(
    () => [
      {
        id: "llm",
        label: "LLM Provider",
        subtitle: "Optional provider + credentials",
        complete: llmValidated,
      },
    ],
    [llmValidated],
  );

  useEffect(() => {
    if (!settings) return;
    reset({
      llmProvider: settings.llmProvider?.value || "",
      llmBaseUrl: settings.llmBaseUrl?.value || "",
      llmApiKey: "",
    });
  }, [reset, settings]);

  useEffect(() => {
    if (!selectedProvider) return;
    setValidation(EMPTY_VALIDATION_STATE);
  }, [selectedProvider]);

  useEffect(() => {
    if (demoMode || !settings || settingsLoading || !shouldValidate) return;
    if (validation.checked) return;
    void validateLlm();
  }, [
    demoMode,
    settings,
    settingsLoading,
    shouldValidate,
    validation.checked,
    validateLlm,
  ]);

  useEffect(() => {
    if (shouldOpen && !currentStep) setCurrentStep("llm");
  }, [currentStep, shouldOpen]);

  const handleSave = async () => {
    const values = getValues();
    const apiKeyValue = values.llmApiKey.trim();
    const canUseRulesFallback =
      providerConfig.requiresApiKey && !apiKeyValue && !hasLlmKey;

    try {
      const result =
        providerConfig.requiresApiKey && !canUseRulesFallback
          ? await validateLlm()
          : { valid: true, message: null };
      if (!result.valid) {
        toast.error(result.message || "LLM validation failed");
        return;
      }

      setIsSaving(true);
      const update: Partial<UpdateSettingsInput> = {
        llmProvider: providerConfig.normalizedProvider,
        llmBaseUrl: providerConfig.showBaseUrl
          ? values.llmBaseUrl.trim() || null
          : null,
      };
      if (providerConfig.showApiKey && apiKeyValue)
        update.llmApiKey = apiKeyValue;
      await api.updateSettings(update);
      await refreshSettings();
      setValue("llmApiKey", "");
      toast[canUseRulesFallback ? "info" : "success"](
        canUseRulesFallback
          ? "LLM skipped; rule-based scoring will be used until a key is added."
          : "LLM provider connected",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save LLM settings",
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (!shouldOpen || !currentStep || isDismissed) return null;

  return (
    <AlertDialog open>
      <AlertDialogContent className="relative max-w-3xl max-h-[90vh] overflow-hidden p-0">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-3 top-3 z-10"
          onClick={() => setIsDismissed(true)}
          aria-label="Close onboarding"
          title="Close onboarding"
        >
          <X className="h-4 w-4" />
        </Button>
        <div className="space-y-6 px-6 py-6 max-h-[calc(90vh-3.5rem)] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Welcome to Job Ops</AlertDialogTitle>
            <AlertDialogDescription>
              Add an optional LLM key. Your local PDF resume is configured from
              Settings and does not require RxResume.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <Tabs value={currentStep} onValueChange={setCurrentStep}>
            <TabsList className="grid h-auto w-full grid-cols-1 gap-2 border-b border-border/60 bg-transparent p-0 text-left">
              {steps.map((step) => (
                <FieldLabel
                  key={step.id}
                  className="w-full [&>[data-slot=field]]:border-0 [&>[data-slot=field]]:p-0 [&>[data-slot=field]]:rounded-none"
                >
                  <TabsTrigger
                    value={step.id}
                    className={cn(
                      "w-full rounded-md hover:bg-muted/60 border-b-2 border-transparent px-3 py-4 text-left shadow-none",
                      currentStep === step.id
                        ? "border-primary !bg-muted/60 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <Field orientation="horizontal" className="items-start">
                      <FieldContent>
                        <FieldTitle>{step.label}</FieldTitle>
                        <FieldDescription>{step.subtitle}</FieldDescription>
                      </FieldContent>
                      <span
                        className={cn(
                          "mt-0.5 flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold",
                          step.complete
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {step.complete ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          "1"
                        )}
                      </span>
                    </Field>
                  </TabsTrigger>
                </FieldLabel>
              ))}
            </TabsList>

            <TabsContent value="llm" className="space-y-4 pt-6">
              <div>
                <p className="text-sm font-semibold">Connect LLM provider</p>
                <p className="text-xs text-muted-foreground">
                  Optional for scoring and tailoring. Without a key, rule-based
                  scoring remains available.
                </p>
              </div>
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
                        value={selectedProvider}
                        onValueChange={field.onChange}
                        disabled={isSaving}
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
                </div>
                {providerConfig.showBaseUrl && (
                  <Controller
                    name="llmBaseUrl"
                    control={control}
                    render={({ field }) => (
                      <SettingsInput
                        label="LLM base URL"
                        inputProps={{ ...field, name: "llmBaseUrl" }}
                        placeholder={providerConfig.baseUrlPlaceholder}
                        helper={providerConfig.baseUrlHelper}
                        current={settings?.llmBaseUrl?.value || "—"}
                        disabled={isSaving}
                      />
                    )}
                  />
                )}
                {providerConfig.showApiKey && (
                  <Controller
                    name="llmApiKey"
                    control={control}
                    render={({ field }) => (
                      <SettingsInput
                        label="LLM API key"
                        inputProps={{ ...field, name: "llmApiKey" }}
                        type="password"
                        placeholder="Enter key"
                        current={
                          llmKeyHint
                            ? `${providerConfig.keyHelper}. Leave blank to use the saved key.`
                            : undefined
                        }
                        disabled={isSaving}
                      />
                    )}
                  />
                )}
              </div>
              {validation.message && !validation.valid && (
                <p className="text-sm text-destructive">{validation.message}</p>
              )}
            </TabsContent>
          </Tabs>

          <div className="flex justify-end">
            <Button
              onClick={() => void handleSave()}
              disabled={isBusy(isSaving, settingsLoading, isValidating)}
            >
              {isSaving || isValidating ? "Validating..." : "Continue"}
            </Button>
          </div>
          <Progress value={steps[0].complete ? 100 : 0} className="h-2" />
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};

function isBusy(
  isSaving: boolean,
  settingsLoading: boolean,
  isValidating: boolean,
): boolean {
  return isSaving || settingsLoading || isValidating;
}
