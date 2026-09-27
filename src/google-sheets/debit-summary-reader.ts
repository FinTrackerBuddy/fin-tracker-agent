import {
  DEFAULT_EXPENSE_MONTH_TABS,
  getDebitSummaryA1Range,
  type GoogleSheetsLedgerConfiguration,
} from "./config.js";
import type { GoogleSheetsApiClient } from "./sheets-api.js";

/** One effective debit total from the workbook's category-by-month matrix. */
export interface DebitSummaryAmount {
  category: string;
  month: string;
  amount: number;
}

/**
 * Reads the formula-backed Debit summary once instead of scanning every ledger
 * tab when an answer needs only category/month monetary totals.
 */
export class GoogleSheetsDebitSummaryReader {
  public constructor(
    private readonly configuration: Pick<GoogleSheetsLedgerConfiguration, "spreadsheetId" | "monthTabs">,
    private readonly sheetsApi: GoogleSheetsApiClient,
  ) {}

  public async readDebitSummary(): Promise<DebitSummaryAmount[]> {
    const range = getDebitSummaryA1Range();
    let response;
    try {
      response = await this.sheetsApi.getValues(this.configuration.spreadsheetId, range);
    } catch (error) {
      throw new Error("Unable to read Debit summary.", { cause: error });
    }

    const configuredMonths = new Set(this.configuration.monthTabs);
    const amounts: DebitSummaryAmount[] = [];
    for (const row of response.values) {
      const category = summaryCategory(row[1]);
      if (!category || isTotalRow(category) || !row.some((value, index) => index >= 2 && typeof value === "number")) {
        continue;
      }
      for (const [index, month] of DEFAULT_EXPENSE_MONTH_TABS.entries()) {
        if (!configuredMonths.has(month)) continue;
        amounts.push({ category, month, amount: summaryAmount(row[index + 2], category, month) });
      }
    }
    return amounts;
  }
}

function summaryCategory(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isTotalRow(category: string): boolean {
  return /^grand\s+total$|^total(?:\s|$)/i.test(category);
}

function summaryAmount(value: unknown, category: string, month: string): number {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Malformed Debit summary value for ${category} in ${month}.`);
  }
  return value;
}
