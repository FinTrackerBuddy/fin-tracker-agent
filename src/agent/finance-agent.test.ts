import assert from "node:assert/strict";
import test from "node:test";

import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";

import type { ToolCapableLlm } from "../llm/llm-service.js";
import { createGetExpensesTool } from "../tools/get-expenses.js";
import { createCompareSpendingPeriodsTool } from "../tools/compare-spending-periods.js";
import { createAnalyzeExpensesTool } from "../tools/analyze-expenses.js";
import { FinanceAgent } from "./finance-agent.js";
import type { ApplicationLogger, LogDetails, LogScope } from "../logging/application-logger.js";

const expenseCategoryVocabulary = {
  async listCategories(): Promise<readonly string[]> {
    return ["Dining out", "Food order", "Groceries", "Travel"];
  },
};

const legacyCategoryVocabulary = {
  async listCategories(): Promise<readonly string[]> {
    return ["Food"];
  },
};

class RecordedLogger implements ApplicationLogger {
  public readonly entries: string[] = [];

  public info(scope: LogScope, message: string, details?: LogDetails): void {
    this.entries.push(`${scope}:${message}:${JSON.stringify(details ?? {})}`);
  }

  public error(scope: LogScope, message: string, details?: LogDetails): void {
    this.entries.push(`${scope}:${message}:${JSON.stringify(details ?? {})}`);
  }
}

test("returns a stable user-facing response without a tool call", async () => {
  const providerAgnosticLlm: Pick<ToolCapableLlm, "sendMessagesWithTools"> = {
    async sendMessagesWithTools(): Promise<AIMessage> {
      return new AIMessage("I can help with expense questions.");
    },
  };
  const agent = new FinanceAgent(providerAgnosticLlm, undefined, undefined, expenseCategoryVocabulary);

  assert.deepEqual(await agent.respond("What can you help me with?"), {
    text: "I can help with expense questions.",
  });
});

test("executes getExpenses and uses its result to produce the final response", async () => {
  const calls: BaseMessage[][] = [];
  const toolsProvided: StructuredToolInterface[][] = [];
  const agent = new FinanceAgent({
    async sendMessagesWithTools(messages, tools): Promise<AIMessage> {
      const conversation = messages as BaseMessage[];
      calls.push(conversation);
      toolsProvided.push(tools);

      if (calls.length === 1) {
        return new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "get-expenses-1",
              name: "getExpenses",
              args: { category: "Food" },
            },
          ],
        });
      }

      return new AIMessage("You spent 450 on food.");
    },
  }, createGetExpensesTool({
    monthTabs: ["April"],
    async listExpenses() {
      return [{
        date: "2026-04-01", category: "Food", description: "Groceries", amount: 450,
        sourceSheet: "April", sourceRow: 9,
      }];
    },
  }), undefined, legacyCategoryVocabulary);

  const response = await agent.respond("How much did I spend on food?");

  assert.deepEqual(response, {
    text: "You spent 450 on food.",
  });
  assert.equal(calls.length, 2);
  assert.equal(toolsProvided[0][0]?.name, "getExpenses");

  const toolMessage = calls[1].find((message) => message instanceof ToolMessage);
  assert.ok(toolMessage);
  assert.deepEqual(JSON.parse(toolMessage.content.toString()), {
    expenses: [
      { date: "2026-04-01", category: "Food", description: "Groceries", amount: 450 },
    ],
    total: 450,
  });
});

