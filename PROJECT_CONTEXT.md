# fin-tracker-agent — Project Context

## 1. Project purpose

`fin-tracker-agent` is a personal finance assistant that answers natural-language questions over personal financial data. Its current, verified data source is a Google Sheets **Expenses** workbook. The intended experience is: a user asks a finance question, the agent chooses a deterministic tool, the tool reads/calculates from the workbook, and the agent returns a concise answer.

## 2. Technology stack

- Node.js with strict TypeScript and native ES modules.
- LangChain for LLM and tool integration.
- Provider abstraction supporting OpenAI and Gemini; the current local configuration uses Gemini `gemini-3.1-flash-lite`.
- Read-only Google Sheets API access through local Google OAuth.
- Dependency-free Node `http` API server.
- Node test runner, TypeScript type-checking, and TypeScript compilation.

## 3. Current architecture

```text
POST /api/query
    ↓
FinanceAgent
    ↓
ToolCapableLlm (provider-neutral boundary)
    ↓
Deterministic tools
    ↓
ExpenseDataSource
    ↓
Google Sheets monthly ledger
```

`FinanceAgent` supplies date/category context plus bounded relevant session turns, selects and executes tools, and turns structured results into a natural-language answer. The provider layer owns LangChain OpenAI/Gemini construction. Tools own deterministic validation, retrieval, and financial calculation; they do not construct LLM prompts. Google OAuth, Sheets API access, ledger parsing, and expense normalization are isolated under `src/google-sheets/`.

## 4. Repository structure

```text
src/
  main.ts                 application entry point
  http/                   bearer auth and POST /api/query server
  agent/                  FinanceAgent and Asia/Kolkata date context
  llm/                    provider-neutral LLM boundary; OpenAI/Gemini providers
  tools/                  deterministic expense-analysis tools
  google-sheets/          OAuth, Sheets reads, ledger reader, ExpenseDataSource
  logging/                safe application logger and query correlation metadata
  examples/               opt-in live development examples
PROJECT_SPEC.md           product vision, architecture direction, roadmap
PROJECT_STATUS.md         operational implementation status for Codex
PROJECT_CONTEXT.md        portable handoff for a future ChatGPT conversation
AGENTS.md                 project-wide Codex working instructions
WORKBOOK_DATA_MAP.md      observed Expenses workbook schema and constraints
```

Each important source area has adjacent `*.test.ts` tests. Build output and dependencies are generated and omitted from this summary.

## 5. Current data source

The mapped workbook is an Expenses workbook for FY 2026–27, not a general investment/retirement/wealth tracker. The authoritative transaction detail is in the configured April–March monthly tabs, range `A9:G`:

- `DATE`, transaction description, debit amount, credit amount, debit category, credit category, account.
- Debit rows are expenses under the current `ExpenseDataSource`; credit rows are not.
- Debit/credit categories and accounts are free-text labels. There is no stable transaction ID.
- Dates are spreadsheet serial dates displayed without a year; the reader preserves resolved ISO dates.
- October–March were observed as template tabs with no transaction detail at the time of inspection.

Use `WORKBOOK_DATA_MAP.md` for the full tab map, formulas, and data-quality constraints. Configure the workbook only through environment variables such as `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_MONTH_TABS`, and `GOOGLE_SHEETS_LEDGER_RANGE`; never include their values in documentation.

## 6. Google OAuth

Google Sheets access is read-only. `npm run google-auth` performs the local installed-app OAuth flow with account selection and a localhost callback (`http://localhost:3000/oauth2callback`). Ignored local `credentials.json` and `token.json` hold OAuth secrets/tokens. Saved access tokens are reused while valid and refreshed with the saved refresh token when necessary. No OAuth credentials or token values belong in source control or handoff documentation.

## 7. LLM/provider architecture

`LlmService` wraps a small `ToolCapableLlm` interface used by `FinanceAgent`. The interface isolates the agent from provider implementations. OpenAI uses LangChain `ChatOpenAI`; Gemini uses `ChatGoogle` from `@langchain/google`. Provider and model selection come from environment configuration; API keys are never passed to the agent or tools.

The agent’s bounded tool loop allows at most three model/tool rounds. It must remain provider-neutral; provider-specific settings stay in `src/llm/`.

