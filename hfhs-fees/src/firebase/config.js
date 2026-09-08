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
  apiKey: "AIzaSyAqNCQ1Q_djNvYJ4TSa6kCt66gCXZdWAjA",
  authDomain: "sms-school-manage-hfhs-siwan.firebaseapp.com",
  projectId: "school-manage-hfhs-siwan",
  storageBucket: "sms-school-manage-hfhs-siwan.firebasestorage.app",
  messagingSenderId: "677398380911",
  appId: "1:677398380911:web:b7612f2bc094902ee3e89a",
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