test("uses analyzeExpenses grouped by month for a natural-language monthly trend request", async () => {
  const calls: BaseMessage[][] = [];
  const logger = new RecordedLogger();
  const agent = new FinanceAgent({
    async sendMessagesWithTools(messages): Promise<AIMessage> {
      calls.push(messages);
      if (calls.length === 1) {
        return new AIMessage({
          content: "",
          tool_calls: [{ id: "trend-1", name: "analyzeExpenses", args: {
            groupBy: "month", aggregation: "sum", sort: { field: "total", direction: "asc" },
          } }],
        });
      }
      return new AIMessage("Your monthly spending rose from April to May.");
    },
  }, createGetExpensesTool({
    monthTabs: ["April", "May"],
    async listExpenses() {
      return [];
    },
  }), undefined, legacyCategoryVocabulary, logger, undefined, createAnalyzeExpensesTool({
    monthTabs: ["April", "May"],
    async listExpenses() {
      return [
        { date: "2026-04-01", category: "Food", description: "Market", amount: 100, sourceSheet: "April", sourceRow: 9 },
        { date: "2026-05-01", category: "Food", description: "Market", amount: 200, sourceSheet: "May", sourceRow: 9 },
      ];
    },
  }));

  assert.deepEqual(await agent.respond("Show my monthly spending trend."), {
    text: "Your monthly spending rose from April to May.",
  });
  assert.match(calls[0]?.[0]?.content.toString() ?? "", /monthly progression/);
  const toolMessage = calls[1]?.find((message) => message instanceof ToolMessage);
  assert.ok(toolMessage);
  assert.deepEqual(JSON.parse(toolMessage.content.toString()), {
    groupBy: "month", aggregation: "sum",
    results: [{ key: "April", total: 100 }, { key: "May", total: 200 }], matchingExpenseCount: 2,
  });
  assert.match(logger.entries.join("\n"), /Tool:Tool call requested:.*"analyzeExpenses"/);
  assert.match(logger.entries.join("\n"), /Tool:Tool execution completed:.*"analysisResultCount":2.*"durationMs":\d+/);
  assert.doesNotMatch(logger.entries.join("\n"), /Market/);
});

test("uses compareSpendingPeriods for last month versus this month in calendar order", async () => {
  const calls: BaseMessage[][] = [];
  const logger = new RecordedLogger();
  const agent = new FinanceAgent({
    async sendMessagesWithTools(messages): Promise<AIMessage> {
      calls.push(messages);
      if (calls.length === 1) {
        return new AIMessage({
          content: "",
          tool_calls: [{
            id: "comparison-1",
            name: "compareSpendingPeriods",
            args: {
              periods: [
                { label: "August", months: ["August"] },
                { label: "September", months: ["September"] },
              ],
            },
          }],
        });
      }
      return new AIMessage("You spent 50 more in September than August.");
    },
  }, createGetExpensesTool({
    monthTabs: ["August", "September"],
    async listExpenses() {
      return [];
    },
  }), {
    now: () => new Date("2026-09-17T12:00:00.000Z"),
  }, legacyCategoryVocabulary, logger, createCompareSpendingPeriodsTool({
    monthTabs: ["August", "September"],
    async listExpenses() {
      return [
        { date: "2026-08-01", category: "Food", description: "August item", amount: 100, sourceSheet: "August", sourceRow: 9 },
        { date: "2026-09-01", category: "Food", description: "September item", amount: 150, sourceSheet: "September", sourceRow: 9 },
      ];
    },
  }));

  assert.deepEqual(await agent.respond("Compare last month with this month."), {
    text: "You spent 50 more in September than August.",
  });
  assert.match(calls[0]?.[0]?.content.toString() ?? "", /Previous workbook month tab: August/);
  assert.match(calls[0]?.[0]?.content.toString() ?? "", /Current workbook month tab: September/);
  assert.match(calls[0]?.[0]?.content.toString() ?? "", /Use compareSpendingPeriods/);
  const toolMessage = calls[1]?.find((message) => message instanceof ToolMessage);
  assert.ok(toolMessage);
  assert.deepEqual(JSON.parse(toolMessage.content.toString()).comparisons, [
    { from: "August", to: "September", difference: 50, percentageChange: 50 },
  ]);
  assert.match(logger.entries.join("\n"), /Tool:Tool call requested:.*compareSpendingPeriods.*queryId/);
  assert.match(logger.entries.join("\n"), /August:\[August\].*September:\[September\]/);
  assert.match(logger.entries.join("\n"), /Tool:Tool execution completed:.*"periodCount":2.*"comparisonCount":1.*"total":"₹250".*"durationMs":\d+/);
  assert.doesNotMatch(logger.entries.join("\n"), /August item|September item/);
});

