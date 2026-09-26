import { tool } from "@langchain/core/tools";
import { z } from "zod";

import {
  createGoogleSheetsExpenseDataSourceFromEnvironment,
  type ExpenseDataSource,
} from "../google-sheets/expense-data-source.js";
import {
  deriveExpenseCategories,
  normalizeExpenseCategory,
  resolveExpenseCategories,
} from "../google-sheets/expense-category-vocabulary.js";
import { type ApplicationLogger } from "../logging/application-logger.js";

export interface SpendingPeriodInput {
  label: string;
  months: string[];
}

export interface CompareSpendingPeriodsInput {
  /** Optional literal workbook category labels to include in every period. */
  categories?: string[];
  /** Optional exact ledger descriptions to include in every period. */
  descriptions?: string[];
  /** Ordered periods; comparisons are made only between adjacent entries. */
  periods: SpendingPeriodInput[];
}

export interface SpendingPeriodTotal {
  label: string;
  months: string[];
  total: number;
}

export interface SpendingPeriodComparison {
  from: string;
  to: string;
  /** to.total - from.total */
  difference: number;
  /** Null when the baseline period has zero spending. */
  percentageChange: number | null;
}

export interface CompareSpendingPeriodsOutput {
  /** Present only when the calculation was filtered to workbook categories. */
  categories?: string[];
  /** Present only when the calculation was filtered to exact ledger descriptions. */
  descriptions?: string[];
  /** Sum of the returned filtered period totals, when a filter is supplied. */
  total?: number;
  periods: SpendingPeriodTotal[];
  comparisons: SpendingPeriodComparison[];
}

/**
 * Deterministically compares ordered periods from the existing debit-only
 * expense source. Input order is retained; this tool never infers or changes
 * a caller's calendar or financial-year ordering.
 */
export async function compareSpendingPeriods(
  input: CompareSpendingPeriodsInput,
  source?: ExpenseDataSource,
  logger?: ApplicationLogger,
): Promise<CompareSpendingPeriodsOutput> {
  const expenseSource = source
    ?? await createGoogleSheetsExpenseDataSourceFromEnvironment(process.env, logger);
  const periods = resolvePeriods(input, expenseSource.monthTabs);
  const expenses = await expenseSource.listExpenses();
  const categories = resolveCategories(input.categories, expenses);
  const descriptions = resolveDescriptions(input.descriptions, expenses);
  const normalizedCategories = new Set(categories.map(normalizeExpenseCategory));
  const selectedDescriptions = new Set(descriptions);
  const totalsByMonth = new Map<string, number>();

  for (const expense of expenses) {
    if (normalizedCategories.size > 0
      && !normalizedCategories.has(normalizeExpenseCategory(expense.category))) {
      continue;
    }
    if (selectedDescriptions.size > 0 && !selectedDescriptions.has(expense.description)) continue;
    totalsByMonth.set(expense.sourceSheet, (totalsByMonth.get(expense.sourceSheet) ?? 0) + expense.amount);
  }

  const periodTotals = periods.map(({ label, months }) => ({
    label,
    months,
    total: months.reduce((total, month) => total + (totalsByMonth.get(month) ?? 0), 0),
  }));

  return {
    ...((categories.length > 0 || descriptions.length > 0)
      ? {
        ...(categories.length > 0 ? { categories } : {}),
        ...(descriptions.length > 0 ? { descriptions } : {}),
        total: periodTotals.reduce((total, period) => total + period.total, 0),
      }
      : {}),
    periods: periodTotals,
    comparisons: periodTotals.slice(1).map((period, index) => {
      const previous = periodTotals[index]!;
      const difference = period.total - previous.total;
      return {
        from: previous.label,
        to: period.label,
        difference,
        percentageChange: previous.total === 0 ? null : (difference / previous.total) * 100,
      };
    }),
  };
}