## 8. Current agent capabilities

- **`getExpenses`** — retrieves transaction-level debit expenses with deterministic month, ISO-date, literal-category, and cash payment-method filtering.
- **`compareSpendingPeriods`** — returns deterministic totals for one or more explicitly ordered periods, each containing one or more configured months. Its optional literal `categories` filter applies to every period, so category analysis never falls back to overall spending; filtered calls also return their deterministic aggregate total, plus sequential differences and percentage changes when multiple periods are supplied.
- **`analyzeExpenses`** — generic closed-specification analysis over normalized expenses. It composes workbook-backed month/date-range/category/account/cash filters with grouping by month, weekday, category, or account; `sum` or `count`; deterministic sorting; and a bounded top-N limit. It has no arbitrary expressions, merchant grouping, or LLM calculation path.

The agent supplies a compact, dynamically derived expense-category vocabulary to the LLM. Category selection is canonicalized and validated against current workbook labels; there is no hard-coded semantic mapping or semantic data retrieval.

Relative dates use the single `Asia/Kolkata` authority in `date-context.ts`: “this month” and “last month” use calendar order, not the workbook’s April–March display order. Period comparison preserves caller order and performs only sequential comparisons. A zero baseline yields `percentageChange: null`, never `Infinity` or `NaN`.

## 9. Current HTTP API

`src/main.ts` starts the API on port `3001`.

```http
POST /api/query
Authorization: Bearer <API_AUTH_TOKEN>
Content-Type: application/json

{ "query": "Compare my spending between August and September." }
```

For same-process follow-ups, callers may add a client-generated `conversationId` and reuse it:

```json
{ "query": "How much was it in September?", "conversationId": "budget-review-2026" }
```

Successful responses retain the stable shape:

```json
{ "text": "..." }
```

The API uses a static bearer token loaded from ignored local environment configuration. Missing, malformed, or incorrect authorization returns `401 { "error": "Unauthorized" }` before body processing or agent execution. This is deliberately not a user-account, session, OAuth, or JWT system.

## 10. Logging and observability

The console logger emits scoped `HTTP`, `Agent`, `LLM`, `Tool`, `GoogleSheets`, and `Error` events. Every request receives a UUID `queryId`, propagated through HTTP, agent, LLM, tools, and relevant Sheets events. LLM and tool execution record millisecond durations.

Logs deliberately exclude API keys, bearer tokens, OAuth tokens, authorization headers, credentials, raw Sheets rows, transaction descriptions, and full prompts. Tool logs use bounded arguments and aggregate summaries.

## 11. Current tests and verification

Tests use fakes/mocks rather than live LLM or Google Sheets calls.

```text
npm run typecheck
npm run build
npm test
npm run test:api
npm run test:finance-agent
npm run test:expenses
npm run test:google-sheets
npm run test:google-oauth
npm run test:llm
```

The HTTP suite uses a temporary local loopback listener. API authentication tests use a non-secret fixture token.

## 12. Project roadmap

### Phase 1 — Foundation + Basic Expense Agent — COMPLETE

Completed: TypeScript foundation, LangChain/provider abstraction, OpenAI/Gemini support, read-only Sheets OAuth and ledger access, `FinanceAgent`, `getExpenses`, category/date handling, HTTP API, safe logging, query IDs, and execution timings.

### Phase 2 — Deterministic Financial Analysis — COMPLETE

Completed: ordered category-aware period comparison and the generic composable `analyzeExpenses` engine, which also handles monthly progression through month grouping. The LLM chooses a bounded data-only specification; TypeScript performs all retrieval, grouping, aggregation, sorting, and financial calculation. New analytical questions should use those primitives rather than add specialized analysis tools.

### Phase 3 — Conversation Context, Item-Level Analysis & Semantic Memory — NEXT

Three separate concerns are planned:

