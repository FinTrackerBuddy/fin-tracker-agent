import assert from "node:assert/strict";
import test from "node:test";

import { ReadOnlyGoogleSheetsApiClient } from "./sheets-api.js";
import type { ApplicationLogger, LogDetails, LogScope } from "../logging/application-logger.js";

class RecordedLogger implements ApplicationLogger {
  public readonly entries: string[] = [];

  public info(scope: LogScope, message: string, details?: LogDetails): void {
    this.entries.push(`${scope}:${message}:${JSON.stringify(details ?? {})}`);
  }

  public error(scope: LogScope, message: string, details?: LogDetails): void {
    this.entries.push(`${scope}:${message}:${JSON.stringify(details ?? {})}`);
  }
}

test("uses an authenticated GET request with unformatted values", async () => {
  let requestedUrl: URL | undefined;
  let requestedInit: RequestInit | undefined;
  const client = new ReadOnlyGoogleSheetsApiClient(
    { getAccessToken: async () => "temporary-token" },
    async (url, init) => {
      requestedUrl = new URL(url);
      requestedInit = init;
      return new Response(JSON.stringify({ range: "April!A9:G", values: [] }), {
        status: 200,
      });
    },
  );

  const values = await client.getValues("spreadsheet-id", "April!A9:G");

  assert.deepEqual(values, { range: "April!A9:G", values: [] });
  assert.equal(requestedInit?.method, "GET");
  assert.equal(
    new Headers(requestedInit?.headers).get("authorization"),
    "Bearer temporary-token",
  );
  assert.equal(requestedUrl?.searchParams.get("valueRenderOption"), "UNFORMATTED_VALUE");
  assert.equal(requestedUrl?.searchParams.get("dateTimeRenderOption"), "SERIAL_NUMBER");
});

test("reports an API failure without attempting a write", async () => {
  const client = new ReadOnlyGoogleSheetsApiClient(
    { getAccessToken: async () => "temporary-token" },
    async () => new Response(JSON.stringify({ error: { message: "not found" } }), {
      status: 404,
    }),
  );

  await assert.rejects(
    client.getValues("spreadsheet-id", "Missing!A9:G"),
    /HTTP 404/,
  );
});

test("logs only the Sheets range and row count, never the access token or response rows", async () => {
  const logger = new RecordedLogger();
  const client = new ReadOnlyGoogleSheetsApiClient(
    { getAccessToken: async () => "secret-access-token" },
    async () => new Response(JSON.stringify({ range: "April!A9:G", values: [[1, "private expense"]] }), { status: 200 }),
    logger,
  );

  await client.getValues("spreadsheet-id", "April!A9:G");

  assert.deepEqual(logger.entries, [
    'GoogleSheets:Reading ledger range:{"range":"April!A9:G"}',
    'GoogleSheets:Ledger range read completed:{"range":"April!A9:G","rowCount":1}',
  ]);
  assert.doesNotMatch(logger.entries.join("\n"), /secret-access-token|private expense/);
});
