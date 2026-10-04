import { initializeApp } from "firebase/app";
import { initializeFirestore, CACHE_SIZE_UNLIMITED } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

/**
 * Firestore initialization.
 *
 * NOTE: We intentionally do NOT set `experimentalForceLongPolling: true` here.
 * That flag forces Firestore to use HTTP long-polling instead of WebSockets,
 * and on a normal network it causes EVERY Firestore read to fail with
 * `FirebaseError: An internal error occurred.` — which is what was happening
 * before this change.
 *
 * If you ever deploy behind a proxy/firewall that blocks WebSockets, you can
 * re-enable it here, but understand the tradeoff.
 */
export const db = initializeFirestore(app, {
  cacheSizeBytes: CACHE_SIZE_UNLIMITED,
});

export const auth = getAuth(app);

export default app;
