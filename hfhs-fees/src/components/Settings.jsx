import React, { useState } from "react";
import { startNewMonth } from "../firebase/feeService";
import "../styles/feeManagement.css";

export default function Settings({ session }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  const [month, setMonth] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const [isFirstMonth, setIsFirstMonth] = useState(false);

  async function handleStartMonth() {
    if (!month) return;

    const confirmed = window.confirm(
      `Create monthly bills for ${month}?\n\n` +
        `• Session: ${session}\n` +
        `• First month of session: ${
          isFirstMonth ? "YES — Development Fee ₹3150 will be billed" : "No"
        }\n\n` +
        `This creates one monthlyBills document per student. Safe to re-run — existing bills will be overwritten.`
    );
    if (!confirmed) return;

    setBusy(true);
    setStatus(null);
    try {
      const res = await startNewMonth(session, month, { isFirstMonth });
      setStatus({
        ok: true,
        message: `✅ Created ${res.created} bills for ${month}.`,
      });
    } catch (err) {
      setStatus({ ok: false, message: `❌ ${err.message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fm-card">
      <h2>Monthly Billing Engine</h2>
      <p className="fm-hint" style={{ marginBottom: 16 }}>
        Start a new month to bill every student's tuition (and standing transport, if opted). 
        Unpaid balances roll forward as <strong>Previous Due</strong>.
      </p>

      <div className="fm-filter-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 16 }}>
        <label className="fm-inline-label">
          Month to generate
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            disabled={busy}
          />
        </label>

        <label className="fm-checkbox-row">
          <input
            type="checkbox"
            checked={isFirstMonth}
            onChange={(e) => setIsFirstMonth(e.target.checked)}
            disabled={busy}
          />
          This is the first month of the session (bills Development Fee ₹3150)
        </label>

        <button
          type="button"
          className="fm-primary-btn"
          onClick={handleStartMonth}
          disabled={busy || !month}
          style={{ marginTop: 8 }}
        >
          {busy ? "Generating bills…" : "🚀 Start New Month"}
        </button>
      </div>

      {status && (
        <p
          style={{
            color: status.ok ? "#16a34a" : "#dc2626",
            marginTop: 16,
            fontWeight: 600,
            background: status.ok ? "#dcfce7" : "#fee2e2",
            padding: 12,
            borderRadius: 6
          }}
        >
          {status.message}
        </p>
      )}

      <div style={{ marginTop: 24, padding: 16, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
        <h4 style={{ margin: "0 0 8px", color: "#1e293b" }}>When should I click this?</h4>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "#475569", lineHeight: 1.6 }}>
          <li>
            <strong>Once, at the start of the session (April):</strong> tick "First month" so Development Fee ₹3150 is billed.
          </li>
          <li>
            <strong>On the 1st of every later month:</strong> leave the box unticked. Only tuition (+ standing transport) is billed; last month's unpaid balance carries forward.
          </li>
          <li>
            <strong>Safe to re-run</strong> for the same month — bills are overwritten, not duplicated. But never re-run a month after payments have been collected.
          </li>
        </ul>
      </div>
    </div>
  );
}
