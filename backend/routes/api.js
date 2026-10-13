import { randomInt } from "node:crypto";
import multer from "multer";
import express from "express";
import { GoogleGenAI } from "@google/genai";
import { db, auth, FieldValue } from "../config/firebase.js";
import { authenticate } from "../middleware/authenticate.js";
import { HttpError, asyncRoute } from "../lib/errors.js";
import { calculateBalances, moneyToCents } from "../lib/finance.js";
import {
  activeMember, amount, date, enumValue, id, inviteCode, memberByUid, text, time, userId
} from "../lib/validation.js";
import { deleteImage, uploadImage } from "../services/cloudinary.js";

export const apiRouter = express.Router();
const router = apiRouter;
const storage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter(_req, file, callback) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
        return callback(new HttpError(400, "Choose a JPG, PNG, or WEBP image."));
      }
      callback(null, true);
    }
});

  router.get("/auth/profile", authenticate, asyncRoute(async (req, res) => {
    const user = await auth.getUser(req.user.uid);
    const profile = await db.collection("users").doc(req.user.uid).get();
    res.json({
      uid: req.user.uid,
      name: user.displayName || req.user.name,
      email: user.email || req.user.email,
      photoURL: user.photoURL || "",
      createdAt: user.metadata.creationTime || null,
      preferences: profile.exists ? profile.data().preferences || {} : {}
    });
  }));

  router.patch("/auth/profile", authenticate, asyncRoute(async (req, res) => {
    const name = text(req.body.name, "Name", { max: 80 });
    await auth.updateUser(req.user.uid, { displayName: name });
    await db.collection("users").doc(req.user.uid).set({
      name,
      email: req.user.email,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    res.json({ name });
  }));

  router.get("/trips", authenticate, asyncRoute(async (req, res) => {
    const [memberTrips, ownedTrips] = await Promise.all([
      db.collection("trips").where("activeMemberIds", "array-contains", req.user.uid).get(),
      db.collection("trips").where("ownerId", "==", req.user.uid).get()
    ]);
    const tripsById = new Map();
    for (const snapshot of [...memberTrips.docs, ...ownedTrips.docs]) {
      const trip = { id: snapshot.id, ...snapshot.data() };
      if (!trip.deletedAt && activeMember(trip.members || [], req.user.uid)) tripsById.set(snapshot.id, trip);
    }
    res.json({ trips: [...tripsById.values()].sort((a, b) => String(b.start).localeCompare(String(a.start))) });
  }));

  router.get("/trips/trash", authenticate, asyncRoute(async (req, res) => {
    const snapshots = await db.collection("trips").where("ownerId", "==", req.user.uid).get();
    res.json({ trips: snapshots.docs
      .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
      .filter((trip) => trip.deletedAt) });
  }));

  router.post("/trips", authenticate, asyncRoute(async (req, res) => {
    const name = text(req.body.name, "Trip name", { max: 100 });
    const destination = text(req.body.destination, "Destination", { max: 100 });
    const start = date(req.body.start, "Start date");
    const end = date(req.body.end, "End date");
    if (end < start) throw new HttpError(400, "End date cannot be before the start date.");
    const tripRef = db.collection("trips").doc();
    const member = {
      uid: req.user.uid, name: req.user.name, email: req.user.email,
      status: "active", joinedAt: new Date().toISOString()
    };
    let code;
    let codeRef;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      code = createInviteCode();
      codeRef = db.collection("inviteCodes").doc(code);
      const created = await db.runTransaction(async (transaction) => {
        const reserved = await transaction.get(codeRef);
        if (reserved.exists) return false;
        transaction.create(codeRef, { tripId: tripRef.id, createdAt: FieldValue.serverTimestamp() });
        transaction.create(tripRef, {
          id: tripRef.id, name, destination, start, end,
          cover: text(req.body.cover || "", "Cover", { max: 500, required: false }),
          ownerId: req.user.uid, inviteCode: code,
          members: [member], activeMemberIds: [req.user.uid],
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
          deletedAt: null
        });
        return true;
      });
      if (created) break;
      code = null;
    }
    if (!code) throw new HttpError(503, "A unique invite code could not be reserved. Please retry.");
    res.status(201).json({ trip: { id: tripRef.id, name, destination, start, end, ownerId: req.user.uid, inviteCode: code, members: [member] } });
  }));

  router.post("/trips/join", authenticate, asyncRoute(async (req, res) => {
    const code = inviteCode(req.body.inviteCode);
    const codeSnapshot = await db.collection("inviteCodes").doc(code).get();
    if (!codeSnapshot.exists) throw new HttpError(404, "No active trip uses that invite code.");
    const tripRef = db.collection("trips").doc(codeSnapshot.data().tripId);
    const result = await db.runTransaction(async (transaction) => {
      const tripSnapshot = await transaction.get(tripRef);
      if (!tripSnapshot.exists || tripSnapshot.data().deletedAt) throw new HttpError(404, "This trip no longer exists.");
      const trip = tripSnapshot.data();
      const members = trip.members || [];
      const current = memberByUid(members, req.user.uid);
      if (current?.status === "active") return { id: tripRef.id, trip, alreadyMember: true };
      const activeMembers = members.filter((member) => member.status === "active");
      if (activeMembers.length >= 10) throw new HttpError(409, "This trip already has the maximum of 10 active members.");
      const member = {
        uid: req.user.uid, name: req.user.name, email: req.user.email,
        status: "active", joinedAt: new Date().toISOString()
      };
      const nextMembers = current
        ? members.map((entry) => entry.uid === req.user.uid ? member : entry)
        : [...members, member];
      transaction.update(tripRef, {
        members: nextMembers,
        activeMemberIds: [...trip.activeMemberIds || [], req.user.uid],
        updatedAt: FieldValue.serverTimestamp()
      });
      return { id: tripRef.id, trip: { ...trip, members: nextMembers }, alreadyMember: false };
    });
    res.json({ trip: { id: result.id, ...result.trip }, alreadyMember: result.alreadyMember });
  }));

  router.get("/trips/:tripId", authenticate, asyncRoute(async (req, res) => {
    const trip = await getTrip(req.params.tripId);
    requireActiveMember(trip, req.user.uid);
    res.json({ trip });
  }));

  router.get("/trips/:tripId/full", authenticate, asyncRoute(async (req, res) => {
    const trip = await getTrip(req.params.tripId);
    requireActiveMember(trip, req.user.uid);
    const collections = ["itinerary", "expenses", "tasks", "documents", "settlements"];
    const snapshots = await Promise.all(collections.map((name) => db.collection("trips").doc(trip.id).collection(name).get()));
    const result = Object.fromEntries(collections.map((name, index) => [
      name,
      snapshots[index].docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => !item.deletedAt)
    ]));
    const summary = calculateBalances(trip.members || [], result.expenses, result.settlements);
    res.json({ trip, ...result, summary });
  }));

  router.delete("/trips/:tripId", authenticate, asyncRoute(async (req, res) => {
    const tripRef = db.collection("trips").doc(id(req.params.tripId, "Trip ID"));
    const codeRef = db.collection("inviteCodes").doc((await getTrip(tripRef.id)).inviteCode);
    await db.runTransaction(async (transaction) => {
      const [tripSnapshot, codeSnapshot] = await Promise.all([
        transaction.get(tripRef), transaction.get(codeRef)
      ]);
      if (!tripSnapshot.exists) throw new HttpError(404, "This trip could not be found.");
      const trip = tripSnapshot.data();
      requireOwner(trip, req.user.uid);
      if (trip.deletedAt) throw new HttpError(409, "This trip has already been deleted.");
      transaction.update(tripRef, {
        deletedAt: FieldValue.serverTimestamp(), deletedBy: req.user.uid,
        updatedAt: FieldValue.serverTimestamp()
      });
      if (codeSnapshot.exists) transaction.update(codeRef, { deletedAt: FieldValue.serverTimestamp() });
    });
    res.json({ success: true });
  }));

  router.post("/trips/:tripId/restore", authenticate, asyncRoute(async (req, res) => {
    const tripRef = db.collection("trips").doc(id(req.params.tripId, "Trip ID"));
    const initial = await tripRef.get();
    if (!initial.exists) throw new HttpError(404, "This trip could not be found.");
    const codeRef = db.collection("inviteCodes").doc(initial.data().inviteCode);
    await db.runTransaction(async (transaction) => {
      const [tripSnapshot, codeSnapshot] = await Promise.all([
        transaction.get(tripRef), transaction.get(codeRef)
      ]);
      if (!tripSnapshot.exists) throw new HttpError(404, "This trip could not be found.");
      const trip = tripSnapshot.data();
      requireOwner(trip, req.user.uid);
      if (!trip.deletedAt) throw new HttpError(409, "This trip is not in the trash.");
      transaction.update(tripRef, { deletedAt: null, deletedBy: null, updatedAt: FieldValue.serverTimestamp() });
      if (codeSnapshot.exists) transaction.update(codeRef, { deletedAt: null });
    });
    res.json({ success: true });
  }));

  router.post("/trips/:tripId/leave", authenticate, asyncRoute(async (req, res) => {
    const tripRef = db.collection("trips").doc(id(req.params.tripId, "Trip ID"));
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(tripRef);
      if (!snapshot.exists || snapshot.data().deletedAt) throw new HttpError(404, "This trip could not be found.");
      const trip = { id: snapshot.id, ...snapshot.data() };
      requireActiveMember(trip, req.user.uid);
      const activeMembers = (trip.members || []).filter((member) => member.status === "active");
      if (trip.ownerId === req.user.uid && activeMembers.length === 1) {
        throw new HttpError(409, "You are the only member. Delete the trip instead.");
      }
      let ownerId = trip.ownerId;
      if (trip.ownerId === req.user.uid) {
        const transferTo = userId(req.body.transferOwnerId, "New owner");
        if (transferTo === req.user.uid || !activeMember(trip.members, transferTo)) {
          throw new HttpError(400, "Choose another active trip member as the new owner.");
        }
        ownerId = transferTo;
      }
      const members = trip.members.map((member) => member.uid === req.user.uid
        ? { ...member, status: "left", leftAt: new Date().toISOString() }
        : member);
      transaction.update(tripRef, {
        ownerId, members,
        activeMemberIds: (trip.activeMemberIds || []).filter((uid) => uid !== req.user.uid),
        updatedAt: FieldValue.serverTimestamp()
      });
    });
    res.json({ success: true });
  }));

  router.get("/trips/:tripId/history", authenticate, asyncRoute(async (req, res) => {
    const trip = await getTrip(req.params.tripId);
    requireOwner(trip, req.user.uid);
    const records = await db.collection("trips").doc(trip.id).collection("history").get();
    res.json({ history: records.docs.map((item) => ({ id: item.id, ...item.data() })) });
  }));

  router.post("/trips/:tripId/history/:historyId/restore", authenticate, asyncRoute(async (req, res) => {
    const trip = await getTrip(req.params.tripId);
    const historyRef = db.collection("trips").doc(trip.id).collection("history").doc(id(req.params.historyId, "History ID"));
    await db.runTransaction(async (transaction) => {
      const tripRef = db.collection("trips").doc(trip.id);
      const [tripSnapshot, historySnapshot] = await Promise.all([
        transaction.get(tripRef), transaction.get(historyRef)
      ]);
      if (!tripSnapshot.exists) throw new HttpError(404, "This trip could not be found.");
      requireOwner(tripSnapshot.data(), req.user.uid);
      if (!historySnapshot.exists) throw new HttpError(404, "That deleted item could not be found.");
      const history = historySnapshot.data();
      if (history.restoredAt) throw new HttpError(409, "This item has already been restored.");
      const targetRef = db.collection("trips").doc(trip.id).collection(history.collection).doc(history.originalId);
      const existing = await transaction.get(targetRef);
      if (!existing.exists || !existing.data().deletedAt) throw new HttpError(409, "This item can no longer be restored.");
      transaction.set(targetRef, { ...history.original, deletedAt: null, deletedBy: null, updatedAt: FieldValue.serverTimestamp() });
      transaction.update(historyRef, { restoredAt: FieldValue.serverTimestamp(), restoredBy: req.user.uid });
    });
    res.json({ success: true });
  }));

  router.get("/trips/:tripId/expenses/summary", authenticate, asyncRoute(async (req, res) => {
    const trip = await getTrip(req.params.tripId);
    requireActiveMember(trip, req.user.uid);
    const [expenses, settlements] = await Promise.all([
      activeCollection(trip.id, "expenses"),
      activeCollection(trip.id, "settlements")
    ]);
    res.json(calculateBalances(trip.members || [], expenses, settlements));
  }));

  router.get("/trips/:tripId/settlements", authenticate, asyncRoute(async (req, res) => {
    const trip = await getTrip(req.params.tripId);
    requireActiveMember(trip, req.user.uid);
    res.json({ settlements: await activeCollection(trip.id, "settlements") });
  }));

  router.post("/trips/:tripId/settlements", authenticate, asyncRoute(async (req, res) => {
    const trip = await getTrip(req.params.tripId);
    requireActiveMember(trip, req.user.uid);
    const fromId = req.user.uid;
    const toId = userId(req.body.toId, "Recipient");
    const value = amount(req.body.amount);
    if (fromId === toId) throw new HttpError(400, "You cannot settle a payment with yourself.");
    if (!activeMember(trip.members, fromId) || !activeMember(trip.members, toId)) {
      throw new HttpError(400, "Both people in a settlement must be active trip members.");
    }
    const tripRef = db.collection("trips").doc(trip.id);
    const expenseQuery = tripRef.collection("expenses");
    const settlementQuery = tripRef.collection("settlements");
    const settlementRef = settlementQuery.doc();
    await db.runTransaction(async (transaction) => {
      const [tripSnapshot, expenseSnapshots, settlementSnapshots] = await Promise.all([
        transaction.get(tripRef), transaction.get(expenseQuery), transaction.get(settlementQuery)
      ]);
      const currentTrip = tripSnapshot.data();
      requireActiveMember(currentTrip, req.user.uid);
      const allExpenses = expenseSnapshots.docs.map((item) => ({ id: item.id, ...item.data() }));
      const allSettlements = settlementSnapshots.docs.map((item) => ({ id: item.id, ...item.data() }));
      const pendingBetweenMembers = allSettlements.filter((item) =>
        item.status === "pending" && item.fromId === fromId && item.toId === toId);
      if (pendingBetweenMembers.length) {
        throw new HttpError(409, "A payment between these members is already awaiting approval.");
      }
      const balances = calculateBalances(currentTrip.members || [], allExpenses, allSettlements).members;
      if (balances[fromId]?.balanceCents >= 0 || balances[toId]?.balanceCents <= 0) {
        throw new HttpError(409, "There is no outstanding amount to settle between these members.");
      }
      const cents = moneyToCents(value);
      const pendingFrom = allSettlements.filter((item) => item.status === "pending" && item.fromId === fromId)
        .reduce((sum, item) => sum + moneyToCents(item.amount), 0);
      const pendingTo = allSettlements.filter((item) => item.status === "pending" && item.toId === toId)
        .reduce((sum, item) => sum + moneyToCents(item.amount), 0);
      if (cents + pendingFrom > -balances[fromId].balanceCents ||
          cents + pendingTo > balances[toId].balanceCents) {
        throw new HttpError(400, "Payment cannot be greater than the outstanding amount.");
      }
      transaction.create(settlementRef, {
        tripId: trip.id, fromId, toId, amount: value, status: "pending",
        createdAt: FieldValue.serverTimestamp(), approvedAt: null, rejectedAt: null, approvedBy: null
      });
    });
    res.status(201).json({ settlement: { id: settlementRef.id, fromId, toId, amount: value, status: "pending" } });
  }));

  for (const action of ["approve", "reject"]) {
    router.post(`/trips/:tripId/settlements/:settlementId/${action}`, authenticate, asyncRoute(async (req, res) => {
      const trip = await getTrip(req.params.tripId);
      requireActiveMember(trip, req.user.uid);
      const tripRef = db.collection("trips").doc(trip.id);
      const settlementRef = tripRef.collection("settlements").doc(id(req.params.settlementId, "Settlement ID"));
      await db.runTransaction(async (transaction) => {
        const [tripSnapshot, settlementSnapshot] = await Promise.all([
          transaction.get(tripRef), transaction.get(settlementRef)
        ]);
        if (!settlementSnapshot.exists) throw new HttpError(404, "That settlement could not be found.");
        const currentTrip = tripSnapshot.data();
        const settlement = settlementSnapshot.data();
        requireActiveMember(currentTrip, req.user.uid);
        if (settlement.toId !== req.user.uid) throw new HttpError(403, "Only the payment recipient can respond to this settlement.");
        if (settlement.status !== "pending") throw new HttpError(409, "This settlement has already been answered.");
        if (action === "approve") {
          const [expenseSnapshots, settlementSnapshots] = await Promise.all([
            transaction.get(tripRef.collection("expenses")),
            transaction.get(tripRef.collection("settlements"))
          ]);
          const expenses = expenseSnapshots.docs.map((item) => ({ id: item.id, ...item.data() }));
          const settlements = settlementSnapshots.docs
            .filter((item) => item.id !== settlementRef.id)
            .map((item) => ({ id: item.id, ...item.data() }));
          const balances = calculateBalances(currentTrip.members || [], expenses, settlements).members;
          const cents = moneyToCents(settlement.amount);
          if (balances[settlement.fromId]?.balanceCents >= 0 ||
              balances[settlement.toId]?.balanceCents <= 0 ||
              cents > -balances[settlement.fromId].balanceCents ||
              cents > balances[settlement.toId].balanceCents) {
            throw new HttpError(409, "The outstanding balance changed. Refresh and create a new settlement.");
          }
          transaction.update(settlementRef, {
            status: "approved", approvedAt: FieldValue.serverTimestamp(), approvedBy: req.user.uid
          });
        } else {
          transaction.update(settlementRef, {
            status: "rejected", rejectedAt: FieldValue.serverTimestamp(), rejectedBy: req.user.uid
          });
        }
      });
      res.json({ success: true, status: action === "approve" ? "approved" : "rejected" });
    }));
  }

  router.post("/trips/:tripId/documents", authenticate, storage.single("image"), asyncRoute(async (req, res) => {
    const trip = await getTrip(req.params.tripId);
    requireActiveMember(trip, req.user.uid);
    const caption = text(req.body.caption, "Caption", { max: 160 });
    if (!req.file || !validImageSignature(req.file.buffer)) {
      throw new HttpError(400, "Choose a valid JPG, PNG, or WEBP image (maximum 10 MB).");
    }
    const uploaded = await uploadImage(req.file.buffer);
    const documentRef = db.collection("trips").doc(trip.id).collection("documents").doc();
    try {
      await db.runTransaction(async (transaction) => {
        const tripSnapshot = await transaction.get(db.collection("trips").doc(trip.id));
        if (!tripSnapshot.exists || tripSnapshot.data().deletedAt) throw new HttpError(404, "This trip could not be found.");
        const currentTrip = { id: tripSnapshot.id, ...tripSnapshot.data() };
        requireActiveMember(currentTrip, req.user.uid);
        transaction.create(documentRef, {
          tripId: trip.id, caption, url: uploaded.url, publicId: uploaded.publicId,
          uploadedBy: req.user.uid, uploadedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
          deletedAt: null
        });
      });
    } catch (error) {
      try {
        await deleteImage(uploaded.publicId);
      } catch (cleanupError) {
        console.error("Uploaded image cleanup failed after metadata could not be saved.", cleanupError);
      }
      if (error instanceof HttpError) throw error;
      console.error("Image metadata could not be saved after upload.", error);
      throw new HttpError(502, "The image uploaded but its trip record could not be saved. Please retry.");
    }
    res.status(201).json({ document: { id: documentRef.id, caption, url: uploaded.url, uploadedBy: req.user.uid } });
  }));

  router.patch("/trips/:tripId/documents/:documentId", authenticate, asyncRoute(async (req, res) => {
    const trip = await getTrip(req.params.tripId);
    const tripRef = db.collection("trips").doc(trip.id);
    const documentRef = tripRef.collection("documents").doc(id(req.params.documentId, "Document ID"));
    const caption = text(req.body.caption, "Caption", { max: 160 });
    await db.runTransaction(async (transaction) => {
      const [tripSnapshot, documentSnapshot] = await Promise.all([
        transaction.get(tripRef), transaction.get(documentRef)
      ]);
      if (!tripSnapshot.exists || tripSnapshot.data().deletedAt) throw new HttpError(404, "This trip could not be found.");
      requireActiveMember({ id: tripSnapshot.id, ...tripSnapshot.data() }, req.user.uid);
      if (!documentSnapshot.exists || documentSnapshot.data().deletedAt) throw new HttpError(404, "That document could not be found.");
      transaction.update(documentRef, { caption, updatedAt: FieldValue.serverTimestamp() });
    });
    res.json({ document: { id: documentRef.id, caption } });
  }));

  router.post("/destination-guide", authenticate, asyncRoute(async (req, res) => {
    const destination = text(req.body.destination, "Destination", { max: 100 });
    const tripId = req.body.tripId ? id(req.body.tripId, "Trip ID") : null;
    if (tripId) requireActiveMember(await getTrip(tripId), req.user.uid);
    if (!process.env.GEMINI_API_KEY) {
      throw new HttpError(503, "The destination guide is not configured yet. Add GEMINI_API_KEY on the server.");
    }
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    let timeout;
    let response;
    try {
      response = await Promise.race([
        ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `Create 6 to 8 accurate, concise travel recommendations for ${destination}. Return an array of objects with placeName, category (Attractions, Nature, Food, Culture, Adventure, or Spiritual), description, bestTime, estimatedDuration, and whyVisit. Do not invent precise claims; express uncertainty when appropriate. Return JSON only.`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  placeName: { type: "STRING" }, category: { type: "STRING" },
                  description: { type: "STRING" }, bestTime: { type: "STRING" },
                  estimatedDuration: { type: "STRING" }, whyVisit: { type: "STRING" }
                },
                required: ["placeName", "category", "description", "bestTime", "estimatedDuration", "whyVisit"]
              }
            }
          }
        }),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new HttpError(504, "The destination guide took too long to respond. Please retry.")), 20000);
          timeout.unref?.();
        })
      ]);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      console.error("Gemini destination guide request failed.", error);
      throw new HttpError(502, "The destination guide is temporarily unavailable. Please retry.");
    } finally {
      clearTimeout(timeout);
    }
    let recommendations;
    try {
      recommendations = JSON.parse(response.text || "");
    } catch {
      throw new HttpError(502, "The destination guide returned an invalid response. Please retry.");
    }
    if (!Array.isArray(recommendations) || recommendations.length < 6) {
      throw new HttpError(502, "The destination guide returned too few recommendations. Please retry.");
    }
    const categories = ["Attractions", "Nature", "Food", "Culture", "Adventure", "Spiritual"];
    let normalized;
    try {
      normalized = recommendations.slice(0, 8).map((item) => ({
        placeName: text(item.placeName, "Place name", { max: 100 }),
        category: categories.includes(item.category) ? item.category : "Attractions",
        description: text(item.description, "Description", { max: 500 }),
        bestTime: text(item.bestTime, "Best time", { max: 100 }),
        estimatedDuration: text(item.estimatedDuration, "Estimated duration", { max: 80 }),
        whyVisit: text(item.whyVisit, "Why visit", { max: 300 })
      }));
    } catch {
      throw new HttpError(502, "The destination guide returned incomplete place details. Please retry.");
    }
    res.json({ destination, recommendations: normalized });
  }));

  const collectionNames = ["itinerary", "expenses", "tasks", "documents"];
  router.get("/trips/:tripId/:collection", authenticate, asyncRoute(async (req, res) => {
    const collection = requireCollection(req.params.collection, collectionNames);
    const trip = await getTrip(req.params.tripId);
    requireActiveMember(trip, req.user.uid);
    res.json({ [collection]: await activeCollection(trip.id, collection) });
  }));

  router.post("/trips/:tripId/:collection", authenticate, asyncRoute(async (req, res) => {
    const collection = requireCollection(req.params.collection, ["itinerary", "expenses", "tasks"]);
    const trip = await getTrip(req.params.tripId);
    let values;
    const itemRef = db.collection("trips").doc(trip.id).collection(collection).doc();
    await db.runTransaction(async (transaction) => {
      const tripSnapshot = await transaction.get(db.collection("trips").doc(trip.id));
      if (!tripSnapshot.exists || tripSnapshot.data().deletedAt) throw new HttpError(404, "This trip could not be found.");
      const currentTrip = { id: tripSnapshot.id, ...tripSnapshot.data() };
      requireActiveMember(currentTrip, req.user.uid);
      values = validateItem(collection, req.body, currentTrip, req.user.uid);
      transaction.create(itemRef, {
        ...values, createdBy: req.user.uid, createdAt: FieldValue.serverTimestamp(),
        tripId: trip.id, updatedAt: FieldValue.serverTimestamp(), deletedAt: null
      });
    });
    res.status(201).json({ item: { id: itemRef.id, ...values, createdBy: req.user.uid } });
  }));

  router.patch("/trips/:tripId/:collection/:itemId", authenticate, asyncRoute(async (req, res) => {
    const collection = requireCollection(req.params.collection, ["itinerary", "expenses", "tasks"]);
    const trip = await getTrip(req.params.tripId);
    const tripRef = db.collection("trips").doc(trip.id);
    const itemRef = tripRef.collection(collection).doc(id(req.params.itemId, "Item ID"));
    const updated = await db.runTransaction(async (transaction) => {
      const [tripSnapshot, itemSnapshot] = await Promise.all([transaction.get(tripRef), transaction.get(itemRef)]);
      if (!tripSnapshot.exists || tripSnapshot.data().deletedAt) throw new HttpError(404, "This trip could not be found.");
      const currentTrip = { id: tripSnapshot.id, ...tripSnapshot.data() };
      requireActiveMember(currentTrip, req.user.uid);
      if (!itemSnapshot.exists || itemSnapshot.data().deletedAt) throw new HttpError(404, "That item could not be found.");
      const current = itemSnapshot.data();
      const values = validateItem(collection, { ...current, ...req.body }, currentTrip, req.user.uid, current);
      transaction.update(itemRef, { ...values, updatedAt: FieldValue.serverTimestamp() });
      return { id: itemRef.id, ...current, ...values };
    });
    res.json({ item: updated });
  }));

  router.delete("/trips/:tripId/:collection/:itemId", authenticate, asyncRoute(async (req, res) => {
    const collection = requireCollection(req.params.collection, collectionNames);
    const trip = await getTrip(req.params.tripId);
    const tripRef = db.collection("trips").doc(trip.id);
    const itemRef = tripRef.collection(collection).doc(id(req.params.itemId, "Item ID"));
    const historyRef = tripRef.collection("history").doc();
    await db.runTransaction(async (transaction) => {
      const [tripSnapshot, itemSnapshot] = await Promise.all([transaction.get(tripRef), transaction.get(itemRef)]);
      if (!tripSnapshot.exists || tripSnapshot.data().deletedAt) throw new HttpError(404, "This trip could not be found.");
      requireActiveMember({ id: tripSnapshot.id, ...tripSnapshot.data() }, req.user.uid);
      if (!itemSnapshot.exists || itemSnapshot.data().deletedAt) throw new HttpError(404, "That item could not be found.");
      const original = itemSnapshot.data();
      transaction.update(itemRef, {
        deletedAt: FieldValue.serverTimestamp(), deletedBy: req.user.uid, updatedAt: FieldValue.serverTimestamp()
      });
      transaction.create(historyRef, {
        originalId: itemRef.id, collection, original,
        deletedBy: req.user.uid, deletedAt: FieldValue.serverTimestamp(), restoredAt: null
      });
    });
    res.json({ success: true });
  }));

function createInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

async function getTrip(tripId, { includeDeleted = false } = {}) {
  const ref = db.collection("trips").doc(id(tripId, "Trip ID"));
  const snapshot = await ref.get();
  if (!snapshot.exists || (!includeDeleted && snapshot.data().deletedAt)) {
    throw new HttpError(404, "This trip could not be found.");
  }
  return { id: snapshot.id, ...snapshot.data() };
}

function requireActiveMember(trip, uid) {
  if (!activeMember(trip.members || [], uid)) throw new HttpError(403, "You must be an active member of this trip.");
}

function requireOwner(trip, uid) {
  if (trip.ownerId !== uid) throw new HttpError(403, "Only the trip owner can do that.");
}

function requireCollection(value, allowed) {
  if (!allowed.includes(value)) throw new HttpError(404, "That trip section was not found.");
  return value;
}

async function activeCollection(tripId, collection) {
  const snapshot = await db.collection("trips").doc(tripId).collection(collection).get();
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => !item.deletedAt);
}

function validateItem(collection, body, trip, uid, current = null) {
  if (collection === "itinerary") {
    return {
      date: date(body.date, "Date"),
      time: time(body.time || ""),
      title: text(body.title, "Place or title", { max: 120 }),
      location: text(body.location || "", "Location", { max: 160, required: false }),
      description: text(body.description || "", "Description", { max: 1000, required: false }),
      tripId: trip.id,
      createdBy: current?.createdBy || uid
    };
  }
  if (collection === "expenses") {
    const participants = body.participants;
    if (!Array.isArray(participants) || participants.length === 0 ||
        participants.length > 10 || participants.some((memberId) => typeof memberId !== "string") ||
        new Set(participants).size !== participants.length) {
      throw new HttpError(400, "Choose one or more unique trip members for this expense.");
    }
    const paidById = userId(body.paidById, "Payer");
    for (const memberId of participants) {
      const member = memberByUid(trip.members || [], userId(memberId, "Participant"));
      const historicalParticipant = current?.participants?.includes(memberId);
      if (!member || (!activeMember(trip.members || [], memberId) && !historicalParticipant)) {
        throw new HttpError(400, "Expense participants must be active trip members.");
      }
    }
    const payer = memberByUid(trip.members || [], paidById);
    if (!payer || (!activeMember(trip.members || [], paidById) && current?.paidById !== paidById)) {
      throw new HttpError(400, "Choose a valid active trip member as the payer.");
    }
    return {
      title: text(body.title, "Expense name", { max: 120 }),
      category: enumValue(body.category, ["Accommodation", "Transport", "Food", "Activities", "Shopping", "Other"], "Category"),
      amount: amount(body.amount),
      paidById,
      participants: [...participants].sort(),
      date: date(body.date, "Date"),
      tripId: trip.id,
      createdBy: current?.createdBy || uid
    };
  }
  if (collection === "tasks") {
    const assigneeId = body.assigneeId ? userId(body.assigneeId, "Assignee") : "";
    if (assigneeId && !activeMember(trip.members || [], assigneeId) && current?.assigneeId !== assigneeId) {
      throw new HttpError(400, "Tasks can only be assigned to active trip members.");
    }
    return {
      title: text(body.title, "Task name", { max: 120 }),
      description: text(body.description || "", "Description", { max: 500, required: false }),
      assigneeId,
      dueDate: body.dueDate ? date(body.dueDate, "Due date") : "",
      status: enumValue(body.status || "open", ["open", "done"], "Task status"),
      tripId: trip.id,
      createdBy: current?.createdBy || uid
    };
  }
  throw new HttpError(400, "That item type cannot be created here.");
}

function validImageSignature(buffer) {
  if (buffer.length < 12) return false;
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  return jpeg || png || webp;
}
