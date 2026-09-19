import { readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type { GoogleOAuthAccessTokenProvider } from "./sheets-api.js";

export interface InstalledGoogleOAuthCredentials {
  client_id: string;
  client_secret: string;
  auth_uri: string;
  token_uri: string;
  redirect_uris: string[];
}

export interface GoogleOAuthTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date: number;
  token_type?: string;
  scope?: string;
}

export interface GoogleOAuthPaths {
  credentialsPath: string;
  tokenPath: string;
}

export interface GoogleOAuthTokenStore {
  load(): Promise<GoogleOAuthTokens | undefined>;
  save(tokens: GoogleOAuthTokens): Promise<void>;
}

export function getLocalGoogleOAuthPaths(rootDirectory: string = process.cwd()): GoogleOAuthPaths {
  return {
    credentialsPath: join(rootDirectory, "credentials.json"),
    tokenPath: join(rootDirectory, "token.json"),
  };
}

export class FileGoogleOAuthTokenStore implements GoogleOAuthTokenStore {
  public constructor(private readonly tokenPath: string) {}

  public async load(): Promise<GoogleOAuthTokens | undefined> {
    try {
      return parseTokens(JSON.parse(await readFile(this.tokenPath, "utf8")));
    } catch (error) {
      if (isMissingFileError(error)) {
        return undefined;
      }
      throw new Error("Saved Google OAuth token is invalid. Run npm run google-auth -- --force.", {
        cause: error,
      });
    }
  }

  public async save(tokens: GoogleOAuthTokens): Promise<void> {
    const safeTokens = parseTokens(tokens);
    const temporaryPath = `${this.tokenPath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(safeTokens, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.tokenPath);
  }
}

export async function loadInstalledGoogleOAuthCredentials(
  credentialsPath: string,
): Promise<InstalledGoogleOAuthCredentials> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(credentialsPath, "utf8"));
  } catch (error) {
    throw new Error("Google OAuth credentials.json could not be read.", { cause: error });
  }

  const installed = isRecord(parsed) ? parsed.installed : undefined;
  if (!isRecord(installed)
    || !isNonEmptyString(installed.client_id)
    || !isNonEmptyString(installed.client_secret)
    || !isNonEmptyString(installed.auth_uri)
    || !isNonEmptyString(installed.token_uri)
    || !Array.isArray(installed.redirect_uris)
    || installed.redirect_uris.length === 0
    || !installed.redirect_uris.every(isNonEmptyString)) {
    throw new Error("credentials.json is not a usable installed-application OAuth client configuration.");
  }

  return {
    client_id: installed.client_id,
    client_secret: installed.client_secret,
    auth_uri: installed.auth_uri,
    token_uri: installed.token_uri,
    redirect_uris: installed.redirect_uris,
  };
}

export interface OAuthTokenEndpoint {
  request(form: URLSearchParams): Promise<GoogleOAuthTokens>;
}

export class GoogleOAuthTokenEndpoint implements OAuthTokenEndpoint {
  public constructor(
    private readonly credentials: InstalledGoogleOAuthCredentials,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  public async request(form: URLSearchParams): Promise<GoogleOAuthTokens> {
    const response = await this.fetchImplementation(this.credentials.token_uri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      throw new Error("Google OAuth token request failed. Run npm run google-auth -- --force.");
    }
    return parseTokenResponse(body);
  }
}

export class StoredGoogleOAuthAccessTokenProvider
  implements GoogleOAuthAccessTokenProvider {
  public constructor(
    private readonly tokenStore: GoogleOAuthTokenStore,
    private readonly credentials: InstalledGoogleOAuthCredentials,
    private readonly endpoint: OAuthTokenEndpoint = new GoogleOAuthTokenEndpoint(credentials),
    private readonly now: () => number = Date.now,
  ) {}

  public async getAccessToken(): Promise<string> {
    const savedTokens = await this.tokenStore.load();
    if (!savedTokens) {
      throw new Error("Google OAuth authorization is required. Run npm run google-auth.");
    }
    if (savedTokens.expiry_date > this.now() + 60_000) {
      return savedTokens.access_token;
    }
    if (!savedTokens.refresh_token) {
      throw new Error("Saved Google OAuth token cannot be refreshed. Run npm run google-auth -- --force.");
    }

    const refreshedTokens = await this.endpoint.request(new URLSearchParams({
      client_id: this.credentials.client_id,
      client_secret: this.credentials.client_secret,
      refresh_token: savedTokens.refresh_token,
      grant_type: "refresh_token",
    }));
    const mergedTokens: GoogleOAuthTokens = {
      ...refreshedTokens,
      refresh_token: refreshedTokens.refresh_token ?? savedTokens.refresh_token,
    };
    await this.tokenStore.save(mergedTokens);
    return mergedTokens.access_token;
  }
}

export async function createStoredGoogleOAuthAccessTokenProvider(
  paths: GoogleOAuthPaths = getLocalGoogleOAuthPaths(),
): Promise<StoredGoogleOAuthAccessTokenProvider> {
  const credentials = await loadInstalledGoogleOAuthCredentials(paths.credentialsPath);
  return new StoredGoogleOAuthAccessTokenProvider(
    new FileGoogleOAuthTokenStore(paths.tokenPath),
    credentials,
  );
}

export async function exchangeAuthorizationCode(
  authorizationCode: string,
  redirectUri: string,
  credentials: InstalledGoogleOAuthCredentials,
  endpoint: OAuthTokenEndpoint = new GoogleOAuthTokenEndpoint(credentials),
): Promise<GoogleOAuthTokens> {
  const tokens = await endpoint.request(new URLSearchParams({
    code: authorizationCode,
    client_id: credentials.client_id,
    client_secret: credentials.client_secret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  }));
  if (!tokens.refresh_token) {
    throw new Error("Google OAuth did not return a refresh token. Run npm run google-auth -- --force.");
  }
  return tokens;
}

function parseTokenResponse(value: unknown): GoogleOAuthTokens {
  if (!isRecord(value) || !isNonEmptyString(value.access_token)) {
    throw new Error("Google OAuth returned an invalid token response.");
  }
  const expiresIn = value.expires_in;
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("Google OAuth token response did not include a valid expiry.");
  }
  return parseTokens({
    access_token: value.access_token,
    refresh_token: isNonEmptyString(value.refresh_token) ? value.refresh_token : undefined,
    expiry_date: Date.now() + expiresIn * 1000,
    token_type: isNonEmptyString(value.token_type) ? value.token_type : undefined,
    scope: isNonEmptyString(value.scope) ? value.scope : undefined,
  });
}

function parseTokens(value: unknown): GoogleOAuthTokens {
  if (!isRecord(value)
    || !isNonEmptyString(value.access_token)
    || typeof value.expiry_date !== "number"
    || !Number.isFinite(value.expiry_date)
    || value.expiry_date <= 0
    || (value.refresh_token !== undefined && !isNonEmptyString(value.refresh_token))) {
    throw new Error("Saved token has an invalid shape.");
  }
  return {
    access_token: value.access_token,
    expiry_date: value.expiry_date,
    ...(value.refresh_token ? { refresh_token: value.refresh_token } : {}),
    ...(isNonEmptyString(value.token_type) ? { token_type: value.token_type } : {}),
    ...(isNonEmptyString(value.scope) ? { scope: value.scope } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
