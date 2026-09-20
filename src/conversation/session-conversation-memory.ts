export interface ConversationTurn {
  readonly query: string;
  readonly response: string;
}

export interface SessionConversationMemory {
  getRelevantHistory(conversationId: string, query: string): readonly ConversationTurn[];
  remember(conversationId: string, turn: ConversationTurn): void;
}

export interface InMemorySessionConversationMemoryOptions {
  readonly maxSessions?: number;
  readonly maxTurnsPerSession?: number;
  readonly maxCharactersPerTurnField?: number;
}

const DEFAULT_MAX_SESSIONS = 100;
const DEFAULT_MAX_TURNS_PER_SESSION = 6;
const DEFAULT_MAX_CHARACTERS_PER_TURN_FIELD = 600;

/**
 * Ephemeral, process-local conversation context. It deliberately has no disk,
 * database, embedding, or vector-store integration. Only bounded user queries
 * and final assistant answers are retained; tool results are never stored.
 */
export class InMemorySessionConversationMemory implements SessionConversationMemory {
  private readonly sessions = new Map<string, ConversationTurn[]>();
  private readonly maxSessions: number;
  private readonly maxTurnsPerSession: number;
  private readonly maxCharactersPerTurnField: number;

  public constructor(options: InMemorySessionConversationMemoryOptions = {}) {
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.maxTurnsPerSession = options.maxTurnsPerSession ?? DEFAULT_MAX_TURNS_PER_SESSION;
    this.maxCharactersPerTurnField = options.maxCharactersPerTurnField ?? DEFAULT_MAX_CHARACTERS_PER_TURN_FIELD;
  }

  public getRelevantHistory(conversationId: string, query: string): readonly ConversationTurn[] {
    if (!isFollowUp(query)) {
      return [];
    }
    return this.sessions.get(conversationId) ?? [];
  }

  public remember(conversationId: string, turn: ConversationTurn): void {
    const existingTurns = this.sessions.get(conversationId) ?? [];
    const boundedTurn = {
      query: truncate(turn.query, this.maxCharactersPerTurnField),
      response: truncate(turn.response, this.maxCharactersPerTurnField),
    };
    const turns = [...existingTurns, boundedTurn].slice(-this.maxTurnsPerSession);

    // Refresh recency for the session, then evict the least recently used one.
    this.sessions.delete(conversationId);
    this.sessions.set(conversationId, turns);
    while (this.sessions.size > this.maxSessions) {
      const oldestConversationId = this.sessions.keys().next().value as string | undefined;
      if (oldestConversationId === undefined) break;
      this.sessions.delete(oldestConversationId);
    }
  }
}

function isFollowUp(query: string): boolean {
  const normalized = query.trim().toLowerCase();
  return /\b(it|that|there|them|those|same\s+(?:category|month|period|account)|previous\s+(?:one|category|month|period)|above)\b/.test(normalized)
    || /^(?:and|but|also)\b/.test(normalized)
    || /^(?:what|how)\s+about\b/.test(normalized);
}

function truncate(value: string, maximumCharacters: number): string {
  return value.length <= maximumCharacters ? value : `${value.slice(0, Math.max(0, maximumCharacters - 3))}...`;
}
