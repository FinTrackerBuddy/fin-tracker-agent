import assert from "node:assert/strict";
import test from "node:test";

import { InMemorySessionConversationMemory } from "./session-conversation-memory.js";

test("returns bounded prior turns only for follow-up wording", () => {
  const memory = new InMemorySessionConversationMemory({ maxTurnsPerSession: 2 });
  memory.remember("session-a", { query: "Show August groceries.", response: "August groceries were ₹500." });
  memory.remember("session-a", { query: "Show September groceries.", response: "September groceries were ₹750." });
  memory.remember("session-a", { query: "Show October groceries.", response: "October groceries were ₹600." });

  assert.deepEqual(memory.getRelevantHistory("session-a", "How much was it?"), [
    { query: "Show September groceries.", response: "September groceries were ₹750." },
    { query: "Show October groceries.", response: "October groceries were ₹600." },
  ]);
  assert.deepEqual(memory.getRelevantHistory("session-a", "Show travel spending."), []);
});

test("bounds sessions and stored turn text in process memory", () => {
  const memory = new InMemorySessionConversationMemory({ maxSessions: 1, maxCharactersPerTurnField: 10 });
  memory.remember("session-a", { query: "123456789012", response: "abcdefghijkl" });
  memory.remember("session-b", { query: "Question", response: "Answer" });

  assert.deepEqual(memory.getRelevantHistory("session-a", "what about it?"), []);
  assert.deepEqual(memory.getRelevantHistory("session-b", "what about it?"), [
    { query: "Question", response: "Answer" },
  ]);
});
