import React, { useState, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  searchStudents, collectPayment, getMonthlyBill, getStudentPaymentSummary, getStudentFeeProfile,
} from "../firebase/feeService";
import ReceiptPrintSheet from "./ReceiptPrintSheet";
import PrintManager from "./PrintManager";
import "../styles/feeManagement.css";

const PAYMENT_METHODS = ["Cash", "UPI", "Bank Transfer", "Cheque", "Other"];

export default function FeeCollection({ session, month, role, initialStudentId, onReceiptGenerated }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [bill, setBill] = useState(null);
  const [sessionPaid, setSessionPaid] = useState(0);
  const [loadingBill, setLoadingBill] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState(null);
  const [flash, setFlash] = useState("");
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

  useEffect(() => {
    if (initialStudentId) {
      getStudentFeeProfile(initialStudentId).then(s => {
        setSelectedStudent(s);
        refreshAll(s.id);
      }).catch(err => setError(err.message));
    }
  }, [initialStudentId]);

  async function refreshAll(studentId) {
    setLoadingBill(true);
    try {
      const [b, summary] = await Promise.all([
        getMonthlyBill(session, month, studentId),
        getStudentPaymentSummary(studentId, session, month),
      ]);
      setBill(b);
      setSessionPaid(summary.sessionTotal);
      return b;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setLoadingBill(false);
    }
  }

  async function handleSearch(e) {
    if (e) e.preventDefault();
    if (!searchTerm.trim()) return;
    setError(null);
    setLoadingBill(true);
    try {
      const found = await searchStudents(searchTerm.trim());
      setResults(found);
    } catch (err) {
      setError("Search failed. Please try again.");
    } finally {
      setLoadingBill(false);
    }
  }

  // FIXED: Ensure this fires properly and clears search results
  async function selectStudent(student, e) {
    if (e) e.preventDefault();
    
    // 1. Immediately set the student
    setSelectedStudent(student);
    setResults([]); // Clear search results so UI updates
    setIdempotencyKey(uuidv4());
    setError(null);

    // 2. Reset form just in case
    setForm(f => ({ ...f, amountReceived: "", discount: 0, lateFee: 0, remarks: "" }));

    // 3. Load the bill
    await refreshAll(student.id);
  }

  function showFlash(msg) {
    setFlash(msg);
    setTimeout(() => setFlash(""), 1500);
  }

  // --- DYNAMIC REAL-TIME MATH ---
  const baseBill = bill ? (bill.totalDue || 0) : 0;
  const alreadyPaid = bill ? (bill.totalPaid || 0) : 0;
  
  const enteredDiscount = Number(form.discount || 0);
  const enteredLateFee = Number(form.lateFee || 0);
  const amountAdd = Number(form.amountReceived || 0);
  
  const grossBill = bill ? ((bill.previousDue || 0) + (bill.tuitionBilled || 0) + (bill.transportBilled || 0) + (bill.devFeeBilled || 0)) : 0;
  const displayTotal = grossBill - enteredDiscount + enteredLateFee;
  const displayBalance = Math.max(displayTotal - alreadyPaid - amountAdd, 0);

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
        amountReceived: amountAdd,
      });

      const freshBill = await refreshAll(selectedStudent.id);
      
      const enrichedReceipt = {
        ...receipt,
        totalDue: displayTotal,
        remainingDue: displayBalance,
        previousDue: freshBill?.previousDue || 0,
      };

      onReceiptGenerated?.(enrichedReceipt, duplicateBlocked);
      showFlash("✅ Payment Successful");
      setReceiptPopup(enrichedReceipt);
      setIdempotencyKey(uuidv4());
      setForm(f => ({ ...f, amountReceived: "", referenceNumber: "", discount: 0, lateFee: 0, remarks: "" }));
    } catch (err) {
      setError(err.message || "Payment could not be recorded.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fm-card fm-collect-compact" style={{ paddingBottom: 40 }}>
      <div className="fm-collect-header">
        <h2>Collect Fee</h2>
        <span className="fm-subtle">Billing month: <strong>{month}</strong></span>
      </div>

      {flash && <div className="fm-flash">{flash}</div>}

      <form onSubmit={handleSearch} className="fm-search-row" style={{ marginBottom: 8 }}>
        <input 
          type="text" 
          placeholder="Search by name or admission no." 
          value={searchTerm} 
          onChange={(e) => setSearchTerm(e.target.value)} 
        />
        <button type="submit">Search</button>
      </form>

      {/* FIX: Ensure the onClick passes the event and student correctly */}
      {results.length > 0 && !selectedStudent && (
        <ul className="fm-result-list fm-result-list-compact" style={{ margin: 0, padding: 0 }}>
          {results.map((s) => (
            <li 
              key={s.id} 
              onClick={(e) => selectStudent(s, e)}
              style={{ padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid #e2e8f0" }}
            >
              <strong style={{ color: "#1e293b" }}>{s.name}</strong> 
              <span style={{ color: "#64748b", marginLeft: 8 }}>
                — Adm# {s.admissionNumber} — Class {s.className}
              </span>
            </li>
          ))}
        </ul>
      )}

      {selectedStudent && (
        <>
          <div className="fm-student-header fm-student-header-compact" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
            <div>
              <h3 style={{ margin: 0, color: "#1e293b" }}>{selectedStudent.name}</h3>
              <p style={{ margin: "4px 0 0", color: "#64748b" }}>Adm# {selectedStudent.admissionNumber} · Class {selectedStudent.className}</p>
            </div>
            <button 
              type="button" 
              className="fm-secondary-btn" 
              onClick={() => { setSelectedStudent(null); setBill(null); setSearchTerm(""); }}
            >
              Change Student
            </button>
          </div>

          {loadingBill && <p className="fm-subtle">Loading bill…</p>}

          {!loadingBill && !bill && (
            <div style={{ padding: 16, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, marginTop: 16 }}>
              <p style={{ margin: 0, color: "#991b1b", fontWeight: 600 }}>No bill generated for {month}.</p>
              <p style={{ margin: "4px 0 0", color: "#991b1b", fontSize: 13 }}>Please go to Settings → Start New Month to generate the bill before collecting payment.</p>
            </div>
          )}

          {bill && (
            <div className="fm-bill-two-col fm-bill-two-col-compact" style={{ background: "#f8fafc", padding: 16, borderRadius: 8, marginTop: 16 }}>
              <div className="fm-bill-left" style={{ flex: 1 }}>
                <h4 style={{ color: "#475569", textTransform: "uppercase", fontSize: 12, marginBottom: 12 }}>Current Bill Breakdown</h4>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    {bill.previousDue > 0 && (
                      <tr style={{ color: "#dc2626" }}>
                        <td style={{ padding: "4px 0" }}>Previous Due</td>
                        <td align="right">₹{bill.previousDue}</td>
                      </tr>
                    )}
                    <tr>
                      <td style={{ padding: "4px 0" }}>Tuition Fee</td>
                      <td align="right">₹{bill.tuitionBilled || 0}</td>
                    </tr>
                    {bill.transportBilled > 0 && (
                      <tr>
                        <td style={{ padding: "4px 0" }}>Transport Fee</td>
                        <td align="right">₹{bill.transportBilled}</td>
                      </tr>
                    )}
                    {bill.devFeeBilled > 0 && (
                      <tr>
                        <td style={{ padding: "4px 0" }}>Development Fee</td>
                        <td align="right">₹{bill.devFeeBilled}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="fm-bill-right" style={{ flex: 1, paddingLeft: 20, borderLeft: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748b", marginBottom: 16 }}>
                  <span>Session Paid (Till Date)</span>
                  <strong style={{ color: "#16a34a" }}>₹{sessionPaid}</strong>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ background: "#fff", padding: 12, borderRadius: 6, border: "1px solid #e2e8f0" }}>
                    <span style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Total Billed</span>
                    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>₹{displayTotal}</div>
                  </div>
                  <div style={{ background: "#fff", padding: 12, borderRadius: 6, border: "1px solid #e2e8f0" }}>
                    <span style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Paid (This Month)</span>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#16a34a", marginTop: 4 }}>₹{alreadyPaid}</div>
                  </div>
                  <div style={{ background: "#fff", padding: 12, borderRadius: 6, border: "1px solid #e2e8f0" }}>
                    <span style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Amount Entered</span>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#2563eb", marginTop: 4 }}>₹{amountAdd}</div>
                  </div>
                  <div style={{ background: "#fef2f2", padding: 12, borderRadius: 6, border: "1px solid #fecaca" }}>
                    <span style={{ fontSize: 10, color: "#991b1b", fontWeight: 600, textTransform: "uppercase" }}>Current Balance</span>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#dc2626", marginTop: 4 }}>₹{displayBalance}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {bill && (
            <form onSubmit={handleSubmit} className="fm-payment-form fm-payment-form-compact" style={{ marginTop: 24 }}>
              <label>
                Fee Type
                <select value={form.feeType} onChange={(e) => setForm({ ...form, feeType: e.target.value })}>
                  {["Tuition Fee", "Examination Fee", "Computer Fee", "Library Fee", "Activity Fee", "Other Charges"].map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>

              <label>
                Amount Received (₹) *
                <input type="number" required min="0" value={form.amountReceived} onChange={(e) => setForm({ ...form, amountReceived: e.target.value })} />
              </label>

              <label>
                Payment Date
                <input type="date" value={form.paymentDate} onChange={(e) => setForm({ ...form, paymentDate: e.target.value })} />
              </label>

              <label>
                Payment Method
                <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
                  {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
                </select>
              </label>

              <label>
                Transaction / Reference No.
                <input type="text" value={form.referenceNumber} onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })} />
              </label>

              <label>
                Discount (₹)
                <input type="number" min="0" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} />
              </label>

              <label>
                Late Fee (₹)
                <input type="number" min="0" value={form.lateFee} onChange={(e) => setForm({ ...form, lateFee: e.target.value })} />
              </label>
            </form>
          )}

          {error && <p className="fm-error" style={{ marginTop: 12 }}>{error}</p>}

          {bill && (
            <div className="fm-action-row" style={{ marginTop: 24 }}>
              <div className="fm-action-buttons" style={{ marginLeft: "auto" }}>
                <button type="submit" disabled={submitting || !bill} className="fm-primary-btn" onClick={handleSubmit}>
                  {submitting ? "Recording…" : "Record Payment"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <PrintManager active={!!receiptPopup} onClose={() => setReceiptPopup(null)} type="receipt">
        {receiptPopup && <ReceiptPrintSheet receipts={[receiptPopup]} />}
      </PrintManager>
    </div>
  );
}
