import * as api from "@client/api";
import { SettingsInput } from "@client/pages/settings/components/SettingsInput";
import type {
  WebhookValues,
  WhatsAppValues,
} from "@client/pages/settings/types";
import { formatSecretHint } from "@client/pages/settings/utils";
import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import type React from "react";
import { useState } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { toast } from "sonner";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";

type WebhooksSectionProps = {
  pipelineWebhook: WebhookValues;
  jobCompleteWebhook: WebhookValues;
  whatsapp: WhatsAppValues;
  webhookSecretHint: string | null;
  isLoading: boolean;
  isSaving: boolean;
};

export const WebhooksSection: React.FC<WebhooksSectionProps> = ({
  pipelineWebhook,
  jobCompleteWebhook,
  whatsapp,
  webhookSecretHint,
  isLoading,
  isSaving,
}) => {
  const [isTestingWhatsApp, setIsTestingWhatsApp] = useState(false);
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<UpdateSettingsInput>();

  const handleTestWhatsApp = async () => {
    try {
      setIsTestingWhatsApp(true);
      await api.sendWhatsAppTest();
      toast.success("WhatsApp test notification sent");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not send WhatsApp test notification",
      );
    } finally {
      setIsTestingWhatsApp(false);
    }
  };

  return (
    <AccordionItem value="webhooks" className="border rounded-lg px-4">
      <AccordionTrigger className="hover:no-underline py-4">
        <span className="text-base font-semibold">
          Notifications &amp; Webhooks
        </span>
      </AccordionTrigger>
      <AccordionContent className="pb-4">
        <div className="space-y-6">
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium">WhatsApp</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Personal notifications through CallMeBot when a scheduled job
                search completes, fails, or pauses LinkedIn for safety.
              </p>
            </div>

            <div className="flex items-start gap-3">
              <Controller
                name="whatsappEnabled"
                control={control}
                render={({ field }) => (
                  <Checkbox
                    id="whatsappEnabled"
                    checked={field.value ?? whatsapp.enabled.default}
                    onCheckedChange={(checked) =>
                      field.onChange(checked === true)
                    }
                    disabled={isLoading || isSaving}
                  />
                )}
              />
              <label
                htmlFor="whatsappEnabled"
                className="cursor-pointer text-sm font-medium"
              >
                Enable scheduled-search notifications
              </label>
            </div>

            <SettingsInput
              label="WhatsApp phone number"
              inputProps={register("whatsappPhone")}
              placeholder="+14165551234"
              disabled={isLoading || isSaving}
              error={errors.whatsappPhone?.message as string | undefined}
              helper="Include the country code. CallMeBot is intended for personal-use notifications."
              current={whatsapp.phone.effective || "—"}
            />

            <SettingsInput
              label="CallMeBot API key"
              inputProps={register("whatsappApiKey")}
              type="password"
              placeholder="Enter API key"
              disabled={isLoading || isSaving}
              error={errors.whatsappApiKey?.message as string | undefined}
              helper="Save the phone number and API key before testing."
              current={formatSecretHint(whatsapp.apiKeyHint)}
            />

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isLoading || isSaving || isTestingWhatsApp}
              onClick={() => void handleTestWhatsApp()}
            >
              {isTestingWhatsApp ? "Sending…" : "Send test notification"}
            </Button>
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="text-sm font-medium">Pipeline Status</div>
            <SettingsInput
              label="Webhook URL"
              inputProps={register("pipelineWebhookUrl")}
              placeholder={pipelineWebhook.default || "https://..."}
              disabled={isLoading || isSaving}
              error={errors.pipelineWebhookUrl?.message as string | undefined}
              helper={`When set, the server sends a POST on pipeline completion/failure. Default: ${pipelineWebhook.default || "—"}.`}
              current={pipelineWebhook.effective || "—"}
            />
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="text-sm font-medium">Job Completion</div>
            <div className="space-y-4">
              <SettingsInput
                label="Webhook URL"
                inputProps={register("jobCompleteWebhookUrl")}
                placeholder={jobCompleteWebhook.default || "https://..."}
                disabled={isLoading || isSaving}
                error={
                  errors.jobCompleteWebhookUrl?.message as string | undefined
                }
                helper={`When set, the server sends a POST when you mark a job as applied (includes the job description). Default: ${jobCompleteWebhook.default || "—"}.`}
                current={jobCompleteWebhook.effective || "—"}
              />

              <SettingsInput
                label="Webhook Secret"
                inputProps={register("webhookSecret")}
                type="password"
                placeholder="Enter new secret"
                disabled={isLoading || isSaving}
                error={errors.webhookSecret?.message as string | undefined}
                helper="Secret sent to webhook (Bearer token)"
                current={formatSecretHint(webhookSecretHint)}
              />
            </div>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
};
