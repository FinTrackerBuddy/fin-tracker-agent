import assert from "node:assert/strict";
import test from "node:test";

import type { ExpenseDataSource } from "../google-sheets/expense-data-source.js";
import {
  compareSpendingPeriods,
  createCompareSpendingPeriodsTool,
} from "./compare-spending-periods.js";

const source: ExpenseDataSource = {
  monthTabs: ["April", "July", "August", "September", "October", "November", "December", "January", "March"],
  async listExpenses() {
    return [
      { date: "2026-04-01", category: "Food", description: "April", amount: 100, sourceSheet: "April", sourceRow: 9 },
      { date: "2026-07-01", category: "Food", description: "July", amount: 500, sourceSheet: "July", sourceRow: 9 },
      { date: "2026-08-01", category: "Food", description: "August", amount: 100, sourceSheet: "August", sourceRow: 9 },
      { date: "2026-09-01", category: "Food", description: "September", amount: 150, sourceSheet: "September", sourceRow: 9 },
      { date: "2026-12-01", category: "Food", description: "December", amount: 100, sourceSheet: "December", sourceRow: 9 },
      { date: "2027-01-01", category: "Food", description: "January", amount: 50, sourceSheet: "January", sourceRow: 9 },
      { date: "2027-03-01", category: "Food", description: "March", amount: 25, sourceSheet: "March", sourceRow: 9 },
    ];
  },
};

test("compares August to September in caller order with deterministic totals and percentage", async () => {
  const result = await compareSpendingPeriods({ periods: [
    { label: "August", months: ["August"] },
    { label: "September", months: ["September"] },
  ] }, source);

  assert.deepEqual(result, {
    periods: [
      { label: "August", months: ["August"], total: 100 },
      { label: "September", months: ["September"], total: 150 },
    ],
    comparisons: [{ from: "August", to: "September", difference: 50, percentageChange: 50 }],
  });
});

test("preserves reverse September to August direction", async () => {
  const result = await compareSpendingPeriods({ periods: [
    { label: "September", months: ["September"] },
    { label: "August", months: ["August"] },
  ] }, source);

  assert.equal(result.comparisons[0]?.difference, -50);
  assert.ok(Math.abs((result.comparisons[0]?.percentageChange ?? 0) + (100 / 3)) < 1e-12);
  assert.deepEqual(result.comparisons[0] && { from: result.comparisons[0].from, to: result.comparisons[0].to }, {
    from: "September", to: "August",
  });
});

test("creates only adjacent comparisons for multiple ordered calendar months", async () => {
  const result = await compareSpendingPeriods({ periods: [
    { label: "August", months: ["August"] },
    { label: "September", months: ["September"] },
    { label: "October", months: ["October"] },
  ] }, source);

  assert.deepEqual(result.comparisons, [
    { from: "August", to: "September", difference: 50, percentageChange: 50 },
    { from: "September", to: "October", difference: -150, percentageChange: -100 },
  ]);
});

test("preserves calendar-adjacent December to January and March to April direction", async () => {
  const decemberToJanuary = await compareSpendingPeriods({ periods: [
    { label: "December", months: ["December"] },
    { label: "January", months: ["January"] },
  ] }, source);
  const marchToApril = await compareSpendingPeriods({ periods: [
    { label: "March", months: ["March"] },
    { label: "April", months: ["April"] },
  ] }, source);

  assert.deepEqual(decemberToJanuary.comparisons, [
    { from: "December", to: "January", difference: -50, percentageChange: -50 },
  ]);
  assert.deepEqual(marchToApril.comparisons, [
    { from: "March", to: "April", difference: 75, percentageChange: 300 },
  ]);
});

test("supports multi-month periods, deduplicates a period's month names, and retains period order", async () => {
  const result = await compareSpendingPeriods({ periods: [
    { label: "July and August", months: ["July", "August", "august"] },
    { label: "September and October", months: ["September", "October"] },
  ] }, source);

  assert.deepEqual(result, {
    periods: [
      { label: "July and August", months: ["July", "August"], total: 600 },
      { label: "September and October", months: ["September", "October"], total: 150 },
    ],
    comparisons: [{ from: "July and August", to: "September and October", difference: -450, percentageChange: -75 }],
  });
});

test("handles equal spending and zero baselines without invalid percentage values", async () => {
  const equal = await compareSpendingPeriods({ periods: [
    { label: "April", months: ["April"] },
    { label: "December", months: ["December"] },
  ] }, source);
  const zeroBaseline = await compareSpendingPeriods({ periods: [
    { label: "October", months: ["October"] },
    { label: "September", months: ["September"] },
  ] }, source);
  const bothZero = await compareSpendingPeriods({ periods: [
    { label: "October", months: ["October"] },
    { label: "November", months: ["November"] },
  ] }, source);

  assert.deepEqual(equal.comparisons, [{ from: "April", to: "December", difference: 0, percentageChange: 0 }]);
  assert.deepEqual(zeroBaseline.comparisons, [{ from: "October", to: "September", difference: 150, percentageChange: null }]);
  assert.deepEqual(bothZero.comparisons, [{ from: "October", to: "November", difference: 0, percentageChange: null }]);
});