1. **Phase 3A — Session-level conversation memory — COMPLETE**: an optional API `conversationId` selects capped process-local context for reference-like follow-ups such as “it”, “that”, “there”, “the same category”, or “what about September?”. The store is limited to 100 least-recently-used sessions and six capped query/final-answer pairs per session. It stores no tool payloads or raw financial rows, has no disk/database/vector-store persistence, and is reset on server restart.
2. **Phase 3B — Item-level expense analysis**: deterministic analysis of individual financial transactions and their free-text descriptions, for questions about specific items, ranked/repeated items, frequency, spending, comparisons, and trends. The LLM selects a bounded intent/specification; TypeScript performs retrieval and every financial calculation. Extend the composable analysis model where appropriate rather than adding a tool for every item question. This capability is not implemented, and the current `analyzeExpenses` does not group descriptions.
3. **Phase 3C — Persistent semantic user memory**: intentionally maintained user facts/preferences/context across sessions, represented with embeddings and retrieved from a vector database/vector store by semantic similarity rather than keyword matching. Relevant memories would be supplied to the agent/LLM with lifecycle and privacy controls.

Description text is financial transaction data behind `ExpenseDataSource`, never an automatic user-memory or vector-store input. It is free text with no guaranteed stable ID; future normalization/entity grouping must be explicitly designed, tested, and uncertainty-aware rather than silently equating variants. Retrieve the minimum required transaction detail and never log raw descriptions/rows or expose unnecessary transaction data in prompts. None of the three Phase 3 concerns, embeddings, or vector storage is implemented now.

### Phase 4 — Advanced Agent Architecture — FUTURE

Potential work: LangGraph only where justified, more complex multi-step workflows, specialized agents where justified, PostgreSQL as a broader application database, additional financial sources, and scheduled/background workflows.

## 13. Important architectural decisions

- Use LangChain now; use LangGraph only when genuinely justified.
- Keep the provider abstraction and `FinanceAgent` provider-neutral.
- Keep financial calculation, validation, and data access deterministic in TypeScript tools.
- Google Sheets is currently read-only through OAuth; reuse `ExpenseDataSource` rather than duplicating Sheets/ledger logic.
- The current mapped workbook contains expenses, not assumed investment or retirement data.
- Do not add RAG, embeddings, or vector storage before Phase 3; persistent semantic memory must use semantic retrieval rather than keyword matching.
- Phase 3 has separate session memory, deterministic item-level expense analysis, and persistent semantic memory tracks. Only the bounded, ephemeral Phase 3A session context is implemented.
- Item-level financial data remains behind `ExpenseDataSource`; descriptions must not automatically become embeddings, vector-store records, or user memories. Future description semantics must be bounded, tested, and uncertainty-aware.
- Avoid unnecessary infrastructure and dependencies.
- The API uses static bearer authentication, not OAuth/JWT/user accounts/sessions.
- Preserve the API’s `{ "text": "..." }` success contract unless explicitly changing it.
- Preserve safe logs, `queryId` propagation, and duration measurements when modifying relevant flows.

## 14. Explicitly deferred / not yet wanted

- LangGraph without a demonstrated orchestration need.
- Vector database, embeddings, RAG, item-level description analysis, or persistent memory.
- PostgreSQL before a broader persistent data need exists.
- Premature multi-agent architecture or specialized agents.
- Additional wealth/investment data sources without mapped data and a scoped task.
- A full user-account/authentication platform.
- Automatic permanent storage of all conversation messages.

## 15. How future work should be done

Read `AGENTS.md`, `PROJECT_SPEC.md`, `PROJECT_STATUS.md`, and `WORKBOOK_DATA_MAP.md` before substantial implementation. Inspect relevant code and tests, make focused changes, reuse existing abstractions, add deterministic tests, and run appropriate test/typecheck/build commands. Preserve secrets and safe logs, do not refactor unrelated code, and update the appropriate documentation as part of the same meaningful feature task.

## 16. Current state

The project is a working, read-only personal Expenses-agent foundation with Phase 2 and Phase 3A complete. It has provider-neutral tool calling, a generic deterministic expense-analysis engine plus stable transaction-detail and ordered-period tools, bounded process-local session context, local OAuth-backed Sheets reads, a bearer-protected HTTP API, safe correlation/timing logs, and an automated suite using fakes. It has no item-level description analysis, persistent memory, database, vector search, LangGraph, writes, or investment-data integration.

## 17. Likely next step

Phase 3B or 3C is next when explicitly prioritized. Scope deterministic item-level expense analysis and persistent semantic user memory independently. Keep transaction descriptions in the financial-data boundary; do not add a persistent-memory subsystem prematurely.
