# Expenses Workbook Data Map

## Access and scope

- Workbook: configured local Expenses workbook (identity intentionally omitted from source control)
- Spreadsheet ID: supplied only through the ignored local `GOOGLE_SHEETS_SPREADSHEET_ID` environment variable
- Access: verified through the local desktop OAuth flow using the Google Sheets read-only scope.
- Authorization behavior: the deliberate reauthorization flow used `prompt=select_account`; the user selected the account manually.
- Safety: no spreadsheet writes were made. The temporary access token and inspection extract were not persisted in the repository.

This is an expenses and cash-account workbook. It includes transaction categories such as `Investments` and `MF Units Redeemed`, but it has no dedicated mutual-fund, PPF, EPF, portfolio, goals, or broader wealth-tracker tabs.

## Workbook structure

| Tab | Purpose and structure | Relationships / observations |
| --- | --- | --- |
| `Savings Accounts` | Account-card layout rather than a normalized table. It stores bank name, account number, branch, IFSC, owner, opening balance as of April 1, and current balance for four bank accounts. It also has two cash-in-hand balances. | Current balances are formulas that start with the opening balance and net the monthly debit/credit account summaries. Account numbers are stored as numeric cells; they should be treated as identifiers, not amounts, in a future reader. |
| `Debts & Reimbursals` | A small A:D register: `Person`, `To give`, `To receive`, `Remarks`. A separate F:G calculation block shows total loan given to recover, loan payable, and reimbursements. | The calculation block nets the loan/reimbursement categories in `Debit summary` and `Credit summary`; it also carries a stated prior-year reimbursement amount. The tab name uses the nonstandard spelling `Reimbursals`. |
| `Electronic Items bought` | Purchase register with headers on row 2: `Date`, `Item`, `Price`, `Remarks`. Row 1 sums the price column and compares it with the electronics total. | The check formula compares the register total with `Debit summary`'s `Electronic Items` total and expects zero. It currently contains a small number of rows. It overlaps the monthly transaction tabs by design. |
| `Household Items bought` | Purchase register with the same row-2 columns: `Date`, `Item`, `Price`, `Remarks`. | Its row-1 check compares the register total with the `Household items` total in `Debit summary`. It overlaps the monthly transaction tabs and contains more entries than the electronics register. |
| `Debit summary` | Monthly debit-category matrix. Column A is the fiscal-year total, B is the category, and C:N are April through March. | Categories are linked from `Util sheet` column C. Each monthly cell uses `SUMIF` against that month's debit type and debit amount columns. The grand-total row intentionally starts below the loan/reimbursement/transfer rows, so it is not a total of every debit-category row. |
| `Credit summary` | Monthly credit-category matrix with the same A:N layout as `Debit summary`. | Categories are linked from `Util sheet` column D. Each monthly cell uses `SUMIF` against that month's credit type and credit amount columns. Its grand-total row also excludes the early operational categories. |
| `April` | Monthly transaction ledger with populated detail. | Uses the common monthly layout described below. |
| `May` | Monthly transaction ledger with populated detail. | Uses the common monthly layout. |
| `June` | Monthly transaction ledger with populated detail. | Uses the common monthly layout. |
| `July` | Monthly transaction ledger with populated detail. | Uses the common monthly layout. |
| `August` | Monthly transaction ledger with populated detail. | Uses the common monthly layout. |
| `September` | Monthly transaction ledger with populated detail. | Uses the common monthly layout. |
| `October` | Monthly ledger template with account summary and transaction headers, but no transaction detail yet. | Uses the common monthly layout. |
| `November` | Monthly ledger template with account summary and transaction headers, but no transaction detail yet. | Uses the common monthly layout. |
| `December` | Monthly ledger template with account summary and transaction headers, but no transaction detail yet. | Uses the common monthly layout. |
| `January` | Monthly ledger template with account summary and transaction headers, but no transaction detail yet. | Uses the common monthly layout. |
| `February` | Monthly ledger template with account summary and transaction headers, but no transaction detail yet. | Uses the common monthly layout. |
| `March` | Monthly ledger template with account summary and transaction headers, but no transaction detail yet. | Uses the common monthly layout. |
| `Util sheet` | Master lists: accounts in column A, debit types in C, and credit types in D. | It supplies category labels to the debit/credit summaries and account labels to the monthly account-summary formulas. It is the closest thing to a controlled taxonomy. |

