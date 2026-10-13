import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const enabled = process.env.RUN_FIREBASE_ACCEPTANCE === "1";
if (!enabled) {
  console.log("Skipped: set RUN_FIREBASE_ACCEPTANCE=1 with the Firebase Auth/Firestore emulators and PackNGo server running.");
  process.exit(0);
}

const apiBase = (process.env.PACKNGO_API_URL || "http://localhost:5000").replace(/\/$/, "");
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const authBase = `${authHost.startsWith("http") ? authHost : `http://${authHost}`}/identitytoolkit.googleapis.com/v1`;
const apiKey = process.env.FIREBASE_API_KEY || "fake-api-key";
const unique = randomUUID().replaceAll("-", "").slice(0, 14);

async function createAccount(label) {
  const response = await fetch(`${authBase}/accounts:signUp?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `packngo-${label}-${unique}@example.test`,
      password: `PackNGo-${randomUUID()}-Strong`,
      returnSecureToken: true
    })
  });
  const account = await response.json();
  assert.equal(response.ok, true, `Firebase Auth emulator could not create ${label}: ${JSON.stringify(account)}`);
  return account;
}

async function request(path, token, { method = "GET", body, expectedStatus = 200 } = {}) {
  const response = await fetch(`${apiBase}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const result = await response.json().catch(() => ({}));
  assert.equal(response.status, expectedStatus, `${method} ${path}: ${JSON.stringify(result)}`);
  return result;
}

async function run() {
  const [owner, guest, outsider] = await Promise.all([
    createAccount("owner"), createAccount("guest"), createAccount("outsider")
  ]);
  const { trip } = await request("/trips", owner.idToken, {
    method: "POST", expectedStatus: 201,
    body: { name: `Acceptance ${unique}`, destination: "Pondicherry", start: "2027-01-10", end: "2027-01-12" }
  });
  assert.ok(trip.id && trip.id.length >= 18, "Trip uses a generated Firestore document ID.");

  const itinerary = await request(`/trips/${trip.id}/itinerary`, owner.idToken, {
    method: "POST", expectedStatus: 201,
    body: { date: "2027-01-10", time: "09:00", title: "Beach visit", location: "Pondicherry", description: "Meet at the shore." }
  });
  const task = await request(`/trips/${trip.id}/tasks`, owner.idToken, {
    method: "POST", expectedStatus: 201,
    body: { title: "Book transport", description: "Coordinate arrival.", assigneeId: "", dueDate: "2027-01-09", status: "open" }
  });

  const joined = await request("/trips/join", guest.idToken, {
    method: "POST", body: { inviteCode: trip.inviteCode.toLowerCase() }
  });
  assert.equal(joined.trip.id, trip.id, "Joining resolves to the original Firestore trip.");
  assert.equal(joined.alreadyMember, false);
  const joinedAgain = await request("/trips/join", guest.idToken, {
    method: "POST", body: { inviteCode: trip.inviteCode }
  });
  assert.equal(joinedAgain.alreadyMember, true, "Joining again does not create a duplicate member.");
  const [ownerExpense, guestExpense] = await Promise.all([
    request(`/trips/${trip.id}/expenses`, owner.idToken, {
      method: "POST", expectedStatus: 201,
      body: { title: "Hotel", category: "Accommodation", amount: 90, paidById: owner.localId, participants: [owner.localId, guest.localId], date: "2027-01-10" }
    }),
    request(`/trips/${trip.id}/expenses`, guest.idToken, {
      method: "POST", expectedStatus: 201,
      body: { title: "Food", category: "Food", amount: 60, paidById: guest.localId, participants: [owner.localId, guest.localId], date: "2027-01-10" }
    })
  ]);

  const guestView = await request(`/trips/${trip.id}/full`, guest.idToken);
  assert.equal(guestView.trip.id, trip.id);
  assert.equal(guestView.itinerary.some((item) => item.title === "Beach visit"), true);
  assert.equal(guestView.tasks.some((item) => item.title === "Book transport"), true);
  assert.equal(guestView.expenses.length, 2);
  await request(`/trips/${trip.id}/tasks/${task.item.id}`, guest.idToken, {
    method: "PATCH", body: { title: "Transport confirmed", status: "done" }
  });
  const updatedForOwner = await request(`/trips/${trip.id}/full`, owner.idToken);
  assert.equal(updatedForOwner.tasks[0].title, "Transport confirmed");
  assert.equal(updatedForOwner.tasks[0].status, "done");

  let summary = await request(`/trips/${trip.id}/expenses/summary`, owner.idToken);
  assert.equal(summary.totalSpent, 150);
  assert.equal(summary.members[owner.localId].balance, 15);
  assert.equal(summary.members[guest.localId].balance, -15);
  assert.equal(summary.balanceCents, 0);

  const repayment = await request(`/trips/${trip.id}/settlements`, guest.idToken, {
    method: "POST", expectedStatus: 201,
    body: { toId: owner.localId, amount: 15 }
  });
  summary = await request(`/trips/${trip.id}/expenses/summary`, owner.idToken);
  assert.equal(summary.members[owner.localId].balance, 15, "A pending repayment does not alter balances.");
  await request(`/trips/${trip.id}/settlements/${repayment.settlement.id}/approve`, owner.idToken, { method: "POST" });
  summary = await request(`/trips/${trip.id}/expenses/summary`, guest.idToken);
  assert.equal(summary.members[owner.localId].balance, 0);
  assert.equal(summary.members[guest.localId].balance, 0);

  await request(`/trips/${trip.id}/full`, outsider.idToken, { expectedStatus: 403 });
  const additionalMembers = await Promise.all(Array.from({ length: 8 }, (_, index) => createAccount(`extra${index}`)));
  for (const account of additionalMembers) {
    await request("/trips/join", account.idToken, { method: "POST", body: { inviteCode: trip.inviteCode } });
  }
  assert.equal((await request(`/trips/${trip.id}/full`, owner.idToken)).trip.activeMemberIds.length, 10);
  await request("/trips/join", outsider.idToken, {
    method: "POST", body: { inviteCode: trip.inviteCode }, expectedStatus: 409
  });
  await request(`/trips/${trip.id}/itinerary/${itinerary.item.id}`, owner.idToken, { method: "DELETE" });
  let ownerHistory = await request(`/trips/${trip.id}/history`, owner.idToken);
  const itineraryHistory = ownerHistory.history.find((entry) => entry.originalId === itinerary.item.id);
  assert.ok(itineraryHistory, "Deletion records the original itinerary item.");
  await request(`/trips/${trip.id}/history/${itineraryHistory.id}/restore`, owner.idToken, { method: "POST" });
  assert.equal((await request(`/trips/${trip.id}/full`, guest.idToken)).itinerary[0].title, "Beach visit");

  await request(`/trips/${trip.id}/leave`, guest.idToken, { method: "POST", body: {} });
  await request(`/trips/${trip.id}/full`, guest.idToken, { expectedStatus: 403 });
  await request("/trips/join", guest.idToken, { method: "POST", body: { inviteCode: trip.inviteCode } });
  await request(`/trips/${trip.id}/full`, guest.idToken);

  await request(`/trips/${trip.id}`, owner.idToken, { method: "DELETE" });
  await request(`/trips/${trip.id}/full`, owner.idToken, { expectedStatus: 404 });
  await request(`/trips/${trip.id}/restore`, owner.idToken, { method: "POST" });
  await request(`/trips/${trip.id}/full`, owner.idToken);

  console.log("PASS: Firebase two-user acceptance flow (same trip, shared updates, expense settlement, authorization, history restore, leave/rejoin, trip restore).");
  console.log(`Trip ID: ${trip.id}`);
  console.log(`Expense IDs: ${ownerExpense.item.id}, ${guestExpense.item.id}`);
  if (!process.env.CLOUDINARY_API_SECRET) console.log("Not run: live Cloudinary image upload (configure Cloudinary and add the image upload step before deployment).");
  if (!process.env.GEMINI_API_KEY) console.log("Not run: live Gemini destination guide (optional; configure GEMINI_API_KEY to enable).");
}

run().catch((error) => {
  console.error("PackNGo Firebase acceptance test failed:", error);
  process.exitCode = 1;
});
