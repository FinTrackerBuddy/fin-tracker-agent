import assert from "node:assert/strict";
import test from "node:test";

import {
  CachedExpenseCategoryVocabulary,
  deriveExpenseCategories,
  resolveExpenseCategories,
} from "./expense-category-vocabulary.js";

test("derives compact distinct labels using the existing trim/case normalization", () => {
  assert.deepEqual(deriveExpenseCategories([
    { category: " Food order " },
    { category: "food ORDER" },
    { category: "Dining out" },
  ]), ["Dining out", "Food order"]);
});

test("resolves only known labels to literal workbook categories", () => {
  assert.deepEqual(
    resolveExpenseCategories([" food order ", "DINING OUT", "Food"], ["Food order", "Dining out"]),
    { categories: ["Food order", "Dining out"], unknownCategories: ["Food"] },
  );
});

test("caches the compact vocabulary instead of rereading it on every request", async () => {
  let reads = 0;
  let now = 100;
  const vocabulary = new CachedExpenseCategoryVocabulary(async () => ({
    monthTabs: ["September"],
    async listExpenses() {
      reads += 1;
      return [{ category: "Food order" } as never];
    },
  }), () => now, 50);

  assert.deepEqual(await vocabulary.listCategories(), ["Food order"]);
  assert.deepEqual(await vocabulary.listCategories(), ["Food order"]);
  assert.equal(reads, 1);
  now = 150;
  await vocabulary.listCategories();
  assert.equal(reads, 2);
});
