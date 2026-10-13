import test from "node:test";
import assert from "node:assert/strict";
import { HttpError } from "../lib/errors.js";
import { amount, date, inviteCode, time } from "../lib/validation.js";

function rejected(callback) {
  assert.throws(callback, (error) => error instanceof HttpError && error.status === 400);
}

test("accepts INR amounts with at most two decimal places", () => {
  assert.equal(amount("100"), 100);
  assert.equal(amount("99.50"), 99.5);
  assert.equal(amount(1500.75), 1500.75);
});

test("rejects non-positive, non-finite, and over-precision amounts", () => {
  for (const value of ["0", "-1", "abc", "1.001", "1e3", NaN, Infinity, null]) {
    rejected(() => amount(value));
  }
});

test("validates actual calendar dates and trip invite codes", () => {
  assert.equal(date("2026-10-06", "Start date"), "2026-10-06");
  rejected(() => date("2026-02-30", "Start date"));
  assert.equal(time("23:45"), "23:45");
  rejected(() => time("24:00"));
  rejected(() => time("9:15"));
  assert.equal(inviteCode("abC234"), "ABC234");
  rejected(() => inviteCode("ABC01O"));
  rejected(() => inviteCode("short"));
});
