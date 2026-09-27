import assert from "node:assert/strict";
import test from "node:test";

import { InMemorySessionConversationMemory } from "./session-conversation-memory.js";

test("returns bounded prior turns for every query in a conversation", () => {
  const memory = new InMemorySessionConversationMemory({ maxTurnsPerSession: 2 });
  memory.remember("session-a", { query: "Show August groceries.", response: "August groceries were ₹500." });
  memory.remember("session-a", { query: "Show September groceries.", response: "September groceries were ₹750." });
  memory.remember("session-a", { query: "Show October groceries.", response: "October groceries were ₹600." });

  assert.deepEqual(memory.getRelevantHistory("session-a", "How much was it?"), [
    { query: "Show September groceries.", response: "September groceries were ₹750." },
    { query: "Show October groceries.", response: "October groceries were ₹600." },
  ]);
  assert.deepEqual(memory.getRelevantHistory("session-a", "Show travel spending."), [
    { query: "Show September groceries.", response: "September groceries were ₹750." },
    { query: "Show October groceries.", response: "October groceries were ₹600." },
  ]);
  assert.deepEqual(memory.getRelevantHistory("session-a", "Exclude electronic items as well."), [
    { query: "Show September groceries.", response: "September groceries were ₹750." },
    { query: "Show October groceries.", response: "October groceries were ₹600." },
  ]);
});

test("keeps the ten most recent default conversation turns", () => {
  const memory = new InMemorySessionConversationMemory();
  for (let index = 1; index <= 11; index += 1) {
    memory.remember("session-a", { query: `Query ${index}`, response: `Answer ${index}` });
  }

  assert.deepEqual(memory.getRelevantHistory("session-a", "A wholly new question"), Array.from({ length: 10 }, (_, index) => ({
    query: `Query ${index + 2}`,
    response: `Answer ${index + 2}`,
  })));
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
