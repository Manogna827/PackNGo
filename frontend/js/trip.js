import { authReady } from "./firebase.js";
import { api } from "./api.js";
import { escapeHtml, formatDate, fullName, money, setButtonBusy, showPageError, toast } from "./utils.js";

const tripId = new URLSearchParams(window.location.search).get("id");
const state = { user: null, trip: null, itinerary: [], expenses: [], tasks: [], documents: [], settlements: [], summary: null, guide: [] };
const loading = document.querySelector("#trip-loading");
const content = document.querySelector("#trip-content");

if (!tripId) {
  showPageError({ message: "This trip link is missing its trip ID. Open the trip from your trips list." });
} else {
  try {
    state.user = await authReady;
    if (!state.user) window.location.replace("/login.html");
    else await refreshTrip();
  } catch (error) {
    showPageError(error);
    if (error.message.includes("active member")) window.setTimeout(() => window.location.assign("/dashboard.html"), 1500);
  }
}

async function refreshTrip() {
  const data = await api(`/trips/${encodeURIComponent(tripId)}/full`);
  Object.assign(state, data);
  loading.hidden = true;
  content.hidden = false;
  renderTripHeader();
  renderItinerary();
  renderExpenses();
  renderTasks();
  renderDocuments();
  renderHistory();
}

function renderTripHeader() {
  const activeMembers = state.trip.members.filter((member) => member.status === "active");
  document.title = `${state.trip.name} — PackNGo`;
  document.querySelector("#trip-name").textContent = state.trip.name;
  document.querySelector("#trip-destination").textContent = state.trip.destination;
  document.querySelector("#trip-dates").textContent = `${formatDate(state.trip.start)} – ${formatDate(state.trip.end)}`;
  const days = Math.max(1, Math.round((new Date(`${state.trip.end}T00:00:00Z`) - new Date(`${state.trip.start}T00:00:00Z`)) / 86400000) + 1);
  document.querySelector("#trip-duration").textContent = `${days} ${days === 1 ? "day" : "days"}`;
  document.querySelector("#member-cluster").innerHTML = activeMembers.map((member) => `<span class="member-avatar" title="${escapeHtml(member.name)}">${escapeHtml((member.name || "?").slice(0, 1).toUpperCase())}</span>`).join("");
  document.querySelector("#member-count").textContent = `${activeMembers.length} of 10 travellers`;
  document.querySelector("#invite-code-display").textContent = state.trip.inviteCode;
  const isOwner = state.trip.ownerId === state.user.uid;
  document.querySelector("#delete-trip").hidden = !isOwner;
  const transferWrap = document.querySelector("#transfer-wrap");
  const transferOptions = activeMembers.filter((member) => member.uid !== state.user.uid);
  transferWrap.hidden = !isOwner || !transferOptions.length;
  document.querySelector("#transfer-owner").innerHTML = transferOptions.map((member) =>
    `<option value="${escapeHtml(member.uid)}">${escapeHtml(member.name || member.email)}</option>`).join("");
  document.querySelector("#history-section").hidden = !isOwner;
  renderMemberControls();
}

function renderMemberControls() {
  const activeMembers = state.trip.members.filter((member) => member.status === "active");
  const isOwner = state.trip.ownerId === state.user.uid;
  document.querySelector("#leave-trip").textContent = isOwner && activeMembers.length === 1 ? "Delete-only owner" : "Leave trip";
  document.querySelector("#leave-trip").disabled = isOwner && activeMembers.length === 1;
}

document.querySelector("#copy-code")?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.trip.inviteCode);
    toast("Invite code copied.");
  } catch {
    window.prompt("Copy this invite code:", state.trip.inviteCode);
  }
});

document.querySelectorAll(".workspace-tab").forEach((button) => {
  button.addEventListener("click", () => selectTab(button.dataset.tab));
});

