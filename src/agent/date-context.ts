export const APPLICATION_TIME_ZONE = "Asia/Kolkata";

const WORKBOOK_MONTH_TABS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type WorkbookMonthTab = (typeof WORKBOOK_MONTH_TABS)[number];

export interface Clock {
  now(): Date;
}

export interface FinanceDateContext {
  localDate: string;
  currentCalendarMonth: WorkbookMonthTab;
  currentYear: number;
  currentWorkbookMonthTab: WorkbookMonthTab;
  previousCalendarMonth: WorkbookMonthTab;
  previousYear: number;
  previousWorkbookMonthTab: WorkbookMonthTab;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/**
 * Resolves calendar-relative date facts in the application's timezone. Month
 * names intentionally match the inspected Expenses workbook's monthly tabs;
 * their April–March financial-year display order is irrelevant here.
 */
export function getFinanceDateContext(
  now: Date,
  timeZone: string = APPLICATION_TIME_ZONE,
): FinanceDateContext {
  if (Number.isNaN(now.getTime())) {
    throw new Error("A valid current date is required.");
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatToParts(now);
  const day = requiredDatePart(parts, "day");
  const month = requiredDatePart(parts, "month") as WorkbookMonthTab;
  const year = Number(requiredDatePart(parts, "year"));

  if (!WORKBOOK_MONTH_TABS.includes(month) || !Number.isInteger(year)) {
    throw new Error("Unable to resolve the current local calendar date.");
  }

  const monthIndex = WORKBOOK_MONTH_TABS.indexOf(month);
  const previousMonthIndex = (monthIndex + WORKBOOK_MONTH_TABS.length - 1)
    % WORKBOOK_MONTH_TABS.length;
  const previousCalendarMonth = WORKBOOK_MONTH_TABS[previousMonthIndex]!;
  const previousYear = monthIndex === 0 ? year - 1 : year;

  return {
    localDate: `${month} ${day}, ${year}`,
    currentCalendarMonth: month,
    currentYear: year,
    currentWorkbookMonthTab: month,
    previousCalendarMonth,
    previousYear,
    previousWorkbookMonthTab: previousCalendarMonth,
  };
}

/** Builds authoritative time instructions for the provider-neutral agent prompt. */
export function formatFinanceDateContext(context: FinanceDateContext): string {
  return [
    "Authoritative date context supplied by the application:",
    `Current local date: ${context.localDate}`,
    `Current calendar month: ${context.currentCalendarMonth}`,
    `Current year: ${context.currentYear}`,
    `Current workbook month tab: ${context.currentWorkbookMonthTab}`,
    `Previous calendar month: ${context.previousCalendarMonth}`,
    `Previous year: ${context.previousYear}`,
    `Previous workbook month tab: ${context.previousWorkbookMonthTab}`,
    'Interpret "this month" as the current workbook month tab above.',
    'Interpret "last month" as the previous workbook month tab above.',
    "Month names in tool calls must be actual workbook month tabs.",
    "The workbook's April–March financial-year ordering must not change calendar-relative dates.",
  ].join("\n");
}

function requiredDatePart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  const value = parts.find((part) => part.type === type)?.value;
  if (!value) {
    throw new Error(`Unable to resolve local date ${type}.`);
  }
  return value;
}
