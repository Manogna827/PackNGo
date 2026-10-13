import { authReady, firebaseReady, getAuth } from "./firebase.js";
import { api } from "./api.js";
import { setButtonBusy, showPageError, toast } from "./utils.js";

const form = document.querySelector("#auth-form");
const page = document.body.dataset.page;

document.querySelectorAll("[data-toggle-password]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.togglePassword);
    if (!input) return;
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    button.setAttribute("aria-label", visible ? "Hide password" : "Show password");
    button.textContent = visible ? "Hide" : "Show";
  });
});

try {
  await firebaseReady;
  if (await authReady) window.location.replace("/dashboard.html");
} catch (error) {
  showPageError(error);
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("[type=submit]");
  setButtonBusy(button, true, page === "signup" ? "Creating account…" : "Signing in…");
  const values = new FormData(form);
  try {
    const auth = await getAuth();
    const sdk = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js");
    const email = String(values.get("email") || "").trim().toLowerCase();
    const password = String(values.get("password") || "");
    if (page === "signup") {
      const name = String(values.get("name") || "").trim();
      const confirmation = String(values.get("confirmPassword") || "");
      if (!name) throw new Error("Enter your name.");
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
      if (password.length < 8) throw new Error("Use a password with at least 8 characters.");
      if (password !== confirmation) throw new Error("The passwords do not match.");
      const credential = await sdk.createUserWithEmailAndPassword(auth, email, password);
      await sdk.updateProfile(credential.user, { displayName: name });
      await credential.user.getIdToken(true);
      await api("/auth/profile", { method: "PATCH", body: { name } });
    } else {
      if (!email || !password) throw new Error("Enter your email address and password.");
      await sdk.signInWithEmailAndPassword(auth, email, password);
    }
    window.location.assign("/dashboard.html");
  } catch (error) {
    const message = ({
      "auth/email-already-in-use": "An account already uses this email. Try signing in.",
      "auth/invalid-credential": "That email and password combination was not recognized.",
      "auth/invalid-email": "Enter a valid email address.",
      "auth/weak-password": "Choose a stronger password with at least 8 characters.",
      "auth/too-many-requests": "Too many attempts. Wait a moment, then try again.",
      "auth/network-request-failed": "Could not reach Firebase Authentication. Check your connection."
    })[error.code] || error.message || "Could not complete authentication.";
    showPageError({ message });
    toast(message, "error");
  } finally {
    setButtonBusy(button, false);
  }
});
