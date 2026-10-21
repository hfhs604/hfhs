import React, { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  searchStudents,
  collectPayment,
  getMonthlyBill,
  addBooksFee,
  addPreviousYearBalance,
  addKitFee,
  getStudentPaymentSummary,
} from "../firebase/feeService";
import ReceiptPrintSheet from "./ReceiptPrintSheet";
import PrintManager from "./PrintManager";
import "../styles/feeManagement.css";

const PAYMENT_METHODS = ["Cash", "UPI", "Bank Transfer", "Cheque", "Other"];
const ADDON_ROLES = ["superAdmin", "admin", "accountant"];

function fmtDate(d) {
  if (!d) return "—";
  try {
    const date = d instanceof Date ? d : new Date(d);
    const day = String(date.getDate()).padStart(2, "0");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${day}-${months[date.getMonth()]}`;
  } catch {
    return "—";
  }
}

export default function FeeCollection({ session, month, onReceiptGenerated, role }) {
  const canManageAddons = ADDON_ROLES.includes(role);

  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [bill, setBill] = useState(null);
  const [sessionPaid, setSessionPaid] = useState(0);
  const [lastPayment, setLastPayment] = useState(null);
  const [loadingBill, setLoadingBill] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState(null);
  const [flash, setFlash] = useState("");

  const [addonBusy, setAddonBusy] = useState(false);
  const [addonMsg, setAddonMsg] = useState("");
  const [promptSlot, setPromptSlot] = useState(null);
  const [promptValue, setPromptValue] = useState("");
  const [promptConfirming, setPromptConfirming] = useState(false);

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

  async function refreshAll(studentId) {
    setLoadingBill(true);
    try {
      const [b, summary] = await Promise.all([
        getMonthlyBill(session, month, studentId),
        getStudentPaymentSummary(studentId, session, month),
      ]);
      setBill(b);
      setSessionPaid(summary.sessionTotal);
      setLastPayment(summary.lastPayment);
      return b;
    } catch (e) {
      setError(e.message);
      return null;
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
    setResults([]); // Hide search results immediately
    setIdempotencyKey(uuidv4());
    setError(null);
    setAddonMsg("");
    await refreshAll(student.id);
  }

  function showFlash(msg) {
    setFlash(msg);
    setTimeout(() => setFlash(""), 1500);
  }

  const amountAdd = Number(form.amountReceived || 0);
  const displayTotalPaidThisMonth = bill ? (bill.totalPaid || 0) : 0;
  const displayBalance = bill ? Math.max((bill.carriedForward || 0), 0) : 0;

  function buildParticularsFromBill(b, feeTypeLabel) {
    const items = [];
    if (!b) return items;

    if ((b.tuitionBilled || 0) > 0) items.push({ label: feeTypeLabel || "Tuition Fee", amount: b.tuitionBilled });
    if ((b.transportBilled || 0) > 0) items.push({ label: "Transport Fee", amount: b.transportBilled });
    if ((b.devFeeBilled || 0) > 0) items.push({ label: "Development Fee", amount: b.devFeeBilled });
    if ((b.booksBilled || 0) > 0) items.push({ label: "Books Fee", amount: b.booksBilled });
    if ((b.previousYearBilled || 0) > 0) items.push({ label: "Previous Year Balance", amount: b.previousYearBilled });
    if ((b.kitFeeBilled || 0) > 0) items.push({ label: "Admission / Kit Fee", amount: b.kitFeeBilled });
    return items;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting || !selectedStudent) return;

    if (!amountAdd || amountAdd <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const balanceBefore = bill ? (bill.carriedForward || 0) : 0;

      const { receipt, duplicateBlocked } = await collectPayment({
        studentId: selectedStudent.id,
        session,
        month,
        idempotencyKey,
        ...form,
        amountReceived: amountAdd,
      });

      const freshBill = await refreshAll(selectedStudent.id);
      const particulars = buildParticularsFromBill(freshBill || bill, form.feeType);

      const enrichedReceipt = {
        ...receipt,
        particulars,
        amountReceivedThisTransaction: amountAdd,
        totalDue: balanceBefore,
        remainingDue: freshBill?.carriedForward || 0,
        previousDue: freshBill?.previousDue || 0,
        isCharge: false,
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

      showFlash(`✅ ${label} ₹${amount} charged`);
      await refreshAll(selectedStudent.id);

      if (res.receipt) {
        setReceiptPopup({ ...res.receipt, isCharge: true });
      }

      setAddonMsg(
        res.duplicateBlocked
          ? "Already recorded."
          : `${label} ₹${amount} added to the bill (charge, not payment).`
      );
    } catch (e) {
      setAddonMsg(`❌ ${e.message}`);
    } finally {
      setAddonBusy(false);
    }
  }

  function promptForAmount(slot) {
    setPromptSlot(slot);
    setPromptValue("");
    setPromptConfirming(false);
  }

  function cancelPrompt() {
    setPromptSlot(null);
    setPromptValue("");
    setPromptConfirming(false);
  }

  async function confirmPrompt() {
    if (promptConfirming) return;

    const amt = Number(promptValue);
    if (!amt || amt <= 0) {
      setAddonMsg("Please enter a valid amount.");
      return;
    }

    setPromptConfirming(true);

    try {
      if (promptSlot === "books") {
        await handleAddon(addBooksFee, amt, "Books");
      } else if (promptSlot === "previousYear") {
        await handleAddon(addPreviousYearBalance, amt, "Previous Year Balance");
      } else if (promptSlot === "kit") {
        await handleAddon(addKitFee, amt, "Admission / Kit");
      }
      cancelPrompt();
    } catch (e) {
      setPromptConfirming(false);
    }
  }

  return (
    <div className="fm-card">
      <div className="fm-row-header">
        <h2>Collect Fee</h2>
        <span className="fm-subtle">Billing month: <strong>{month}</strong></span>
      </div>

      {flash && <div className="fm-flash">{flash}</div>}

      <form onSubmit={handleSearch} className="fm-search-row">
        <input
          type="text"
          placeholder="Search by name or admission no."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <button type="submit" className="fm-primary-btn" style={{ padding: "0 24px" }}>Search</button>
      </form>

      {/* PROFESSIONAL SEARCH RESULTS TABLE */}
      {results.length > 0 && !selectedStudent && (
        <div className="fm-table-scroll" style={{ maxHeight: 300, marginBottom: 20 }}>
          <table className="fm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Adm#</th>
                <th>Class</th>
                <th style={{ textAlign: "center" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {results.map((s) => (
                <tr key={s.id} onClick={() => selectStudent(s)} style={{ cursor: "pointer" }}>
                  <td className="wrap-text" style={{ fontWeight: 600, color: "var(--primary-blue)" }}>
                    {s.name}
                  </td>
                  <td>{s.admissionNumber}</td>
                  <td>{s.className}{s.section ? `-${s.section}` : ""}</td>
                  <td style={{ textAlign: "center" }}>
                    <button
                      type="button"
                      className="fm-btn-sm"
                      onClick={(e) => { e.stopPropagation(); selectStudent(s); }}
                    >
                      Select
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedStudent && (
        <>
          <div className="fm-student-header">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3>{selectedStudent.name}</h3>
              <button
                type="button"
                className="fm-link-btn"
                onClick={() => { setSelectedStudent(null); setBill(null); }}
              >
                ✕ Clear Selection
              </button>
            </div>
            <p>
              Adm# {selectedStudent.admissionNumber} · Class {selectedStudent.className}
              {selectedStudent.rollNumber ? ` · Roll ${selectedStudent.rollNumber}` : ""}
            </p>
          </div>

          {loadingBill && <p className="fm-subtle">Loading bill…</p>}

          {bill && (
            <div className="fm-bill-two-col">
              {/* LEFT COLUMN: ITEMIZED BILL */}
              <div>
                <h4 style={{ margin: "0 0 12px", color: "#64748b", fontSize: 13, textTransform: "uppercase" }}>Current Bill Breakdown</h4>
                <table className="fm-bill-table" style={{ width: "100%" }}>
                  <tbody>
                    {bill.previousDue > 0 && (
                      <tr className="fm-row-prev">
                        <td style={{ color: "#dc2626", fontWeight: 600 }}>Previous Due</td>
                        <td align="right" style={{ color: "#dc2626", fontWeight: 600 }}>₹{bill.previousDue}</td>
                      </tr>
                    )}
                    <tr>
                      <td>Tuition Fee</td>
                      <td align="right">₹{bill.tuitionBilled || 0}</td>
                    </tr>
                    {bill.devFeeBilled > 0 && (
                      <tr><td>Development Fee</td><td align="right">₹{bill.devFeeBilled}</td></tr>
                    )}
                    {bill.transportBilled > 0 && (
                      <tr><td>Transport (charge)</td><td align="right">₹{bill.transportBilled}</td></tr>
                    )}
                    {bill.booksBilled > 0 && (
                      <tr><td>Books (charge)</td><td align="right">₹{bill.booksBilled}</td></tr>
                    )}
                    {bill.previousYearBilled > 0 && (
                      <tr><td>Previous Year (charge)</td><td align="right">₹{bill.previousYearBilled}</td></tr>
                    )}
                    {bill.kitFeeBilled > 0 && (
                      <tr><td>Kit Fee (charge)</td><td align="right">₹{bill.kitFeeBilled}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* RIGHT COLUMN: STATS */}
              <div>
                <div className="fm-bill-session-line">
                  <span>Session Paid (Till Date)</span>
                  <strong style={{ color: "var(--success-green)" }}>₹{sessionPaid}</strong>
                </div>

                <div className="fm-stats-grid">
                  <div className="fm-stat-cell">
                    <span className="fm-stat-cell-label">Total Billed</span>
                    <span className="fm-stat-cell-value">₹{bill.totalDue || 0}</span>
                  </div>
                  <div className="fm-stat-cell">
                    <span className="fm-stat-cell-label">Paid (This Month)</span>
                    <span className="fm-stat-cell-value" style={{ color: "var(--success-green)" }}>₹{displayTotalPaidThisMonth}</span>
                    {lastPayment && (
                      <span className="fm-stat-cell-sub">
                        Last: {fmtDate(lastPayment.date)} · ₹{lastPayment.amount}
                      </span>
                    )}
                  </div>
                  <div className="fm-stat-cell">
                    <span className="fm-stat-cell-label">Amount Entered</span>
                    <span className="fm-stat-cell-value" style={{ color: "var(--primary-blue)" }}>₹{amountAdd}</span>
                  </div>
                  <div className="fm-stat-cell fm-stat-cell-balance">
                    <span className="fm-stat-cell-label">Current Balance</span>
                    <span className="fm-stat-cell-value">₹{displayBalance}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="fm-payment-form">
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
              Amount Received (₹) *
              <input type="number" required min="0" value={form.amountReceived}
                onChange={(e) => setForm({ ...form, amountReceived: e.target.value })} 
                style={{ fontSize: 16, fontWeight: 600, color: "var(--primary-blue)", borderColor: "#93c5fd" }}
              />
            </label>

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

            <label>
              Transaction / Reference No.
              <input type="text" value={form.referenceNumber}
                onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })} />
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
              <input type="text" value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </label>
          </form>

          {error && <p className="fm-error">{error}</p>}
          {addonMsg && <p className="fm-hint" style={{ color: "var(--primary-blue)", fontWeight: 500 }}>{addonMsg}</p>}

          <div className="fm-action-row">
            {canManageAddons && (
              <div className="fm-action-addons">
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
                  👕 + Kit
                </button>
              </div>
            )}

            <div className="fm-action-buttons">
              <button type="button" className="fm-secondary-btn"
                onClick={() => {
                  setSelectedStudent(null);
                  setBill(null);
                  setSessionPaid(0);
                  setLastPayment(null);
                  setResults([]);
                  setSearchTerm("");
                  setError(null);
                  setAddonMsg("");
                }}>
                ← Back
              </button>

              <button
                type="submit"
                disabled={submitting}
                className="fm-primary-btn"
                onClick={handleSubmit}
                style={{ padding: "10px 24px", fontSize: 14 }}
              >
                {submitting ? "Recording…" : "Record Payment"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* PROMPT MODAL */}
      {promptSlot && (
        <div className="fm-modal-overlay">
          <div className="fm-modal" style={{ maxWidth: 380 }}>
            <h3>Add Charge</h3>
            <p className="fm-hint">This will be added to the student's bill as a charge — it will not be recorded as a payment.</p>
            <input
              type="number"
              min="1"
              autoFocus
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmPrompt()}
              disabled={promptConfirming}
              style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 6, marginTop: 12 }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button type="button" className="fm-secondary-btn" onClick={cancelPrompt} disabled={promptConfirming}>Cancel</button>
              <button type="button" className="fm-primary-btn" onClick={confirmPrompt} disabled={promptConfirming || !promptValue || Number(promptValue) <= 0}>
                {promptConfirming ? "Adding…" : `Add ₹${promptValue || 0}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <PrintManager active={!!receiptPopup} onClose={() => setReceiptPopup(null)} type="receipt">
        {receiptPopup && <ReceiptPrintSheet receipts={[receiptPopup]} />}
      </PrintManager>
    </div>
  );
}
