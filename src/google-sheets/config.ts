export const DEFAULT_EXPENSE_MONTH_TABS = [
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "January",
  "February",
  "March",
] as const;

export const DEFAULT_MONTHLY_LEDGER_RANGE = "A9:G";

export interface GoogleSheetsLedgerConfiguration {
  spreadsheetId: string;
  monthTabs: string[];
  ledgerRange: string;
}

export function loadGoogleSheetsLedgerConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): GoogleSheetsLedgerConfiguration {
  const spreadsheetId = environment.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID must be set.");
  }

  if (!/^[A-Za-z0-9_-]+$/.test(spreadsheetId)) {
    throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID must be a spreadsheet ID, not a URL.");
  }

  const monthTabs = parseMonthTabs(environment.GOOGLE_SHEETS_MONTH_TABS);
  const ledgerRange = environment.GOOGLE_SHEETS_LEDGER_RANGE?.trim()
    || DEFAULT_MONTHLY_LEDGER_RANGE;

  if (ledgerRange !== DEFAULT_MONTHLY_LEDGER_RANGE) {
    throw new Error(
      `GOOGLE_SHEETS_LEDGER_RANGE must match the inspected ledger range: ${DEFAULT_MONTHLY_LEDGER_RANGE}.`,
    );
  }

  return { spreadsheetId, monthTabs, ledgerRange };
}

export function getMonthlyLedgerA1Range(
  sheetName: string,
  ledgerRange: string = DEFAULT_MONTHLY_LEDGER_RANGE,
): string {
  return `${sheetName}!${ledgerRange}`;
}

function parseMonthTabs(configuredTabs: string | undefined): string[] {
  const monthTabs = configuredTabs
    ? configuredTabs.split(",").map((tab) => tab.trim()).filter(Boolean)
    : [...DEFAULT_EXPENSE_MONTH_TABS];

  if (monthTabs.length === 0) {
    throw new Error("GOOGLE_SHEETS_MONTH_TABS must include at least one month tab.");
  }

  if (new Set(monthTabs).size !== monthTabs.length) {
    throw new Error("GOOGLE_SHEETS_MONTH_TABS must not contain duplicate tab names.");
  }

  const invalidTabs = monthTabs.filter(
    (tab) => !DEFAULT_EXPENSE_MONTH_TABS.includes(tab as (typeof DEFAULT_EXPENSE_MONTH_TABS)[number]),
  );
  if (invalidTabs.length > 0) {
    throw new Error(
      `GOOGLE_SHEETS_MONTH_TABS contains unsupported month tab(s): ${invalidTabs.join(", ")}.`,
    );
  }

  return monthTabs;
}
