import assert from "node:assert/strict";
import test from "node:test";

import {
  GeminiLlmProvider,
  OpenAiLlmProvider,
  createLlmProvider,
} from "./llm-provider.js";
import { LlmService, loadLlmConfiguration } from "./llm-service.js";

const configuredEnvironment = {
  LLM_PROVIDER: "openai",
  LLM_MODEL: "gpt-4o-mini",
  OPENAI_API_KEY: "test-key",
};

test("loads an OpenAI LangChain configuration", () => {
  assert.deepEqual(loadLlmConfiguration(configuredEnvironment), {
    provider: "openai",
    model: "gpt-4o-mini",
    apiKey: "test-key",
    reasoningEffort: "medium",
  });
});

test("provider factory selects OpenAI without sending a request", () => {
  assert.ok(createLlmProvider(loadLlmConfiguration(configuredEnvironment)) instanceof OpenAiLlmProvider);
  assert.ok(new LlmService(loadLlmConfiguration(configuredEnvironment)));
});

test("provider factory selects Gemini without passing OpenAI reasoning options", () => {
  const configuration = loadLlmConfiguration({
    LLM_PROVIDER: "gemini",
    LLM_MODEL: "gemini-3.1-flash-lite",
    GEMINI_API_KEY: "test-gemini-key",
    LLM_REASONING_EFFORT: "invalid-for-openai-but-irrelevant-to-gemini",
  });

  assert.deepEqual(configuration, {
    provider: "gemini",
    model: "gemini-3.1-flash-lite",
    apiKey: "test-gemini-key",
  });
  assert.ok(createLlmProvider(configuration) instanceof GeminiLlmProvider);
  assert.ok(new LlmService(configuration));
});

test("rejects unsupported providers and missing provider-specific API keys", () => {
  assert.throws(
    () => loadLlmConfiguration({ ...configuredEnvironment, LLM_PROVIDER: "glm" }),
    /openai or gemini/,
  );
  assert.throws(
    () => loadLlmConfiguration({ LLM_PROVIDER: "openai", LLM_MODEL: "gpt-4o-mini" }),
    /OPENAI_API_KEY/,
  );
  assert.throws(
    () => loadLlmConfiguration({ LLM_PROVIDER: "gemini", LLM_MODEL: "gemini-3.1-flash-lite" }),
    /GEMINI_API_KEY/,
  );
});
