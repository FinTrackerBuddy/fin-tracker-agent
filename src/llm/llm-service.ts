import {
  createLlmProvider,
  loadLlmConfiguration,
  type LlmConfiguration,
  type ToolCapableLlm,
} from "./llm-provider.js";

export { loadLlmConfiguration, type LlmConfiguration, type ToolCapableLlm } from "./llm-provider.js";

/** Provider-agnostic LangChain wrapper used by the application entry points. */
export class LlmService implements ToolCapableLlm {
  private readonly provider: ToolCapableLlm;

  public constructor(configuration: LlmConfiguration) {
    this.provider = createLlmProvider(configuration);
  }

  public static fromEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
  ): LlmService {
    return new LlmService(loadLlmConfiguration(environment));
  }

  public async sendPrompt(prompt: string): Promise<string> {
    return this.provider.sendPrompt(prompt);
  }

  public async sendMessagesWithTools(...parameters: Parameters<ToolCapableLlm["sendMessagesWithTools"]>) {
    return this.provider.sendMessagesWithTools(...parameters);
  }
}