function selectTab(name) {
  document.querySelectorAll(".workspace-tab").forEach((button) => {
    const active = button.dataset.tab === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    const active = panel.id === `panel-${name}`;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
}

function renderItinerary() {
  const items = [...state.itinerary].sort((a, b) =>
    a.date.localeCompare(b.date) || String(a.time || "").localeCompare(String(b.time || "")));
  document.querySelector("#itinerary-count").textContent = `${items.length} ${items.length === 1 ? "stop" : "stops"}`;
  document.querySelector("#itinerary-list").innerHTML = items.length ? items.map((item) => `
    <article class="item-card"><div class="item-card-top"><div><p class="eyebrow">${formatDate(item.date)}${item.time ? ` · ${escapeHtml(item.time)}` : ""}</p><h3>${escapeHtml(item.title)}</h3></div>
      <div class="item-actions"><button class="icon-button" data-edit-itinerary="${escapeHtml(item.id)}">Edit</button><button class="icon-button danger" data-delete-collection="itinerary" data-delete-id="${escapeHtml(item.id)}">Delete</button></div></div>
      ${item.location ? `<p>⌖ ${escapeHtml(item.location)}</p>` : ""}${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}
      <div class="item-meta"><span>Added by ${escapeHtml(fullName(state.trip.members, item.createdBy))}</span></div>
    </article>`).join("") : `<div class="empty-inline">The itinerary is clear for now. Add the first stop when you’re ready.</div>`;
}

const itineraryForm = document.querySelector("#itinerary-form");
itineraryForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = new FormData(itineraryForm);
  const itemId = String(values.get("itemId") || "");
  const button = itineraryForm.querySelector("[type=submit]");
  setButtonBusy(button, true, "Saving…");
  try {
    const body = {
      date: String(values.get("date") || ""),
      time: String(values.get("time") || ""),
      title: String(values.get("title") || "").trim(),
      location: String(values.get("location") || "").trim(),
      description: String(values.get("description") || "").trim()
    };
    await api(`/trips/${encodeURIComponent(tripId)}/itinerary${itemId ? `/${encodeURIComponent(itemId)}` : ""}`, {
      method: itemId ? "PATCH" : "POST", body
    });
    resetForm(itineraryForm);
    toast(itemId ? "Itinerary item updated." : "Itinerary item added.");
    await refreshTrip();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setButtonBusy(button, false);
  }
});

document.querySelector("#itinerary-list")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-itinerary]");
  if (!button) return;
  const item = state.itinerary.find((entry) => entry.id === button.dataset.editItinerary);
  if (!item) return;
  setForm(itineraryForm, { itemId: item.id, date: item.date, time: item.time, title: item.title, location: item.location, description: item.description });
  setEditing(itineraryForm, true);
  document.querySelector("#itinerary-title").focus();
});

