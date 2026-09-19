import { tool } from "@langchain/core/tools";
import { z } from "zod";

import {
  createGoogleSheetsExpenseDataSourceFromEnvironment,
  type ExpenseDataSource,
  type GoogleSheetsExpense,
} from "../google-sheets/expense-data-source.js";
import {
  deriveExpenseCategories,
  normalizeExpenseCategory,
  resolveExpenseCategories,
} from "../google-sheets/expense-category-vocabulary.js";
import { type ApplicationLogger } from "../logging/application-logger.js";

/** The intentionally finite set of dimensions supported by the expense ledger. */
export type ExpenseGroupDimension = "month" | "dayOfWeek" | "category" | "account";
export type ExpenseAggregation = "sum" | "count";
export type ExpenseSortField = "total" | "count";
export type SortDirection = "asc" | "desc";

export interface ExpenseAnalysisFilter {
  months?: string[];
  /** Exact ISO ledger date. Do not combine with startDate/endDate. */
  date?: string;
  /** Inclusive ISO ledger-date range. */
  startDate?: string;
  /** Inclusive ISO ledger-date range. */
  endDate?: string;
  /** Literal current-workbook category labels, canonicalized before analysis. */
  categories?: string[];
  /** Exact ledger account labels, matched case-insensitively after trimming. */
  accounts?: string[];
  /** Account-type filter supported by the current workbook. */
  paymentMethod?: "cash";
}

/** Closed, data-only analysis specification. It never accepts expressions or code. */
export interface ExpenseAnalysisSpec {
  filter?: ExpenseAnalysisFilter;
  groupBy?: ExpenseGroupDimension;
  aggregation: ExpenseAggregation;
  sort?: { field: ExpenseSortField; direction: SortDirection };
  /** Bounded top-N result count. */
  limit?: number;
}

export interface ExpenseAnalysisResult {
  key: string;
  total?: number;
  count?: number;
}

export interface ExpenseAnalysisOutput {
  filter?: Omit<ExpenseAnalysisFilter, "categories"> & { categories?: string[] };
  groupBy?: ExpenseGroupDimension;
  aggregation: ExpenseAggregation;
  results: ExpenseAnalysisResult[];
  matchingExpenseCount: number;
}

