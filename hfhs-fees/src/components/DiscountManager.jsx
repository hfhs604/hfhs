import React, { useState } from "react";
import { applyDiscount, searchStudents } from "../firebase/feeService";
import "../styles/feeManagement.css";

/**
 * `canManageDiscounts` should come from the logged-in user's role/permissions
 * in your app shell (see users.{permissions.manageDiscounts} in the rules).
 * The UI-level gate here is a courtesy — the real enforcement is in
 * firestore.rules, which rejects the write regardless of what this renders.
 */
export default function DiscountManager({ canManageDiscounts }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ amount: "", type: "fixed", reason: "" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSearch(e) {
    e.preventDefault();
    if (!searchTerm.trim()) return;
    setResults(await searchStudents(searchTerm.trim()));
  }

  async function handleApply(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await applyDiscount({ studentId: selected.id, amount: Number(form.amount), type: form.type, reason: form.reason });
      setMessage(`Discount of ₹${form.amount} applied to ${selected.name}. ✓`);
      setForm({ amount: "", type: "fixed", reason: "" });
      setSelected(null);
      setResults([]);
      setSearchTerm("");
    } catch (err) {
      setMessage(err.message || "Could not apply discount.");
    } finally {
      setSaving(false);
    }
  }

  if (!canManageDiscounts) {
    return (
      <div className="fm-card fm-empty-state">
        You don't have permission to manage discounts. Ask a Super Admin to grant
        the <code>manageDiscounts</code> permission.
      </div>
    );
  }

  return (
    <div className="fm-card">
      <h2>Discounts &amp; Concessions</h2>

      {!selected && (
        <form onSubmit={handleSearch} className="fm-search-row">
          <input placeholder="Search student" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          <button type="submit">Search</button>
        </form>
      )}

      {!selected && results.length > 0 && (
        <ul className="fm-result-list">
          {results.map((s) => (
            <li key={s.id} onClick={() => setSelected(s)}>
              <strong>{s.name}</strong> — Adm# {s.admissionNumber} — Class {s.className} {s.section}
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <form onSubmit={handleApply} className="fm-payment-form">
          <p className="fm-full-width">Applying discount to <strong>{selected.name}</strong> (Adm# {selected.admissionNumber})</p>
          <label>
            Discount Type
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="fixed">Fixed Amount</option>
              <option value="percentage">Percentage</option>
              <option value="student-specific">Student-specific Concession</option>
              <option value="category-specific">Category-specific Concession</option>
            </select>
          </label>
          <label>
            {form.type === "percentage" ? "Discount (%)" : "Discount Amount (₹)"}
            <input required type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </label>
          <label className="fm-full-width">
            Reason
            <textarea required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </label>
          {message && <p className="fm-full-width">{message}</p>}
          <div className="fm-full-width" style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={saving} className="fm-primary-btn">
              {saving ? "Applying…" : "Apply Discount"}
            </button>
            <button type="button" onClick={() => setSelected(null)}>Cancel</button>
          </div>
        </form>
      )}

      {message && !selected && <p>{message}</p>}
    </div>
  );
}
