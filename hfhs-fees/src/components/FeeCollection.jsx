import React, { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  searchStudents,
  collectPayment,
  getMonthlyBill,
  addTransportFee,
  addBooksFee,
  addPreviousYearBalance,
  addKitFee,
  MONTHLY_TUITION,
} from "../firebase/feeService";
import "../styles/feeManagement.css";

const PAYMENT_METHODS = ["Cash", "UPI", "Bank Transfer", "Cheque", "Other"];

export default function FeeCollection({ session, month, onReceiptGenerated }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [bill, setBill] = useState(null);
  const [loadingBill, setLoadingBill] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState(null);

  // Add-on panel state
  const [addonBusy, setAddonBusy] = useState(false);
  const [addonMsg, setAddonMsg] = useState("");
  const [booksAmt, setBooksAmt] = useState("");
  const [pyAmt, setPyAmt] = useState("");
  const [kitAmt, setKitAmt] = useState("");
  const [showBooks, setShowBooks] = useState(false);
  const [showPy, setShowPy] = useState(false);
  const [showKit, setShowKit] = useState(false);

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

  async function refreshBill(studentId) {
    setLoadingBill(true);
    try {
      const b = await getMonthlyBill(session, month, studentId);
      setBill(b);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingBill(false);
    }
  }

  async function handleSearch(e) {
    e.preventDefault();
    if (!searchTerm.trim()) return;
    setError(null);
    const found = await searchStudents(searchTerm.trim());
    setResults(found);
  }

  async function selectStudent(student) {
    setSelectedStudent(student);
    setIdempotencyKey(uuidv4());
    setError(null);
    setAddonMsg("");
    await refreshBill(student.id);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting || !selectedStudent) return;
    setSubmitting(true);
    setError(null);
    try {
      const { receipt, duplicateBlocked } = await collectPayment({
        studentId: selectedStudent.id,
        session,
        month,
        idempotencyKey,
        ...form,
      });
      onReceiptGenerated?.(receipt, duplicateBlocked);
      setIdempotencyKey(uuidv4());
      setForm((f) => ({
        ...f,
        amountReceived: "",
        referenceNumber: "",
        discount: 0,
        lateFee: 0,
        remarks: "",
      }));
      await refreshBill(selectedStudent.id);
    } catch (err) {
      setError(err.message || "Payment could not be recorded.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddon(fn, amount) {
    setAddonBusy(true);
    setAddonMsg("");
    try {
      const res = await fn({
        studentId: selectedStudent.id,
        amount,
        session,
        month,
        paymentDate: new Date().toISOString(),
        idempotencyKey: uuidv4(),
      });
      setAddonMsg(
        res.duplicateBlocked
          ? "This entry was already recorded."
          : `✅ Added. Receipt: ${res.receipt.receiptNumber}`
      );
      await refreshBill(selectedStudent.id);
    } catch (e) {
      setAddonMsg(`❌ ${e.message}`);
    } finally {
      setAddonBusy(false);
    }
  }

  const monthlyTuition = selectedStudent
    ? MONTHLY_TUITION[selectedStudent.className] || 0
    : 0;

  return (
    <div className="fm-card">
      <h2>Collect Fee</h2>
      <p className="fm-subtle">Billing month: <strong>{month}</strong></p>

      {/* Search */}
      <form onSubmit={handleSearch} className="fm-search-row">
        <input
          type="text"
          placeholder="Search by name or admission no."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <button type="submit">Search</button>
      </form>

      {results.length > 0 && !selectedStudent && (
        <ul className="fm-result-list">
          {results.map((s) => (
            <li key={s.id} onClick={() => selectStudent(s)}>
              <strong>{s.name}</strong> — Adm# {s.admissionNumber} — Class {s.className}
              {bill && bill.studentId === s.id && (
                <span className={`fm-badge fm-badge-${(bill.status || "").toLowerCase()}`}>
                  {bill.status}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {selectedStudent && (
        <>
          <div className="fm-student-header">
            <h3>{selectedStudent.name}</h3>
            <p>
              Adm# {selectedStudent.admissionNumber} · Class {selectedStudent.className}
              {selectedStudent.rollNumber ? ` · Roll ${selectedStudent.rollNumber}` : ""}
            </p>
          </div>

          {loadingBill && <p className="fm-subtle">Loading bill…</p>}

          {bill && (
            <div className="fm-bill-breakdown">
              <h4>Current Month Bill ({month})</h4>
              <table className="fm-bill-table">
                <tbody>
                  {bill.previousDue > 0 && (
                    <tr className="fm-row-prev">
                      <td>Previous Due (carried forward)</td>
                      <td align="right">₹{bill.previousDue}</td>
                    </tr>
                  )}
                  <tr>
                    <td>Tuition (this month)</td>
                    <td align="right">₹{bill.tuitionBilled || 0}</td>
                  </tr>
                  {bill.transportBilled > 0 && (
                    <tr>
                      <td>Transport</td>
                      <td align="right">₹{bill.transportBilled}</td>
                    </tr>
                  )}
                  {bill.devFeeBilled > 0 && (
                    <tr>
                      <td>Development Fee</td>
                      <td align="right">₹{bill.devFeeBilled}</td>
                    </tr>
                  )}
                  {bill.booksBilled > 0 && (
                    <tr>
                      <td>Books</td>
                      <td align="right">₹{bill.booksBilled}</td>
                    </tr>
                  )}
                  {bill.previousYearBilled > 0 && (
                    <tr>
                      <td>Previous Year Balance</td>
                      <td align="right">₹{bill.previousYearBilled}</td>
                    </tr>
                  )}
                  {bill.kitFeeBilled > 0 && (
                    <tr>
                      <td>Admission / Kit Fee</td>
                      <td align="right">₹{bill.kitFeeBilled}</td>
                    </tr>
                  )}
                  <tr className="fm-row-total">
                    <td><strong>Total Due</strong></td>
                    <td align="right"><strong>₹{bill.totalDue}</strong></td>
                  </tr>
                  <tr>
                    <td>Total Paid</td>
                    <td align="right">₹{bill.totalPaid}</td>
                  </tr>
                  <tr className="fm-row-balance">
                    <td><strong>Balance</strong></td>
                    <td align="right"><strong>₹{bill.carriedForward}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Payment form */}
          <form onSubmit={handleSubmit} className="fm-payment-form">
            <label>
              Fee Type
              <select
                value={form.feeType}
                onChange={(e) => setForm({ ...form, feeType: e.target.value })}
              >
                {[
                  "Tuition Fee",
                  "Examination Fee",
                  "Computer Fee",
                  "Library Fee",
                  "Activity Fee",
                  "Other Charges",
                ].map((c) => (
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
              <select
                value={form.paymentMethod}
                onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
              >
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
              <input
                type="number"
                min="0"
                value={form.discount}
                onChange={(e) => setForm({ ...form, discount: e.target.value })}
              />
            </label>

            <label>
              Late Fee (₹)
              <input
                type="number"
                min="0"
                value={form.lateFee}
                onChange={(e) => setForm({ ...form, lateFee: e.target.value })}
              />
            </label>

            <label className="fm-full-width">
              Remarks
              <textarea
                value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
              />
            </label>

            {error && <p className="fm-error">{error}</p>}

            <button type="submit" disabled={submitting} className="fm-primary-btn">
              {submitting ? "Recording payment…" : "Record Payment"}
            </button>
          </form>

          {/* Add-on panel */}
          <div className="fm-addon-panel">
            <h4>Add-on Fees</h4>
            <p className="fm-subtle">These add to the current month's bill and count as paid.</p>

            <div className="fm-addon-row">
              <button
                type="button"
                disabled={addonBusy}
                onClick={() => handleAddon(addTransportFee, 800)}
              >
                🚌 + ₹800 Transport
              </button>
              <button
                type="button"
                disabled={addonBusy}
                onClick={() => handleAddon(addTransportFee, 1500)}
              >
                🚌 + ₹1500 Transport
              </button>
            </div>

            <div className="fm-addon-row">
              {!showBooks ? (
                <button type="button" disabled={addonBusy} onClick={() => setShowBooks(true)}>
                  📚 + Books Fee
                </button>
              ) : (
                <>
                  <input
                    type="number"
                    placeholder="Amount ₹"
                    value={booksAmt}
                    onChange={(e) => setBooksAmt(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={addonBusy || !booksAmt}
                    onClick={async () => {
                      await handleAddon(addBooksFee, Number(booksAmt));
                      setBooksAmt("");
                      setShowBooks(false);
                    }}
                  >
                    Add
                  </button>
                  <button type="button" onClick={() => setShowBooks(false)}>Cancel</button>
                </>
              )}
            </div>

            <div className="fm-addon-row">
              {!showPy ? (
                <button type="button" disabled={addonBusy} onClick={() => setShowPy(true)}>
                  📜 + Previous Year Balance
                </button>
              ) : (
                <>
                  <input
                    type="number"
                    placeholder="Amount ₹"
                    value={pyAmt}
                    onChange={(e) => setPyAmt(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={addonBusy || !pyAmt}
                    onClick={async () => {
                      await handleAddon(addPreviousYearBalance, Number(pyAmt));
                      setPyAmt("");
                      setShowPy(false);
                    }}
                  >
                    Add
                  </button>
                  <button type="button" onClick={() => setShowPy(false)}>Cancel</button>
                </>
              )}
            </div>

            <div className="fm-addon-row">
              {!showKit ? (
                <button type="button" disabled={addonBusy} onClick={() => setShowKit(true)}>
                  👕 + Admission / Kit Fee
                </button>
              ) : (
                <>
                  <input
                    type="number"
                    placeholder="Amount ₹"
                    value={kitAmt}
                    onChange={(e) => setKitAmt(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={addonBusy || !kitAmt}
                    onClick={async () => {
                      await handleAddon(addKitFee, Number(kitAmt));
                      setKitAmt("");
                      setShowKit(false);
                    }}
                  >
                    Add
                  </button>
                  <button type="button" onClick={() => setShowKit(false)}>Cancel</button>
                </>
              )}
            </div>

            {addonMsg && <p className="fm-addon-msg">{addonMsg}</p>}
          </div>

          <button
            type="button"
            className="fm-secondary-btn"
            onClick={() => {
              setSelectedStudent(null);
              setBill(null);
              setResults([]);
              setSearchTerm("");
              setError(null);
              setAddonMsg("");
            }}
          >
            ← Back to search
          </button>
        </>
      )}
    </div>
  );
}
