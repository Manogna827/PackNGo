import test from "node:test";
import assert from "node:assert/strict";
import { calculateBalances, moneyToCents } from "../lib/finance.js";

const members = [
  { uid: "a", name: "A", status: "active" },
  { uid: "b", name: "B", status: "active" },
  { uid: "c", name: "C", status: "active" }
];
const expense = (id, amount, paidById, participants = ["a", "b", "c"]) => ({
  id, amount, paidById, participants, deletedAt: null
});

test("matches the three-person expense and settlement acceptance example", () => {
  const expenses = [expense("one", 90, "a"), expense("two", 60, "b")];
  const before = calculateBalances(members, expenses);
  assert.equal(before.totalSpent, 150);
  assert.deepEqual(
    Object.fromEntries(Object.entries(before.members).map(([uid, member]) => [uid, member.balance])),
    { a: 40, b: 10, c: -50 }
  );
  assert.deepEqual(before.suggestions, [
    { fromId: "c", toId: "a", amount: 40 },
    { fromId: "c", toId: "b", amount: 10 }
  ]);
  const afterFirst = calculateBalances(members, expenses, [
    { fromId: "c", toId: "a", amount: 40, status: "approved" }
  ]);
  assert.equal(afterFirst.members.a.balance, 0);
  assert.equal(afterFirst.members.a.paid, 90, "Repayment receipts do not rewrite expense payments.");
  assert.equal(afterFirst.members.b.balance, 10);
  assert.equal(afterFirst.members.c.balance, -10);
  const settled = calculateBalances(members, expenses, [
    { fromId: "c", toId: "a", amount: 40, status: "approved" },
    { fromId: "c", toId: "b", amount: 10, status: "approved" }
  ]);
  assert.deepEqual(Object.values(settled.members).map((member) => member.balance), [0, 0, 0]);
  assert.equal(settled.balanceCents, 0);
});

test("matches the two-person ₹250 and ₹90 acceptance example", () => {
  const result = calculateBalances([
    { uid: "a", name: "Manogna", status: "active" },
    { uid: "b", name: "Samhitha", status: "active" }
  ], [
    expense("first", 250, "a", ["a", "b"]),
    expense("second", 90, "b", ["a", "b"])
  ]);
  assert.equal(result.totalSpent, 340);
  assert.equal(result.members.a.share, 170);
  assert.equal(result.members.a.balance, 80);
  assert.equal(result.members.b.share, 170);
  assert.equal(result.members.b.balance, -80);
  assert.deepEqual(result.suggestions, [{ fromId: "b", toId: "a", amount: 80 }]);
});

test("allocates indivisible cents deterministically and conserves money", () => {
  const result = calculateBalances(members, [expense("round", 1, "a")]);
  assert.deepEqual(members.map((member) => result.members[member.uid].share), [0.34, 0.33, 0.33]);
  assert.equal(result.totalCents, 100);
  assert.equal(result.balanceCents, 0);
});

test("preserves historical participants and leaves pending repayments out of balances", () => {
  const leftMember = { ...members[2], status: "left" };
  const result = calculateBalances([members[0], members[1], leftMember], [
    expense("old", 90, "a", ["a", "c"])
  ], [{ fromId: "c", toId: "a", amount: 20, status: "pending" }]);
  assert.equal(result.members.c.share, 45);
  assert.equal(result.members.c.balance, -45);
  assert.equal(result.members.a.paid, 90);
  assert.equal(result.balanceCents, 0);
});

test("excludes deleted expenses and records approved repayments separately", () => {
  const result = calculateBalances(members, [
    expense("kept", 30, "a", ["a", "b"]),
    { ...expense("deleted", 999, "b"), deletedAt: "2026-01-01T00:00:00.000Z" }
  ], [{ fromId: "b", toId: "a", amount: 10, status: "approved" }]);
  assert.equal(result.totalSpent, 30);
  assert.equal(result.members.a.paid, 30);
  assert.equal(result.members.b.paid, 0);
  assert.equal(result.members.b.settled, 10);
  assert.equal(result.balanceCents, 0);
});

test("uses exact integer-cent values for two-decimal amounts", () => {
  assert.equal(moneyToCents(99.5), 9950);
  assert.equal(moneyToCents(1500.75), 150075);
});
