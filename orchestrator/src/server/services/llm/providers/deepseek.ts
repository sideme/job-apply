import { createOpenAiCompatibleStrategy } from "./openai-compatible";

export const deepSeekStrategy = createOpenAiCompatibleStrategy({
  provider: "deepseek",
  defaultBaseUrl: "https://api.deepseek.com",
});