function renderExpenses() {
  const expenseForm = document.querySelector("#expense-form");
  const activeMembers = state.trip.members.filter((member) => member.status === "active");
  const expenseLog = document.querySelector("#expense-list");
  expenseLog.innerHTML = state.expenses.length ? [...state.expenses]
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .map((expense) => `
      <article class="item-card"><div class="item-card-top"><div><p class="eyebrow">${formatDate(expense.date)} · ${escapeHtml(expense.category)}</p><h3>${escapeHtml(expense.title)}</h3></div>
        <div class="item-actions"><strong>${money(expense.amount)}</strong><button class="icon-button" data-edit-expense="${escapeHtml(expense.id)}">Edit</button><button class="icon-button danger" data-delete-collection="expenses" data-delete-id="${escapeHtml(expense.id)}">Delete</button></div></div>
        <div class="item-meta"><span>Paid by ${escapeHtml(fullName(state.trip.members, expense.paidById))}</span><span>·</span><span>Split ${expense.participants.length} ways</span></div></article>`).join("")
    : `<div class="empty-inline">No shared expenses yet. Add one to keep the group in sync.</div>`;

  document.querySelector("#expense-total").textContent = money(state.summary.totalSpent);
  const activeBalances = activeMembers.map((member) => state.summary.members[member.uid]).filter(Boolean);
  const perPerson = activeBalances.length ? state.summary.totalSpent / activeBalances.length : 0;
  document.querySelector("#expense-person-share").textContent = state.expenses.length ? `${money(perPerson)} per active traveller, average` : "No expenses yet";
  document.querySelector("#expense-summary").innerHTML = Object.values(state.summary.members)
    .filter((member) => member.active || member.paidCents || member.shareCents)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((member) => {
      const balanceClass = member.balance > 0 ? "balance-positive" : member.balance < 0 ? "balance-negative" : "balance-zero";
      const status = member.balance > 0 ? `Gets back ${money(member.balance)}` : member.balance < 0 ? `Owes ${money(Math.abs(member.balance))}` : "Settled";
      return `<div class="summary-row"><strong>${escapeHtml(member.name)}${member.active ? "" : " · left"}</strong>
        <div class="summary-metric"><span>Amount paid</span><span>${money(member.paid)}</span></div>
        <div class="summary-metric"><span>Fair share</span><span>${money(member.share)}</span></div>
        <div class="summary-metric"><span>Balance</span><span class="${balanceClass}">${status}</span></div>
      </div>`;
    }).join("") || `<div class="empty-inline">Payment summaries will appear when the first expense is added.</div>`;

  const suggestions = state.summary.suggestions || [];
  document.querySelector("#settlement-list").innerHTML = suggestions.length ? suggestions.map((suggestion) => `
    <div class="settlement-card"><p><strong>${escapeHtml(fullName(state.trip.members, suggestion.fromId))}</strong> → <strong>${escapeHtml(fullName(state.trip.members, suggestion.toId))}</strong><small>Suggested repayment</small></p>
      <strong>${money(suggestion.amount)}</strong>${suggestion.fromId === state.user.uid ? `<button class="button button-outline button-small" data-create-settlement="${escapeHtml(suggestion.toId)}" data-amount="${suggestion.amount}">Mark paid</button>` : ""}
    </div>`).join("") : `<div class="empty-inline">Everyone is settled up. Lovely.</div>`;

  const settlementSorted = [...state.settlements].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  document.querySelector("#settlement-history").innerHTML = settlementSorted.length ? settlementSorted.map((settlement) => `
    <div class="settlement-card"><p><strong>${escapeHtml(fullName(state.trip.members, settlement.fromId))}</strong> → <strong>${escapeHtml(fullName(state.trip.members, settlement.toId))}</strong>
      <small>${settlement.createdAt ? formatDate(settlement.createdAt) : "Just now"}</small></p><strong>${money(settlement.amount)}</strong>
      <div class="settlement-actions"><span class="status-pill ${settlement.status === "pending" ? "pending" : settlement.status === "rejected" ? "rejected" : ""}">${escapeHtml(settlement.status)}</span>
      ${settlement.status === "pending" && settlement.toId === state.user.uid ? `<button class="icon-button" data-settlement-action="approve" data-settlement-id="${escapeHtml(settlement.id)}">Approve</button><button class="icon-button danger" data-settlement-action="reject" data-settlement-id="${escapeHtml(settlement.id)}">Reject</button>` : ""}</div>
    </div>`).join("") : `<div class="empty-inline">Repayment requests will appear here.</div>`;

  document.querySelector("#participant-options").innerHTML = activeMembers.map((member) => `
    <label class="participant-option"><input type="checkbox" name="participants" value="${escapeHtml(member.uid)}" checked> ${escapeHtml(member.name || member.email)}</label>`).join("");
  document.querySelector("#expense-payer").innerHTML = activeMembers.map((member) =>
    `<option value="${escapeHtml(member.uid)}">${escapeHtml(member.name || member.email)}</option>`).join("");
}

