const toCents = (value) => Math.round(Number(value) * 100);
const fromCents = (value) => Number((value / 100).toFixed(2));

function allocateCents(totalCents, participantIds) {
  const ids = [...new Set(participantIds)].sort();
  if (!ids.length) return {};
  const base = Math.floor(totalCents / ids.length);
  let remainder = totalCents - base * ids.length;
  return Object.fromEntries(ids.map((id) => {
    const share = base + (remainder > 0 ? 1 : 0);
    remainder -= 1;
    return [id, share];
  }));
}

export function calculateBalances(members, expenses, settlements = []) {
  const byId = new Map(members.map((member) => [member.uid, {
    uid: member.uid,
    name: member.name || member.email || "Trip member",
    active: member.status === "active",
    paidCents: 0,
    settledCents: 0,
    shareCents: 0,
    balanceCents: 0
  }]));

  for (const expense of expenses) {
    if (expense.deletedAt) continue;
    const amountCents = toCents(expense.amount);
    const payer = byId.get(expense.paidById);
    if (payer) payer.paidCents += amountCents;
    const participants = (expense.participants || []).filter((uid) => byId.has(uid));
    const shares = allocateCents(amountCents, participants);
    for (const [uid, shareCents] of Object.entries(shares)) {
      byId.get(uid).shareCents += shareCents;
    }
  }

  for (const settlement of settlements) {
    if (settlement.status !== "approved") continue;
    const from = byId.get(settlement.fromId);
    const to = byId.get(settlement.toId);
    const amountCents = toCents(settlement.amount);
    if (from && to) {
      from.settledCents += amountCents;
      to.settledCents -= amountCents;
    }
  }

  for (const member of byId.values()) {
    member.balanceCents = member.paidCents + member.settledCents - member.shareCents;
  }

  const membersById = Object.fromEntries([...byId.entries()].map(([uid, member]) => [uid, {
    ...member,
    paid: fromCents(member.paidCents),
    settled: fromCents(member.settledCents),
    share: fromCents(member.shareCents),
    balance: fromCents(member.balanceCents)
  }]));
  const totalCents = expenses.filter((expense) => !expense.deletedAt)
    .reduce((sum, expense) => sum + toCents(expense.amount), 0);
  const balanceCents = [...byId.values()].reduce((sum, member) => sum + member.balanceCents, 0);

  return {
    totalSpent: fromCents(totalCents),
    totalCents,
    balanceCents,
    members: membersById,
    suggestions: buildSettlementSuggestions([...byId.values()])
  };
}

export function buildSettlementSuggestions(members) {
  const debtors = members.filter((member) => member.balanceCents < 0)
    .map((member) => ({ uid: member.uid, cents: -member.balanceCents }))
    .sort((a, b) => a.uid.localeCompare(b.uid));
  const creditors = members.filter((member) => member.balanceCents > 0)
    .map((member) => ({ uid: member.uid, cents: member.balanceCents }))
    .sort((a, b) => a.uid.localeCompare(b.uid));
  const suggestions = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const amountCents = Math.min(debtors[debtorIndex].cents, creditors[creditorIndex].cents);
    if (amountCents > 0) {
      suggestions.push({
        fromId: debtors[debtorIndex].uid,
        toId: creditors[creditorIndex].uid,
        amount: fromCents(amountCents)
      });
    }
    debtors[debtorIndex].cents -= amountCents;
    creditors[creditorIndex].cents -= amountCents;
    if (!debtors[debtorIndex].cents) debtorIndex += 1;
    if (!creditors[creditorIndex].cents) creditorIndex += 1;
  }
  return suggestions;
}

export function moneyToCents(value) {
  return toCents(value);
}
