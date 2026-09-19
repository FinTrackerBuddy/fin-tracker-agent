import assert from "node:assert/strict";
import test from "node:test";

import { formatFinanceDateContext, getFinanceDateContext } from "./date-context.js";

test("resolves September as this month in Asia/Kolkata", () => {
  const context = getFinanceDateContext(new Date("2026-09-16T12:00:00.000Z"));

  assert.equal(context.localDate, "September 16, 2026");
  assert.equal(context.currentCalendarMonth, "September");
  assert.equal(context.currentYear, 2026);
  assert.equal(context.currentWorkbookMonthTab, "September");
});

test("resolves January and its preceding December using calendar order", () => {
  const context = getFinanceDateContext(new Date("2027-01-15T12:00:00.000Z"));

  assert.equal(context.currentCalendarMonth, "January");
  assert.equal(context.currentWorkbookMonthTab, "January");
  assert.equal(context.previousCalendarMonth, "December");
  assert.equal(context.previousYear, 2026);
  assert.equal(context.previousWorkbookMonthTab, "December");
});

test("uses March as April's last month despite April–March workbook ordering", () => {
  const context = getFinanceDateContext(new Date("2027-04-15T12:00:00.000Z"));

  assert.equal(context.currentWorkbookMonthTab, "April");
  assert.equal(context.previousWorkbookMonthTab, "March");
  assert.match(
    formatFinanceDateContext(context),
    /April–March financial-year ordering must not change calendar-relative dates/,
  );
});