document.querySelector("#expense-list")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-expense]");
  if (!button) return;
  const expense = state.expenses.find((entry) => entry.id === button.dataset.editExpense);
  if (!expense) return;
  const form = document.querySelector("#expense-form");
  setForm(form, {
    itemId: expense.id, title: expense.title, category: expense.category,
    amount: Number(expense.amount).toFixed(2), paidById: expense.paidById, date: expense.date
  });
  const participants = document.querySelector("#participant-options");
  const existing = new Set(expense.participants);
  const knownMembers = state.trip.members.filter((member) =>
    member.status === "active" || existing.has(member.uid));
  participants.innerHTML = knownMembers.map((member) => `
    <label class="participant-option"><input type="checkbox" name="participants" value="${escapeHtml(member.uid)}" ${existing.has(member.uid) ? "checked" : ""}> ${escapeHtml(member.name || member.email)}${member.status !== "active" ? " (left)" : ""}</label>`).join("");
  const payer = form.querySelector("[name=paidById]");
  if (expense.paidById && ![...payer.options].some((option) => option.value === expense.paidById)) {
    const oldPayer = state.trip.members.find((member) => member.uid === expense.paidById);
    if (oldPayer) payer.add(new Option(`${oldPayer.name} (left)`, oldPayer.uid));
  }
  setEditing(form, true, "#expense-form-title", "Edit expense");
});

const expenseForm = document.querySelector("#expense-form");
expenseForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = new FormData(expenseForm);
  const itemId = String(values.get("itemId") || "");
  const participants = values.getAll("participants").map(String);
  if (!participants.length) {
    toast("Choose at least one participant for this expense.", "error");
    return;
  }
  const button = expenseForm.querySelector("[type=submit]");
  setButtonBusy(button, true, "Saving…");
  try {
    await api(`/trips/${encodeURIComponent(tripId)}/expenses${itemId ? `/${encodeURIComponent(itemId)}` : ""}`, {
      method: itemId ? "PATCH" : "POST",
      body: {
        title: String(values.get("title") || "").trim(),
        category: String(values.get("category") || ""),
        amount: Number(values.get("amount")),
        paidById: String(values.get("paidById") || ""),
        participants,
        date: String(values.get("date") || "")
      }
    });
    resetForm(expenseForm);
    toast(itemId ? "Expense updated." : "Expense added.");
    await refreshTrip();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setButtonBusy(button, false);
  }
});

