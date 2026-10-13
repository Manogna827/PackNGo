export const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

export function formatDate(value) {
  if (!value) return "—";
  let date;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date = new Date(`${value}T00:00:00Z`);
  } else if (value && typeof value === "object" && Number.isFinite(value._seconds)) {
    date = new Date(value._seconds * 1000);
  } else {
    date = new Date(value);
  }
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC"
  }).format(date);
}

export const money = (value) => `₹${Number(value || 0).toLocaleString("en-IN", {
  minimumFractionDigits: 2, maximumFractionDigits: 2
})}`;

export function toast(message, type = "success") {
  const container = document.querySelector("#toast-region");
  if (!container) return;
  const item = document.createElement("div");
  item.className = `toast toast-${type}`;
  item.setAttribute("role", "status");
  item.textContent = message;
  container.append(item);
  setTimeout(() => item.remove(), 3600);
}

export function showPageError(error) {
  const notice = document.querySelector("#page-notice");
  if (!notice) return;
  notice.hidden = false;
  notice.textContent = error?.message || "Something went wrong. Please try again.";
}

export function setButtonBusy(button, busy, busyText = "Saving…") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

export function fullName(members, uid) {
  return members.find((member) => member.uid === uid)?.name || "Trip member";
}