const analysisSchema = z.object({
  filter: z.object({
    months: z.array(z.string()).min(1).optional(),
    date: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    categories: z.array(z.string()).min(1).optional(),
    accounts: z.array(z.string()).min(1).optional(),
    paymentMethod: z.enum(["cash"]).optional(),
  }).optional(),
  groupBy: z.enum(["month", "dayOfWeek", "category", "account"]).optional(),
  aggregation: z.enum(["sum", "count"]),
  sort: z.object({
    field: z.enum(["total", "count"]),
    direction: z.enum(["asc", "desc"]),
  }).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

/**
 * Runs a closed, composable analysis specification over normalized debit
 * expenses. All filtering, grouping, aggregation, and sorting happens here,
 * never in the LLM.
 */
export async function analyzeExpenses(
  input: ExpenseAnalysisSpec,
  source?: ExpenseDataSource,
  logger?: ApplicationLogger,
): Promise<ExpenseAnalysisOutput> {
  const specification = analysisSchema.parse(input) as ExpenseAnalysisSpec;
  validateSortForAggregation(specification);
  const expenseSource = source
    ?? await createGoogleSheetsExpenseDataSourceFromEnvironment(process.env, logger);
  const expenses = await expenseSource.listExpenses();
  const filter = resolveFilter(specification.filter, expenseSource.monthTabs, expenses);
  const matchingExpenses = expenses.filter((expense) => matchesFilter(expense, filter));
  const values = new Map<string, { total: number; count: number }>();

  for (const expense of matchingExpenses) {
    const key = getGroupKey(expense, specification.groupBy);
    const value = values.get(key) ?? { total: 0, count: 0 };
    value.total += expense.amount;
    value.count += 1;
    values.set(key, value);
  }

  const results = [...values.entries()].map(([key, value]) => specification.aggregation === "sum"
    ? { key, total: value.total }
    : { key, count: value.count });
  sortResults(results, specification.sort);

  return {
    ...(filter ? { filter } : {}),
    ...(specification.groupBy ? { groupBy: specification.groupBy } : {}),
    aggregation: specification.aggregation,
    results: specification.limit === undefined ? results : results.slice(0, specification.limit),
    matchingExpenseCount: matchingExpenses.length,
  };
}

export function createAnalyzeExpensesTool(source?: ExpenseDataSource, logger?: ApplicationLogger) {
  return tool(
    async (input): Promise<ExpenseAnalysisOutput> => analyzeExpenses(input, source, logger),
    {
      name: "analyzeExpenses",
      description: "Run a deterministic, composable expense analysis. It filters normalized debit expenses, groups only by month, dayOfWeek, category, or account, then deterministically sums or counts, sorts, and optionally limits results. Use this instead of getExpenses whenever the user asks for grouped, ranked, top-N, or aggregated analysis. Do not calculate from raw transactions yourself.",
      schema: analysisSchema,
    },
  );
}

export const analyzeExpensesTool = createAnalyzeExpensesTool();

function resolveFilter(
  input: ExpenseAnalysisFilter | undefined,
  configuredMonths: readonly string[],
  expenses: readonly GoogleSheetsExpense[],
): ExpenseAnalysisOutput["filter"] | undefined {
  if (!input) return undefined;
  if (input.date && (input.startDate || input.endDate)) {
    throw new Error("Provide either date or startDate/endDate, not both.");
  }
  const date = normalizeIsoDate(input.date);
  const startDate = normalizeIsoDate(input.startDate);
  const endDate = normalizeIsoDate(input.endDate);
  if (startDate && endDate && startDate > endDate) {
    throw new Error("startDate must be on or before endDate.");
  }
  const months = input.months ? resolveMonths(input.months, configuredMonths) : undefined;
  const categories = input.categories ? resolveCategories(input.categories, expenses) : undefined;
  const accounts = input.accounts ? normalizeNonEmptyStrings(input.accounts, "accounts") : undefined;
  return {
    ...(months ? { months: [...months] } : {}),
    ...(date ? { date } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    ...(categories ? { categories } : {}),
    ...(accounts ? { accounts } : {}),
    ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
  };
}

function matchesFilter(expense: GoogleSheetsExpense, filter: ExpenseAnalysisOutput["filter"] | undefined): boolean {
  if (!filter) return true;
  if (filter.months && !filter.months.includes(expense.sourceSheet)) return false;
  if (filter.date && expense.date !== filter.date) return false;
  if (filter.startDate && expense.date < filter.startDate) return false;
  if (filter.endDate && expense.date > filter.endDate) return false;
  if (filter.categories && !filter.categories.some((category) => normalizeExpenseCategory(category) === normalizeExpenseCategory(expense.category))) return false;
  if (filter.accounts && !filter.accounts.some((account) => normalizeText(account) === normalizeText(expense.account ?? ""))) return false;
  return !filter.paymentMethod || /\bcash\b/i.test(expense.account ?? "");
}

function getGroupKey(expense: GoogleSheetsExpense, groupBy: ExpenseGroupDimension | undefined): string {
  switch (groupBy) {
    case "month": return expense.sourceSheet;
    case "dayOfWeek": return dayOfWeek(expense.date);
    case "category": return expense.category;
    case "account": return expense.account?.trim() || "Unspecified";
    default: return "All expenses";
  }
}

function sortResults(results: ExpenseAnalysisResult[], sort: ExpenseAnalysisSpec["sort"]): void {
  results.sort((left, right) => {
    if (!sort) return left.key.localeCompare(right.key);
    const leftValue = sort.field === "total" ? left.total : left.count;
    const rightValue = sort.field === "total" ? right.total : right.count;
    const difference = (leftValue ?? 0) - (rightValue ?? 0);
    return difference === 0 ? left.key.localeCompare(right.key) : sort.direction === "asc" ? difference : -difference;
  });
}

function validateSortForAggregation(specification: ExpenseAnalysisSpec): void {
  if (specification.sort && specification.sort.field !== (specification.aggregation === "sum" ? "total" : "count")) {
    throw new Error(`sort.field must be ${specification.aggregation === "sum" ? "total" : "count"} when aggregation is ${specification.aggregation}.`);
  }
}

function resolveMonths(requestedMonths: readonly string[], configuredMonths: readonly string[]): string[] {
  const resolved: string[] = [];
  for (const requestedMonth of normalizeNonEmptyStrings(requestedMonths, "months")) {
    const month = configuredMonths.find((candidate) => normalizeText(candidate) === normalizeText(requestedMonth));
    if (!month) throw new Error(`Monthly ledger tab "${requestedMonth}" is not configured. Available tabs: ${configuredMonths.join(", ")}.`);
    if (!resolved.includes(month)) resolved.push(month);
  }
  return resolved;
}

function resolveCategories(requestedCategories: readonly string[], expenses: readonly GoogleSheetsExpense[]): string[] {
  const selection = resolveExpenseCategories(normalizeNonEmptyStrings(requestedCategories, "categories"), deriveExpenseCategories(expenses));
  if (selection.unknownCategories.length > 0) {
    throw new Error(`Unknown expense category: ${selection.unknownCategories.join(", ")}. Use a literal category from the current workbook vocabulary.`);
  }
  return selection.categories;
}

function normalizeNonEmptyStrings(values: readonly string[], field: string): string[] {
  const normalized = values.map((value) => typeof value === "string" ? value.trim() : "");
  if (normalized.length === 0 || normalized.some((value) => !value)) throw new Error(`${field} must include non-empty strings.`);
  return [...new Set(normalized)];
}

function normalizeIsoDate(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date = value.trim();
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("Expense date must use ISO format YYYY-MM-DD.");
  }
  return date;
}

function dayOfWeek(date: string): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(`${date}T00:00:00Z`).getUTCDay()]!;
}

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase();
}