document.querySelector("#settlement-list")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-create-settlement]");
  if (!button) return;
  button.disabled = true;
  try {
    const { settlement } = await api(`/trips/${encodeURIComponent(tripId)}/settlements`, {
      method: "POST", body: { toId: button.dataset.createSettlement, amount: Number(button.dataset.amount) }
    });
    toast("Repayment sent for approval.");
    await refreshTrip();
    document.querySelector(`[data-settlement-id="${CSS.escape(settlement.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    button.disabled = false;
    toast(error.message, "error");
  }
});

document.querySelector("#settlement-history")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-settlement-action]");
  if (!button) return;
  button.disabled = true;
  try {
    await api(`/trips/${encodeURIComponent(tripId)}/settlements/${encodeURIComponent(button.dataset.settlementId)}/${button.dataset.settlementAction}`, { method: "POST" });
    toast(button.dataset.settlementAction === "approve" ? "Repayment approved." : "Repayment rejected.");
    await refreshTrip();
  } catch (error) {
    button.disabled = false;
    toast(error.message, "error");
  }
});

function renderTasks() {
  const sorted = [...state.tasks].sort((a, b) =>
    (a.status === "done") - (b.status === "done") || String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")));
  document.querySelector("#task-count").textContent = `${sorted.filter((task) => task.status === "open").length} open`;
  document.querySelector("#task-assignee").innerHTML = `<option value="">Anyone / unassigned</option>` + state.trip.members
    .filter((member) => member.status === "active")
    .map((member) => `<option value="${escapeHtml(member.uid)}">${escapeHtml(member.name || member.email)}</option>`).join("");
  document.querySelector("#task-list").innerHTML = sorted.length ? sorted.map((task) => `
    <article class="item-card ${task.status === "done" ? "task-done" : ""}"><div class="item-card-top"><div><h3>${escapeHtml(task.title)}</h3>${task.description ? `<p>${escapeHtml(task.description)}</p>` : ""}</div>
      <div class="item-actions"><button class="icon-button" data-toggle-task="${escapeHtml(task.id)}">${task.status === "done" ? "Undo" : "Complete"}</button><button class="icon-button" data-edit-task="${escapeHtml(task.id)}">Edit</button><button class="icon-button danger" data-delete-collection="tasks" data-delete-id="${escapeHtml(task.id)}">Delete</button></div></div>
      <div class="item-meta">${task.assigneeId ? `<span>For ${escapeHtml(fullName(state.trip.members, task.assigneeId))}</span>` : "<span>Unassigned</span>"}${task.dueDate ? `<span>· Due ${formatDate(task.dueDate)}</span>` : ""}<span class="status-pill ${task.status === "done" ? "" : "pending"}">${task.status === "done" ? "Done" : "Open"}</span></div>
    </article>`).join("") : `<div class="empty-inline">No trip tasks yet. Add one to share the small stuff.</div>`;
}

const taskForm = document.querySelector("#task-form");
taskForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = new FormData(taskForm);
  const itemId = String(values.get("itemId") || "");
  const button = taskForm.querySelector("[type=submit]");
  setButtonBusy(button, true, "Saving…");
  try {
    await api(`/trips/${encodeURIComponent(tripId)}/tasks${itemId ? `/${encodeURIComponent(itemId)}` : ""}`, {
      method: itemId ? "PATCH" : "POST",
      body: {
        title: String(values.get("title") || "").trim(),
        description: String(values.get("description") || "").trim(),
        assigneeId: String(values.get("assigneeId") || ""),
        dueDate: String(values.get("dueDate") || ""),
        status: taskForm.dataset.status || "open"
      }
    });
    resetForm(taskForm);
    taskForm.dataset.status = "open";
    toast(itemId ? "Task updated." : "Task added.");
    await refreshTrip();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setButtonBusy(button, false);
  }
});

document.querySelector("#task-list")?.addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-task]");
  if (editButton) {
    const task = state.tasks.find((entry) => entry.id === editButton.dataset.editTask);
    if (!task) return;
    setForm(taskForm, { itemId: task.id, title: task.title, description: task.description, assigneeId: task.assigneeId, dueDate: task.dueDate });
    taskForm.dataset.status = task.status;
    setEditing(taskForm, true, "#task-form-title", "Edit task");
    return;
  }
  const toggleButton = event.target.closest("[data-toggle-task]");
  if (!toggleButton) return;
  const task = state.tasks.find((entry) => entry.id === toggleButton.dataset.toggleTask);
  if (!task) return;
  toggleButton.disabled = true;
  try {
    await api(`/trips/${encodeURIComponent(tripId)}/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      body: { ...task, status: task.status === "done" ? "open" : "done" }
    });
    toast(task.status === "done" ? "Task reopened." : "Task completed.");
    await refreshTrip();
  } catch (error) {
    toggleButton.disabled = false;
    toast(error.message, "error");
  }
});

function renderDocuments() {
  document.querySelector("#document-list").innerHTML = state.documents.length ? [...state.documents].reverse().map((document) => `
    <article class="document-card"><a href="${escapeHtml(document.url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(document.url)}" alt="${escapeHtml(document.caption)}" loading="lazy"></a>
      <div class="document-caption"><div><strong>${escapeHtml(document.caption)}</strong><div class="item-meta">Added by ${escapeHtml(fullName(state.trip.members, document.uploadedBy))}</div></div><div class="item-actions"><button class="icon-button" data-edit-document="${escapeHtml(document.id)}">Edit</button><button class="icon-button danger" data-delete-collection="documents" data-delete-id="${escapeHtml(document.id)}">Delete</button></div></div></article>`).join("")
    : `<div class="empty-inline">No images or travel documents yet. Keep your group’s useful details together here.</div>`;
}

