import assert from "node:assert/strict";
import test from "node:test";

import type { ExpenseDataSource } from "../google-sheets/expense-data-source.js";
import { analyzeExpenses, createAnalyzeExpensesTool } from "./analyze-expenses.js";

const source: ExpenseDataSource = {
  monthTabs: ["April", "July", "August", "September"],
  async listExpenses() {
    return [
      { date: "2026-04-01", category: "Groceries", description: "April market", amount: 100, sourceSheet: "April", sourceRow: 9, account: "Pratheek Cash" },
      { date: "2026-07-04", category: "Dining out", description: "July lunch", amount: 120, sourceSheet: "July", sourceRow: 9, account: "Pratheek SCB" },
      { date: "2026-07-10", category: "Food order", description: "July delivery", amount: 180, sourceSheet: "July", sourceRow: 10, account: "Pratheek Cash" },
      { date: "2026-08-01", category: "Groceries", description: "Saturday market", amount: 500, sourceSheet: "August", sourceRow: 9, account: "Pratheek Cash" },
      { date: "2026-08-02", category: "Groceries", description: "Sunday market", amount: 300, sourceSheet: "August", sourceRow: 10, account: "Pratheek SCB" },
      { date: "2026-08-08", category: "Groceries", description: "Saturday market", amount: 200, sourceSheet: "August", sourceRow: 11, account: "Arya Cash" },
      { date: "2026-08-09", category: "Dining out", description: "Dinner", amount: 250, sourceSheet: "August", sourceRow: 12, account: "Pratheek SCB" },
      { date: "2026-08-10", category: "Food order", description: "Delivery", amount: 150, sourceSheet: "August", sourceRow: 13, account: "Pratheek Cash" },
      { date: "2026-09-01", category: "Travel", description: "Metro", amount: 400, sourceSheet: "September", sourceRow: 9, account: "Pratheek SCB" },
    ];
  },
};

test("deterministically groups August groceries by weekday and sums descending", async () => {
  const result = await analyzeExpenses({
    filter: { months: ["August"], categories: [" groceries "] },
    groupBy: "dayOfWeek",
    aggregation: "sum",
    sort: { field: "total", direction: "desc" },
  }, source);

  assert.deepEqual(result, {
    filter: { months: ["August"], categories: ["Groceries"] },
    groupBy: "dayOfWeek",
    aggregation: "sum",
    results: [{ key: "Saturday", total: 700 }, { key: "Sunday", total: 300 }],
    matchingExpenseCount: 3,
  });
});

test("composes category, month, account, top-N, and multiple filters", async () => {
  const categories = await analyzeExpenses({
    filter: { months: ["August"] }, groupBy: "category", aggregation: "sum", sort: { field: "total", direction: "desc" }, limit: 5,
  }, source);
  const months = await analyzeExpenses({
    filter: { months: ["April", "July", "August", "September"] }, groupBy: "month", aggregation: "sum", sort: { field: "total", direction: "asc" },
  }, source);
  const accounts = await analyzeExpenses({
    filter: { months: ["August"] }, groupBy: "account", aggregation: "sum", sort: { field: "total", direction: "desc" },
  }, source);
  const foodByMonth = await analyzeExpenses({
    filter: { months: ["July", "August"], categories: ["Dining out", "Food order"] }, groupBy: "month", aggregation: "sum", sort: { field: "total", direction: "desc" },
  }, source);

  assert.deepEqual(categories.results, [
    { key: "Groceries", total: 1000 }, { key: "Dining out", total: 250 }, { key: "Food order", total: 150 },
  ]);
  assert.deepEqual(months.results, [
    { key: "April", total: 100 }, { key: "July", total: 300 }, { key: "September", total: 400 }, { key: "August", total: 1400 },
  ]);
  assert.deepEqual(accounts.results, [
    { key: "Pratheek Cash", total: 650 }, { key: "Pratheek SCB", total: 550 }, { key: "Arya Cash", total: 200 }]);
  assert.deepEqual(foodByMonth.results, [{ key: "August", total: 400 }, { key: "July", total: 300 }]);
});

test("supports count aggregation, date/account/payment filters, and valid empty results", async () => {
  const count = await analyzeExpenses({
    filter: { months: ["August"], paymentMethod: "cash" }, groupBy: "category", aggregation: "count", sort: { field: "count", direction: "desc" },
  }, source);
  const empty = await analyzeExpenses({
    filter: { date: "2026-08-31", accounts: ["Pratheek Cash"] }, groupBy: "category", aggregation: "sum",
  }, source);

  assert.deepEqual(count.results, [{ key: "Groceries", count: 2 }, { key: "Food order", count: 1 }]);
  assert.deepEqual(empty, {
    filter: { date: "2026-08-31", accounts: ["Pratheek Cash"] }, groupBy: "category", aggregation: "sum", results: [], matchingExpenseCount: 0,
  });
});

test("rejects invalid closed specifications deterministically", async () => {
  await assert.rejects(analyzeExpenses({ filter: { categories: ["Food"] }, aggregation: "sum" }, source), /Unknown expense category/);
  await assert.rejects(analyzeExpenses({ groupBy: "merchant" as never, aggregation: "sum" }, source), /Invalid option/);
  await assert.rejects(analyzeExpenses({ aggregation: "average" as never }, source), /Invalid option/);
  await assert.rejects(analyzeExpenses({ aggregation: "sum", sort: { field: "count", direction: "desc" } }, source), /sort.field must be total/);
  await assert.rejects(analyzeExpenses({ aggregation: "sum", limit: 0 }, source), /Too small/);
  await assert.rejects(analyzeExpenses({ filter: { startDate: "2026-08-10", endDate: "2026-08-01" }, aggregation: "sum" }, source), /startDate/);
});

test("exposes the same closed specification through one LangChain tool", async () => {
  const result = await createAnalyzeExpensesTool(source).invoke({
    filter: { months: ["August"] }, groupBy: "category", aggregation: "sum", sort: { field: "total", direction: "desc" }, limit: 1,
  });
  assert.deepEqual(result.results, [{ key: "Groceries", total: 1000 }]);
});