test("uses one category-filtered comparison call for last-two-month outside-food analysis", async () => {
  const calls: BaseMessage[][] = [];
  const comparisonInvocations: unknown[] = [];
  const agent = new FinanceAgent({
    async sendMessagesWithTools(messages): Promise<AIMessage> {
      calls.push(messages);
      if (calls.length === 1) {
        return new AIMessage({
          content: "",
          tool_calls: [{
            id: "outside-food-1",
            name: "compareSpendingPeriods",
            args: {
              categories: [" dining OUT ", "food order"],
              periods: [
                { label: "July", months: ["July"] },
                { label: "August", months: ["August"] },
              ],
            },
          }],
        });
      }
      return new AIMessage("Outside food was ₹300 in July and ₹500 in August, up ₹200 (66.67%).");
    },
  }, {
    name: "getExpenses",
    async invoke() {
      throw new Error("getExpenses must not be called for category-period analysis");
    },
  } as unknown as StructuredToolInterface, {
    now: () => new Date("2026-09-17T12:00:00.000Z"),
  }, expenseCategoryVocabulary, undefined, {
    name: "compareSpendingPeriods",
    async invoke(input: unknown) {
      comparisonInvocations.push(input);
      return {
        categories: ["Dining out", "Food order"],
        total: 800,
        periods: [
          { label: "July", months: ["July"], total: 300 },
          { label: "August", months: ["August"], total: 500 },
        ],
        comparisons: [{ from: "July", to: "August", difference: 200, percentageChange: 200 / 3 }],
      };
    },
  } as unknown as StructuredToolInterface);

  const response = await agent.respond("What is my spending analysis in last 2 months in outside food?");

  assert.match(response.text, /Outside food/);
  assert.equal(calls.length, 2);
  assert.deepEqual(comparisonInvocations, [{
    categories: ["Dining out", "Food order"],
    periods: [
      { label: "July", months: ["July"] },
      { label: "August", months: ["August"] },
    ],
  }]);
  assert.match(calls[0]?.[0]?.content.toString() ?? "", /Never call an unfiltered comparison after a category-filtered request/);
  const toolMessage = calls[1]?.find((message) => message instanceof ToolMessage);
  assert.ok(toolMessage);
  assert.deepEqual(JSON.parse(toolMessage.content.toString()).periods, [
    { label: "July", months: ["July"], total: 300 },
    { label: "August", months: ["August"], total: 500 },
  ]);
});

test("logs the real LLM and getExpenses tool lifecycle using summaries", async () => {
  const logger = new RecordedLogger();
  let invocation = 0;
  const agent = new FinanceAgent({
    async sendMessagesWithTools(): Promise<AIMessage> {
      invocation += 1;
      return invocation === 1
        ? new AIMessage({ content: "", tool_calls: [{ id: "expenses-1", name: "getExpenses", args: { month: "April", category: "Food" } }] })
        : new AIMessage("You spent 450 on food.");
    },
  }, createGetExpensesTool({
    monthTabs: ["April"],
    async listExpenses() {
      return [{ date: "2026-04-01", category: "Food", description: "Groceries", amount: 450, sourceSheet: "April", sourceRow: 9 }];
    },
  }), undefined, legacyCategoryVocabulary, logger);

  await agent.respond("How much did I spend on food?", "query-test-id");

  assert.equal(logger.entries.length, 12);
  assert.match(logger.entries[0] ?? "", /^Agent:Execution started:.*"queryId":"query-test-id"/);
  assert.match(logger.entries[3] ?? "", /^LLM:Invoking model:.*"attempt":1.*"queryId":"query-test-id"/);
  assert.match(logger.entries[4] ?? "", /^LLM:Model invocation completed:.*"durationMs":\d+.*"queryId":"query-test-id"/);
  assert.match(logger.entries[5] ?? "", /^Tool:Tool call requested:.*"getExpenses".*"queryId":"query-test-id"/);
  assert.match(logger.entries[6] ?? "", /^Tool:Tool execution started:.*"queryId":"query-test-id"/);
  assert.match(logger.entries[7] ?? "", /^Tool:Tool execution completed:.*"expenseCount":1.*"total":"₹450".*"durationMs":\d+.*"queryId":"query-test-id"/);
  assert.match(logger.entries[9] ?? "", /^LLM:Model invocation completed:.*"attempt":2.*"durationMs":\d+.*"queryId":"query-test-id"/);
  assert.match(logger.entries[11] ?? "", /^Agent:Execution completed:.*"queryId":"query-test-id"/);
  assert.doesNotMatch(logger.entries.join("\n"), /Groceries/);
});

