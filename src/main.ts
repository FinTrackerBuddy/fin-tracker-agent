import { FinanceAgent } from "./agent/finance-agent.js";
import { createFinanceApiServer } from "./http/finance-api-server.js";
import { loadApiAuthToken } from "./http/api-auth.js";
import { LlmService } from "./llm/llm-service.js";
import { consoleApplicationLogger } from "./logging/application-logger.js";

const port = 3001;
const agent = new FinanceAgent(LlmService.fromEnvironment(), undefined, undefined, undefined, consoleApplicationLogger);
const server = createFinanceApiServer(agent, loadApiAuthToken(), consoleApplicationLogger);

server.listen(port, () => {
  consoleApplicationLogger.info("HTTP", "Finance API listening", { url: `http://localhost:${port}` });
});
