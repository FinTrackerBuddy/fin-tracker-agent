import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FileGoogleOAuthTokenStore,
  StoredGoogleOAuthAccessTokenProvider,
  loadInstalledGoogleOAuthCredentials,
  type GoogleOAuthTokenStore,
  type GoogleOAuthTokens,
} from "./oauth-token-store.js";

const credentials = {
  client_id: "client-id",
  client_secret: "client-secret",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  redirect_uris: ["http://localhost:48173/oauth2callback"],
};

test("saves and loads local OAuth tokens without exposing their values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "finance-agent-oauth-"));
  try {
    const tokenPath = join(directory, "token.json");
    const store = new FileGoogleOAuthTokenStore(tokenPath);
    const tokens: GoogleOAuthTokens = {
      access_token: "test-access-token",
      refresh_token: "test-refresh-token",
      expiry_date: 2_000_000_000_000,
    };
    await store.save(tokens);

    assert.deepEqual(await store.load(), tokens);
    assert.equal((await stat(tokenPath)).mode & 0o777, 0o600);
    const storedJson = await readFile(tokenPath, "utf8");
    assert.doesNotThrow(() => JSON.parse(storedJson));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reuses a still-valid access token without refreshing", async () => {
  const store = new MemoryTokenStore({
    access_token: "valid-access-token",
    refresh_token: "refresh-token",
    expiry_date: 100_000,
  });
  let refreshRequests = 0;
  const provider = new StoredGoogleOAuthAccessTokenProvider(
    store,
    credentials,
    { async request() { refreshRequests += 1; throw new Error("must not refresh"); } },
    () => 1_000,
  );

  assert.equal(await provider.getAccessToken(), "valid-access-token");
  assert.equal(refreshRequests, 0);
});

test("refreshes an expired token and persists the replacement", async () => {
  const store = new MemoryTokenStore({
    access_token: "expired-access-token",
    refresh_token: "refresh-token",
    expiry_date: 1_000,
  });
  let request: URLSearchParams | undefined;
  const provider = new StoredGoogleOAuthAccessTokenProvider(
    store,
    credentials,
    {
      async request(form) {
        request = form;
        return { access_token: "new-access-token", expiry_date: 20_000 };
      },
    },
    () => 2_000,
  );

  assert.equal(await provider.getAccessToken(), "new-access-token");
  assert.equal(request?.get("grant_type"), "refresh_token");
  assert.equal(request?.get("refresh_token"), "refresh-token");
  assert.deepEqual(store.saved, {
    access_token: "new-access-token",
    refresh_token: "refresh-token",
    expiry_date: 20_000,
  });
});

test("reports missing, invalid, and unrefreshable local credentials clearly", async () => {
  const missingProvider = new StoredGoogleOAuthAccessTokenProvider(
    new MemoryTokenStore(), credentials, undefined, () => 1_000,
  );
  await assert.rejects(missingProvider.getAccessToken(), /npm run google-auth/);

  const unrefreshableProvider = new StoredGoogleOAuthAccessTokenProvider(
    new MemoryTokenStore({ access_token: "expired", expiry_date: 1 }),
    credentials,
    undefined,
    () => 1_000,
  );
  await assert.rejects(unrefreshableProvider.getAccessToken(), /cannot be refreshed/);

  const directory = await mkdtemp(join(tmpdir(), "finance-agent-oauth-"));
  try {
    const credentialsPath = join(directory, "credentials.json");
    await writeFile(credentialsPath, "{}", "utf8");
    await assert.rejects(loadInstalledGoogleOAuthCredentials(credentialsPath), /installed-application/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

class MemoryTokenStore implements GoogleOAuthTokenStore {
  public saved: GoogleOAuthTokens | undefined;

  public constructor(private readonly value?: GoogleOAuthTokens) {}

  public async load(): Promise<GoogleOAuthTokens | undefined> {
    return this.value;
  }

  public async save(tokens: GoogleOAuthTokens): Promise<void> {
    this.saved = tokens;
  }
}
