# Personal Finance Agent — Project Specification

## 1. Goal

Build a personal finance assistant using **Node.js + TypeScript** and Agentic AI.

The system will work with existing Google Sheets containing:
- Expenses
- Mutual fund portfolio information
- Investments
- PPF / EPF
- Goals
- Travel fund
- Other personal financial information

The agent should eventually be able to:
- Read and analyze financial data
- Answer natural-language questions
- Generate summaries and insights
- Add/update data in Google Sheets
- Use updated mutual-fund NAV and portfolio data
- Orchestrate specialized agents for advanced tasks

## 2. Technology Direction

### Core
- **Language:** TypeScript
- **Runtime:** Node.js
- **Framework:** NestJS as the application grows
- **LLM framework:** LangChain
- **Agent orchestration:** LangGraph when workflows become sufficiently complex
- **Model providers:** Model-agnostic through LangChain

Potential model providers:
- OpenAI
- GLM / ZhipuAI
- Gemini
- Other supported providers
- Open/local models later if useful

The agent architecture should not be tightly coupled to one LLM provider.

### Data / Infrastructure
- **Initial data source:** Google Sheets
- **Database:** PostgreSQL when required
- **Scheduled processing:** Node/NestJS jobs initially; n8n may be introduced for workflow automation
- **Deployment:** Local during development; VPS/container deployment when continuous/background execution is required
- **Docker:** Introduce when deployment or environment consistency requires it

Avoid adding infrastructure or frameworks unless they solve a real requirement.

# 3. Project Documentation

The repository should maintain two important project documents:

- **PROJECT_SPEC.md** — overall project goal, architecture, phases, technology direction, and development principles.
- **PROJECT_STATUS.md** — current implementation state.

`PROJECT_STATUS.md` should contain:
- Current phase
- Completed work
- Current/in-progress work
- Next planned step
- Important implementation decisions
- Known issues/blockers
- Relevant setup/configuration notes

Codex should update `PROJECT_STATUS.md` after meaningful implementation milestones.

When starting a new Codex session, it should read both `PROJECT_SPEC.md` and `PROJECT_STATUS.md` before continuing work. The repository should be treated as the source of truth rather than relying on previous Codex conversation context.

# 4. Development Phases

## Phase 1 — Foundation + Basic Expense Agent — Complete

Completed capabilities include the Node.js + TypeScript foundation; LangChain and provider abstraction; OpenAI and Gemini providers; FinanceAgent; read-only Google Sheets OAuth integration; deterministic `getExpenses`; tool calling; Asia/Kolkata relative-date context; semantic category selection and validation; the `src/main.ts` JSON HTTP API; and server-side correlation-ID and timing logs.

## Phase 2 — Deterministic Financial Analysis — Complete

Completed deterministic analysis over the financial data already available through Google Sheets. The LLM translates a question into a closed structured specification; TypeScript retrieves data and performs all financial calculations.

The generic `analyzeExpenses` capability composes supported filters (month, ISO date/range, category, account, cash), grouping (`month`, `dayOfWeek`, `category`, `account`), `sum`/`count` aggregation, aggregate sorting, and a bounded top-N limit. It deliberately does not support arbitrary expressions, unsupported dimensions, or merchant/description grouping. Stable tools remain for transaction detail, monthly progression, and explicitly ordered period comparison; comparison preserves caller order, adjacent comparisons, category filters, and null zero-baseline percentages.

## Phase 3 — Conversation Context, Item-Level Analysis & Semantic Memory — Next

Phase 3 has three related but distinct capabilities. They must remain separate from each other and from financial transaction data; they do not need to be implemented as one system.

### Phase 3A — Session-level conversation memory

Within one API conversation/session, retain the bounded, relevant prior-turn context needed to resolve references such as "it", "that", "there", or "the same category". This is implemented as an optional caller-provided API `conversationId` with process-local, bounded history: at most 100 least-recently-used sessions and six capped user-query/final-answer pairs per session. Only reference-like follow-ups receive this context; the entire conversation is never automatically sent to the LLM. Tool results and raw financial rows are excluded, and the store has no disk/database/vector-store persistence, so it resets with the application process.

### Phase 3B — Item-level expense analysis

Extend the deterministic expense-analysis model to support questions that inspect individual debit transactions and their free-text descriptions, such as items ordered in a month, ranked item spending, repeated-item frequency, item-by-period comparisons, and item trends. The LLM may interpret the question and select a bounded analysis specification; TypeScript must retrieve, filter, group, count, aggregate, sort, and compare the financial data deterministically. It must not calculate totals from raw transaction records in LLM reasoning. Description-level operations must use exact ledger text unless a separately scoped normalization design is introduced; they must not silently merge variants.

This is an extension of the generic composable analysis direction, not a mandate to add one tool per item question or to prescribe a new API/tool shape before implementation. The existing Phase 2 `analyzeExpenses` capability does not yet support description grouping.

Descriptions are free text and the workbook has no guaranteed stable transaction ID. Description variants may refer to the same underlying item, but future normalization, entity extraction, or grouping must be explicitly scoped, deterministic where possible, tested, and clear about uncertainty; no arbitrary semantic mappings may be silently introduced.

Transaction descriptions are financial data held behind `ExpenseDataSource`, not persistent semantic user memory. Retrieve only the transaction-level detail needed for the requested analysis. Do not log raw descriptions or financial rows, automatically persist descriptions as memories, embed every expense, or expose unnecessary details in intermediate prompts.

### Phase 3C — Persistent semantic user memory

Across sessions, retain intentionally created or updated user-specific facts, preferences, and context. The planned flow is: user information/fact → memory representation → embedding → vector database/vector store → semantic retrieval using the current query → relevant memories supplied to the agent/LLM → LLM relevance assessment. Planned work includes the memory creation/update model, embeddings, vector storage and semantic search, relevant-memory injection into agent reasoning, and memory lifecycle/cleanup.

