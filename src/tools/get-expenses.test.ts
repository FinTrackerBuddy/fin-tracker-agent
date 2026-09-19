import assert from "node:assert/strict";
import test from "node:test";

import type { ExpenseDataSource } from "../google-sheets/expense-data-source.js";
import { createGetExpensesTool, getExpenses } from "./get-expenses.js";

const source: ExpenseDataSource = {
  monthTabs: ["April", "May"],
  async listExpenses() {
    return [
      { date: "2026-04-01", category: "Groceries", description: "Weekly groceries", amount: 824.82, sourceSheet: "April", sourceRow: 9 },
      { date: "2026-04-02", category: "Transport", description: "Metro pass", amount: 120, sourceSheet: "April", sourceRow: 10 },
      { date: "2026-05-03", category: "Groceries", description: "Market purchase", amount: 200, sourceSheet: "May", sourceRow: 9 },
    ];
  },
};

test("reads expenses from the injected Sheets data source and filters by month/date", async () => {
  const result = await getExpenses({ month: "april", date: "2026-04-01" }, source);

  assert.deepEqual(result, {
    expenses: [{ date: "2026-04-01", category: "Groceries", description: "Weekly groceries", amount: 824.82 }],
    total: 824.82,
  });
});

test("filters Google Sheets expenses by category through the stable LangChain tool", async () => {
  const getExpensesTool = createGetExpensesTool(source);
  const result = await getExpensesTool.invoke({ category: "groceries", month: "May" });

  assert.deepEqual(result, {
    expenses: [{ date: "2026-05-03", category: "Groceries", description: "Market purchase", amount: 200 }],
    total: 200,
  });
});

test("matches multiple literal categories and preserves trim/case-normalized exact matching", async () => {
  const result = await getExpenses({
    categories: [" food order ", "DINING OUT"],
  }, {
    monthTabs: ["September"],
    async listExpenses() {
      return [
        { date: "2026-09-01", category: "Food order", description: "Delivery", amount: 450, sourceSheet: "September", sourceRow: 9 },
        { date: "2026-09-02", category: "Dining out", description: "Lunch", amount: 300, sourceSheet: "September", sourceRow: 10 },
        { date: "2026-09-03", category: "Groceries", description: "Market", amount: 900, sourceSheet: "September", sourceRow: 11 },
      ];
    },
  });

  assert.deepEqual(result, {
    expenses: [
      { date: "2026-09-01", category: "Food order", description: "Delivery", amount: 450 },
      { date: "2026-09-02", category: "Dining out", description: "Lunch", amount: 300 },
    ],
    total: 750,
  });
});

test("rejects categories that are absent from the current workbook vocabulary", async () => {
  await assert.rejects(
    getExpenses({ categories: ["Food"] }, source),
    /Unknown expense category: Food/,
  );
});

test("rejects invalid dates and month tabs before reading the source", async () => {
  await assert.rejects(getExpenses({ date: "04-01-2026" }, source), /ISO format/);
  await assert.rejects(getExpenses({ date: "2026-02-30" }, source), /ISO format/);
  await assert.rejects(getExpenses({ month: "Expenses" }, source), /not configured/);
  await assert.rejects(getExpenses({ month: "April", months: ["May"] }, source), /either month or months/);
});

test("filters cash spending by a cash-labelled account without requiring an exact account name", async () => {
  const result = await getExpenses({ paymentMethod: "cash", months: ["August", "September"] }, {
    monthTabs: ["August", "September"],
    async listExpenses() {
      return [
        { date: "2026-08-01", category: "Groceries", description: "Market", amount: 300, sourceSheet: "August", sourceRow: 9, account: "Pratheek Cash" },
        { date: "2026-08-02", category: "Transport", description: "Taxi", amount: 250, sourceSheet: "August", sourceRow: 10, account: "Arya Cash" },
        { date: "2026-09-01", category: "Groceries", description: "Store", amount: 900, sourceSheet: "September", sourceRow: 9, account: "Pratheek SCB" },
        { date: "2026-07-01", category: "Groceries", description: "Old market", amount: 100, sourceSheet: "July", sourceRow: 9, account: "Pratheek Cash" },
      ];
    },
  });

  assert.deepEqual(result, {
    expenses: [
      { date: "2026-08-01", category: "Groceries", description: "Market", amount: 300 },
      { date: "2026-08-02", category: "Transport", description: "Taxi", amount: 250 },
    ],
    total: 550,
  });
});
