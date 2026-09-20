import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import type { FinanceAgentResponse } from "../agent/finance-agent.js";
import {
  InMemorySessionConversationMemory,
  type ConversationTurn,
  type SessionConversationMemory,
} from "../conversation/session-conversation-memory.js";
import { isAuthorizedBearerToken } from "./api-auth.js";
import {
  consoleApplicationLogger,
  summarizeQuery,
  type ApplicationLogger,
  withLogDetails,
} from "../logging/application-logger.js";

const MAX_REQUEST_BODY_BYTES = 1_000_000;

export interface FinanceQueryAgent {
  respond(query: string, queryId?: string, conversationHistory?: readonly ConversationTurn[]): Promise<FinanceAgentResponse>;
}

export function createFinanceApiServer(
  agent: FinanceQueryAgent,
  apiAuthToken: string,
  logger: ApplicationLogger = consoleApplicationLogger,
  conversationMemory: SessionConversationMemory = new InMemorySessionConversationMemory(),
): Server {
  return createServer(async (request, response) => {
    const queryId = randomUUID();
    const requestLogger = withLogDetails(logger, { queryId });
    const pathname = new URL(
      request.url ?? "/",
      "http://localhost",
    ).pathname;

    requestLogger.info("HTTP", "Request received", { method: request.method ?? "UNKNOWN", path: pathname });

    if (request.method !== "POST" || pathname !== "/api/query") {
      requestLogger.info("HTTP", "Request completed", { status: 404 });
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    if (!isAuthorizedBearerToken(request.headers.authorization, apiAuthToken)) {
      requestLogger.info("HTTP", "API authentication failed", { status: 401 });
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    requestLogger.info("HTTP", "API authentication succeeded");

    try {
      const body = await readJsonBody(request);
      const query = getQuery(body);

      if (query === undefined) {
        requestLogger.info("HTTP", "Request rejected", { status: 400, reason: "missing_query" });
        sendJson(response, 400, { error: "Request body must include a non-empty query." });
        return;
      }

      requestLogger.info("HTTP", "Query received", { query: summarizeQuery(query) });
      const conversationId = getConversationId(body);
      if (conversationId === null) {
        requestLogger.info("HTTP", "Request rejected", { status: 400, reason: "invalid_conversation_id" });
        sendJson(response, 400, { error: "conversationId must be a 1-128 character identifier containing only letters, numbers, hyphens, or underscores." });
        return;
      }
      const conversationHistory = conversationId === undefined
        ? []
        : conversationMemory.getRelevantHistory(conversationId, query);
      if (conversationId !== undefined) {
        requestLogger.info("HTTP", "Session context selected", { priorTurnCount: conversationHistory.length });
      }
      const result = await agent.respond(query, queryId, conversationHistory);
      if (conversationId !== undefined) {
        conversationMemory.remember(conversationId, { query, response: result.text });
      }
      sendJson(response, 200, result);
      requestLogger.info("HTTP", "Request completed", { status: 200, responseCharacters: result.text.length });
    } catch (error) {
      if (error instanceof InvalidRequestBodyError) {
        requestLogger.info("HTTP", "Request rejected", { status: 400, reason: "invalid_body" });
        sendJson(response, 400, { error: error.message });
        return;
      }

      requestLogger.error("Error", "Finance API request failed", { errorType: getErrorType(error) });
      sendJson(response, 500, { error: "Unable to process finance query." });
    }
  });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BODY_BYTES) {
      throw new InvalidRequestBodyError("Request body is too large.");
    }
    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim().length === 0) {
    throw new InvalidRequestBodyError("Request body is required.");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new InvalidRequestBodyError("Request body must contain valid JSON.");
  }
}

function getQuery(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }

  const query = (body as Record<string, unknown>).query;
  if (typeof query !== "string" || query.trim().length === 0) {
    return undefined;
  }

  return query.trim();
}

function getConversationId(body: unknown): string | undefined | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const conversationId = (body as Record<string, unknown>).conversationId;
  if (conversationId === undefined) {
    return undefined;
  }
  if (typeof conversationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(conversationId)) {
    return null;
  }
  return conversationId;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

class InvalidRequestBodyError extends Error {}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
