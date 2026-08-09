import { createOpenAiCompatibleStrategy } from "./openai-compatible";

export const qwenStrategy = createOpenAiCompatibleStrategy({
  provider: "qwen",
  defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
});
