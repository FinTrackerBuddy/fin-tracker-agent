import assert from "node:assert/strict";
import test from "node:test";

import type { GoogleSheetsLedgerConfiguration } from "./config.js";
import { GoogleSheetsLedgerReader } from "./ledger-reader.js";
import type { GoogleSheetsApiClient } from "./sheets-api.js";

const configuration: GoogleSheetsLedgerConfiguration = {
  spreadsheetId: "spreadsheet-id",
  monthTabs: ["April", "May"],
  ledgerRange: "A9:G",
};

test("maps the inspected seven-column monthly ledger with effective values", async () => {
  const requestedRanges: string[] = [];
  const sheetsApi: GoogleSheetsApiClient = {
    getValues: async (_spreadsheetId, range) => {
      requestedRanges.push(range);
      return {
        range,
        values: range.startsWith("April")
          ? [
              [45748, "Groceries", 824.82, "", "Groceries", "", "Pratheek SCB"],
              [45749, "Interest", "", 1016, "", "Arya Income", "Arya BOB"],
              [],
            ]
          : [],
      };
    },
  };

  const transactions = await new GoogleSheetsLedgerReader(
    configuration,
    sheetsApi,
  ).readMonthlyLedger();

  assert.deepEqual(requestedRanges, ["April!A9:G", "May!A9:G"]);
  assert.deepEqual(transactions, [
    {
      sourceSheet: "April",
      sourceRow: 9,
      dateSerial: 45748,
      date: "2025-04-01",
      description: "Groceries",
      debitAmount: 824.82,
      creditAmount: undefined,
      debitCategory: "Groceries",
      creditCategory: undefined,
      account: "Pratheek SCB",
    },
    {
      sourceSheet: "April",
      sourceRow: 10,
      dateSerial: 45749,
      date: "2025-04-02",
      description: "Interest",
      debitAmount: undefined,
      creditAmount: 1016,
      debitCategory: undefined,
      creditCategory: "Arya Income",
      account: "Arya BOB",
    },
  ]);
});

test("identifies missing tabs and malformed ledger rows", async () => {
  const missingSheetApi: GoogleSheetsApiClient = {
    getValues: async () => {
      throw new Error("Requested entity was not found.");
    },
  };
  await assert.rejects(
    new GoogleSheetsLedgerReader(configuration, missingSheetApi).readMonthlyLedger(),
    /Unable to read monthly ledger tab "April"/,
  );

  const malformedSheetApi: GoogleSheetsApiClient = {
    getValues: async (_spreadsheetId, range) => ({
      range,
      values: [[45748, "Broken row", 100, 50, "Groceries", "Income", "Pratheek SCB"]],
    }),
  };
  await assert.rejects(
    new GoogleSheetsLedgerReader(
      { ...configuration, monthTabs: ["April"] },
      malformedSheetApi,
    ).readMonthlyLedger(),
    /exactly one of DR AMOUNT or CR AMOUNT/,
  );
});
