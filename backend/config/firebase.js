import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";

function parseServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid JSON.");
    }
  }
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    };
  }
  return null;
}

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) throw new Error("FIREBASE_PROJECT_ID is required.");

const serviceAccount = parseServiceAccount();
const emulatorEnabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
if (!serviceAccount && !emulatorEnabled) {
  throw new Error("Configure Firebase Admin credentials or FIRESTORE_EMULATOR_HOST before starting PackNGo.");
}

const appOptions = { projectId };
if (serviceAccount) appOptions.credential = cert(serviceAccount);

export const firebaseApp = getApps()[0] || initializeApp(appOptions);
export const db = getFirestore(firebaseApp);
export const auth = getAuth(firebaseApp);
export { FieldValue, Timestamp };
