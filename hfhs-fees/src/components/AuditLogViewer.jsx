import React, { useEffect, useState } from "react";
import { auth } from "../firebase/config";
import { getAuditLogs } from "../firebase/feeService";
import "../styles/feeManagement.css";

/**
 * Retries a Firestore read a few times with a short backoff when the SDK
 * returns a transient error (typically on a cold page load, before the
 * client has finished connecting).
 */
async function getAuditLogsWithRetry(opts, retries = 3, delayMs = 800) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await getAuditLogs(opts);
    } catch (err) {
      const transient =
        err?.code === "unavailable" ||
        err?.code === "internal" ||
        err?.message?.includes("internal error") ||
        err?.message?.includes("client is offline");

      // If we've retried enough times, give up and let the caller decide.
      if (!transient || attempt === retries - 1) throw err;

      await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
}

export default function AuditLogViewer() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Wait for Firebase Auth to finish restoring the session before
      // querying — otherwise the SDK can throw "internal error" on the
      // very first request.
      await new Promise((resolve) => {
        if (auth.currentUser) return resolve();
        const unsub = auth.onAuthStateChanged((u) => {
          unsub();
          resolve(u);
        });
      });

      try {
        const list = await getAuditLogsWithRetry({ limitCount: 200 });
        if (cancelled) return;
        setLogs(list);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        // Treat "empty collection / internal error" as "no logs yet"
        // instead of showing a scary red error. Genuine failures still
        // surface below.
        const isInternal =
          err?.code === "internal" ||
          err?.message?.includes("internal error");

        if (isInternal) {
          console.warn("Audit log query returned internal error; assuming empty.");
          setLogs([]);
          setError(null);
        } else {
          console.error("AuditLogViewer failed:", err);
          setError(err.message || "Could not load audit log.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="fm-card">
      <h2>Audit Log</h2>
      <p className="fm-hint">
        Every financial and record change, for accountability. Nothing here can be
        edited or deleted.
      </p>

      {loading ? (
        <p className="fm-empty-state">Loading…</p>
      ) : error ? (
        <p className="fm-empty-state" style={{ color: "#c62828" }}>
          {error}
        </p>
      ) : logs.length === 0 ? (
        <p className="fm-empty-state">
          No audit entries yet. Entries appear here after any student, payment,
          or fee change is made.
        </p>
      ) : (
        <table className="fm-table">
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Action</th>
              <th>Student</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{l.timestamp?.toDate?.().toLocaleString?.() || "—"}</td>
                <td>{l.userEmail || l.userId}</td>
                <td>{l.action}</td>
                <td>{l.studentId || "—"}</td>
                <td>
                  {l.newValue ? (
                    <code style={{ fontSize: 11 }}>
                      {JSON.stringify(l.newValue)}
                    </code>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