## Monthly transaction layout

Every month uses the same core ledger, with transaction headers on row 8:

| Column | Field | Representation |
| --- | --- | --- |
| A | `DATE` | Spreadsheet date values displayed as `dd-mmm`; the display omits the year. |
| B | `TRANSACTION INFO` | Free-text description. |
| C | `DR AMOUNT` | Numeric debit amount; some rows use arithmetic formulas to split or combine a purchase. |
| D | `CR AMOUNT` | Numeric credit amount. |
| E | `TYPE (IF DEBIT)` | Debit-category text matched to `Util sheet` column C. |
| F | `TYPE (IF CREDIT)` | Credit-category text matched to `Util sheet` column D. |
| G | `ACCOUNT` | Account label matched to `Util sheet` column A. |

Rows 2:7 provide an `Accounts summary` with debit and credit `SUMIF` formulas. The ledger starts on row 9. April through September contain populated rows; October through March currently contain only the summary and header template.

## Relationships and calculation flow

```text
Util sheet (accounts and category taxonomy)
          ↓
Monthly tabs (ledger rows and per-account debit/credit summaries)
          ↓                         ↓
Debit summary / Credit summary   Savings Accounts cash and bank roll-forwards
          ↓
Debts & Reimbursals; household/electronics reconciliation checks
```

- `Debit summary` aggregates monthly `TYPE (IF DEBIT)` / `DR AMOUNT` values.
- `Credit summary` aggregates monthly `TYPE (IF CREDIT)` / `CR AMOUNT` values.
- `Savings Accounts` nets selected monthly account-summary rows against opening balances. The monthly formula block references a selected subset of the listed accounts, rather than a general account table.
- The household and electronics registers reconcile their price totals to the corresponding debit-summary categories. They are secondary categorized views, not independent expense sources.
- `Debts & Reimbursals` derives its total lines from summary-category netting and a carried-forward reimbursement amount.

## Data-quality and normalization notes

- The monthly ledger is the authoritative transaction-detail source for a future read-only expense reader. The summaries and purchase registers derive from or reconcile against it.
- There is no stable transaction ID. A future reader should treat a combination of month, row position, date, description, amount, category, and account as a provisional record identity.
- `TRANSACTION INFO` is free text, not a controlled item/merchant taxonomy. Similar descriptions may describe the same real-world item, but the workbook does not establish that equivalence; any future description normalization or entity grouping must be explicitly designed and validated.
- Dates are real spreadsheet dates but are displayed without a year. The workbook title establishes FY 2026–27, but a production reader should preserve the underlying date serial and resolve its year explicitly.
- Debit and credit are represented in separate columns and separate category columns. A record should normally have one populated side; validation should identify rows with both or neither populated rather than silently treating blanks as zero.
- Amount cells may be literals or formulas such as arithmetic splits. A reader should use effective numeric values for analysis and retain formula provenance only when needed.
- The account, debit-type, and credit-type lists are maintained as free-text master lists rather than enforced IDs or validated references. Category spelling/case drift would break `SUMIF`-based summaries.
- Some labels contain spelling/style inconsistencies, including `Debts & Reimbursals`, `Entertaintment & Movies`, and `Misc uncategorised`.
- Summary formulas use large fixed row ranges even where the visible monthly data is much shorter. This is functional as a buffer but creates an implicit range convention that a future service should not copy blindly.
- Account numbers appear as numeric values in the account cards. A future integration must never coerce or expose them as financial amounts, and should avoid logging them.

## Recommended next implementation milestone

Implement only a read-only Google Sheets expense source for the monthly ledger tabs. Configure the workbook ID outside source control, read rows 9 onward from the selected month tabs, map the seven observed ledger fields, use the effective numeric debit/credit values, and keep the current `FinanceAgent` response contract unchanged. Do not add writes, portfolio features, database storage, or later-phase infrastructure.
