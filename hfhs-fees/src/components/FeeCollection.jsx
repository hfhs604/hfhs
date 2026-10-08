import React, { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  searchStudents,
  collectPayment,
  getMonthlyBill,
  addBooksFee,
  addPreviousYearBalance,
  addKitFee,
  MONTHLY_TUITION,
} from "../firebase/feeService";
import ReceiptPrintSheet from "./ReceiptPrintSheet";
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
  const [flash, setFlash] = useState("");

  const [addonBusy, setAddonBusy] = useState(false);
  const [addonMsg, setAddonMsg] = useState("");
  const [promptSlot, setPromptSlot] = useState(null);
  const [promptValue, setPromptValue] = useState("");

  const [transportEnabled, setTransportEnabled] = useState(false);
  const [transportValue, setTransportValue] = useState(800);

  const [receiptPopup, setReceiptPopup] = useState(null);

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
    setTransportEnabled(false);
    setTransportValue(800);
    await refreshBill(student.id);
  }

  function showFlash(msg) {
    setFlash(msg);
    setTimeout(() => setFlash(""), 1000);
  }

  // Live preview values
  const transportAdd = transportEnabled ? Number(transportValue || 0) : 0;
  const amountAdd = Number(form.amountReceived || 0);
  const discountAdd = Number(form.discount || 0);
  const lateAdd = Number(form.lateFee || 0);
  const netThisPayment = amountAdd + transportAdd + lateAdd - discountAdd;
  const projectedTotalDue = bill ? (bill.totalDue || 0) + transportAdd : 0;
  const projectedBalance = bill
    ? Math.max((bill.totalDue || 0) + transportAdd - (bill.totalPaid || 0) - netThisPayment, 0)
    : 0;

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting || !selectedStudent) return;

    if (transportEnabled) {
      const t = Number(transportValue);
      if (t < 800 || t > 1500) {
        setError("Transport must be between ₹800 and ₹1500.");
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      const totalReceived = amountAdd + transportAdd;

      const { receipt, duplicateBlocked } = await collectPayment({
        studentId: selectedStudent.id,
        session,
        month,
        idempotencyKey,
        ...form,
        amountReceived: totalReceived,
        remarks:
          (form.remarks || "") +
          (transportEnabled ? ` [Transport ₹${transportValue}]` : ""),
      });

      const enrichedReceipt = {
        ...receipt,
        transportFee: transportAdd,
        tuitionFee: Number(form.amountReceived || 0),
      };

      onReceiptGenerated?.(enrichedReceipt, duplicateBlocked);
      showFlash("✅ Payment Successful");
      setReceiptPopup(enrichedReceipt);
      setIdempotencyKey(uuidv4());
      setForm((f) => ({
        ...f,
        amountReceived: "",
        referenceNumber: "",
        discount: 0,
        lateFee: 0,
        remarks: "",
      }));
      setTransportEnabled(false);
      setTransportValue(800);
      await refreshBill(selectedStudent.id);
    } catch (err) {
      setError(err.message || "Payment could not be recorded.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddon(fn, amount, label) {
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
      showFlash(`✅ ${label} added`);
      setAddonMsg(
        res.duplicateBlocked
          ? "This entry was already recorded."
          : `Added ${label}. Receipt: ${res.receipt.receiptNumber}`
      );
      setReceiptPopup(res.receipt);
      await refreshBill(selectedStudent.id);
    } catch (e) {
      setAddonMsg(`❌ ${e.message}`);
    } finally {
      setAddonBusy(false);
    }
  }

  function promptForAmount(slot) {
    setPromptSlot(slot);
    setPromptValue("");
  }

  function confirmPrompt() {
    const amt = Number(promptValue);
    if (!amt || amt <= 0) {
      setAddonMsg("Please enter a valid amount.");
      return;
    }
    if (promptSlot === "books") handleAddon(addBooksFee, amt, "Books");
    else if (promptSlot === "previousYear") handleAddon(addPreviousYearBalance, amt, "Previous Year Balance");
    else if (promptSlot === "kit") handleAddon(addKitFee, amt, "Admission / Kit");
    setPromptSlot(null);
  }

  return (
    <div className="fm-card">
      <h2>Collect Fee</h2>
      <p className="fm-subtle">Billing month: <strong>{month}</strong></p>

      {flash && <div className="fm-flash">{flash}</div>}

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
                  {bill.devFeeBilled > 0 && (
                    <tr><td>Development Fee</td><td align="right">₹{bill.devFeeBilled}</td></tr>
                  )}
                  {(bill.transportBilled > 0 || transportAdd > 0) && (
                    <tr>
                      <td>Transport {transportAdd > 0 && bill.transportBilled === 0 ? "(adding now)" : ""}</td>
                      <td align="right">₹{(bill.transportBilled || 0) + (bill.transportBilled === 0 ? transportAdd : 0)}</td>
                    </tr>
                  )}
                  {bill.booksBilled > 0 && (
                    <tr><td>Books</td><td align="right">₹{bill.booksBilled}</td></tr>
                  )}
                  {bill.previousYearBilled > 0 && (
                    <tr><td>Previous Year Balance</td><td align="right">₹{bill.previousYearBilled}</td></tr>
                  )}
                  {bill.kitFeeBilled > 0 && (
                    <tr><td>Admission / Kit Fee</td><td align="right">₹{bill.kitFeeBilled}</td></tr>
                  )}

                  <tr className="fm-row-total">
                    <td><strong>Total Due</strong></td>
                    <td align="right">
                      <strong>₹{projectedTotalDue}</strong>
                      {transportAdd > 0 && (
                        <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 6 }}>
                          (was ₹{bill.totalDue})
                        </span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td>Total Paid</td>
                    <td align="right">₹{(bill.totalPaid || 0) + netThisPayment}</td>
                  </tr>
                  <tr className="fm-row-balance">
                    <td><strong>Balance</strong></td>
                    <td align="right"><strong>₹{projectedBalance}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <form onSubmit={handleSubmit} className="fm-payment-form">
            {/* Row 1: Fee Type | Transport checkbox */}
            <label>
              Fee Type
              <select value={form.feeType}
                onChange={(e) => setForm({ ...form, feeType: e.target.value })}>
                {["Tuition Fee", "Examination Fee", "Computer Fee", "Library Fee", "Activity Fee", "Other Charges"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>

            <label>
              <span style={{ visibility: "hidden" }}>_</span>
              <span style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={transportEnabled}
                  onChange={(e) => setTransportEnabled(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: "pointer" }}
                />
                Include Transport Fee
              </span>
            </label>

            {/* Row 2: Transport amount (only when ticked) */}
            {transportEnabled && (
              <label>
                Transport Amount (₹800–₹1500)
                <input
                  type="number"
                  min="800"
                  max="1500"
                  step="50"
                  value={transportValue}
                  onChange={(e) => setTransportValue(Number(e.target.value))}
                />
              </label>
            )}

            {/* Row 3: Amount Received | Transaction/Reference */}
            <label>
              Amount Received (₹)
              <input type="number" required min="0" value={form.amountReceived}
                onChange={(e) => setForm({ ...form, amountReceived: e.target.value })} />
            </label>

            <label>
              Transaction / Reference No.
              <input type="text" value={form.referenceNumber}
                onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })} />
            </label>

            {/* Row 4: Payment Date | Payment Method */}
            <label>
              Payment Date
              <input type="date" value={form.paymentDate}
                onChange={(e) => setForm({ ...form, paymentDate: e.target.value })} />
            </label>

            <label>
              Payment Method
              <select value={form.paymentMethod}
                onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
                {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>

            {/* Row 5: Discount | Late Fee */}
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
              <textarea value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </label>

            {error && <p className="fm-error">{error}</p>}

            <button type="submit" disabled={submitting} className="fm-primary-btn fm-full-width">
              {submitting ? "Recording payment…" : "Record Payment"}
            </button>
          </form>

          <div className="fm-addon-panel">
            <h4>Add-on Fees</h4>
            <p className="fm-subtle">One-time fees added to this month's bill.</p>

            <div className="fm-addon-row-buttons">
              <button type="button" className="fm-addon-btn" disabled={addonBusy}
                onClick={() => promptForAmount("books")}>
                📚 + Books
              </button>
              <button type="button" className="fm-addon-btn" disabled={addonBusy}
                onClick={() => promptForAmount("previousYear")}>
                📜 + Prev Year
              </button>
              <button type="button" className="fm-addon-btn" disabled={addonBusy}
                onClick={() => promptForAmount("kit")}>
                👕 + Admission / Kit
              </button>
            </div>

            {addonMsg && <p className="fm-addon-msg">{addonMsg}</p>}
          </div>

          <button type="button" className="fm-secondary-btn"
            onClick={() => {
              setSelectedStudent(null);
              setBill(null);
              setResults([]);
              setSearchTerm("");
              setError(null);
              setAddonMsg("");
              setTransportEnabled(false);
              setTransportValue(800);
            }}>
            ← Back to search
          </button>
        </>
      )}

      {promptSlot && (
        <div className="fm-modal-overlay">
          <div className="fm-modal" style={{ maxWidth: 380 }}>
            <h3>
              {promptSlot === "books" && "Add Books Fee"}
              {promptSlot === "previousYear" && "Add Previous Year Balance"}
              {promptSlot === "kit" && "Add Admission / Kit Fee"}
            </h3>
            <p style={{ margin: "12px 0", fontSize: 14, color: "#4b5563" }}>
              Enter the amount in ₹
            </p>
            <input
              type="number"
              min="1"
              autoFocus
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmPrompt()}
              style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 6, fontSize: 15 }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button type="button" className="fm-secondary-btn"
                onClick={() => setPromptSlot(null)}>Cancel</button>
              <button type="button" className="fm-primary-btn"
                onClick={confirmPrompt}>Add</button>
            </div>
          </div>
        </div>
      )}

      {receiptPopup && (
        <div className="fm-modal-overlay" style={{ zIndex: 9500 }}>
          <div style={{
            background: "#fff",
            borderRadius: 10,
            padding: 20,
            maxWidth: 800,
            width: "95%",
            maxHeight: "90vh",
            overflowY: "auto",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, color: "#1a3d6d" }}>Payment Receipt</h3>
              <button
                type="button"
                onClick={() => setReceiptPopup(null)}
                style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}
              >
                ×
              </button>
            </div>

            <ReceiptPrintSheet receipts={[receiptPopup]} />

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" className="fm-secondary-btn"
                onClick={() => setReceiptPopup(null)}>Close</button>
              <button type="button" className="fm-primary-btn"
                onClick={() => window.print()}>🖨 Print</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