test("supplies authoritative current and previous workbook month context to the model", async () => {
  const calls: BaseMessage[][] = [];
  const agent = new FinanceAgent({
    async sendMessagesWithTools(messages): Promise<AIMessage> {
      calls.push(messages);
      return new AIMessage("No expense data is needed.");
    },
  }, undefined, {
    now: () => new Date("2027-01-15T12:00:00.000Z"),
  }, expenseCategoryVocabulary);

  await agent.respond("How much did I spend this month?");

  const systemMessage = calls[0]?.[0];
  assert.ok(systemMessage);
  const content = systemMessage.content.toString();
  assert.match(content, /Current local date: January 15, 2027/);
  assert.match(content, /Current workbook month tab: January/);
  assert.match(content, /Previous workbook month tab: December/);
  assert.match(content, /Interpret "this month" as the current workbook month tab above/);
  assert.match(content, /Available expense categories in the workbook:/);
  assert.match(content, /- Dining out/);
  assert.match(content, /do not include loosely associated categories/);
  assert.match(content, /Cash is a payment-method\/account filter/);
  assert.match(content, /Pratheek Cash and Arya Cash/);
});

test("canonicalizes semantic multi-category selections and never invokes an unknown category", async () => {
  const calls: BaseMessage[][] = [];
  const agent = new FinanceAgent({
    async sendMessagesWithTools(messages): Promise<AIMessage> {
      calls.push(messages);
      if (calls.length === 1) {
        return new AIMessage({
          content: "",
          tool_calls: [{
            id: "food-1",
            name: "getExpenses",
            args: { month: "September", categories: ["Food order", "Dining out", "Food"] },
          }],
        });
      }
      return new AIMessage("You spent 750 on food.");
    },
  }, createGetExpensesTool({
    monthTabs: ["September"],
    async listExpenses() {
      return [
        { date: "2026-09-01", category: "Food order", description: "Delivery", amount: 450, sourceSheet: "September", sourceRow: 9 },
        { date: "2026-09-02", category: "Dining out", description: "Lunch", amount: 300, sourceSheet: "September", sourceRow: 10 },
        { date: "2026-09-03", category: "Travel", description: "Taxi", amount: 200, sourceSheet: "September", sourceRow: 11 },
      ];
    },
  }), {
    now: () => new Date("2026-09-16T12:00:00.000Z"),
  }, expenseCategoryVocabulary);

  assert.deepEqual(await agent.respond("How much did I spend on food this month?"), {
    text: "You spent 750 on food.",
  });
  assert.match(calls[0]?.[0]?.content.toString() ?? "", /Current workbook month tab: September/);
  const toolMessage = calls[1].find((message) => message instanceof ToolMessage);
  assert.ok(toolMessage);
  assert.deepEqual(JSON.parse(toolMessage.content.toString()), {
    expenses: [
      { date: "2026-09-01", category: "Food order", description: "Delivery", amount: 450 },
      { date: "2026-09-02", category: "Dining out", description: "Lunch", amount: 300 },
    ],
    total: 750,
  });
});

test("canonicalizes an exact Dining out selection to the literal workbook label", async () => {
  const invocations: unknown[] = [];
  const agent = new FinanceAgent({
    async sendMessagesWithTools(messages): Promise<AIMessage> {
      if (messages.some((message) => message instanceof ToolMessage)) {
        return new AIMessage("You spent 300 on Dining out.");
      }
      return new AIMessage({
        content: "",
        tool_calls: [{ id: "dining-1", name: "getExpenses", args: { category: " dining OUT " } }],
      });
    },
  }, {
    name: "getExpenses",
    async invoke(input: unknown) {
      invocations.push(input);
      return { expenses: [], total: 300 };
    },
  } as unknown as StructuredToolInterface, undefined, expenseCategoryVocabulary);

  await agent.respond("How much did I spend on Dining out?");
  assert.deepEqual(invocations, [{ categories: ["Dining out"] }]);
});

test("does not execute a tool call when every requested category is unknown", async () => {
  let toolInvoked = false;
  const agent = new FinanceAgent({
    async sendMessagesWithTools(messages): Promise<AIMessage> {
      if (messages.some((message) => message instanceof ToolMessage)) {
        return new AIMessage("Food is not an available workbook category.");
      }
      return new AIMessage({
        content: "",
        tool_calls: [{ id: "unknown-1", name: "getExpenses", args: { categories: ["Food"] } }],
      });
    },
  }, {
    name: "getExpenses",
    async invoke() {
      toolInvoked = true;
      return {};
    },
  } as unknown as StructuredToolInterface, undefined, expenseCategoryVocabulary);

  await agent.respond("How much did I spend on food?");
  assert.equal(toolInvoked, false);
});

