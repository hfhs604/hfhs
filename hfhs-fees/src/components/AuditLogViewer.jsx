import React, { useEffect, useState } from "react";
import { getAuditLogs } from "../firebase/feeService";
import "../styles/feeManagement.css";

export default function AuditLogViewer() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAuditLogs({ limitCount: 200 }).then((l) => { setLogs(l); setLoading(false); });
  }, []);

  return (
    <div className="fm-card">
      <h2>Audit Log</h2>
      <p className="fm-hint">Every financial and record change, for accountability. Nothing here can be edited or deleted.</p>
      {loading ? (
        <p className="fm-empty-state">Loading…</p>
      ) : logs.length === 0 ? (
        <p className="fm-empty-state">No audit entries yet.</p>
      ) : (
        <table className="fm-table">
          <thead><tr><th>When</th><th>User</th><th>Action</th><th>Student</th><th>Details</th></tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{l.timestamp?.toDate?.().toLocaleString?.() || "—"}</td>
                <td>{l.userEmail || l.userId}</td>
                <td>{l.action}</td>
                <td>{l.studentId || "—"}</td>
                <td>
                  {l.newValue ? <code style={{ fontSize: 11 }}>{JSON.stringify(l.newValue)}</code> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
