# fin-tracker-agent — Project Instructions

## Source of truth and scope

Before changing this repository, read `PROJECT_SPEC.md`, `PROJECT_STATUS.md`, and `WORKBOOK_DATA_MAP.md`. They define the product direction, current implementation state, and observed Google Sheets schema respectively. Prefer small, focused changes that fit the active phase; do not implement future-phase work opportunistically.

## Documentation responsibilities

```text
AGENTS.md
    ↓ How Codex should work
PROJECT_SPEC.md
    ↓ What we are building
PROJECT_STATUS.md
    ↓ Current operational/project state for Codex
PROJECT_CONTEXT.md
    ↓ Portable project context for future ChatGPT conversations
```

- `PROJECT_SPEC.md` describes product vision, requirements, architecture principles, intended capabilities, and the roadmap. Change it when product scope, intended behavior, or architectural direction changes.
- `PROJECT_STATUS.md` is the operational state document for Codex: completed work, implementation state, verification, configuration/architecture notes, current phase, and next implementation work. Read it before substantial work.
- `PROJECT_CONTEXT.md` is a concise, portable handoff for a fresh ChatGPT conversation. It summarizes the context, architecture, decisions, capabilities, roadmap, and current state needed to continue intelligently; it is not a detailed implementation log.
- `AGENTS.md` contains the project-wide working instructions and conventions Codex must follow.

Whenever Codex implements a new feature, capability, architectural change, meaningful behavior change, or major bug fix, update documentation as part of that same task:

1. Update `PROJECT_STATUS.md` whenever implementation state changes.
2. Review `PROJECT_CONTEXT.md` and update it whenever the change matters to a future ChatGPT handoff.
3. Update `PROJECT_SPEC.md` when requirements, intended behavior, architecture direction, or roadmap changes.
4. Do not churn documents for trivial/internal changes that do not affect project understanding.

`PROJECT_STATUS.md` and `PROJECT_CONTEXT.md` must both remain current as meaningful work progresses; future feature prompts should not need to restate this rule.

## Current roadmap

- **Phase 1 — Foundation + Basic Expense Agent — COMPLETE**
- **Phase 2 — Deterministic Financial Analysis — COMPLETE**
- **Phase 3 — Conversation Context, Item-Level Analysis & Semantic Memory — NEXT (when explicitly prioritized)**
- **Phase 4 — Advanced Agent Architecture — FUTURE**

Phase 3 has three distinct concerns that must remain separate:

1. Session-level conversation memory for an active conversation.
2. Item-level expense analysis over individual financial transaction records and their free-text descriptions.
3. Persistent user-specific semantic memory using embeddings and a vector database, including retrieval, LLM-context injection, and lifecycle/cleanup.

Transaction descriptions are financial data, not semantic user memories. Do not automatically embed or persist them in a vector store, or turn them into user facts/preferences. Do not implement any Phase 3 concern during Phase 2. Do not add embeddings, a vector database, RAG, PostgreSQL, LangGraph, specialized agents, or background/scheduled workflows unless the current task and project phase explicitly require them.

## Architecture rules

- Use Node.js and strict TypeScript. LangChain is the primary LLM framework.
- Keep the provider layer model/provider-agnostic. `FinanceAgent` must depend on the common tool-capable LLM boundary, not a provider implementation.
- Use LangGraph only when complex stateful, multi-step, or multi-agent orchestration demonstrably requires it.
- Keep agent reasoning, deterministic tools, Google Sheets data access, and infrastructure separated.
- Tools are deterministic data-access/calculation capabilities. They must not contain LLM reasoning or construct LLM prompts.
- Perform financial calculations and validation in normal TypeScript, never in LLM reasoning. The LLM chooses a tool and explains its structured result.
- Reuse existing abstractions and avoid unnecessary dependencies or layers.

## Current implementation conventions

