export type LogScope = "HTTP" | "Agent" | "LLM" | "Tool" | "GoogleSheets" | "Error";

export type LogDetails = Record<string, string | number | boolean | readonly string[] | undefined>;

/**
 * Small application boundary for operational events. A structured logger can
 * later implement this interface without changing the agent or HTTP flow.
 */
export interface ApplicationLogger {
  info(scope: LogScope, message: string, details?: LogDetails): void;
  error(scope: LogScope, message: string, details?: LogDetails): void;
}

/** Adds stable request metadata to every event sent through a logger. */
export function withLogDetails(
  logger: ApplicationLogger,
  context: LogDetails,
): ApplicationLogger {
  return {
    info(scope, message, details) {
      logger.info(scope, message, { ...details, ...context });
    },
    error(scope, message, details) {
      logger.error(scope, message, { ...details, ...context });
    },
  };
}

export class ConsoleApplicationLogger implements ApplicationLogger {
  public info(scope: LogScope, message: string, details?: LogDetails): void {
    console.log(formatLogLine(scope, message, details));
  }

  public error(scope: LogScope, message: string, details?: LogDetails): void {
    console.error(formatLogLine(scope, message, details));
  }
}

export const consoleApplicationLogger = new ConsoleApplicationLogger();

export function summarizeQuery(query: string): string {
  const normalized = query.replace(/\s+/g, " ").trim();
  const summary = normalized.length <= 300 ? normalized : `${normalized.slice(0, 297)}...`;
  return redactSensitiveText(summary);
}

export function formatCurrency(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function formatLogLine(scope: LogScope, message: string, details?: LogDetails): string {
  const suffix = details
    ? Object.entries(details)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${formatValue(value!)}`)
      .join(" ")
    : "";
  return `[${scope}] ${message}${suffix ? ` ${suffix}` : ""}`;
}

function formatValue(value: Exclude<LogDetails[string], undefined>): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map(redactSensitiveText));
  }
  if (typeof value === "string") {
    return JSON.stringify(redactSensitiveText(value));
  }
  return String(value);
}

function redactSensitiveText(value: string): string {
  return value.replace(/(?:sk-|AIza|ya29\.|Bearer\s+)[A-Za-z0-9._-]+/gi, "[REDACTED]");
}
