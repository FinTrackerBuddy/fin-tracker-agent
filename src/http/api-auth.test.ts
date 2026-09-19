import assert from "node:assert/strict";
import test from "node:test";

import { isAuthorizedBearerToken, loadApiAuthToken } from "./api-auth.js";

test("loads a non-empty API authentication token from the environment", () => {
  assert.equal(loadApiAuthToken({ API_AUTH_TOKEN: "test-token" }), "test-token");
  assert.throws(() => loadApiAuthToken({}), /API_AUTH_TOKEN must be set/);
  assert.throws(() => loadApiAuthToken({ API_AUTH_TOKEN: "   " }), /API_AUTH_TOKEN must be set/);
});

test("accepts only an exact bearer token without naive token comparison", () => {
  assert.equal(isAuthorizedBearerToken("Bearer test-token", "test-token"), true);
  assert.equal(isAuthorizedBearerToken(undefined, "test-token"), false);
  assert.equal(isAuthorizedBearerToken("Basic test-token", "test-token"), false);
  assert.equal(isAuthorizedBearerToken("Bearer", "test-token"), false);
  assert.equal(isAuthorizedBearerToken("Bearer wrong-token", "test-token"), false);
  assert.equal(isAuthorizedBearerToken("Bearer test-token extra", "test-token"), false);
});
