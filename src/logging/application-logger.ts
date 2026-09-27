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

/**
 * Produces a bounded diagnostic suitable for application logs. Error details
 * are useful for operations, but provider and OAuth errors can occasionally
 * echo credentials, so they use the same redaction path as other log text.
 */
export function summarizeError(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < 3 && current instanceof Error; depth += 1) {
    if (current.message.trim()) {
      messages.push(current.message.trim());
    }
    current = getErrorCause(current);
  }

  const summary = messages.length > 0 ? [...new Set(messages)].join(" Caused by: ") : "Unknown error.";
  const bounded = summary.length <= 500 ? summary : `${summary.slice(0, 497)}...`;
  return redactSensitiveText(bounded);
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
  return value
    .replace(/(?:sk-|AIza|ya29\.|Bearer\s+)[A-Za-z0-9._-]+/gi, "[REDACTED]")
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization)\s*[=:]\s*["']?[^,\s"']+/gi, "$1=[REDACTED]")
    .replace(/([?&](?:key|api_key|access_token|refresh_token)=[^&#\s]*)/gi, "[REDACTED]");
}

function getErrorCause(error: Error): unknown {
  const candidate = error as Error & { cause?: unknown };
  return candidate.cause;
}
