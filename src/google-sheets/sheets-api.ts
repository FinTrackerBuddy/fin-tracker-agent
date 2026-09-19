export interface GoogleOAuthAccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export interface GoogleSheetsValuesResponse {
  range: string;
  values: unknown[][];
}

export interface GoogleSheetsApiClient {
  getValues(
    spreadsheetId: string,
    range: string,
  ): Promise<GoogleSheetsValuesResponse>;
}

import { type ApplicationLogger } from "../logging/application-logger.js";

export type FetchImplementation = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

/** A minimal GET-only adapter for the Google Sheets values API. */
export class ReadOnlyGoogleSheetsApiClient implements GoogleSheetsApiClient {
  public constructor(
    private readonly accessTokenProvider: GoogleOAuthAccessTokenProvider,
    private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly logger?: ApplicationLogger,
  ) {}

  public async getValues(
    spreadsheetId: string,
    range: string,
  ): Promise<GoogleSheetsValuesResponse> {
    this.logger?.info("GoogleSheets", "Reading ledger range", { range });
    const accessToken = await this.accessTokenProvider.getAccessToken();
    if (!accessToken.trim()) {
      throw new Error("Google OAuth did not provide an access token.");
    }

    const url = new URL(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
    );
    url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
    url.searchParams.set("dateTimeRenderOption", "SERIAL_NUMBER");

    const response = await this.fetchImplementation(url, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const body: unknown = await response.json();

    if (!response.ok) {
      this.logger?.error("Error", "Google Sheets read failed", { status: response.status });
      throw new Error(`Google Sheets read failed with HTTP ${response.status}.`);
    }

    const values = parseValuesResponse(body);
    this.logger?.info("GoogleSheets", "Ledger range read completed", { range, rowCount: values.values.length });
    return values;
  }
}

function parseValuesResponse(body: unknown): GoogleSheetsValuesResponse {
  if (!isRecord(body) || typeof body.range !== "string") {
    throw new Error("Google Sheets returned an invalid values response.");
  }

  if (body.values === undefined) {
    return { range: body.range, values: [] };
  }

  if (!Array.isArray(body.values) || !body.values.every(Array.isArray)) {
    throw new Error("Google Sheets returned malformed row values.");
  }

  return { range: body.range, values: body.values };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
