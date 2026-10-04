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
    <div className="fm-card" style={{ marginTop: 20 }}>
      <h2>Monthly Billing</h2>
      <p className="fm-hint">
        Start a new month to bill every student's tuition (and standing
        transport, if opted). Unpaid balances roll forward as{" "}
        <strong>Previous Due</strong>.
      </p>

      <div
        className="fm-search-row"
        style={{ flexDirection: "column", alignItems: "flex-start", gap: 12 }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Month to start
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            disabled={busy}
          />
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={isFirstMonth}
            onChange={(e) => setIsFirstMonth(e.target.checked)}
            disabled={busy}
          />
          First month of session (bills Development Fee ₹3150)
        </label>

        <button
          type="button"
          className="fm-primary-btn"
          onClick={handleStartMonth}
          disabled={busy || !month}
        >
          {busy ? "Creating bills…" : "Start New Month"}
        </button>
      </div>

      {status && (
        <p
          style={{
            color: status.ok ? "#059669" : "#dc2626",
            marginTop: 12,
            fontWeight: 500,
          }}
        >
          {status.message}
        </p>
      )}

      <details
        style={{
          marginTop: 20,
          padding: 12,
          background: "#f9fafb",
          borderRadius: 6,
          fontSize: "0.9em",
        }}
      >
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          When should I click this?
        </summary>
        <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
          <li>
            <strong>Once, at the start of the session (April):</strong> tick
            "First month" so Development Fee ₹3150 is billed.
          </li>
          <li>
            <strong>On the 1st of every later month:</strong> leave the box
            unticked. Only tuition (+ standing transport) is billed; last
            month's unpaid balance carries forward.
          </li>
          <li>
            <strong>Safe to re-run</strong> for the same month — bills are
            overwritten, not duplicated. But never re-run a month after
            payments have been collected.
          </li>
        </ul>
      </details>
    </div>
  );
}
