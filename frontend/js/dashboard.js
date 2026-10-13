import { authReady } from "./firebase.js";
import { api } from "./api.js";
import { escapeHtml, formatDate, showPageError, toast } from "./utils.js";

const tripList = document.querySelector("#trip-list");
const trashList = document.querySelector("#trash-list");

try {
  const user = await authReady;
  if (!user) window.location.replace("/login.html");
  else await loadTrips();
} catch (error) {
  showPageError(error);
}

async function loadTrips() {
  try {
    const { trips } = await api("/trips");
    document.querySelector("#trip-count").textContent = `${trips.length} ${trips.length === 1 ? "trip" : "trips"}`;
    tripList.innerHTML = trips.length ? trips.map((trip) => tripCard(trip)).join("") : `
      <div class="empty-state"><span>✳</span><h3>Your next adventure starts here.</h3><p>Create a trip, or join one with the code your group shared.</p></div>`;
    const trash = await api("/trips/trash");
    trashList.innerHTML = trash.trips.length ? trash.trips.map((trip) => `
      <article class="trip-card">
        <div class="trip-card-content"><p class="eyebrow">IN THE TRASH</p><h3>${escapeHtml(trip.name)}</h3>
          <p>${escapeHtml(trip.destination)} · ${formatDate(trip.start)} – ${formatDate(trip.end)}</p>
          <div class="trip-card-footer"><span>Deleted trip</span><button class="icon-button" data-restore-trip="${escapeHtml(trip.id)}">Restore trip</button></div>
        </div></article>`).join("") : `<div class="empty-state"><p>No deleted trips.</p></div>`;
  } catch (error) {
    tripList.innerHTML = "";
    showPageError(error);
  }
}

function tripCard(trip) {
  const members = trip.members?.filter((member) => member.status === "active").length || 1;
  return `<a class="trip-card" href="/trip.html?id=${encodeURIComponent(trip.id)}">
    <div class="trip-card-visual"><img src="https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=900&q=75" alt="" loading="lazy"><span>${members} ${members === 1 ? "traveller" : "travellers"}</span></div>
    <div class="trip-card-content"><p class="eyebrow">${escapeHtml(trip.destination)}</p><h3>${escapeHtml(trip.name)}</h3>
      <p>${formatDate(trip.start)} – ${formatDate(trip.end)}</p><div class="trip-card-footer"><span>Shared trip workspace</span><strong>Open trip ↗</strong></div>
    </div></a>`;
}

trashList?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-restore-trip]");
  if (!button || !window.confirm("Restore this trip? Its previous invite code will work again.")) return;
  button.disabled = true;
  try {
    await api(`/trips/${encodeURIComponent(button.dataset.restoreTrip)}/restore`, { method: "POST" });
    toast("Trip restored.");
    await loadTrips();
  } catch (error) {
    button.disabled = false;
    toast(error.message, "error");
  }
});