- `src/main.ts` exposes only `POST /api/query`; successful responses stay `{ "text": "..." }` unless a change is explicitly requested.
- `FinanceAgent` runs a bounded LangChain tool loop and currently registers:
  - `getExpenses` for transaction-level retrieval and category/month/date/payment-method filtering.
  - `compareSpendingPeriods` for deterministic ordered period totals, differences, and percentage changes.
  - `analyzeExpenses` for closed, composable filtering, grouping, sum/count aggregation, sorting, and top-N analysis.
- `ExpenseDataSource` is the common debit-expense boundary for tools. Reuse it; do not duplicate Google Sheets API calls, OAuth handling, ledger parsing, or expense data sources.
- Google Sheets access is currently read-only through OAuth. The observed ledger tabs are configured April–March, with ledger range `A9:G`.
- `src/agent/date-context.ts` is the sole relative-date authority. It uses `Asia/Kolkata`; calendar-relative months and calendar adjacency are not determined by April–March display order.
- For period comparison, preserve caller order and compare only sequential periods. A zero baseline yields `percentageChange: null`, never `Infinity` or `NaN`.
- `analyzeExpenses` is the generic analysis boundary, including month-by-month progression. Its closed specification supports only workbook-backed filters (months, ISO date/range, categories, accounts, cash), grouping by month/day of week/category/account, `sum` or `count`, matching aggregate sorting, and a bounded limit. Do not add a specialized tool for each new grouping question.
- Item-level description analysis is planned Phase 3 work, not a current `analyzeExpenses` feature. When prioritized, extend the generic deterministic analysis model where appropriate rather than adding one tool per food/item/frequency/trend question. The LLM may choose a bounded operation but must not calculate totals from raw transactions. Any description normalization or entity grouping must be explicitly designed, tested, and report uncertainty; free-text variations must not be silently treated as the same item.
- Workbook category vocabulary is retrieved dynamically from current debit expense data. Do not hard-code semantic category mappings where this vocabulary can be used.
- Preserve the `queryId` through HTTP, agent, LLM, tools, and Sheets-related logs. Preserve duration logging for LLM and tool execution when modifying those paths.

## Financial-data rules

- The inspected workbook is an **Expenses** workbook, not a general wealth/investment tracker. `WORKBOOK_DATA_MAP.md` is authoritative for its tabs, fields, formulas, and limitations.
- Do not assume mutual funds, PPF, EPF, goals, or other wealth data exists unless it is actually present in the mapped workbook.
- Treat monthly ledger debit rows as expenses; credit rows are not expenses under the current source abstraction.
- Keep financial analysis deterministic, validated, and covered by fake/in-memory source tests.
- Retrieve the minimum transaction-level detail needed for an analysis. Never log raw transaction descriptions or rows, expose unnecessary details in intermediate prompts, or treat financial records as automatically persistent memory.

## Configuration and secrets

- `.env` contains real local configuration/secrets; `.env.example` is the template.
- When configuration changes are required, update both files while preserving every existing `.env` secret. Never print, expose, overwrite, or replace secrets with placeholders.
- Never commit credentials, API keys, OAuth tokens, or other secrets. Local `credentials.json` and `token.json` remain protected by `.gitignore`.
- Do not add configuration unless the capability genuinely needs it.

## Implementation and testing discipline

- Inspect relevant code and tests before modifying behavior. Reuse existing abstractions rather than duplicating logic.
- Add or update deterministic tests for meaningful behavior changes; do not make live LLM or Google Sheets calls in unit tests.
- Run the relevant targeted tests, plus `npm run typecheck`, `npm run build`, and `npm test` when appropriate.
- Preserve compatibility and public API contracts where practical; do not silently change them.
- Keep logging useful and safe. Never log API keys, OAuth tokens, authorization headers, credentials, raw sensitive financial rows, or full prompts.
- Follow the documentation-responsibility and same-task update rule above. Preserve project history in `PROJECT_STATUS.md`.
