let authInstance;
let clientAuth;

export const firebaseReady = (async () => {
  const response = await fetch("/api/config");
  if (!response.ok) throw new Error("Could not load the PackNGo Firebase configuration.");
  const { firebase } = await response.json();
  if (!firebase.apiKey || !firebase.authDomain || !firebase.projectId || !firebase.appId) {
    throw new Error("Firebase web configuration is missing. Add FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, and FIREBASE_APP_ID to the server environment.");
  }
  const [{ initializeApp }, { getAuth, setPersistence, browserLocalPersistence, connectAuthEmulator }] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js")
  ]);
  const app = initializeApp(firebase);
  clientAuth = getAuth(app);
  if (firebase.authEmulatorHost) {
    const host = firebase.authEmulatorHost.startsWith("http") ? firebase.authEmulatorHost : `http://${firebase.authEmulatorHost}`;
    connectAuthEmulator(clientAuth, host, { disableWarnings: true });
  }
  await setPersistence(clientAuth, browserLocalPersistence);
  authInstance = clientAuth;
  return authInstance;
})();

export const authReady = firebaseReady.then((auth) => new Promise((resolve) => {
  import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js")
    .then(({ onAuthStateChanged }) => {
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        unsubscribe();
        resolve(user);
      }, () => resolve(null));
    });
}));

export async function getAuth() {
  await firebaseReady;
  return authInstance;
}

export async function getCurrentUser() {
  await firebaseReady;
  return clientAuth.currentUser;
}
