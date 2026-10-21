import React, { useState } from "react";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { auth } from "./firebase/config";
import schoolLogo from "./assets/school-logo.jpg";
import "./styles/feeManagement.css";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      let emailToUse = username.trim();
      if (!emailToUse.includes("@")) {
        emailToUse = `${emailToUse}@hfhs.local`;
      }
      await signInWithEmailAndPassword(auth, emailToUse, password);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const resetEmail = window.prompt(
      "Enter your personal email address to receive a password reset link.\n(Make sure you use the email you gave to the school office)"
    );
    if (!resetEmail) return;

    setResetting(true);
    try {
      await sendPasswordResetEmail(auth, resetEmail);
      setMessage(`✅ Reset link sent to ${resetEmail}. Check your inbox.`);
    } catch (err) {
      setError("Could not send reset email. Ask the office to update your email.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "#f1f5f9" }}>
      
      {/* Login Form Container */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <form onSubmit={handleSubmit} className="fm-card" style={{ width: 360, maxWidth: "100%" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <img src={schoolLogo} alt="Holy Faith High School" style={{ width: 60, height: 60, borderRadius: "50%" }} />
          </div>
          <h2 style={{ textAlign: "center", marginTop: 0, color: "#1e293b" }}>Fee Management Login</h2>

          <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12, fontSize: 13 }}>
            Email or Student ID
            <input
              type="text"
              required
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. 11260000 or admin@school.com"
              style={{ padding: 10, border: "1px solid #cbd5e1", borderRadius: 6 }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12, fontSize: 13 }}>
            Password
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ padding: 10, border: "1px solid #cbd5e1", borderRadius: 6 }}
            />
          </label>

          {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12, fontWeight: 500 }}>{error}</p>}
          {message && <p style={{ color: "#16a34a", fontSize: 13, marginBottom: 12, fontWeight: 500 }}>{message}</p>}

          <button type="submit" disabled={submitting} className="fm-primary-btn" style={{ width: "100%" }}>
            {submitting ? "Signing in…" : "Sign In"}
          </button>

          <div style={{ textAlign: "center", marginTop: 16 }}>
            <button 
              type="button" 
              onClick={handleResetPassword}
              disabled={resetting}
              style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 13, textDecoration: "underline" }}
            >
              Forgot Password? Reset via Email
            </button>
          </div>
        </form>
      </div>

      {/* Footer for Login */}
      <footer className="fm-footer" style={{ background: "transparent", borderTop: "none" }}>
        All rights reserved © Holy Faith High School
      </footer>

    </div>
  );
}

function friendlyError(err) {
  switch (err.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect ID or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    default:
      return "Could not sign in. Please check your details.";
  }
}
