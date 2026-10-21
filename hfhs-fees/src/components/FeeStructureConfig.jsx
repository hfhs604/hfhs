import React, { useEffect, useState } from "react";
import { setFeeStructure, getFeeStructure } from "../firebase/feeService";
import "../styles/feeManagement.css";

const DEFAULT_CATEGORIES = [
  "Admission Fee", "Tuition Fee", "Annual Fee", "Examination Fee",
  "Development Fee", "Computer Fee", "Library Fee", "Transport Fee",
  "Activity Fee", "Other Charges",
];
const FREQUENCIES = ["monthly", "quarterly", "half-yearly", "annual"];

export default function FeeStructureConfig({ session }) {
  const [className, setClassName] = useState("");
  const [categories, setCategories] = useState(
    DEFAULT_CATEGORIES.map((name) => ({ name, amount: 0, frequency: "annual", enabled: false }))
  );
  const [lateFeeRule, setLateFeeRule] = useState({ amount: 0, gracePeriodDays: 7 });
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    if (!className) return;
    getFeeStructure(session, className).then((existing) => {
      if (existing) {
        setCategories(existing.categories);
        setLateFeeRule(existing.lateFeeRule || { amount: 0, gracePeriodDays: 7 });
      } else {
        setCategories(DEFAULT_CATEGORIES.map((name) => ({ name, amount: 0, frequency: "annual", enabled: false })));
      }
    });
  }, [className, session]);

  function updateCategory(index, field, value) {
    setCategories((cats) => cats.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!className) return;
    setSaving(true);
    try {
      const activeCategories = categories.filter((c) => c.enabled);
      await setFeeStructure({ session, className, categories: activeCategories, lateFeeRule });
      setSavedMsg(`Fee structure saved for Class ${className}, session ${session}.`);
      setTimeout(() => setSavedMsg(""), 3000);
    } finally {
      setSaving(false);
    }
  }

  const total = categories.filter((c) => c.enabled).reduce((s, c) => s + Number(c.amount || 0), 0);

  return (
    <div className="fm-card">
      <h2>Fee Structure — {session}</h2>
      <p className="fm-hint">Set per-class fees. Editing here never changes previous sessions' records.</p>

      <label className="fm-inline-label" style={{ maxWidth: 300, marginBottom: 20 }}>
        Select Class to Configure
        <input value={className} onChange={(e) => setClassName(e.target.value)} placeholder="e.g. 6 or X" />
      </label>

      {className && (
        <form onSubmit={handleSave}>
          <div className="fm-table-scroll">
            <table className="fm-table">
              <thead>
                <tr>
                  <th style={{ width: 80 }}>Enable</th>
                  <th>Fee Category</th>
                  <th>Amount (₹)</th>
                  <th>Frequency</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((cat, i) => (
                  <tr key={cat.name}>
                    <td>
                      <input 
                        type="checkbox" 
                        checked={cat.enabled} 
                        onChange={(e) => updateCategory(i, "enabled", e.target.checked)} 
                        style={{ width: 18, height: 18, cursor: "pointer" }}
                      />
                    </td>
                    <td>{cat.name}</td>
                    <td>
                      <input 
                        type="number" 
                        min="0" 
                        value={cat.amount} 
                        disabled={!cat.enabled}
                        onChange={(e) => updateCategory(i, "amount", Number(e.target.value))} 
                        style={{ padding: 6, width: 120 }}
                      />
                    </td>
                    <td>
                      <select 
                        value={cat.frequency} 
                        disabled={!cat.enabled}
                        onChange={(e) => updateCategory(i, "frequency", e.target.value)}
                        style={{ padding: 6 }}
                      >
                        {FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="fm-bill-two-col" style={{ marginTop: 24, padding: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              Total Annual Fee (Class {className})
              <div style={{ fontSize: 24, color: "#2563eb", marginTop: 8 }}>₹{total.toLocaleString()}</div>
            </div>
            
            <div>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#64748b" }}>Late Fee Rule</span>
              <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                <label className="fm-inline-label" style={{ flex: 1 }}>
                  Amount (₹)
                  <input type="number" min="0" value={lateFeeRule.amount}
                    onChange={(e) => setLateFeeRule({ ...lateFeeRule, amount: Number(e.target.value) })} />
                </label>
                <label className="fm-inline-label" style={{ flex: 1 }}>
                  Grace Days
                  <input type="number" min="0" value={lateFeeRule.gracePeriodDays}
                    onChange={(e) => setLateFeeRule({ ...lateFeeRule, gracePeriodDays: Number(e.target.value) })} />
                </label>
              </div>
            </div>
          </div>

          {savedMsg && <p className="fm-success" style={{ marginTop: 16 }}>{savedMsg} ✓</p>}
          
          <button type="submit" disabled={saving} className="fm-primary-btn" style={{ marginTop: 16 }}>
            {saving ? "Saving…" : "Save Fee Structure"}
          </button>
        </form>
      )}
    </div>
  );
}
