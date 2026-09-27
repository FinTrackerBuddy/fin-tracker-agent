import assert from "node:assert/strict";
import test from "node:test";

import { GoogleSheetsDebitSummaryReader } from "./debit-summary-reader.js";
import type { GoogleSheetsApiClient } from "./sheets-api.js";

test("reads configured month/category totals from Debit summary and excludes grand totals", async () => {
  const ranges: string[] = [];
  const api: GoogleSheetsApiClient = {
    async getValues(_spreadsheetId, range) {
      ranges.push(range);
      return {
        range,
        values: [
          ["FY total", "Category", "April", "May"],
          [300, "Food", 100, 200],
          [300, "Grand Total", 100, 200],
          [0, "Travel", 0, 0],
        ],
      };
    },
  };
  const reader = new GoogleSheetsDebitSummaryReader({ spreadsheetId: "spreadsheet", monthTabs: ["April", "May"] }, api);

  assert.deepEqual(await reader.readDebitSummary(), [
    { category: "Food", month: "April", amount: 100 },
    { category: "Food", month: "May", amount: 200 },
    { category: "Travel", month: "April", amount: 0 },
    { category: "Travel", month: "May", amount: 0 },
  ]);
  assert.deepEqual(ranges, ["Debit summary!A:N"]);
});
