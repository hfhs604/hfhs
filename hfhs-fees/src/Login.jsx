import React, { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "./firebase/config";
import schoolLogo from "./assets/school-logo.jpg";
import "./styles/feeManagement.css";

/**
 * Standalone login screen. Every account (superAdmin, admin, accountant,
 * staff, and student/parent) signs in here with email + password — the
 * role stored on their users/{uid} Firestore doc decides what they see
 * after login (handled in App.jsx / FeeManagementApp.jsx).
 *
 * Accounts themselves are created in the Firebase console (Authentication
 * tab) or via the Firebase CLI — see README "First-time setup" for the
 * exact steps to create your first Super Admin.
 */
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fm-app" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <form onSubmit={handleSubmit} className="fm-card" style={{ width: 340, maxWidth: "90vw" }}>
        <div className="fm-app-brand" style={{ justifyContent: "center", marginBottom: 16 }}>
          <img src={schoolLogo} alt="Holy Faith High School" className="fm-app-logo" />
        </div>
        <h2 style={{ textAlign: "center", marginTop: 0 }}>Fee Management Login</h2>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12, fontSize: 13 }}>
          Email
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12, fontSize: 13 }}>
          Password
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
          />
        </label>

        {error && <p className="fm-error" style={{ marginBottom: 12 }}>{error}</p>}

        <button type="submit" disabled={submitting} className="fm-primary-btn fm-full-width">
          {submitting ? "Signing in…" : "Sign In"}
        </button>
      </form>
    </div>
  );
}

function friendlyError(err) {
  switch (err.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/invalid-email":
      return "That doesn't look like a valid email address.";
    default:
      return "Could not sign in. Please try again.";
  }
}
