import { getAuth } from "./firebase.js";
import { toast } from "./utils.js";

export async function logout() {
  if (!window.confirm("Log out of PackNGo?")) return;
  const auth = await getAuth();
  const { signOut } = await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js");
  await signOut(auth);
  window.location.assign("/login.html");
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-logout]");
  if (!button) return;
  try {
    await logout();
  } catch (error) {
    toast(error.message, "error");
  }
});
