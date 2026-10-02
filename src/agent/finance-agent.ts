import type { ToolCapableLlm } from "../llm/llm-service.js";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";

import { createGetExpensesTool } from "../tools/get-expenses.js";
import { createCompareSpendingPeriodsTool } from "../tools/compare-spending-periods.js";
import { createAnalyzeExpensesTool } from "../tools/analyze-expenses.js";
import {
  consoleApplicationLogger,
  formatCurrency,
  summarizeError,
  summarizeQuery,
  type ApplicationLogger,
  withLogDetails,
} from "../logging/application-logger.js";
import {
  expenseCategoryVocabulary,
  resolveExpenseCategories,
  type ExpenseCategoryVocabularyProvider,
} from "../google-sheets/expense-category-vocabulary.js";
import {
  formatFinanceDateContext,
  getFinanceDateContext,
  systemClock,
  type Clock,
} from "./date-context.js";
import type { ConversationTurn } from "../conversation/session-conversation-memory.js";

export interface FinanceAgentResponse {
  text: string;
}

/**
 * The first finance-agent boundary. Tool execution can be added internally
 * later while callers continue to receive the stable response contract.
 */
export class FinanceAgent {
  private readonly configuredExpenseTool?: StructuredToolInterface;
  private readonly configuredSpendingPeriodComparisonTool?: StructuredToolInterface;
  private readonly configuredExpenseAnalysisTool?: StructuredToolInterface;

  public constructor(
    private readonly llm: Pick<ToolCapableLlm, "sendMessagesWithTools">,
    expenseTool: StructuredToolInterface | undefined = undefined,
    private readonly clock: Clock = systemClock,
    private readonly categoryVocabulary: ExpenseCategoryVocabularyProvider = expenseCategoryVocabulary,
    private readonly logger: ApplicationLogger = consoleApplicationLogger,
    spendingPeriodComparisonTool: StructuredToolInterface | undefined = undefined,
    expenseAnalysisTool: StructuredToolInterface | undefined = undefined,
  ) {
    this.configuredExpenseTool = expenseTool;
    this.configuredSpendingPeriodComparisonTool = spendingPeriodComparisonTool;
    this.configuredExpenseAnalysisTool = expenseAnalysisTool;
  }

  public async respond(
    userMessage: string,
    queryId: string = randomUUID(),
    conversationHistory: readonly ConversationTurn[] = [],
  ): Promise<FinanceAgentResponse> {
    const logger = withLogDetails(this.logger, { queryId });
    const expenseTool: StructuredToolInterface = this.configuredExpenseTool
      ?? createGetExpensesTool(undefined, logger);
    const spendingPeriodComparisonTool: StructuredToolInterface = this.configuredSpendingPeriodComparisonTool
      ?? createCompareSpendingPeriodsTool(undefined, logger);
    const expenseAnalysisTool: StructuredToolInterface = this.configuredExpenseAnalysisTool
      ?? createAnalyzeExpensesTool(undefined, logger);
    const tools = [expenseTool, spendingPeriodComparisonTool, expenseAnalysisTool];
    logger.info("Agent", "Execution started", { query: summarizeQuery(userMessage) });
    const dateContext = formatFinanceDateContext(getFinanceDateContext(this.clock.now()));
    logger.info("Agent", "Loading expense category vocabulary");
    let knownCategories: readonly string[];
    try {
      knownCategories = await this.categoryVocabulary.listCategories();
    } catch (error) {
      logger.error("Error", "Expense category vocabulary loading failed", {
        errorType: getErrorType(error),
        errorMessage: summarizeError(error),
      });
      throw error;
    }
    logger.info("Agent", "Expense category vocabulary loaded", { categoryCount: knownCategories.length });
    const messages: BaseMessage[] = [
      new SystemMessage(createSystemPrompt(dateContext, knownCategories)),
      ...conversationHistory.flatMap((turn) => [
        new HumanMessage(turn.query),
        new AIMessage(turn.response),
      ]),
      new HumanMessage(userMessage),
    ];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const llmStartedAt = performance.now();
      const attemptNumber = attempt + 1;
      logger.info("LLM", "Request prepared", {
        attempt: attemptNumber,
        messageCount: messages.length,
        messageTrace: summarizeMessages(messages),
        availableTools: tools.map((candidate) => candidate.name),
      });
      logger.info("LLM", "Invoking model", {
        attempt: attemptNumber,
        debugQuery: summarizeQuery(userMessage),
      });
      let response;
      try {
        response = await this.llm.sendMessagesWithTools(messages, tools);
      } catch (error) {
        logger.error("Error", "LLM invocation failed", {
          attempt: attemptNumber,
          durationMs: elapsedMilliseconds(llmStartedAt),
          errorType: getErrorType(error),
          errorMessage: summarizeError(error),
        });
        throw error;
      }
      logger.info("LLM", "Model invocation completed", {
        attempt: attemptNumber,
        durationMs: elapsedMilliseconds(llmStartedAt),
      });

      const toolCalls = response.tool_calls ?? [];
      logger.info("LLM", "Model response received", {
        attempt: attemptNumber,
        responseTextCharacters: response.text.length,
        responseTextSha256: contentSha256(response.text),
        toolCallCount: toolCalls.length,
        toolCallTrace: summarizeResponseToolCalls(toolCalls),
        invalidToolCallCount: response.invalid_tool_calls?.length ?? 0,
      });

      if (toolCalls.length === 0) {
        logger.info("Agent", "Final response generated", { responseCharacters: response.text.length });
        logger.info("Agent", "Execution completed");
        return { text: response.text };
      }

      messages.push(response);

      for (const toolCall of toolCalls) {
        const requestedTool = tools.find((candidate) => candidate.name === toolCall.name);
        if (!requestedTool || !toolCall.id) {
          logger.error("Error", "Unsupported tool call requested", { tool: toolCall.name });
          throw new Error(`Unsupported tool call: ${toolCall.name}`);
        }

        logger.info("Tool", "Tool call requested", {
          tool: toolCall.name,
          arguments: summarizeToolArguments(toolCall.args),
        });

        const validatedArguments = toolCall.name === expenseTool.name
          || toolCall.name === spendingPeriodComparisonTool.name
          || toolCall.name === expenseAnalysisTool.name
          ? validateExpenseToolCategories(toolCall.args, knownCategories, toolCall.name === expenseAnalysisTool.name)
          : { args: toolCall.args };
        if (validatedArguments.error) {
          logger.info("Tool", "Tool call rejected", { tool: toolCall.name, reason: "unknown_categories" });
          messages.push(
            new ToolMessage({
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: validatedArguments.error }),
            }),
          );
          continue;
        }

