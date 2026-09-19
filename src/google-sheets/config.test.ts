import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_EXPENSE_MONTH_TABS,
  DEFAULT_MONTHLY_LEDGER_RANGE,
  loadGoogleSheetsLedgerConfiguration,
} from "./config.js";

test("loads the inspected monthly ledger configuration", () => {
  assert.deepEqual(
    loadGoogleSheetsLedgerConfiguration({
      GOOGLE_SHEETS_SPREADSHEET_ID: "spreadsheet-id_123",
    }),
    {
      spreadsheetId: "spreadsheet-id_123",
      monthTabs: [...DEFAULT_EXPENSE_MONTH_TABS],
      ledgerRange: DEFAULT_MONTHLY_LEDGER_RANGE,
    },
  );
});

test("supports a configured subset of the observed month tabs", () => {
  const configuration = loadGoogleSheetsLedgerConfiguration({
    GOOGLE_SHEETS_SPREADSHEET_ID: "spreadsheet-id_123",
    GOOGLE_SHEETS_MONTH_TABS: "April, May",
  });

  assert.deepEqual(configuration.monthTabs, ["April", "May"]);
});

test("rejects missing and unexpected ledger configuration", () => {
  assert.throws(() => loadGoogleSheetsLedgerConfiguration({}), /SPREADSHEET_ID/);
  assert.throws(
    () => loadGoogleSheetsLedgerConfiguration({
      GOOGLE_SHEETS_SPREADSHEET_ID: "spreadsheet-id_123",
      GOOGLE_SHEETS_MONTH_TABS: "April, April",
    }),
    /duplicate/,
  );
  assert.throws(
    () => loadGoogleSheetsLedgerConfiguration({
      GOOGLE_SHEETS_SPREADSHEET_ID: "spreadsheet-id_123",
      GOOGLE_SHEETS_MONTH_TABS: "April, Expenses",
    }),
    /unsupported/,
  );
  assert.throws(
    () => loadGoogleSheetsLedgerConfiguration({
      GOOGLE_SHEETS_SPREADSHEET_ID: "spreadsheet-id_123",
      GOOGLE_SHEETS_LEDGER_RANGE: "A1:G",
    }),
    /A9:G/,
  );
});
