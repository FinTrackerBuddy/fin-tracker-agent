import assert from "node:assert/strict";
import test from "node:test";

import {
  GOOGLE_SHEETS_READ_ONLY_SCOPE,
  GOOGLE_SHEETS_LOCAL_REDIRECT_URI,
  createLocalGoogleOAuthAuthorizationPlan,
} from "./local-oauth.js";

const authorizationInput = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/auth",
  clientId: "test-client-id",
  redirectUri: GOOGLE_SHEETS_LOCAL_REDIRECT_URI,
  state: "test-state",
};

test("always requests the Google account chooser with read-only Sheets scope", () => {
  const { authorizationUrl, reuseSavedToken } =
    createLocalGoogleOAuthAuthorizationPlan(authorizationInput);

  assert.equal(authorizationUrl.searchParams.get("prompt"), "select_account");
  assert.equal(
    authorizationUrl.searchParams.get("scope"),
    GOOGLE_SHEETS_READ_ONLY_SCOPE,
  );
  assert.equal(authorizationUrl.searchParams.get("client_id"), "test-client-id");
  assert.equal(authorizationUrl.searchParams.get("redirect_uri"), GOOGLE_SHEETS_LOCAL_REDIRECT_URI);
  assert.equal(authorizationUrl.searchParams.get("login_hint"), null);
  assert.equal(reuseSavedToken, true);
});

test("does not reuse a saved token during intentional reauthorization", () => {
  const { authorizationUrl, reuseSavedToken } =
    createLocalGoogleOAuthAuthorizationPlan({
      ...authorizationInput,
      reauthorize: true,
    });

  assert.equal(authorizationUrl.searchParams.get("prompt"), "select_account");
  assert.equal(reuseSavedToken, false);
});