document.querySelector("#document-list")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-edit-document]");
  if (!button) return;
  const document = state.documents.find((entry) => entry.id === button.dataset.editDocument);
  if (!document) return;
  const caption = window.prompt("Edit this document caption:", document.caption);
  if (caption === null) return;
  button.disabled = true;
  try {
    await api(`/trips/${encodeURIComponent(tripId)}/documents/${encodeURIComponent(document.id)}`, {
      method: "PATCH", body: { caption: caption.trim() }
    });
    toast("Document caption updated.");
    await refreshTrip();
  } catch (error) {
    button.disabled = false;
    toast(error.message, "error");
  }
});

document.querySelector("#document-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("[type=submit]");
  const values = new FormData(form);
  const image = values.get("image");
  if (!(image instanceof File) || !image.size) {
    toast("Choose a JPG, PNG, or WEBP image first.", "error");
    return;
  }
  if (image.size > 10 * 1024 * 1024) {
    toast("Images must be 10 MB or smaller.", "error");
    return;
  }
  setButtonBusy(button, true, "Uploading…");
  try {
    await api(`/trips/${encodeURIComponent(tripId)}/documents`, { method: "POST", body: values });
    form.reset();
    toast("Image added to the trip.");
    await refreshTrip();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setButtonBusy(button, false);
  }
});

document.querySelector("#guide-button")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  setButtonBusy(button, true, "Discovering places…");
  try {
    const result = await api("/destination-guide", {
      method: "POST", body: { destination: state.trip.destination, tripId }
    });
    state.guide = result.recommendations;
    document.querySelector("#guide-results").innerHTML = state.guide.map((item, index) => `
      <article class="guide-result"><p class="eyebrow">${escapeHtml(item.category)} · ${escapeHtml(item.estimatedDuration)}</p><h4>${escapeHtml(item.placeName)}</h4><p>${escapeHtml(item.description)}</p><p><strong>Best time:</strong> ${escapeHtml(item.bestTime)}</p><p>${escapeHtml(item.whyVisit)}</p><button class="icon-button" data-add-guide="${index}">＋ Add to itinerary</button></article>`).join("");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setButtonBusy(button, false);
  }
});

document.querySelector("#guide-results")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-add-guide]");
  if (!button) return;
  const recommendation = state.guide[Number(button.dataset.addGuide)];
  if (!recommendation) return;
  selectTab("itinerary");
  setForm(itineraryForm, {
    date: "", time: "", title: recommendation.placeName,
    location: "", description: `${recommendation.description}\n\n${recommendation.whyVisit}\nBest time: ${recommendation.bestTime}`
  });
  setEditing(itineraryForm, false);
  document.querySelector("#itinerary-date").focus();
  toast("Choose a date and time, then add this idea to the itinerary.");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

document.querySelector("#trip-content")?.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete-collection]");
  if (!deleteButton) return;
  if (!window.confirm(`Delete this ${deleteButton.dataset.deleteCollection === "expenses" ? "expense" : deleteButton.dataset.deleteCollection === "tasks" ? "task" : deleteButton.dataset.deleteCollection === "documents" ? "document" : "itinerary item"}?`)) return;
  deleteButton.disabled = true;
  try {
    await api(`/trips/${encodeURIComponent(tripId)}/${deleteButton.dataset.deleteCollection}/${encodeURIComponent(deleteButton.dataset.deleteId)}`, { method: "DELETE" });
    toast("Deleted. The owner can restore it from trip history.");
    await refreshTrip();
  } catch (error) {
    deleteButton.disabled = false;
    toast(error.message, "error");
  }
});

async function renderHistory() {
  const section = document.querySelector("#history-section");
  if (section.hidden) return;
  try {
    const { history } = await api(`/trips/${encodeURIComponent(tripId)}/history`);
    section.hidden = !history.length;
    document.querySelector("#history-list").innerHTML = history.filter((record) => !record.restoredAt).map((record) => {
      const title = record.original.title || record.original.caption || "Deleted trip item";
      return `<div class="history-row"><span>${escapeHtml(title)} · ${formatDate(record.deletedAt)}</span><button class="icon-button" data-restore-history="${escapeHtml(record.id)}">Restore</button></div>`;
    }).join("") || `<div class="empty-inline">No deleted items to restore.</div>`;
    section.hidden = false;
  } catch (error) {
    toast(error.message, "error");
  }
}

