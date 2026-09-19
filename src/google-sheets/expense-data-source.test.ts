import assert from "node:assert/strict";
import test from "node:test";

import {
  GoogleSheetsExpenseDataSource,
  createGoogleSheetsExpenseDataSourceFromEnvironment,
} from "./expense-data-source.js";

test("maps only debit rows from the monthly ledger into expenses", async () => {
  const source = new GoogleSheetsExpenseDataSource({
    configuration: { monthTabs: ["April"] },
    ledgerReader: {
      async readMonthlyLedger() {
        return [
          {
            sourceSheet: "April", sourceRow: 9, dateSerial: 46113, date: "2026-04-01",
            description: "Groceries", debitAmount: 824.82, debitCategory: "Groceries", account: "Pratheek SCB",
          },
          {
            sourceSheet: "April", sourceRow: 10, dateSerial: 46114, date: "2026-04-02",
            description: "Interest", creditAmount: 1016, creditCategory: "Arya Income", account: "Arya BOB",
          },
        ];
      },
    },
  });

  assert.deepEqual(await source.listExpenses(), [
    {
      date: "2026-04-01", category: "Groceries", description: "Groceries", amount: 824.82,
      sourceSheet: "April", sourceRow: 9, account: "Pratheek SCB",
    },
  ]);
});

test("requires local workbook configuration before creating the OAuth-backed source", async () => {
  await assert.rejects(
    createGoogleSheetsExpenseDataSourceFromEnvironment({}),
    /SPREADSHEET_ID/,
  );
});
