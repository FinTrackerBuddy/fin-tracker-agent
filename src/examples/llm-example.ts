import { LlmService } from "../llm/llm-service.js";

const response = await LlmService.fromEnvironment().sendPrompt(
  "Reply with exactly: LLM integration is working.",
);

console.log(response);
