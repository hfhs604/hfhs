import React, { useEffect, useState } from "react";
import { listBillsForMonth } from "../firebase/feeService";
import "../styles/feeManagement.css";

export default function DueManagement({ session }) {
  const [filters, setFilters] = useState({
    className: "",
    section: "",
    month: new Date().toISOString().slice(0, 7),
  });
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    listBillsForMonth(session, filters.month)
      .then((rows) => {
        if (!active) return;
        // Only keep bills that still have an outstanding balance
        const due = rows
          .filter((b) => (b.carriedForward || 0) > 0)
          .filter((b) => !filters.className || b.className === filters.className)
          .sort((a, b) => (b.carriedForward || 0) - (a.carriedForward || 0));
        setBills(due);
      })
      .catch((err) => {
        if (active) setError(err.message || "Could not load dues.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session, filters.month, filters.className]);

  const totalDue = bills.reduce((sum, b) => sum + (b.carriedForward || 0), 0);

  return (
    <div className="fm-card">
      <h2>Due Fees</h2>
      <p className="fm-hint">
        Students with an outstanding balance for the selected month.
      </p>

      <div className="fm-filter-row">
        <label className="fm-inline-label">
          Month
          <input
            type="month"
            value={filters.month}
            onChange={(e) => setFilters({ ...filters, month: e.target.value })}
          />
        </label>

        <label className="fm-inline-label">
          Class
          <input
            placeholder="e.g. IX"
            value={filters.className}
            onChange={(e) =>
              setFilters({ ...filters, className: e.target.value })
            }
          />
        </label>

        <div className="fm-inline-label">
          <span>Total outstanding</span>
          <strong style={{ fontSize: "1.1em" }}>
            ₹{totalDue.toLocaleString()}
          </strong>
        </div>
      </div>

      {loading ? (
        <p className="fm-empty-state">Loading…</p>
      ) : error ? (
        <p className="fm-empty-state" style={{ color: "#c62828" }}>
          {error}
        </p>
      ) : bills.length === 0 ? (
        <p className="fm-empty-state">
          No students with outstanding dues for this filter.
        </p>
      ) : (
        <table className="fm-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Adm#</th>
              <th>Class</th>
              <th>Previous Due</th>
              <th>Tuition</th>
              <th>Transport</th>
              <th>Other</th>
              <th>Total Due</th>
              <th>Paid</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => {
              const other =
                (b.devFeeBilled || 0) +
                (b.booksBilled || 0) +
                (b.previousYearBilled || 0) +
                (b.kitFeeBilled || 0);
              return (
                <tr key={b.id}>
                  <td>{b.studentName || "—"}</td>
                  <td>{b.studentId || "—"}</td>
                  <td>{b.className || "—"}</td>
                  <td>₹{b.previousDue || 0}</td>
                  <td>₹{b.tuitionBilled || 0}</td>
                  <td>₹{b.transportBilled || 0}</td>
                  <td>₹{other}</td>
                  <td>₹{b.totalDue || 0}</td>
                  <td>₹{b.totalPaid || 0}</td>
                  <td className="fm-due-cell">
                    🔴 ₹{b.carriedForward || 0}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
