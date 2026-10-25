import React, { useState, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import {
  searchStudents, collectPayment, getStudentPaymentSummary, getStudentFeeProfile,
  addBooksFee, addPreviousYearBalance, addKitFee
} from "../firebase/feeService";
import ReceiptPrintSheet from "./ReceiptPrintSheet";
import PrintManager from "./PrintManager";
import "../styles/feeManagement.css";

const PAYMENT_METHODS = ["Cash", "UPI", "Bank Transfer", "Cheque", "Other"];
const ADDON_ROLES = ["superAdmin", "admin", "accountant"];

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

  // Add-on state
  const [addonBusy, setAddonBusy] = useState(false);
  const [addonMsg, setAddonMsg] = useState("");
  const [promptSlot, setPromptSlot] = useState(null);
  const [promptValue, setPromptValue] = useState("");
  const [promptConfirming, setPromptConfirming] = useState(false);

  const canManageAddons = ADDON_ROLES.includes(role);

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
      const safeId = String(studentId).replace(/[\/\\.\*\[\]:;]/g, "-");
      const billRef = doc(db, "monthlyBills", `${session}_${month}_${safeId}`);
      
      const [billSnap, summary] = await Promise.all([
        getDoc(billRef),
        getStudentPaymentSummary(studentId, session, month),
      ]);

      if (billSnap.exists()) {
        setBill({ id: billSnap.id, ...billSnap.data() });
      } else {
        setBill(null);
      }
      setSessionPaid(summary.sessionTotal);
    } catch (e) {
      setError(e.message);
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
      setError("Search failed.");
    } finally {
      setLoadingBill(false);
    }
  }

  async function selectStudent(student) {
    setSelectedStudent(student);
    setResults([]); // This clears the search list
    setSearchTerm(""); // Clears the search box
    setIdempotencyKey(uuidv4());
    setError(null);
    setForm(f => ({ ...f, amountReceived: "", discount: 0, lateFee: 0, remarks: "" }));
    await refreshAll(student.id);
  }

  function handleBack() {
    setSelectedStudent(null);
    setBill(null);
    setResults([]);
    setSearchTerm("");
    setError(null);
    setAddonMsg("");
  }

  function showFlash(msg) {
    setFlash(msg);
    setTimeout(() => setFlash(""), 1500);
  }

  // --- EXACT MATH FOR THE 4 BOXES ---
  const previousDue = bill ? (bill.previousDue || 0) : 0;
  const tuition = bill ? (bill.tuitionBilled || 0) : 0;
  const transport = bill ? (bill.transportBilled || 0) : 0;
  const devFee = bill ? (bill.devFeeBilled || 0) : 0;
  const books = bill ? (bill.booksBilled || 0) : 0;
  const prevYear = bill ? (bill.previousYearBilled || 0) : 0;
  const kit = bill ? (bill.kitFeeBilled || 0) : 0;

  const totalBilled = previousDue + tuition + transport + devFee + books + prevYear + kit;
  const dbCarryForward = bill ? (bill.carriedForward || 0) : 0;
  
  const effectivePaid = Math.max(totalBilled - dbCarryForward, 0);

  const enteredDiscount = Number(form.discount || 0);
  const enteredLateFee = Number(form.lateFee || 0);
  const amountAdd = Number(form.amountReceived || 0);

  const netBill = totalBilled - enteredDiscount + enteredLateFee;
  const finalBalance = Math.max(netBill - effectivePaid - amountAdd, 0);
  const liveSessionPaid = sessionPaid + amountAdd;

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting || !selectedStudent) return;

    setSubmitting(true);
    setError(null);
    
    const actualParticulars = [];
    if (previousDue > 0) actualParticulars.push({ label: "Previous Due", amount: previousDue });
    if (tuition > 0) actualParticulars.push({ label: "Tuition Fee", amount: tuition });
    if (transport > 0) actualParticulars.push({ label: "Transport Fee", amount: transport });
    if (devFee > 0) actualParticulars.push({ label: "Development Fee", amount: devFee });
    if (books > 0) actualParticulars.push({ label: "Books Fee", amount: books });
    if (prevYear > 0) actualParticulars.push({ label: "Previous Year", amount: prevYear });
    if (kit > 0) actualParticulars.push({ label: "Admission / Kit", amount: kit });

    try {
      const { receipt, duplicateBlocked } = await collectPayment({
        studentId: selectedStudent.id,
        session,
        month,
        idempotencyKey,
        ...form,
        amountReceived: amountAdd,
      });

      await refreshAll(selectedStudent.id);
      
      const enrichedReceipt = {
        ...receipt,
        particulars: actualParticulars,
        totalDue: netBill,
        remainingDue: finalBalance,
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

  // --- ADD-ON LOGIC ---
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

      showFlash(`✅ ${label} ₹${amount} added`);
      await refreshAll(selectedStudent.id);
      setAddonMsg(res.duplicateBlocked ? "Already recorded." : `${label} ₹${amount} added.`);
    } catch (e) {
      setAddonMsg(`❌ ${e.message}`);
    } finally {
      setAddonBusy(false);
    }
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
      if (promptSlot === "books") await handleAddon(addBooksFee, amt, "Books");
      else if (promptSlot === "previousYear") await handleAddon(addPreviousYearBalance, amt, "Previous Year Balance");
      else if (promptSlot === "kit") await handleAddon(addKitFee, amt, "Admission / Kit");
      cancelPrompt();
    } catch (e) {
      setPromptConfirming(false);
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
          disabled={!!selectedStudent} // Disable search if a student is selected
        />
        <button type="submit" disabled={!!selectedStudent}>Search</button>
      </form>

      {results.length > 0 && !selectedStudent && (
        <ul className="fm-result-list fm-result-list-compact" style={{ margin: 0, padding: 0 }}>
          {results.map((s) => (
            <li key={s.id} onClick={() => selectStudent(s)} style={{ padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid #e2e8f0" }}>
              <strong style={{ color: "#1e293b" }}>{s.name}</strong> 
              <span style={{ color: "#64748b", marginLeft: 8 }}>— Adm# {s.admissionNumber} — Class {s.className}</span>
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
            <button type="button" className="fm-secondary-btn" onClick={handleBack}>
              ← Back
            </button>
          </div>

          {loadingBill && <p className="fm-subtle">Loading bill…</p>}

          {!loadingBill && !bill && (
            <div style={{ padding: 16, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, marginTop: 16 }}>
              <p style={{ margin: 0, color: "#991b1b", fontWeight: 600 }}>No bill generated for {month}.</p>
            </div>
          )}

          {bill && (
            <div className="fm-bill-two-col fm-bill-two-col-compact" style={{ background: "#f8fafc", padding: 16, borderRadius: 8, marginTop: 16 }}>
              
              <div className="fm-bill-left" style={{ flex: 1 }}>
                <h4 style={{ color: "#475569", textTransform: "uppercase", fontSize: 12, marginBottom: 12 }}>Current Bill Breakdown</h4>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    {previousDue > 0 && (
                      <tr style={{ color: "#dc2626" }}>
                        <td style={{ padding: "4px 0" }}>Previous Due</td>
                        <td align="right">₹{previousDue}</td>
                      </tr>
                    )}
                    <tr>
                      <td style={{ padding: "4px 0" }}>Tuition Fee</td>
                      <td align="right">₹{tuition}</td>
                    </tr>
                    {transport > 0 && (
                      <tr>
                        <td style={{ padding: "4px 0" }}>Transport Fee</td>
                        <td align="right">₹{transport}</td>
                      </tr>
                    )}
                    {devFee > 0 && (
                      <tr>
                        <td style={{ padding: "4px 0" }}>Development Fee</td>
                        <td align="right">₹{devFee}</td>
                      </tr>
                    )}
                    {books > 0 && (
                      <tr>
                        <td style={{ padding: "4px 0" }}>Books Fee</td>
                        <td align="right">₹{books}</td>
                      </tr>
                    )}
                    {prevYear > 0 && (
                      <tr>
                        <td style={{ padding: "4px 0" }}>Previous Year</td>
                        <td align="right">₹{prevYear}</td>
                      </tr>
                    )}
                    {kit > 0 && (
                      <tr>
                        <td style={{ padding: "4px 0" }}>Kit Fee</td>
                        <td align="right">₹{kit}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="fm-bill-right" style={{ flex: 1, paddingLeft: 20, borderLeft: "1px solid #e2e8f0" }}>
                
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748b", marginBottom: 16 }}>
                  <span>Session Paid (Till Date)</span>
                  <strong style={{ color: "#16a34a" }}>₹{liveSessionPaid}</strong>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  
                  <div style={{ background: "#fff", padding: 12, borderRadius: 6, border: "1px solid #e2e8f0" }}>
                    <span style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Total Billed</span>
                    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>₹{totalBilled}</div>
                  </div>

                  <div style={{ background: "#fff", padding: 12, borderRadius: 6, border: "1px solid #e2e8f0" }}>
                    <span style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Paid (This Month)</span>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#16a34a", marginTop: 4 }}>₹{effectivePaid}</div>
                  </div>

                  <div style={{ background: "#fff", padding: 12, borderRadius: 6, border: "1px solid #e2e8f0" }}>
                    <span style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Amount Entered</span>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#2563eb", marginTop: 4 }}>₹{amountAdd}</div>
                  </div>

                  <div style={{ background: "#fef2f2", padding: 12, borderRadius: 6, border: "1px solid #fecaca" }}>
                    <span style={{ fontSize: 10, color: "#991b1b", fontWeight: 600, textTransform: "uppercase" }}>Current Balance</span>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#dc2626", marginTop: 4 }}>₹{finalBalance}</div>
                  </div>
                  
                </div>
              </div>
            </div>
          )}

          {bill && (
            <form onSubmit={handleSubmit} className="fm-payment-form fm-payment-form-compact" style={{ marginTop: 24 }}>
              <label>Fee Type
                <select value={form.feeType} onChange={(e) => setForm({ ...form, feeType: e.target.value })}>
                  {["Tuition Fee", "Examination Fee", "Computer Fee", "Library Fee", "Activity Fee", "Other Charges"].map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>

              <label>Amount Received (₹) *
                <input type="number" required min="0" value={form.amountReceived} onChange={(e) => setForm({ ...form, amountReceived: e.target.value })} />
              </label>

              <label>Payment Date
                <input type="date" value={form.paymentDate} onChange={(e) => setForm({ ...form, paymentDate: e.target.value })} />
              </label>

              <label>Payment Method
                <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
                  {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
                </select>
              </label>

              <label>Transaction / Ref No.
                <input type="text" value={form.referenceNumber} onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })} />
              </label>

              <label>Discount (₹)
                <input type="number" min="0" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} />
              </label>

              <label>Late Fee (₹)
                <input type="number" min="0" value={form.lateFee} onChange={(e) => setForm({ ...form, lateFee: e.target.value })} />
              </label>
            </form>
          )}

          {error && <p className="fm-error" style={{ marginTop: 12 }}>{error}</p>}
          {addonMsg && <p className="fm-addon-msg">{addonMsg}</p>}

          {bill && (
            <div className="fm-action-row" style={{ marginTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              
              {/* RESTORED ADD-ON BUTTONS */}
              {canManageAddons && (
                <div className="fm-action-addons" style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="fm-addon-btn" disabled={addonBusy} onClick={() => promptForAmount("books")}>
                    📚 + Books
                  </button>
                  <button type="button" className="fm-addon-btn" disabled={addonBusy} onClick={() => promptForAmount("previousYear")}>
                    📜 + Prev Year
                  </button>
                  <button type="button" className="fm-addon-btn" disabled={addonBusy} onClick={() => promptForAmount("kit")}>
                    👕 + Kit
                  </button>
                </div>
              )}

              <div className="fm-action-buttons" style={{ marginLeft: "auto" }}>
                <button type="submit" disabled={submitting || !bill} className="fm-primary-btn" onClick={handleSubmit}>
                  {submitting ? "Recording…" : "Record Payment"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ADD-ON AMOUNT PROMPT MODAL */}
      {promptSlot && (
        <div className="fm-modal-overlay">
          <div className="fm-modal" style={{ maxWidth: 380 }}>
            <h3>
              {promptSlot === "books" && "Add Books Fee"}
              {promptSlot === "previousYear" && "Add Previous Year Balance"}
              {promptSlot === "kit" && "Add Admission / Kit Fee"}
            </h3>
            <p style={{ margin: "12px 0", fontSize: 14, color: "#4b5563" }}>Enter the amount in ₹</p>
            <input
              type="number"
              min="1"
              autoFocus
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmPrompt()}
              disabled={promptConfirming}
              style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 6, fontSize: 15 }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button type="button" className="fm-secondary-btn" onClick={cancelPrompt} disabled={promptConfirming}>
                Cancel
              </button>
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