        const toolStartedAt = performance.now();
        logger.info("Tool", "Tool execution started", { tool: toolCall.name });
        let result;
        try {
          result = await requestedTool.invoke(validatedArguments.args);
        } catch (error) {
          logger.error("Error", "Tool execution failed", {
            tool: toolCall.name,
            durationMs: elapsedMilliseconds(toolStartedAt),
            errorType: getErrorType(error),
            errorMessage: summarizeError(error),
          });
          throw error;
        }
        logger.info("Tool", "Tool execution completed", {
          tool: toolCall.name,
          expenseCount: getExpenseCount(result),
          periodCount: getComparisonPeriodCount(result),
          comparisonCount: getComparisonCount(result),
          analysisResultCount: getAnalysisResultCount(result),
          total: getToolTotal(result),
          durationMs: elapsedMilliseconds(toolStartedAt),
        });
        messages.push(
          new ToolMessage({
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          }),
        );
      }
    }

    logger.error("Error", "FinanceAgent exceeded tool-call limit", { attemptCount: 3 });
    throw new Error("FinanceAgent exceeded its tool-call limit.");
  }
}

function createSystemPrompt(dateContext: string, knownCategories: readonly string[]): string {
  return "You are a personal finance assistant. Use available tools for questions that require expense data, then answer using the tool results.\n\n"
    + dateContext
    + "\n\nAvailable expense categories in the workbook:\n"
    + knownCategories.map((category) => `- ${category}`).join("\n")
    + "\n\n"
    + loadFinanceAgentSkills();
}

function loadFinanceAgentSkills(): string {
  const skillsPath = new URL("../../SKILLS.md", import.meta.url);
  const skills = stripSkillsFrontmatter(readFileSync(skillsPath, "utf8"));
  if (!skills) {
    throw new Error("SKILLS.md must contain finance-agent instructions.");
  }
  return skills;
}

function stripSkillsFrontmatter(contents: string): string {
  const trimmed = contents.trim();
  if (!trimmed.startsWith("---\n")) return trimmed;

  const closingDelimiter = trimmed.indexOf("\n---\n", 4);
  if (closingDelimiter === -1) {
    throw new Error("SKILLS.md frontmatter must end with a closing --- delimiter.");
  }
  return trimmed.slice(closingDelimiter + "\n---\n".length).trim();
}

/**
 * Emits the request/response shape without persisting prompt text, raw tool
 * data, descriptions, or model prose in application logs.
 */
function summarizeMessages(messages: readonly BaseMessage[]): string {
  return messages.map((message) => {
    const content = messageContentForDiagnostics(message);
    return `${message.getType()}(characters=${content.length},sha256=${contentSha256(content)})`;
  }).join(" → ");
}

function summarizeResponseToolCalls(
  toolCalls: ReadonlyArray<{ name: string; args: unknown }>,
): string {
  return toolCalls.length === 0
    ? "none"
    : toolCalls.map((toolCall) => `${toolCall.name}(${summarizeToolArguments(toolCall.args)})`).join(", ");
}

function messageContentForDiagnostics(message: BaseMessage): string {
  return typeof message.content === "string" ? message.content : JSON.stringify(message.content);
}

