import React, { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { searchStudents, collectPayment, computeBalanceView } from "../firebase/feeService";
import "../styles/feeManagement.css";

const PAYMENT_METHODS = ["Cash", "UPI", "Bank Transfer", "Cheque", "Other"];

export default function FeeCollection({ session, onReceiptGenerated }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Generated once when the form opens for a student — NOT regenerated on
  // every click — so a double-click submits the same idempotency key twice
  // and the second attempt is safely ignored by collectPayment().
  const [idempotencyKey, setIdempotencyKey] = useState(null);

  const [form, setForm] = useState({
    amountReceived: "",
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentMethod: "Cash",
    referenceNumber: "",
    feeType: "Tuition Fee",
    discount: 0,
    lateFee: 0,
    remarks: "",
  });

  async function handleSearch(e) {
    e.preventDefault();
    if (!searchTerm.trim()) return;
    const found = await searchStudents(searchTerm.trim());
    setResults(found);
  }

  function selectStudent(student) {
    setSelectedStudent(student);
    setIdempotencyKey(uuidv4());
    setError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting || !selectedStudent) return; // guards rapid double-click
    setSubmitting(true);
    setError(null);
    try {
      const { receipt, duplicateBlocked } = await collectPayment({
        studentId: selectedStudent.id,
        session,
        idempotencyKey,
        ...form,
      });
      onReceiptGenerated?.(receipt, duplicateBlocked);
      // Reset for next payment: fresh idempotency key, cleared amount fields
      setIdempotencyKey(uuidv4());
      setForm((f) => ({ ...f, amountReceived: "", referenceNumber: "", discount: 0, lateFee: 0, remarks: "" }));
      const refreshed = await import("../firebase/feeService").then((m) => m.getStudentFeeProfile(selectedStudent.id));
      setSelectedStudent(refreshed);
    } catch (err) {
      setError(err.message || "Payment could not be recorded.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fm-card">
      <h2>Collect Fee</h2>

      <form onSubmit={handleSearch} className="fm-search-row">
        <input
          type="text"
          placeholder="Search by name, admission no., or mobile number"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <button type="submit">Search</button>
      </form>

      {results.length > 0 && !selectedStudent && (
        <ul className="fm-result-list">
          {results.map((s) => (
            <li key={s.id} onClick={() => selectStudent(s)}>
              <strong>{s.name}</strong> — Adm# {s.admissionNumber} — Class {s.className} {s.section}
              <span className={`fm-badge fm-badge-${s.accountStatus.toLowerCase()}`}>{s.accountStatus}</span>
            </li>
          ))}
        </ul>
      )}

      {selectedStudent && (
        <>
          <div className="fm-summary-grid">
            <div>Total Fee<strong>₹{selectedStudent.totalAnnualFee}</strong></div>
            <div>Paid<strong>₹{selectedStudent.totalAmountPaid}</strong></div>
            <div className="fm-due">Due<strong>₹{selectedStudent.totalDue}</strong></div>
            <div className="fm-advance">Advance<strong>₹{selectedStudent.totalAdvance}</strong></div>
          </div>

          <form onSubmit={handleSubmit} className="fm-payment-form">
            <label>
              Fee Type
              <select value={form.feeType} onChange={(e) => setForm({ ...form, feeType: e.target.value })}>
                {["Admission Fee", "Tuition Fee", "Annual Fee", "Examination Fee", "Development Fee",
                  "Computer Fee", "Library Fee", "Transport Fee", "Activity Fee", "Other Charges"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>

            <label>
              Amount Received (₹)
              <input
                type="number"
                required
                min="0"
                value={form.amountReceived}
                onChange={(e) => setForm({ ...form, amountReceived: e.target.value })}
              />
            </label>

            <label>
              Payment Date
              <input
                type="date"
                value={form.paymentDate}
                onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
              />
            </label>

            <label>
              Payment Method
              <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
                {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>

            <label>
              Transaction / Reference No.
              <input
                type="text"
                value={form.referenceNumber}
                onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })}
              />
            </label>

            <label>
              Discount (₹)
              <input type="number" min="0" value={form.discount}
                onChange={(e) => setForm({ ...form, discount: e.target.value })} />
            </label>

            <label>
              Late Fee (₹)
              <input type="number" min="0" value={form.lateFee}
                onChange={(e) => setForm({ ...form, lateFee: e.target.value })} />
            </label>

            <label className="fm-full-width">
              Remarks
              <textarea value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </label>

            {error && <p className="fm-error">{error}</p>}

            <button type="submit" disabled={submitting} className="fm-primary-btn">
              {submitting ? "Recording payment…" : "Record Payment"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
