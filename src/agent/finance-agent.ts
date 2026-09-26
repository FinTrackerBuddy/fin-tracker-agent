import type { ToolCapableLlm } from "../llm/llm-service.js";
import { randomUUID } from "node:crypto";
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
    const knownCategories = await this.categoryVocabulary.listCategories();
    logger.info("Agent", "Expense category vocabulary loaded", { categoryCount: knownCategories.length });
    const messages: BaseMessage[] = [
      new SystemMessage(
        "You are a personal finance assistant. Use available tools for questions that require expense data, then answer using the tool results.\n\n"
          + dateContext
          + "\n\nAvailable expense categories in the workbook:\n"
          + knownCategories.map((category) => `- ${category}`).join("\n")
          + "\n\nWhen a user asks about a broad spending concept, select one or more relevant existing categories from this vocabulary. Never invent a category. Use literal workbook labels in tool categories. If the user's wording exactly matches a category, prefer it. Include multiple categories only when they are directly relevant; do not include loosely associated categories.\n\nCash is a payment-method/account filter, not an expense category. For requests about cash spending, use paymentMethod: 'cash'. This includes owner-prefixed cash accounts such as Pratheek Cash and Arya Cash; never reject a cash request because 'Cash' is absent from the expense-category list.\n\nUse analyzeExpenses for any grouped, ranked, top-N, weekday, category, account, monthly progression, repeated-item, or aggregated spending question. It accepts only a closed data specification: filters; groupBy month, dayOfWeek, category, account, or description; aggregation sum or count; a matching total/count sort; and optional limit. Description grouping returns exact ledger text and never assumes free-text variants are the same item. Put literal category labels in filter.categories. Only use filter.descriptions when the user has supplied an exact description; do not invent or normalize descriptions. The tool performs all filtering, grouping, aggregation, sorting, and calculations—never derive those values from getExpenses rows yourself. Use getExpenses only for necessary transaction-level detail. Use compareSpendingPeriods for explicitly ordered period totals, comparisons, increases/decreases, differences, or percentages. For category- or exact-description-filtered period comparison, call compareSpendingPeriods once with the filter and requested periods; it deterministically returns filtered totals and sequential comparisons. Never call an unfiltered comparison after a category-filtered request or any other filtered request. Preserve the user's requested period order; for a sequence of months compare adjacent calendar transitions only (for example August → September → October), never every pair. The date context above resolves relative terms such as last month and this month.",
      ),
      ...conversationHistory.flatMap((turn) => [
        new HumanMessage(turn.query),
        new AIMessage(turn.response),
      ]),
      new HumanMessage(userMessage),
    ];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const llmStartedAt = performance.now();
      logger.info("LLM", "Invoking model", { attempt: attempt + 1 });
      let response;
      try {
        response = await this.llm.sendMessagesWithTools(messages, tools);
      } catch (error) {
        logger.error("Error", "LLM invocation failed", {
          attempt: attempt + 1,
          durationMs: elapsedMilliseconds(llmStartedAt),
          errorType: getErrorType(error),
        });
        throw error;
      }
      logger.info("LLM", "Model invocation completed", {
        attempt: attempt + 1,
        durationMs: elapsedMilliseconds(llmStartedAt),
      });

      const toolCalls = response.tool_calls ?? [];

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

    logger.error("Error", "FinanceAgent exceeded tool-call limit");
    throw new Error("FinanceAgent exceeded its tool-call limit.");
  }
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
  const safeArguments: Record<string, string | string[]> = {};
  for (const key of ["category", "month", "date", "paymentMethod", "groupBy", "aggregation", "limit"]) {
    const value = argumentsValue[key];
    if (typeof value === "string") {
      safeArguments[key] = summarizeToolArgumentText(value);
    }
  }
  for (const key of ["categories", "months"]) {
    const value = argumentsValue[key];
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      safeArguments[key] = value.slice(0, 20).map(summarizeToolArgumentText);
    }
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
  if (!categories || !categories.every((category) => typeof category === "string")) {
    return { args: argumentsValue };
  }

  const selection = resolveExpenseCategories(categories, knownCategories);
  if (selection.categories.length === 0) {
    return {
      args: argumentsValue,
      error: `No requested categories exist in the current workbook vocabulary. Unknown categories: ${selection.unknownCategories.join(", ")}.`,
    };
  }

  const { category: _deprecatedCategory, categories: _categories, ...otherArguments } = categoryContainer;
  const args = categoriesAreNested
    ? { ...argumentsValue, filter: { ...otherArguments, categories: selection.categories } }
    : { ...otherArguments, categories: selection.categories };
  return {
    args,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