export function createCompareSpendingPeriodsTool(
  source?: ExpenseDataSource,
  logger?: ApplicationLogger,
) {
  return tool(
    async (input): Promise<CompareSpendingPeriodsOutput> =>
      compareSpendingPeriods(input, source, logger),
    {
      name: "compareSpendingPeriods",
      description:
        "Get deterministic totals for one or more ordered month-based periods, optionally filtered to literal workbook expense categories and/or exact ledger descriptions. Description filtering never normalizes or merges variants. Use for category or exact-item spending analysis by month/period, comparisons, increases, decreases, differences, or percentage changes. Preserve the user's period order. Each period has a unique label and one or more actual workbook month tabs (April through March).",
      schema: z.object({
        categories: z.array(z.string()).min(1).optional()
          .describe("Optional literal workbook category labels. When supplied, every period total and comparison includes only these categories."),
        descriptions: z.array(z.string()).min(1).optional()
          .describe("Optional exact ledger descriptions. When supplied, every period total and comparison includes only exactly matching descriptions; do not treat variants as equivalent."),
        periods: z.array(z.object({
          label: z.string().min(1).describe("Unique user-facing period label, for example August."),
          months: z.array(z.string()).min(1).describe("Actual workbook month tabs included in this period."),
        })).min(1).describe("One or more periods in the requested order; adjacent comparisons are returned when there is more than one."),
      }),
    },
  );
}

export const compareSpendingPeriodsTool = createCompareSpendingPeriodsTool();

function resolvePeriods(
  input: CompareSpendingPeriodsInput,
  configuredMonthTabs: readonly string[],
): Array<{ label: string; months: string[] }> {
  if (!input || !Array.isArray(input.periods) || input.periods.length < 1) {
    throw new Error("periods must include at least one ordered period.");
  }

  const labels = new Set<string>();
  return input.periods.map((period) => {
    if (!period || typeof period.label !== "string" || !period.label.trim()) {
      throw new Error("Each comparison period must have a non-empty label.");
    }
    const label = period.label.trim();
    const normalizedLabel = label.toLowerCase();
    if (labels.has(normalizedLabel)) {
      throw new Error(`Comparison period labels must be unique: ${label}.`);
    }
    labels.add(normalizedLabel);

    if (!Array.isArray(period.months) || period.months.length === 0) {
      throw new Error(`Comparison period "${label}" must include at least one workbook month tab.`);
    }
    const normalizedMonths = new Set<string>();
    const months: string[] = [];
    for (const requestedMonth of period.months) {
      if (typeof requestedMonth !== "string" || !requestedMonth.trim()) {
        throw new Error("Each requested month must be a non-empty workbook month tab name.");
      }
      const configuredMonth = configuredMonthTabs.find(
        (month) => month.toLowerCase() === requestedMonth.trim().toLowerCase(),
      );
      if (!configuredMonth) {
        throw new Error(
          `Monthly ledger tab "${requestedMonth.trim()}" is not configured. Available tabs: ${configuredMonthTabs.join(", ")}.`,
        );
      }
      if (!normalizedMonths.has(configuredMonth.toLowerCase())) {
        normalizedMonths.add(configuredMonth.toLowerCase());
        months.push(configuredMonth);
      }
    }
    return { label, months };
  });
}

function resolveCategories(
  requestedCategories: readonly string[] | undefined,
  expenses: readonly { category: string }[],
): string[] {
  if (requestedCategories === undefined) {
    return [];
  }
  if (requestedCategories.length === 0) {
    throw new Error("categories must include at least one expense category.");
  }
  if (!requestedCategories.every((category) => typeof category === "string")) {
    throw new Error("Each requested category must be a string.");
  }

  const selection = resolveExpenseCategories(
    requestedCategories,
    deriveExpenseCategories(expenses),
  );
  if (selection.unknownCategories.length > 0) {
    throw new Error(
      `Unknown expense category: ${selection.unknownCategories.join(", ")}. `
      + "Use a literal category from the current workbook vocabulary.",
    );
  }
  return selection.categories;
}

function resolveDescriptions(
  requestedDescriptions: readonly string[] | undefined,
  expenses: readonly { description: string }[],
): string[] {
  if (requestedDescriptions === undefined) return [];
  if (requestedDescriptions.length === 0 || !requestedDescriptions.every((description) => typeof description === "string" && description.trim())) {
    throw new Error("descriptions must include non-empty strings.");
  }
  const descriptions = [...new Set(requestedDescriptions)];
  const availableDescriptions = new Set(expenses.map((expense) => expense.description));
  if (descriptions.some((description) => !availableDescriptions.has(description))) {
    throw new Error("Unknown expense description. Description filters require an exact current ledger description.");
  }
  return descriptions;
}
