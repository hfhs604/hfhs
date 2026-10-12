import React, { useEffect, useState } from "react";
import { listBillsForMonth } from "../firebase/feeService";
import "../styles/feeManagement.css";

export default function AdvancesList({ session }) {
  const [month, setMonth] = useState(() =>
    new Date().toISOString().slice(0, 7)
  );
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    listBillsForMonth(session, month)
      .then((all) => {
        if (!active) return;
        const advances = all
          .filter((b) => (b.carriedForward || 0) < 0)
          .map((b) => ({
            ...b,
            advance: -1 * (b.carriedForward || 0),
          }))
          .sort((a, b) => b.advance - a.advance);
        setRows(advances);
      })
      .catch((err) => {
        if (active) setError(err.message || "Could not load advances.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session, month]);

  const grandTotal = rows.reduce((s, r) => s + r.advance, 0);

  return (
    <div className="fm-card">
      <h2>Advances</h2>
      <p className="fm-hint">
        Students who have paid more than their bill for the selected month.
        Their credit automatically reduces next month's bill when you run{" "}
        <strong>Settings → Start New Month</strong>.
      </p>

      <div className="fm-filter-row">
        <label className="fm-inline-label">
          Month
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        <div className="fm-inline-label">
          <span>Total advance</span>
          <strong style={{ fontSize: "1.1em", color: "#1565c0" }}>
            ₹{grandTotal.toLocaleString()}
          </strong>
        </div>
      </div>

      {loading ? (
        <p className="fm-empty-state">Loading…</p>
      ) : error ? (
        <p className="fm-empty-state" style={{ color: "#c62828" }}>
          {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="fm-empty-state">
          No advances recorded for this month. Advances appear here when a
          student pays more than their outstanding bill.
        </p>
      ) : (
        <div className="fm-table-scroll">
          <table className="fm-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Adm#</th>
                <th>Class</th>
                <th>Total Due</th>
                <th>Total Paid</th>
                <th>Advance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.studentName || "—"}</td>
                  <td>{r.studentId || "—"}</td>
                  <td>{r.className || "—"}</td>
                  <td>₹{r.totalDue || 0}</td>
                  <td>₹{r.totalPaid || 0}</td>
                  <td style={{ color: "#1565c0", fontWeight: 600 }}>
                    🟢 ₹{r.advance.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
