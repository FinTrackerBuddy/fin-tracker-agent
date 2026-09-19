import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";

import { createFinanceApiServer, type FinanceQueryAgent } from "./finance-api-server.js";
import type { ApplicationLogger, LogDetails, LogScope } from "../logging/application-logger.js";

const apiAuthToken = "test-api-auth-token";
const authorizationHeader = { authorization: `Bearer ${apiAuthToken}` };

async function withServer(
  agent: FinanceQueryAgent,
  run: (baseUrl: string) => Promise<void>,
  logger?: ApplicationLogger,
): Promise<void> {
  const server = createFinanceApiServer(agent, apiAuthToken, logger);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

class RecordedLogger implements ApplicationLogger {
  public readonly entries: string[] = [];

  public info(scope: LogScope, message: string, details?: LogDetails): void {
    this.entries.push(`${scope}:${message}:${JSON.stringify(details ?? {})}`);
  }

  public error(scope: LogScope, message: string, details?: LogDetails): void {
    this.entries.push(`${scope}:${message}:${JSON.stringify(details ?? {})}`);
  }
}

test("POST /api/query rejects missing, malformed, and incorrect authorization before FinanceAgent execution", async () => {
  let invocationCount = 0;
  const logger = new RecordedLogger();
  await withServer({ async respond() {
    invocationCount += 1;
    return { text: "unused" };
  } }, async (baseUrl) => {
    for (const authorization of [undefined, "Basic test-api-auth-token", "Bearer wrong-token"]) {
      const response = await fetch(`${baseUrl}/api/query`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify({ query: "How much did I spend?" }),
      });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "Unauthorized" });
    }
  }, logger);

  assert.equal(invocationCount, 0);
  assert.equal(logger.entries.filter((entry) => entry.includes("API authentication failed")).length, 3);
  assert.doesNotMatch(logger.entries.join("\n"), /test-api-auth-token|wrong-token|authorization/i);
});

test("POST /api/query returns the FinanceAgent response as JSON after authentication", async () => {
  const queries: string[] = [];
  await withServer({
    async respond(query) {
      queries.push(query);
      return { text: "You spent ₹1,250 on dining out." };
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authorizationHeader },
      body: JSON.stringify({ query: " How much did I spend on dining out this month? " }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(await response.json(), { text: "You spent ₹1,250 on dining out." });
  });
  assert.deepEqual(queries, ["How much did I spend on dining out this month?"]);
});

test("POST /api/query logs authentication and request lifecycle events without logging headers", async () => {
  const logger = new RecordedLogger();
  let agentQueryId: string | undefined;
  await withServer({ async respond(_query, queryId) {
    agentQueryId = queryId;
    return { text: "Done." };
  } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authorizationHeader },
      body: JSON.stringify({ query: "How much did I spend?" }),
    });
    assert.equal(response.status, 200);
  }, logger);

  assert.equal(logger.entries.length, 4);
  const queryIds = logger.entries.map((entry) => entry.match(/"queryId":"([^"]+)"/)?.[1]);
  assert.ok(queryIds.every((queryId) => queryId === queryIds[0]));
  assert.equal(agentQueryId, queryIds[0]);
  assert.match(logger.entries[0] ?? "", /^HTTP:Request received:.*"method":"POST".*"queryId":".+"/);
  assert.match(logger.entries[1] ?? "", /^HTTP:API authentication succeeded:.*"queryId":".+"/);
  assert.match(logger.entries[2] ?? "", /^HTTP:Query received:.*"query":"How much did I spend\?".*"queryId":".+"/);
  assert.match(logger.entries[3] ?? "", /^HTTP:Request completed:.*"status":200.*"queryId":".+"/);
  assert.doesNotMatch(logger.entries.join("\n"), /test-api-auth-token|authorization/i);
});

test("POST /api/query rejects a missing body, malformed JSON, and missing or empty queries", async () => {
  await withServer({ async respond() { return { text: "unused" }; } }, async (baseUrl) => {
    const missingBody = await fetch(`${baseUrl}/api/query`, { method: "POST", headers: authorizationHeader });
    assert.equal(missingBody.status, 400);
    assert.deepEqual(await missingBody.json(), { error: "Request body is required." });

    const malformedJson = await fetch(`${baseUrl}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authorizationHeader },
      body: "{",
    });
    assert.equal(malformedJson.status, 400);
    assert.deepEqual(await malformedJson.json(), { error: "Request body must contain valid JSON." });

    const missingQuery = await fetch(`${baseUrl}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authorizationHeader },
      body: JSON.stringify({}),
    });
    assert.equal(missingQuery.status, 400);
    assert.deepEqual(await missingQuery.json(), { error: "Request body must include a non-empty query." });

    const emptyQuery = await fetch(`${baseUrl}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authorizationHeader },
      body: JSON.stringify({ query: "   " }),
    });
    assert.equal(emptyQuery.status, 400);
    assert.deepEqual(await emptyQuery.json(), { error: "Request body must include a non-empty query." });
  });
});

test("POST /api/query returns a safe 500 response when the agent fails", async () => {
  await withServer({
    async respond() {
      throw new Error("provider key is secret");
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authorizationHeader },
      body: JSON.stringify({ query: "How much did I spend?" }),
    });

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Unable to process finance query." });
  });
});
