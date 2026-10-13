import { authReady } from "./firebase.js";
import { api } from "./api.js";
import { setButtonBusy, showPageError, toast } from "./utils.js";

const form = document.querySelector("#profile-form");
try {
  const user = await authReady;
  if (!user) window.location.replace("/login.html");
  else {
    const profile = await api("/auth/profile");
    document.querySelector("#profile-name").value = profile.name || "";
    document.querySelector("#profile-email").value = profile.email || "";
  }
} catch (error) {
  showPageError(error);
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("[type=submit]");
  setButtonBusy(button, true, "Saving…");
  try {
    const name = String(new FormData(form).get("name") || "").trim();
    if (!name) throw new Error("Enter your display name.");
    await api("/auth/profile", { method: "PATCH", body: { name } });
    const user = await authReady;
    const { updateProfile } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js");
    await updateProfile(user, { displayName: name });
    await user.getIdToken(true);
    toast("Profile updated.");
  } catch (error) {
    showPageError(error);
    toast(error.message, "error");
  } finally {
    setButtonBusy(button, false);
  }
});

document.querySelector("#clear-device")?.addEventListener("click", () => {
  if (!window.confirm("Clear only PackNGo preferences stored on this device? Shared trips and Firestore data will not be changed.")) return;
  localStorage.removeItem("packngo.preferences");
  toast("Device preferences cleared.");
});
