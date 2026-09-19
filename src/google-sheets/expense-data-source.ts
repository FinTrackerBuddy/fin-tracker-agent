import {
  loadGoogleSheetsLedgerConfiguration,
  type GoogleSheetsLedgerConfiguration,
} from "./config.js";
import {
  GoogleSheetsLedgerReader,
  type ExpenseLedgerTransaction,
} from "./ledger-reader.js";
import {
  ReadOnlyGoogleSheetsApiClient,
} from "./sheets-api.js";
import { createStoredGoogleOAuthAccessTokenProvider } from "./oauth-token-store.js";
import { type ApplicationLogger } from "../logging/application-logger.js";

/** The normalized expense shape exposed to the application tool layer. */
export interface GoogleSheetsExpense {
  date: string;
  category: string;
  description: string;
  amount: number;
  sourceSheet: string;
  sourceRow: number;
  /** Ledger account, retained for account-type filters such as cash. */
  account?: string;
}

/**
 * Small boundary used by the tool layer and by tests. It deliberately exposes
 * only debit transactions: the inspected monthly ledger records expenses in
 * DR AMOUNT / TYPE (IF DEBIT), while credit rows are income or reimbursements.
 */
export interface ExpenseDataSource {
  readonly monthTabs: readonly string[];
  listExpenses(): Promise<GoogleSheetsExpense[]>;
}

export interface GoogleSheetsExpenseDataSourceDependencies {
  configuration: Pick<GoogleSheetsLedgerConfiguration, "monthTabs">;
  ledgerReader: Pick<GoogleSheetsLedgerReader, "readMonthlyLedger">;
}

export class GoogleSheetsExpenseDataSource implements ExpenseDataSource {
  public readonly monthTabs: readonly string[];

  public constructor(
    private readonly dependencies: GoogleSheetsExpenseDataSourceDependencies,
  ) {
    this.monthTabs = dependencies.configuration.monthTabs;
  }

  public async listExpenses(): Promise<GoogleSheetsExpense[]> {
    const transactions = await this.dependencies.ledgerReader.readMonthlyLedger();
    return transactions
      .filter(isDebitTransaction)
      .map((transaction) => ({
        date: transaction.date,
        category: transaction.debitCategory,
        description: transaction.description,
        amount: transaction.debitAmount,
        sourceSheet: transaction.sourceSheet,
        sourceRow: transaction.sourceRow,
        account: transaction.account,
      }));
  }
}

/**
 * Creates the production, GET-only expense source. OAuth credentials and
 * refreshable tokens are loaded only by the isolated local OAuth layer.
 */
export async function createGoogleSheetsExpenseDataSourceFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  logger?: ApplicationLogger,
): Promise<GoogleSheetsExpenseDataSource> {
  const configuration = loadGoogleSheetsLedgerConfiguration(environment);
  const accessTokenProvider = await createStoredGoogleOAuthAccessTokenProvider();
  const sheetsApi = new ReadOnlyGoogleSheetsApiClient(accessTokenProvider, fetch, logger);
  const ledgerReader = new GoogleSheetsLedgerReader(configuration, sheetsApi);

  return new GoogleSheetsExpenseDataSource({ configuration, ledgerReader });
}

function isDebitTransaction(
  transaction: ExpenseLedgerTransaction,
): transaction is ExpenseLedgerTransaction & {
  debitAmount: number;
  debitCategory: string;
} {
  return transaction.debitAmount !== undefined && transaction.debitCategory !== undefined;
}
