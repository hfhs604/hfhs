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
      `• First month of session: ${isFirstMonth ? "YES (Development Fee ₹3150 will be billed)" : "No"}\n\n` +
      `This creates one monthlyBills document per student. Safe to re-run — existing bills will be overwritten.`
    );
    if (!confirmed) return;

    setBusy(true);
    setStatus(null);
    try {
      const res = await startNewMonth(session, month, { isFirstMonth });
      setStatus({ ok: true, message: `✅ Created ${res.created} bills for ${month}.` });
    } catch (err) {
      setStatus({ ok: false, message: `❌ ${err.message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fm-card">
      <h2>Settings</h2>

      <section className="fm-settings-section">
        <h3>Monthly Billing</h3>
        <p className="fm-subtle">
          Start a new month to bill every student's tuition (and standing
          transport, if opted). Unpaid balances roll forward as{" "}
          <strong>Previous Due</strong>.
        </p>

        <div className="fm-settings-row">
          <label>
            Month to start
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              disabled={busy}
            />
          </label>

          <label className="fm-checkbox-label">
            <input
              type="checkbox"
              checked={isFirstMonth}
              onChange={(e) => setIsFirstMonth(e.target.checked)}
              disabled={busy}
            />
            First month of session (bills Development Fee ₹3150)
          </label>
        </div>

        <button
          type="button"
          className="fm-primary-btn"
          onClick={handleStartMonth}
          disabled={busy || !month}
        >
          {busy ? "Creating bills…" : "Start New Month"}
        </button>

        {status && (
          <p className={status.ok ? "fm-success" : "fm-error"}>{status.message}</p>
        )}

        <details className="fm-help-details">
          <summary>When should I click this?</summary>
          <ul>
            <li>
              <strong>Once, at the start of the session (April):</strong> tick
              "First month" so Development Fee ₹3150 is billed.
            </li>
            <li>
              <strong>On the 1st of every later month:</strong> leave it
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
      </section>
    </div>
  );
}