function contentSha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function summarizeToolArguments(argumentsValue: unknown): string {
  if (!isRecord(argumentsValue)) {
    return "invalid";
  }
  const safeArguments: Record<string, string | string[] | boolean> = {};
  for (const key of ["category", "month", "date", "paymentMethod", "groupBy", "aggregation", "limit"]) {
    const value = argumentsValue[key];
    if (typeof value === "string") {
      safeArguments[key] = summarizeToolArgumentText(value);
    }
  }
  for (const key of ["categories", "excludeCategories", "months"]) {
    const value = argumentsValue[key];
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      safeArguments[key] = value.slice(0, 20).map(summarizeToolArgumentText);
    }
  }
  if (typeof argumentsValue.averageMonthly === "boolean") {
    safeArguments.averageMonthly = argumentsValue.averageMonthly;
  }
  const periods = argumentsValue.periods;
  if (Array.isArray(periods)) {
    safeArguments.periods = periods.slice(0, 20).flatMap((period) => {
      if (!isRecord(period) || typeof period.label !== "string" || !Array.isArray(period.months)) {
        return [];
      }
      const months = period.months.filter((month): month is string => typeof month === "string");
      return [`${summarizeToolArgumentText(period.label)}:[${months.slice(0, 12).map(summarizeToolArgumentText).join(",")}]`];
    });
  }
  const filter = argumentsValue.filter;
  if (isRecord(filter)) {
    const filterSummary = summarizeToolArguments(filter);
    safeArguments.filter = filterSummary;
  }
  return JSON.stringify(safeArguments);
}

function summarizeToolArgumentText(value: string): string {
  return value.length <= 120 ? value : `${value.slice(0, 117)}...`;
}

function getExpenseCount(result: unknown): number | undefined {
  return isRecord(result) && Array.isArray(result.expenses) ? result.expenses.length : undefined;
}

function getToolTotal(result: unknown): string | undefined {
  return isRecord(result) && typeof result.total === "number" && Number.isFinite(result.total)
    ? formatCurrency(result.total)
    : getComparisonPeriodsTotal(result);
}

function getComparisonPeriodCount(result: unknown): number | undefined {
  return isRecord(result) && Array.isArray(result.periods) ? result.periods.length : undefined;
}

function getComparisonCount(result: unknown): number | undefined {
  return isRecord(result) && Array.isArray(result.comparisons) ? result.comparisons.length : undefined;
}

function getAnalysisResultCount(result: unknown): number | undefined {
  return isRecord(result) && Array.isArray(result.results) ? result.results.length : undefined;
}

function getComparisonPeriodsTotal(result: unknown): string | undefined {
  if (!isRecord(result) || !Array.isArray(result.periods)) {
    return undefined;
  }
  let total = 0;
  for (const period of result.periods) {
    if (!isRecord(period) || typeof period.total !== "number" || !Number.isFinite(period.total)) {
      return undefined;
    }
    total += period.total;
  }
  return formatCurrency(total);
}

function validateExpenseToolCategories(
  argumentsValue: unknown,
  knownCategories: readonly string[],
  categoriesAreNested: boolean = false,
): { args: unknown; error?: string } {
  if (!isRecord(argumentsValue)) {
    return { args: argumentsValue };
  }

  const categoryContainer = categoriesAreNested && isRecord(argumentsValue.filter)
    ? argumentsValue.filter
    : argumentsValue;
  const categories = Array.isArray(categoryContainer.categories)
    ? categoryContainer.categories
    : typeof categoryContainer.category === "string" ? [categoryContainer.category] : undefined;
  const excludeCategories = Array.isArray(categoryContainer.excludeCategories)
    ? categoryContainer.excludeCategories
    : undefined;
  if ((!categories && !excludeCategories)
    || (categories && !categories.every((category) => typeof category === "string"))
    || (excludeCategories && !excludeCategories.every((category) => typeof category === "string"))) {
    return { args: argumentsValue };
  }

  const selection = categories ? resolveExpenseCategories(categories, knownCategories) : undefined;
  const exclusionSelection = excludeCategories
    ? resolveExpenseCategories(excludeCategories, knownCategories)
    : undefined;
  if ((selection && selection.categories.length === 0) || (exclusionSelection && exclusionSelection.categories.length === 0)) {
    const unknownCategories = [
      ...(selection?.unknownCategories ?? []),
      ...(exclusionSelection?.unknownCategories ?? []),
    ];
    return {
      args: argumentsValue,
      error: `No requested categories exist in the current workbook vocabulary. Unknown categories: ${unknownCategories.join(", ")}.`,
    };
  }

  const {
    category: _deprecatedCategory,
    categories: _categories,
    excludeCategories: _excludeCategories,
    ...otherArguments
  } = categoryContainer;
  const normalizedCategories = selection?.categories;
  const normalizedExclusions = exclusionSelection?.categories;
  const args = categoriesAreNested
    ? {
      ...argumentsValue,
      filter: {
        ...otherArguments,
        ...(normalizedCategories ? { categories: normalizedCategories } : {}),
        ...(normalizedExclusions ? { excludeCategories: normalizedExclusions } : {}),
      },
    }
    : {
      ...otherArguments,
      ...(normalizedCategories ? { categories: normalizedCategories } : {}),
      ...(normalizedExclusions ? { excludeCategories: normalizedExclusions } : {}),
    };
  return {
    args,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
