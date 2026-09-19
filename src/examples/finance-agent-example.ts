import { FinanceAgent } from "../agent/finance-agent.js";
import { LlmService } from "../llm/llm-service.js";

const agent = new FinanceAgent(LlmService.fromEnvironment());
const response = await agent.respond("How much for daily groceries this month?");

console.log(response.text);
