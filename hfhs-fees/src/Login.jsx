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
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "var(--bg-main)" }}>
      
      {/* Center Wrapper */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <form onSubmit={handleSubmit} className="fm-card" style={{ width: 360, maxWidth: "100%", padding: 32 }}>
          
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
            <img src={schoolLogo} alt="Holy Faith High School" style={{ width: 72, height: 72, borderRadius: "50%", border: "2px solid #e2e8f0" }} />
          </div>
          
          <h2 style={{ textAlign: "center", margin: "0 0 24px", color: "var(--text-main)", fontSize: "1.4em" }}>
            Fee Management
          </h2>

          <label className="fm-inline-label" style={{ marginBottom: 16 }}>
            Email or Student ID
            <input
              type="text"
              required
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. 11260000 or admin@school.com"
              style={{ padding: "12px 14px" }}
            />
          </label>

          <label className="fm-inline-label" style={{ marginBottom: 20 }}>
            Password
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{ padding: "12px 14px" }}
            />
          </label>

          {error && <div className="fm-error" style={{ marginBottom: 16 }}>{error}</div>}
          {message && <div className="fm-success" style={{ marginBottom: 16 }}>{message}</div>}

          <button type="submit" disabled={submitting} className="fm-primary-btn" style={{ width: "100%", padding: 12, fontSize: 14 }}>
            {submitting ? "Signing in…" : "Sign In"}
          </button>

          <div style={{ textAlign: "center", marginTop: 20 }}>
            <button 
              type="button" 
              onClick={handleResetPassword}
              disabled={resetting}
              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 13, textDecoration: "underline" }}
            >
              Forgot Password? Reset via Email
            </button>
          </div>
        </form>
      </div>

      {/* Footer */}
      <footer className="fm-footer" style={{ background: "transparent", borderTop: "none", marginTop: 0 }}>
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
