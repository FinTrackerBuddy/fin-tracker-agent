import {
  createGoogleSheetsExpenseDataSourceFromEnvironment,
  type ExpenseDataSource,
} from "./expense-data-source.js";

/** Compact, read-only category catalog used for LLM context and validation. */
export interface ExpenseCategoryVocabularyProvider {
  listCategories(): Promise<readonly string[]>;
}

/**
 * The existing ledger reader trims labels as it parses them. Matching remains
 * case-insensitive, exactly as the original single-category tool did.
 */
export function normalizeExpenseCategory(category: string): string {
  return category.trim().toLowerCase();
}

export function deriveExpenseCategories(
  expenses: readonly { category: string }[],
): string[] {
  const canonicalByNormalized = new Map<string, string>();

  for (const expense of expenses) {
    const normalized = normalizeExpenseCategory(expense.category);
    if (normalized && !canonicalByNormalized.has(normalized)) {
      canonicalByNormalized.set(normalized, expense.category.trim());
    }
  }

  return [...canonicalByNormalized.values()].sort((left, right) =>
    left.localeCompare(right, "en-US"),
  );
}

/** Resolves requested labels to their literal workbook labels. */
export function resolveExpenseCategories(
  requestedCategories: readonly string[],
  knownCategories: readonly string[],
): { categories: string[]; unknownCategories: string[] } {
  const canonicalByNormalized = new Map(
    knownCategories.map((category) => [normalizeExpenseCategory(category), category]),
  );
  const categories: string[] = [];
  const unknownCategories: string[] = [];

  for (const requestedCategory of requestedCategories) {
    const normalized = normalizeExpenseCategory(requestedCategory);
    const canonical = canonicalByNormalized.get(normalized);
    if (!normalized || !canonical) {
      unknownCategories.push(requestedCategory);
    } else if (!categories.includes(canonical)) {
      categories.push(canonical);
    }
  }

  return { categories, unknownCategories };
}

/**
 * Caches only the compact distinct-label catalog. Expense rows are not sent to
 * the LLM and are still retrieved by getExpenses only when needed.
 */
export class CachedExpenseCategoryVocabulary
  implements ExpenseCategoryVocabularyProvider {
  private cachedCategories?: readonly string[];
  private expiresAt = 0;

  public constructor(
    private readonly sourceFactory: () => Promise<ExpenseDataSource>,
    private readonly now: () => number = Date.now,
    private readonly cacheTtlMilliseconds = 5 * 60 * 1000,
  ) {}

  public async listCategories(): Promise<readonly string[]> {
    if (this.cachedCategories && this.now() < this.expiresAt) {
      return this.cachedCategories;
    }

    const source = await this.sourceFactory();
    const categories = deriveExpenseCategories(await source.listExpenses());
    this.cachedCategories = categories;
    this.expiresAt = this.now() + this.cacheTtlMilliseconds;
    return categories;
  }
}

/** Shared production catalog prevents a workbook scan on every agent request. */
export const expenseCategoryVocabulary = new CachedExpenseCategoryVocabulary(
  () => createGoogleSheetsExpenseDataSourceFromEnvironment(),
);
