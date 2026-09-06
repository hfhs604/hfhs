// Firebase initialization for the standalone deployment.
//
// Values come from Vite env vars (must be prefixed VITE_ so Vite exposes
// them to client code). For local dev, copy .env.example to .env and fill
// them in. For the GitHub Pages build, the values are injected as GitHub
// Actions repository secrets — see .github/workflows/deploy.yml.
//
// Note: Firebase web API keys are not secret by design (they identify your
// project, they don't authorize access) — real protection comes from your
// Firestore security rules (see firestore.rules), not from hiding this file.

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  // Fails fast and obviously instead of a confusing blank screen if env
  // vars weren't set (very common first-deploy mistake).
  // eslint-disable-next-line no-console
  console.error(
    "Firebase config is missing. Did you create a .env file (local) or " +
    "set the VITE_FIREBASE_* repository secrets (GitHub Pages build)? " +
    "See .env.example."
  );
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
