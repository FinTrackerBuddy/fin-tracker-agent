import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runGoogleAuthCommand } from "./google-auth.js";
import { GOOGLE_SHEETS_LOCAL_REDIRECT_URI } from "./local-oauth.js";
import type { GoogleOAuthTokenStore, GoogleOAuthTokens } from "./oauth-token-store.js";

const credentialsJson = JSON.stringify({
  installed: {
    client_id: "client-id",
    client_secret: "client-secret",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    redirect_uris: ["http://localhost"],
  },
});

test("first-time authorization uses account selection and saves exchanged tokens", async () => {
  await withTemporaryCredentials(async (paths) => {
    const store = new MemoryTokenStore();
    let authorizationUrl: URL | undefined;
    const result = await runGoogleAuthCommand(false, {
      paths,
      tokenStore: store,
      async openBrowser(url) { authorizationUrl = url; return false; },
      async receiveCallback() { return "authorization-code"; },
      async exchangeCode(code) {
        assert.equal(code, "authorization-code");
        return { access_token: "access-token", refresh_token: "refresh-token", expiry_date: 10_000 };
      },
      log() {},
    });

    assert.equal(result, "authorized");
    assert.equal(authorizationUrl?.searchParams.get("prompt"), "select_account");
    assert.equal(authorizationUrl?.searchParams.get("redirect_uri"), GOOGLE_SHEETS_LOCAL_REDIRECT_URI);
    assert.equal(authorizationUrl?.searchParams.get("scope"), "https://www.googleapis.com/auth/spreadsheets.readonly");
    assert.deepEqual(store.saved, {
      access_token: "access-token", refresh_token: "refresh-token", expiry_date: 10_000,
    });
  });
});

test("reuses saved setup normally and forces account-selection reauthorization on demand", async () => {
  await withTemporaryCredentials(async (paths) => {
    const saved: GoogleOAuthTokens = { access_token: "access", refresh_token: "refresh", expiry_date: 10_000 };
    const reusedStore = new MemoryTokenStore(saved);
    assert.equal(await runGoogleAuthCommand(false, {
      paths, tokenStore: reusedStore,
      async openBrowser() { throw new Error("browser must not open"); },
      async receiveCallback() { throw new Error("callback must not run"); },
      log() {},
    }), "reused");

    const forcedStore = new MemoryTokenStore(saved);
    let authorizationUrl: URL | undefined;
    assert.equal(await runGoogleAuthCommand(true, {
      paths, tokenStore: forcedStore,
      async openBrowser(url) { authorizationUrl = url; return false; },
      async receiveCallback() { return "new-code"; },
      async exchangeCode() { return { access_token: "new", refresh_token: "new-refresh", expiry_date: 20_000 }; },
      log() {},
    }), "authorized");
    assert.equal(authorizationUrl?.searchParams.get("prompt"), "select_account");
  });
});

test("accepts installed-app credentials without a web-client redirect URI allowlist", async () => {
  await withTemporaryCredentials(async (paths) => {
    const store = new MemoryTokenStore();
    let authorizationUrl: URL | undefined;
    const result = await runGoogleAuthCommand(false, {
      paths,
      tokenStore: store,
      async openBrowser(url) { authorizationUrl = url; return false; },
      async receiveCallback() { return "authorization-code"; },
      async exchangeCode() { return { access_token: "access", refresh_token: "refresh", expiry_date: 10_000 }; },
      log() {},
    });

    assert.equal(result, "authorized");
    assert.equal(authorizationUrl?.searchParams.get("redirect_uri"), GOOGLE_SHEETS_LOCAL_REDIRECT_URI);
  });
});

class MemoryTokenStore implements GoogleOAuthTokenStore {
  public saved: GoogleOAuthTokens | undefined;
  public constructor(private readonly loaded?: GoogleOAuthTokens) {}
  public async load(): Promise<GoogleOAuthTokens | undefined> { return this.loaded; }
  public async save(tokens: GoogleOAuthTokens): Promise<void> { this.saved = tokens; }
}

async function withTemporaryCredentials(
  callback: (paths: { credentialsPath: string; tokenPath: string }) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "finance-agent-auth-command-"));
  try {
    const paths = { credentialsPath: join(directory, "credentials.json"), tokenPath: join(directory, "token.json") };
    await writeFile(paths.credentialsPath, credentialsJson, "utf8");
    await callback(paths);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
