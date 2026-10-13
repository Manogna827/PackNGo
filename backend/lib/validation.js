import { HttpError } from "./errors.js";

export const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function text(value, label, { max = 160, required = true } = {}) {
  if (typeof value !== "string") {
    if (!required && (value === undefined || value === null)) return "";
    throw new HttpError(400, `${label} is required.`);
  }
  const result = value.trim();
  if (required && !result) throw new HttpError(400, `${label} is required.`);
  if (result.length > max) throw new HttpError(400, `${label} must be ${max} characters or fewer.`);
  return result;
}

export function date(value, label, { optional = false } = {}) {
  if (optional && !value) return "";
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    throw new HttpError(400, `${label} must be a valid date.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${label} must be a valid date.`);
  }
  return value;
}

export function time(value, label = "Time") {
  if (value === "") return "";
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new HttpError(400, `${label} must be a valid 24-hour time.`);
  }
  return value;
}

export function amount(value) {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new HttpError(400, "Enter an amount greater than ₹0.00.");
  }
  const raw = String(value).trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(raw)) {
    throw new HttpError(400, "Enter a valid amount with up to two decimal places.");
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(400, "Amount must be greater than ₹0.00.");
  }
  return Number(parsed.toFixed(2));
}

export function inviteCode(value) {
  if (typeof value !== "string") throw new HttpError(400, "Enter a valid invite code.");
  const normalized = value.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(normalized)) {
    throw new HttpError(400, "Invite codes contain six letters or numbers (excluding ambiguous characters).");
  }
  return normalized;
}

export function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) throw new HttpError(400, `Choose a valid ${label.toLowerCase()}.`);
  return value;
}

export function id(value, label = "ID") {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(value)) {
    throw new HttpError(400, `${label} is invalid.`);
  }
  return value;
}

export function userId(value, label = "Member") {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || value.includes("/")) {
    throw new HttpError(400, `${label} is invalid.`);
  }
  return value;
}

export function memberByUid(members, uid) {
  return members.find((member) => member.uid === uid);
}

export function activeMember(members, uid) {
  return memberByUid(members, uid)?.status === "active";
}