test("uses analyzeExpenses for groceries by weekday instead of exposing transactions to the model", async () => {
  const calls: BaseMessage[][] = [];
  let rawExpenseToolCalled = false;
  const agent = new FinanceAgent({
    async sendMessagesWithTools(messages): Promise<AIMessage> {
      calls.push(messages);
      if (calls.length === 1) {
        return new AIMessage({ content: "", tool_calls: [{
          id: "weekday-groceries-1", name: "analyzeExpenses", args: {
            filter: { months: ["August"], categories: [" groceries "] }, groupBy: "dayOfWeek",
            aggregation: "sum", sort: { field: "total", direction: "desc" },
          },
        }] });
      }
      return new AIMessage("You usually bought groceries on Saturday (₹700), then Sunday (₹300)." );
    },
  }, {
    name: "getExpenses",
    async invoke() { rawExpenseToolCalled = true; return {}; },
  } as unknown as StructuredToolInterface, undefined, expenseCategoryVocabulary, undefined, undefined, createAnalyzeExpensesTool({
    monthTabs: ["August"],
    async listExpenses() {
      return [
        { date: "2026-08-01", category: "Groceries", description: "Market", amount: 500, sourceSheet: "August", sourceRow: 9 },
        { date: "2026-08-02", category: "Groceries", description: "Market", amount: 300, sourceSheet: "August", sourceRow: 10 },
        { date: "2026-08-08", category: "Groceries", description: "Market", amount: 200, sourceSheet: "August", sourceRow: 11 },
      ];
    },
  }));

  assert.deepEqual(await agent.respond("Which all day of the week I usually buy groceries in August month and how much each day sorting from highest to lowest"), {
    text: "You usually bought groceries on Saturday (₹700), then Sunday (₹300).",
  });
  assert.equal(rawExpenseToolCalled, false);
  const toolMessage = calls[1]?.find((message) => message instanceof ToolMessage);
  assert.ok(toolMessage);
  assert.deepEqual(JSON.parse(toolMessage.content.toString()), {
    filter: { months: ["August"], categories: ["Groceries"] }, groupBy: "dayOfWeek", aggregation: "sum",
    results: [{ key: "Saturday", total: 700 }, { key: "Sunday", total: 300 }], matchingExpenseCount: 3,
  });
});

test("maps distinct ranked-analysis phrasings to the same composable analysis tool", async () => {
  const specifications: unknown[] = [];
  for (const request of ["Which weekdays do I spend the most on groceries?", "What are my top five categories in August?"]) {
    const agent = new FinanceAgent({
      async sendMessagesWithTools(messages): Promise<AIMessage> {
        if (messages.some((message) => message instanceof ToolMessage)) return new AIMessage("Formatted deterministic analysis.");
        const groceries = request.startsWith("Which weekdays");
        return new AIMessage({ content: "", tool_calls: [{ id: request, name: "analyzeExpenses", args: groceries
          ? { filter: { categories: ["Groceries"] }, groupBy: "dayOfWeek", aggregation: "sum", sort: { field: "total", direction: "desc" } }
          : { filter: { months: ["August"] }, groupBy: "category", aggregation: "sum", sort: { field: "total", direction: "desc" }, limit: 5 },
        }] });
      },
    }, undefined, undefined, expenseCategoryVocabulary, undefined, undefined, {
      name: "analyzeExpenses",
      async invoke(input: unknown) { specifications.push(input); return { aggregation: "sum", results: [], matchingExpenseCount: 0 }; },
    } as unknown as StructuredToolInterface);
    await agent.respond(request);
  }
  assert.deepEqual(specifications, [
    { filter: { categories: ["Groceries"] }, groupBy: "dayOfWeek", aggregation: "sum", sort: { field: "total", direction: "desc" } },
    { filter: { months: ["August"] }, groupBy: "category", aggregation: "sum", sort: { field: "total", direction: "desc" }, limit: 5 },
  ]);
});