Persistent memory must not automatically store every conversation message. The design must apply appropriate privacy and data-boundary rules to distinguish ephemeral session context, persistent user memory, and financial transaction data. Embeddings and vector storage, when introduced, are for intentionally maintained user facts/preferences/context—not an automatic index of financial transactions.

```text
                         User
                           ↓
                     FinanceAgent
                           ↓
                         LLM
                           ↓
              Structured intent/specification
                           ↓
              +------------+-------------+
              |                          |
        Conversation                 Financial
          Memory                       Analysis
              |                          |
      Session context          Deterministic engine
              |                          |
              |                   ExpenseDataSource
              |                          |
              |                 Individual transactions
              |                          |
              +------------+-------------+
                           ↓
                    Structured result
                           ↓
                          LLM
                           ↓
                    Natural-language answer
```

Persistent semantic memory remains a separate subsystem that may supply relevant intentionally maintained user context to the agent. Neither session memory, item-level analysis, nor persistent semantic memory—including embeddings and a vector database—may be introduced during Phase 2 financial-analysis work.

## Phase 4 — Advanced Agent Architecture — Future

Potential work includes LangGraph only where genuinely useful, more complex multi-step workflows, multiple specialized agents where justified, PostgreSQL as a broader persistent application database, additional financial data sources, and scheduled/background workflows.

These are future capabilities; they are not prerequisites for the initial Phase 2 tools.

# 5. Google Sheets Access

The application needs access to the user's Google Sheets.

Before Codex implements the Google Sheets integration:

1. Enable the required Google Sheets API / Google Cloud configuration.
2. Choose service-account or OAuth authentication based on deployment needs.
3. Share the relevant Google Sheets with the Google identity used by the application.
4. Use **Viewer** permission for read-only phases.
5. Use **Editor** permission when write/update functionality is introduced.

Codex needs the relevant sheet structure, sheet names/ranges, and necessary Google access configuration to implement and test the integration.

**Never commit Google credentials, service-account private keys, OAuth secrets, or API keys to Git.** Store secrets using environment variables or an appropriate secrets mechanism.

# 6. Agent / Tool Architecture

Separate AI reasoning from deterministic application logic.

```text
User
  |
  v
Agent / Orchestrator
  |
  +--> LLM
  |
  +--> Tools
          |
          +--> Google Sheets
          +--> PostgreSQL
          +--> Mutual Fund / NAV APIs
          +--> Other external APIs
```

The LLM should handle:
- Understanding user intent
- Reasoning
- Selecting tools
- Deciding the sequence of actions
- Synthesizing results
- Generating natural-language responses

Normal backend code should handle:
- Calculations
- Data validation
- Database operations
- Google Sheets reads/writes
- NAV retrieval
- Scheduled processing
- Authentication
- Error handling

# 7. Model Abstraction

The application should avoid tightly coupling the agent to one model provider.

```text
                     Finance Agent
                          |
                       LangChain
                          |
                    Model Interface
                          |
          +---------------+---------------+
          |               |               |
       OpenAI            GLM           Gemini
```

Models should be evaluated based on:
- Tool/function calling
- Structured output
- Reasoning quality
- Context handling
- Reliability
- Cost
- Latency

Coding/SWE-focused models may be useful for development tasks, but the finance agent should select models based on agent/tool performance rather than coding capability alone.

# 8. LangChain / LangGraph / n8n Roles

### LangChain
LLM/agent application framework and model abstraction layer. Useful for model integrations, tools, agents, structured outputs, and retrieval.

### LangGraph
Introduce when agent workflows require multiple agents, stateful execution, conditional routing, loops, human approval, or complex orchestration.

### n8n
Optional workflow automation layer for predictable integrations and scheduled workflows.

Example:

```text
Schedule
  ↓
Fetch NAV
  ↓
Update database
  ↓
Update Google Sheet
  ↓
Send notification
```

n8n and LangGraph can coexist: n8n handles automation workflows while LangGraph handles complex AI-agent orchestration.

# 9. Deployment

### Development

Start locally:

```text
Local machine
    |
    +-- Node.js / TypeScript
    +-- LangChain
    +-- LangGraph (when needed)
    +-- PostgreSQL (when needed)
    +-- n8n (when needed)
    +-- Finance Agent
```

### Deployment

Move to a VPS/container setup when the application needs to run while the local machine is offline, execute scheduled jobs continuously, or provide an always-available API.

Possible deployment:

```text
VPS
 |
 +-- Finance Agent / API
 +-- PostgreSQL
 +-- n8n
 |
 +-- LLM APIs
 +-- Google Sheets API
 +-- NAV / external APIs
```

Kubernetes/cloud-scale infrastructure is not required initially.

# 10. Initial Success Criteria

The first meaningful milestone is:

> User asks a natural-language question about expenses → Agent determines that expense data is required → Agent calls a Google Sheets tool → Data is retrieved → Agent analyzes it → User receives a useful summary.

Example:

> "How much did I spend on food last month?"

The system should retrieve the relevant rows from Google Sheets and produce a useful answer without manual sheet inspection.

# 11. Development Principles

- Build incrementally.
- Start with one agent and a small number of tools.
- Keep the model provider configurable.
- Introduce LangGraph only when orchestration complexity justifies it.
- Keep deterministic financial calculations in normal backend code.
- Require confirmation for sensitive write operations initially.
- Keep AI decisions separate from actual data mutations.
- Never expose secrets in source control.
- Add RAG/vector databases only when needed.
- Use n8n for predictable automation where it provides value.
- Keep the architecture extensible toward multi-agent orchestration.
