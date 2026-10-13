import { authReady } from "./firebase.js";
import { api } from "./api.js";
import { setButtonBusy, showPageError, toast } from "./utils.js";

const createForm = document.querySelector("#create-trip-form");
const joinForm = document.querySelector("#join-trip-form");

try {
  const user = await authReady;
  if (!user) window.location.replace("/login.html");
} catch (error) {
  showPageError(error);
}

createForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = createForm.querySelector("[type=submit]");
  const values = new FormData(createForm);
  const start = String(values.get("start") || "");
  const end = String(values.get("end") || "");
  if (!start || !end || end < start) {
    showPageError({ message: "Add valid trip dates. The end date cannot be before the start date." });
    return;
  }
  setButtonBusy(button, true, "Creating trip…");
  try {
    const { trip } = await api("/trips", {
      method: "POST",
      body: {
        name: String(values.get("name") || "").trim(),
        destination: String(values.get("destination") || "").trim(),
        start, end
      }
    });
    toast("Trip created. Your shared workspace is ready.");
    window.location.assign(`/trip.html?id=${encodeURIComponent(trip.id)}`);
  } catch (error) {
    showPageError(error);
    toast(error.message, "error");
  } finally {
    setButtonBusy(button, false);
  }
});

const codeInput = document.querySelector("#invite-code");
codeInput?.addEventListener("input", () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6); });

joinForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = joinForm.querySelector("[type=submit]");
  setButtonBusy(button, true, "Joining trip…");
  try {
    const { trip, alreadyMember } = await api("/trips/join", {
      method: "POST", body: { inviteCode: String(new FormData(joinForm).get("inviteCode") || "").trim().toUpperCase() }
    });
    toast(alreadyMember ? "You’re already part of this trip." : "You joined the shared trip.");
    window.location.assign(`/trip.html?id=${encodeURIComponent(trip.id)}`);
  } catch (error) {
    showPageError(error);
    toast(error.message, "error");
  } finally {
    setButtonBusy(button, false);
  }
});
