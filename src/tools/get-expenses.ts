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

export interface Expense {
  date: string;
  category: string;
  description: string;
  amount: number;
  /** The ledger account is kept internally for account-type filtering. */
  account?: string;
}

export interface GetExpensesInput {
  /** @deprecated Prefer categories for new calls. */
  category?: string;
  /** Literal workbook category labels; each is matched deterministically. */
  categories?: string[];
  /** The actual monthly tab name, for example "April". */
  month?: string;
  /** Actual monthly tab names, useful for multi-month comparisons. */
  months?: string[];
  /** An ISO date mapped from the ledger's Google Sheets date serial. */
  date?: string;
  /** Payment method inferred from the ledger account label. */
  paymentMethod?: "cash";
}

export interface GetExpensesOutput {
  expenses: Expense[];
  total: number;
}

export async function getExpenses(
  input: GetExpensesInput = {},
  source?: ExpenseDataSource,
  logger?: ApplicationLogger,
): Promise<GetExpensesOutput> {
  const expenseSource = source ?? await createGoogleSheetsExpenseDataSourceFromEnvironment(process.env, logger);
  const months = resolveMonths(input, expenseSource.monthTabs);
  const date = normalizeIsoDate(input.date);
  const paymentMethod = input.paymentMethod;
  const sourceExpenses = await expenseSource.listExpenses();
  const requestedCategories = getRequestedCategories(input);
  const categorySelection = resolveExpenseCategories(
    requestedCategories,
    deriveExpenseCategories(sourceExpenses),
  );
  if (categorySelection.unknownCategories.length > 0) {
    throw new Error(
      `Unknown expense category: ${categorySelection.unknownCategories.join(", ")}. `
      + "Use a literal category from the current workbook vocabulary.",
    );
  }
  const normalizedCategories = new Set(
    categorySelection.categories.map(normalizeExpenseCategory),
  );
  const expenses = sourceExpenses
    .filter((expense) => !months || months.has(expense.sourceSheet))
    .filter((expense) => !date || expense.date === date)
    .filter((expense) => !paymentMethod || matchesPaymentMethod(expense, paymentMethod))
    .filter((expense) => normalizedCategories.size === 0
      || normalizedCategories.has(normalizeExpenseCategory(expense.category)))
    .map(({ date: expenseDate, category: expenseCategory, description, amount }) => ({
      date: expenseDate,
      category: expenseCategory,
      description,
      amount,
    }));

  return {
    expenses,
    total: expenses.reduce((sum, expense) => sum + expense.amount, 0),
  };
}

export function createGetExpensesTool(source?: ExpenseDataSource, logger?: ApplicationLogger) {
  return tool(
    async (input): Promise<GetExpensesOutput> => getExpenses(input, source, logger),
    {
      name: "getExpenses",
      description:
        "Get read-only expenses from the Google Sheets monthly ledger. Filter by exact category, one or more actual month tab names (April through March), ISO date (YYYY-MM-DD), or payment method. paymentMethod 'cash' matches cash accounts such as Pratheek Cash and Arya Cash; it does not require an account name supplied by the user.",
      schema: z.object({
        category: z
          .string()
          .optional()
          .describe("Deprecated single exact expense category. Prefer categories."),
        categories: z
          .array(z.string())
          .min(1)
          .optional()
          .describe("Optional literal workbook category labels to match exactly after trim/case normalization."),
        month: z
          .string()
          .optional()
          .describe("Optional actual monthly tab name, for example April."),
        months: z
          .array(z.string())
          .min(1)
          .optional()
          .describe("Optional actual monthly tab names for a multi-month period, for example [August, September]. Do not combine with month."),
        date: z
          .string()
          .optional()
          .describe("Optional ISO ledger date in YYYY-MM-DD format."),
        paymentMethod: z
          .enum(["cash"])
          .optional()
          .describe("Optional payment method. Use cash for any ledger account labelled as a cash account, including Pratheek Cash or Arya Cash."),
      }),
    },
  );
}

function getRequestedCategories(input: GetExpensesInput): string[] {
  if (input.categories && input.category) {
    throw new Error("Provide either category or categories, not both.");
  }
  if (input.categories) {
    if (input.categories.length === 0) {
      throw new Error("categories must include at least one expense category.");
    }
    return input.categories;
  }
  return input.category ? [input.category] : [];
}

export const getExpensesTool = createGetExpensesTool();

function resolveMonths(
  input: GetExpensesInput,
  configuredMonthTabs: readonly string[],
): Set<string> | undefined {
  if (input.month && input.months) {
    throw new Error("Provide either month or months, not both.");
  }
  const requestedMonths = input.months ?? (input.month ? [input.month] : []);
  if (requestedMonths.length === 0) {
    return undefined;
  }

  const months = new Set<string>();
  for (const requestedMonth of requestedMonths) {
    if (!requestedMonth?.trim()) {
      throw new Error("Each requested month must be a non-empty workbook month tab name.");
    }
    const normalizedMonth = requestedMonth.trim().toLowerCase();
    const month = configuredMonthTabs.find(
      (configuredMonth) => configuredMonth.toLowerCase() === normalizedMonth,
    );
    if (!month) {
      throw new Error(
        `Monthly ledger tab "${requestedMonth.trim()}" is not configured. Available tabs: ${configuredMonthTabs.join(", ")}.`,
      );
    }
    months.add(month);
  }
  return months;
}

function normalizeIsoDate(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const date = value.trim();
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || Number.isNaN(parsedDate.getTime())
    || parsedDate.toISOString().slice(0, 10) !== date
  ) {
    throw new Error("Expense date must use ISO format YYYY-MM-DD.");
  }
  return date;
}

function matchesPaymentMethod(expense: Expense, paymentMethod: "cash"): boolean {
  switch (paymentMethod) {
    case "cash":
      // Account labels include an owner prefix (for example, "Pratheek Cash").
      // Match the cash token rather than requiring an exact account label.
      return /\bcash\b/i.test(expense.account ?? "");
  }
}
