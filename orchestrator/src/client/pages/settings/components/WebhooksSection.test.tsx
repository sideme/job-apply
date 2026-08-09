import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { Accordion } from "@/components/ui/accordion";
import { WebhooksSection } from "./WebhooksSection";

const WebhooksHarness = () => {
  const methods = useForm<UpdateSettingsInput>({
    defaultValues: {
      pipelineWebhookUrl: "https://pipeline.com",
      jobCompleteWebhookUrl: "https://job.com",
      whatsappEnabled: true,
      whatsappPhone: "+14165551234",
      whatsappApiKey: "",
      webhookSecret: "",
    },
  });

  return (
    <FormProvider {...methods}>
      <Accordion type="multiple" defaultValue={["webhooks"]}>
        <WebhooksSection
          pipelineWebhook={{
            default: "https://default-p.com",
            effective: "https://pipeline.com",
          }}
          jobCompleteWebhook={{
            default: "https://default-j.com",
            effective: "https://job.com",
          }}
          whatsapp={{
            enabled: { default: false, effective: true },
            phone: { default: "", effective: "+14165551234" },
            apiKeyHint: "1234",
          }}
          webhookSecretHint="sec-"
          isLoading={false}
          isSaving={false}
        />
      </Accordion>
    </FormProvider>
  );
};

describe("WebhooksSection", () => {
  it("renders both webhook sections and the secret", () => {
    render(<WebhooksHarness />);

    expect(screen.getByText("Pipeline Status")).toBeInTheDocument();
    expect(screen.getByText("Job Completion")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();

    expect(
      screen.getByDisplayValue("https://pipeline.com"),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://job.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("+14165551234")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send test notification" }),
    ).toBeInTheDocument();

    expect(screen.getByText("sec-********")).toBeInTheDocument();
  });
});