document.querySelector("#history-list")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-restore-history]");
  if (!button) return;
  if (!window.confirm("Restore this item to the shared trip?")) return;
  button.disabled = true;
  try {
    await api(`/trips/${encodeURIComponent(tripId)}/history/${encodeURIComponent(button.dataset.restoreHistory)}/restore`, { method: "POST" });
    toast("Trip item restored.");
    await refreshTrip();
  } catch (error) {
    button.disabled = false;
    toast(error.message, "error");
  }
});

document.querySelector("#delete-trip")?.addEventListener("click", async (event) => {
  if (!window.confirm("Delete this trip? The shared trip will be hidden for everyone. You can restore it from your trips list.")) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api(`/trips/${encodeURIComponent(tripId)}`, { method: "DELETE" });
    toast("Trip moved to recently deleted.");
    window.location.assign("/dashboard.html");
  } catch (error) {
    button.disabled = false;
    toast(error.message, "error");
  }
});

document.querySelector("#leave-trip")?.addEventListener("click", async (event) => {
  const activeMembers = state.trip.members.filter((member) => member.status === "active");
  const isOwner = state.trip.ownerId === state.user.uid;
  if (isOwner && activeMembers.length === 1) {
    toast("You are the only member. Delete the trip instead.", "error");
    return;
  }
  if (!window.confirm("Leave this trip? Your previous contributions stay in the trip history, but you will no longer have access.")) return;
  const body = {};
  if (isOwner) body.transferOwnerId = document.querySelector("#transfer-owner").value;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api(`/trips/${encodeURIComponent(tripId)}/leave`, { method: "POST", body });
    toast(isOwner ? "Trip ownership transferred. You have left the trip." : "You have left the trip.");
    window.location.assign("/dashboard.html");
  } catch (error) {
    button.disabled = false;
    toast(error.message, "error");
  }
});

function setForm(form, values) {
  if (!form) return;
  for (const [key, value] of Object.entries(values)) {
    if (key === "participants") continue;
    const control = form.elements.namedItem(key);
    if (control) control.value = value ?? "";
  }
}

function resetForm(form) {
  form.reset();
  const hiddenId = form.elements.namedItem("itemId");
  if (hiddenId) hiddenId.value = "";
  if (form.id === "expense-form") {
    form.querySelector("#participant-options").innerHTML = state.trip.members
      .filter((member) => member.status === "active")
      .map((member) => `<label class="participant-option"><input type="checkbox" name="participants" value="${escapeHtml(member.uid)}" checked> ${escapeHtml(member.name || member.email)}</label>`).join("");
    form.querySelector("#expense-payer").innerHTML = state.trip.members.filter((member) => member.status === "active")
      .map((member) => `<option value="${escapeHtml(member.uid)}">${escapeHtml(member.name || member.email)}</option>`).join("");
    document.querySelector("#expense-form-title").textContent = "Add an expense";
  }
  if (form.id === "task-form") {
    form.dataset.status = "open";
    document.querySelector("#task-form-title").textContent = "Add a task";
  }
  setEditing(form, false);
}

function setEditing(form, editing, titleSelector = "", title = "") {
  if (!form) return;
  const submit = form.querySelector("[type=submit]");
  if (submit) submit.textContent = editing ? "Save changes" : ({ "itinerary-form": "Add to itinerary", "expense-form": "Add expense", "task-form": "Add task" }[form.id] || "Save");
  if (titleSelector) document.querySelector(titleSelector).textContent = title;
  form.querySelectorAll(".cancel-edit").forEach((button) => { button.hidden = !editing; });
}

document.querySelectorAll(".cancel-edit").forEach((button) => {
  button.addEventListener("click", () => resetForm(button.closest("form")));
});
