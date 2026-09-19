import { ChatGoogle } from "@langchain/google";
import { ChatOpenAI } from "@langchain/openai";
import type { AIMessage, BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";

export type LlmProvider = "openai" | "gemini";
export type OpenAiReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export interface OpenAiLlmConfiguration {
  provider: "openai";
  model: string;
  apiKey: string;
  reasoningEffort: OpenAiReasoningEffort;
}

export interface GeminiLlmConfiguration {
  provider: "gemini";
  model: string;
  apiKey: string;
}

export type LlmConfiguration = OpenAiLlmConfiguration | GeminiLlmConfiguration;

/** The small provider-neutral surface FinanceAgent needs from a LangChain chat model. */
export interface ToolCapableLlm {
  sendPrompt(prompt: string): Promise<string>;
  sendMessagesWithTools(
    messages: BaseMessage[],
    tools: StructuredToolInterface[],
  ): Promise<AIMessage>;
}

export function loadLlmConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): LlmConfiguration {
  const provider = environment.LLM_PROVIDER?.trim();
  const model = environment.LLM_MODEL?.trim();
  if (!model) {
    throw new Error("LLM_MODEL must be set.");
  }

  if (provider === "openai") {
    const apiKey = environment.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY must be set when LLM_PROVIDER=openai.");
    }
    const reasoningEffort = environment.LLM_REASONING_EFFORT ?? "medium";
    if (!isOpenAiReasoningEffort(reasoningEffort)) {
      throw new Error("LLM_REASONING_EFFORT must be a supported OpenAI reasoning level.");
    }
    return { provider, model, apiKey, reasoningEffort };
  }

  if (provider === "gemini") {
    const apiKey = environment.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY must be set when LLM_PROVIDER=gemini.");
    }
    return { provider, model, apiKey };
  }

  throw new Error("LLM_PROVIDER must be set to a supported provider: openai or gemini.");
}

export function createLlmProvider(configuration: LlmConfiguration): ToolCapableLlm {
  switch (configuration.provider) {
    case "openai":
      return new OpenAiLlmProvider(configuration);
    case "gemini":
      return new GeminiLlmProvider(configuration);
  }
}

export class OpenAiLlmProvider implements ToolCapableLlm {
  private readonly model: ChatOpenAI;

  public constructor(configuration: OpenAiLlmConfiguration) {
    this.model = new ChatOpenAI({
      apiKey: configuration.apiKey,
      model: configuration.model,
      temperature: 0,
      reasoning: { effort: configuration.reasoningEffort },
    });
  }

  public async sendPrompt(prompt: string): Promise<string> {
    validatePrompt(prompt);
    return (await this.model.invoke(prompt)).text;
  }

  public async sendMessagesWithTools(
    messages: BaseMessage[],
    tools: StructuredToolInterface[],
  ): Promise<AIMessage> {
    return this.model.bindTools(tools).invoke(messages);
  }
}

export class GeminiLlmProvider implements ToolCapableLlm {
  private readonly model: ChatGoogle;

  public constructor(configuration: GeminiLlmConfiguration) {
    this.model = new ChatGoogle({
      apiKey: configuration.apiKey,
      model: configuration.model,
      temperature: 0,
    });
  }

  public async sendPrompt(prompt: string): Promise<string> {
    validatePrompt(prompt);
    return (await this.model.invoke(prompt)).text;
  }

  public async sendMessagesWithTools(
    messages: BaseMessage[],
    tools: StructuredToolInterface[],
  ): Promise<AIMessage> {
    return this.model.bindTools(tools).invoke(messages);
  }
}

function validatePrompt(prompt: string): void {
  if (!prompt.trim()) {
    throw new Error("A prompt is required.");
  }
}

function isOpenAiReasoningEffort(value: string): value is OpenAiReasoningEffort {
  return ["none", "low", "medium", "high", "xhigh", "max"].includes(value);
}