test("validates period count, labels, and configured month names", async () => {
  await assert.rejects(compareSpendingPeriods({ periods: [] }, source), /at least one/);
  await assert.rejects(compareSpendingPeriods({ periods: [
    { label: "", months: ["August"] }, { label: "September", months: ["September"] },
  ] }, source), /non-empty label/);
  await assert.rejects(compareSpendingPeriods({ periods: [
    { label: "August", months: ["August"] }, { label: "august", months: ["September"] },
  ] }, source), /unique/);
  await assert.rejects(compareSpendingPeriods({ periods: [
    { label: "August", months: ["August"] }, { label: "Invalid", months: ["Expenses"] },
  ] }, source), /not configured/);
});

test("aggregates one filtered category in one month without a comparison", async () => {
  const result = await compareSpendingPeriods({
    categories: ["food"],
    periods: [{ label: "July", months: ["July"] }],
  }, source);

  assert.deepEqual(result, {
    categories: ["Food"],
    total: 500,
    periods: [{ label: "July", months: ["July"], total: 500 }],
    comparisons: [],
  });
});

test("aggregates multiple canonical categories across ordered periods and compares only filtered totals", async () => {
  const categorySource: ExpenseDataSource = {
    monthTabs: ["July", "August", "September"],
    async listExpenses() {
      return [
        { date: "2026-07-01", category: "Dining out", description: "Lunch", amount: 100, sourceSheet: "July", sourceRow: 9 },
        { date: "2026-07-02", category: "Food order", description: "Delivery", amount: 200, sourceSheet: "July", sourceRow: 10 },
        { date: "2026-07-03", category: "Travel", description: "Cab", amount: 900, sourceSheet: "July", sourceRow: 11 },
        { date: "2026-08-01", category: "Dining out", description: "Dinner", amount: 400, sourceSheet: "August", sourceRow: 9 },
        { date: "2026-08-02", category: "Food order", description: "Delivery", amount: 100, sourceSheet: "August", sourceRow: 10 },
        { date: "2026-08-03", category: "Travel", description: "Train", amount: 800, sourceSheet: "August", sourceRow: 11 },
      ];
    },
  };

  const result = await compareSpendingPeriods({
    categories: [" food ORDER ", "dining OUT"],
    periods: [
      { label: "August", months: ["August"] },
      { label: "July", months: ["July"] },
      { label: "September", months: ["September"] },
    ],
  }, categorySource);

  assert.deepEqual(result, {
    categories: ["Food order", "Dining out"],
    total: 800,
    periods: [
      { label: "August", months: ["August"], total: 500 },
      { label: "July", months: ["July"], total: 300 },
      { label: "September", months: ["September"], total: 0 },
    ],
    comparisons: [
      { from: "August", to: "July", difference: -200, percentageChange: -40 },
      { from: "July", to: "September", difference: -300, percentageChange: -100 },
    ],
  });
});

test("returns filtered zero baselines and empty matches deterministically", async () => {
  const result = await compareSpendingPeriods({
    categories: ["Food"],
    periods: [
      { label: "October", months: ["October"] },
      { label: "September", months: ["September"] },
    ],
  }, source);
  const noMatches = await compareSpendingPeriods({
    categories: ["Food"],
    periods: [{ label: "November", months: ["November"] }],
  }, source);

  assert.deepEqual(result.comparisons, [
    { from: "October", to: "September", difference: 150, percentageChange: null },
  ]);
  assert.deepEqual(noMatches, {
    categories: ["Food"],
    total: 0,
    periods: [{ label: "November", months: ["November"], total: 0 }],
    comparisons: [],
  });
});

test("rejects invalid category input without falling back to unfiltered totals", async () => {
  await assert.rejects(compareSpendingPeriods({
    categories: [],
    periods: [{ label: "July", months: ["July"] }],
  }, source), /at least one expense category/);
  await assert.rejects(compareSpendingPeriods({
    categories: ["Travel"],
    periods: [{ label: "July", months: ["July"] }],
  }, source), /Unknown expense category/);
});

test("exposes the comparison through the stable LangChain tool", async () => {
  const comparisonTool = createCompareSpendingPeriodsTool(source);
  const result = await comparisonTool.invoke({ periods: [
    { label: "August", months: ["August"] },
    { label: "September", months: ["September"] },
  ] });

  assert.deepEqual(result.comparisons, [
    { from: "August", to: "September", difference: 50, percentageChange: 50 },
  ]);
});
