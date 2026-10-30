import React, { useState, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { doc, getDoc } from "firebase/firestore";
import { db, auth } from "../firebase/config";
import {
  searchStudents, collectPayment, getMonthlyBill, getStudentPaymentSummary, getStudentFeeProfile,
  addBooksFee, addPreviousYearBalance, addKitFee, getPaymentHistory, deleteTransaction, getUserRole,
  editTransaction, repairStudentHistory, editBillDirect
} from "../firebase/feeService";
import ReceiptPrintSheet from "./ReceiptPrintSheet";
import StudentPrintPage from "./StudentPrintPage";
import LedgerPrintSheet from "./LedgerPrintSheet";
import PrintManager from "./PrintManager";
import "../styles/feeManagement.css";

const PAYMENT_METHODS = ["Cash", "UPI", "Bank Transfer", "Cheque", "Other"];
const ADDON_ROLES = ["superAdmin", "admin", "accountant"];

export default function FeeCollection({ session, month, role, initialStudentId }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [bill, setBill] = useState(null);
  const [history, setHistory] = useState([]);
  
  const [loadingBill, setLoadingBill] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [error, setError] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState(null);
  const [flash, setFlash] = useState("");
  const [receiptPopup, setReceiptPopup] = useState(null);
  
  const [userRole, setUserRole] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [editingTxn, setEditingTxn] = useState(null);

  const [printingStudent, setPrintingStudent] = useState(null);
  const [printLedger, setPrintLedger] = useState(false);
  const [showAllTransactions, setShowAllTransactions] = useState(false);

  const [addonBusy, setAddonBusy] = useState(false);
  const [addonMsg, setAddonMsg] = useState("");
  const [promptSlot, setPromptSlot] = useState(null);
  const [promptValue, setPromptValue] = useState("");
  const [promptDate, setPromptDate] = useState(new Date().toISOString().slice(0, 10));
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
    if (auth.currentUser) {
      getUserRole(auth.currentUser.uid).then(r => setUserRole(r?.role || null));
    }
  }, []);

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
      
      const [billSnap, hist] = await Promise.all([
        getDoc(billRef),
        getPaymentHistory(studentId),
      ]);

      if (billSnap.exists()) {
        setBill({ id: billSnap.id, ...billSnap.data() });
      } else {
        setBill(null);
      }
      setHistory(hist || []); 
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingBill(false);
    }
  }

  async function handleSearch(e) {
    if (e) e.preventDefault();
    const term = searchTerm.trim();
    if (!term) return;
    
    if (!/^\d+$/.test(term) && term.length < 3) {
      setError("Please enter at least 3 characters for a name search, or a valid Admission No.");
      return;
    }
    
    setError(null);
    setLoadingBill(true);
    try {
      const found = await searchStudents(term);
      setResults(found);
    } catch (err) {
      setError("Search failed.");
    } finally {
      setLoadingBill(false);
    }
  }

  async function selectStudent(student) {
    setSelectedStudent(student);
    setResults([]);
    setSearchTerm("");
    setIdempotencyKey(uuidv4());
    setError(null);
    setShowAllTransactions(false); 
    setForm(f => ({ ...f, amountReceived: "", discount: 0, lateFee: 0, remarks: "" }));
    await refreshAll(student.id);
  }

  function handleBack() {
    setSelectedStudent(null);
    setBill(null);
    setHistory([]);
    setResults([]);
    setSearchTerm("");
    setError(null);
    setAddonMsg("");
    setEditingTxn(null);
    setShowAllTransactions(false);
  }

  function showFlash(msg) {
    setFlash(msg);
    setTimeout(() => setFlash(""), 1500);
  }

  function formatDate(t) {
    let dateObj = t.paymentDate || t.createdAt;
    if (!dateObj) return "—";
    try {
      let d = dateObj.seconds ? new Date(dateObj.seconds * 1000) : (dateObj.toDate ? dateObj.toDate() : new Date(dateObj));
      if (isNaN(d.getTime())) return "—";
      return d.toLocaleDateString("en-GB", { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return "—"; }
  }

  const previousDue = bill ? (bill.previousDue || 0) : 0;
  const tuition = bill ? (bill.tuitionBilled || 0) : 0;
  const transport = bill ? (bill.transportBilled || 0) : 0;
  const devFee = bill ? (bill.devFeeBilled || 0) : 0;
  const books = bill ? (bill.booksBilled || 0) : 0;
  const prevYear = bill ? (bill.previousYearBilled || 0) : 0;
  const kit = bill ? (bill.kitFeeBilled || 0) : 0;

  const totalBilled = previousDue + tuition + transport + devFee + books + prevYear + kit;
  
  let totalCashPaid = 0;
  let totalDiscountGiven = 0;
  history.forEach(t => {
    if (t.session === session && t.voided !== true && (!t.componentType || t.componentType === "monthly")) {
      totalCashPaid += Number(t.amountReceived || t.netAmount || 0);
      totalDiscountGiven += Number(t.discount || 0);
    }
  });

  const enteredDiscount = Number(form.discount || 0);
  const amountAdd = Number(form.amountReceived || 0);

  const finalBalance = Math.max(totalBilled - totalCashPaid - totalDiscountGiven - amountAdd - enteredDiscount, 0);
  const liveSessionPaid = totalCashPaid + amountAdd;

  const calculatedHistory = history.map((t) => {
    return {
      ...t,
      snapshotTotalDue: t.totalDue || 0, 
      runningBalance: t.remainingDue !== undefined ? t.remainingDue : 0,
    };
  });

  const visibleHistory = showAllTransactions ? calculatedHistory : calculatedHistory.slice(0, 5);

  async function handleSubmit(e) {
    if (e) e.preventDefault();
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
        totalDue: totalBilled,
        remainingDue: finalBalance,
      };

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

  async function handleDeleteTransaction(txn) {
    const ok = window.confirm(`Are you sure you want to DELETE this transaction?\n\nAmount: ₹${txn.amountReceived || txn.netAmount || txn.addOnAmount || 0}\nDate: ${formatDate(txn)}\n\nThis cannot be undone.`);
    if (!ok) return;

    setDeletingId(txn.id);
    setError(null);
    try {
      await deleteTransaction(txn.id, "Deleted from Collect Fee panel");
      showFlash("✅ Transaction deleted successfully.");
      await refreshAll(selectedStudent.id);
    } catch (err) {
      setError(`❌ Failed to delete: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    if (!editingTxn) return;
    
    try {
      const isAddOn = editingTxn.componentType !== "monthly" && editingTxn.componentType !== "refund";

      await editTransaction({
        transactionId: editingTxn.id,
        newAmount: editingTxn.amountReceived,
        newDiscount: editingTxn.discount,
        newPaymentDate: editingTxn.paymentDate,
        newAddOnAmount: isAddOn ? editingTxn.addOnAmount : undefined
      });
      showFlash("✅ Transaction updated");
      setEditingTxn(null);
      await refreshAll(selectedStudent.id);
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  }

  async function handleViewReceipt(txn) {
    let latestReceipt = txn;
    if (txn.receiptRef) {
      try {
        const snap = await getDoc(doc(db, "receipts", txn.receiptRef));
        if (snap.exists()) {
          latestReceipt = { ...txn, ...snap.data() };
        }
      } catch(e) { console.error("Error fetching receipt", e); }
    }

    setReceiptPopup({
      ...latestReceipt,
      studentName: selectedStudent?.name,
      admissionNumber: selectedStudent?.admissionNumber,
      className: selectedStudent?.className,
      guardianName: selectedStudent?.guardianName || selectedStudent?.fatherName,
      totalDue: txn.snapshotTotalDue,
      remainingDue: txn.runningBalance,
    });
  }

  function promptForAmount(slot) { 
    setPromptSlot(slot); 
    setPromptValue(""); 
    setPromptDate(new Date().toISOString().slice(0, 10)); 
    setPromptConfirming(false); 
  }
  
  function cancelPrompt() { setPromptSlot(null); setPromptValue(""); setPromptConfirming(false); }

  async function handleAddon(fn, amount, label, date) {
    setAddonBusy(true); setAddonMsg("");
    try {
      const res = await fn({ studentId: selectedStudent.id, amount, session, month, paymentDate: new Date(date).toISOString(), idempotencyKey: uuidv4() });
      showFlash(`✅ ${label} ₹${amount} added`);
      await refreshAll(selectedStudent.id);
      setAddonMsg(res.duplicateBlocked ? "Already recorded." : `${label} ₹${amount} added.`);
    } catch (e) { setAddonMsg(`❌ ${e.message}`); } finally { setAddonBusy(false); }
  }

  async function confirmPrompt() {
    if (promptConfirming) return;
    const amt = Number(promptValue);
    if (!amt || amt <= 0) { setAddonMsg("Please enter a valid amount."); return; }
    if (!promptDate) { setAddonMsg("Please select a date."); return; }
    setPromptConfirming(true);
    try {
      if (promptSlot === "books") await handleAddon(addBooksFee, amt, "Books", promptDate);
      else if (promptSlot === "previousYear") await handleAddon(addPreviousYearBalance, amt, "Previous Year Balance", promptDate);
      else if (promptSlot === "kit") await handleAddon(addKitFee, amt, "Admission / Kit", promptDate);
      cancelPrompt();
    } catch (e) { setPromptConfirming(false); }
  }

  return (
    <div className="fm-card fm-collect-compact" style={{ paddingBottom: 40 }}>
      <div className="fm-collect-header">
        <h2>Collect Fee</h2>
        <span className="fm-subtle">Billing month: <strong>{month}</strong></span>
      </div>

      {flash && <div className="fm-flash">{flash}</div>}

      {!selectedStudent && (
        <form onSubmit={handleSearch} className="fm-search-row" style={{ marginBottom: 8 }}>
          <input type="text" placeholder="Search by name, parent name, mobile, or Admission No." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          <button type="submit">Search</button>
        </form>
      )}

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
          <div className="fm-card" style={{ marginBottom: 16, padding: 16, background: "#f8fafc" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, color: "#1e293b", fontSize: 18 }}>{selectedStudent.name}</h3>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="fm-secondary-btn" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setPrintingStudent(selectedStudent)}>
                  🖨 Print Profile
                </button>
                <button type="button" className="fm-secondary-btn" onClick={handleBack}>← Back</button>
              </div>
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, fontSize: 13 }}>
              <div><span style={{ color: "#64748b", fontSize: 11, display: "block" }}>ADMISSION NO</span><strong>{selectedStudent.admissionNumber}</strong></div>
              <div><span style={{ color: "#64748b", fontSize: 11, display: "block" }}>CLASS</span><strong>{selectedStudent.className}</strong></div>
              <div><span style={{ color: "#64748b", fontSize: 11, display: "block" }}>ROLL NO</span><strong>{selectedStudent.rollNumber || "—"}</strong></div>
              <div><span style={{ color: "#64748b", fontSize: 11, display: "block" }}>STATUS</span><strong style={{ color: "#16a34a" }}>{selectedStudent.accountStatus || "ACTIVE"}</strong></div>
              <div><span style={{ color: "#64748b", fontSize: 11, display: "block" }}>FATHER'S NAME</span><strong>{selectedStudent.fatherName || "—"}</strong></div>
              <div><span style={{ color: "#64748b", fontSize: 11, display: "block" }}>MOTHER'S NAME</span><strong>{selectedStudent.motherName || "—"}</strong></div>
              <div><span style={{ color: "#64748b", fontSize: 11, display: "block" }}>MOBILE</span><strong>{selectedStudent.mobileNumber || "—"}</strong></div>
              <div><span style={{ color: "#64748b", fontSize: 11, display: "block" }}>GUARDIAN</span><strong>{selectedStudent.guardianName || "—"}</strong></div>
            </div>
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h4 style={{ color: "#475569", textTransform: "uppercase", fontSize: 12, margin: 0 }}>Current Bill Breakdown</h4>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    {previousDue > 0 && <tr style={{ color: "#dc2626" }}><td style={{ padding: "4px 0" }}>Previous Due</td><td align="right">₹{previousDue}</td></tr>}
                    <tr><td style={{ padding: "4px 0" }}>Tuition Fee</td><td align="right">₹{tuition}</td></tr>
                    {transport > 0 && <tr><td style={{ padding: "4px 0" }}>Transport Fee</td><td align="right">₹{transport}</td></tr>}
                    {devFee > 0 && <tr><td style={{ padding: "4px 0" }}>Development Fee</td><td align="right">₹{devFee}</td></tr>}
                    {books > 0 && <tr><td style={{ padding: "4px 0" }}>Books Fee</td><td align="right">₹{books}</td></tr>}
                    {prevYear > 0 && <tr><td style={{ padding: "4px 0" }}>Previous Year</td><td align="right">₹{prevYear}</td></tr>}
                    {kit > 0 && <tr><td style={{ padding: "4px 0" }}>Kit Fee</td><td align="right">₹{kit}</td></tr>}
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
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#16a34a", marginTop: 4 }}>₹{totalCashPaid}</div>
                  </div>

                  <div style={{ background: "#fff", padding: 12, borderRadius: 6, border: "1px solid #e2e8f0" }}>
                    <span style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Discount Given</span>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#059669", marginTop: 4 }}>₹{enteredDiscount}</div>
                    {totalDiscountGiven > 0 && (
                      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                        (Past discounts: ₹{totalDiscountGiven})
                      </div>
                    )}
                  </div>

                  <div style={{ background: "#fff", padding: 12, borderRadius: 6, border: "1px solid #e2e8f0" }}>
                    <span style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Amount Entered</span>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#2563eb", marginTop: 4 }}>₹{amountAdd}</div>
                  </div>

                  <div style={{ background: "#fef2f2", padding: 12, borderRadius: 6, border: "1px solid #fecaca", gridColumn: "1 / -1" }}>
                    <span style={{ fontSize: 10, color: "#991b1b", fontWeight: 600, textTransform: "uppercase" }}>Current Balance</span>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#dc2626", marginTop: 4 }}>₹{finalBalance}</div>
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
              
              {canManageAddons && (
                <div className="fm-action-addons" style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="fm-addon-btn" disabled={addonBusy} onClick={() => promptForAmount("books")}>📚 + Books</button>
                  <button type="button" className="fm-addon-btn" disabled={addonBusy} onClick={() => promptForAmount("previousYear")}>📜 + Prev Year</button>
                  <button type="button" className="fm-addon-btn" disabled={addonBusy} onClick={() => promptForAmount("kit")}>👕 + Kit</button>
                </div>
              )}

              <div className="fm-action-buttons" style={{ marginLeft: "auto" }}>
                <button type="submit" disabled={submitting || !bill} className="fm-primary-btn" onClick={handleSubmit}>
                  {submitting ? "Recording…" : "Record Payment"}
                </button>
              </div>
            </div>
          )}

          <div style={{ marginTop: 40, borderTop: "1px solid #e2e8f0", paddingTop: 20 }}>
            
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>Student Transaction History</h3>
              <div style={{ display: "flex", gap: 8 }}>
                {history.length > 0 && (
                  <button type="button" className="fm-primary-btn" style={{ padding: "8px 16px" }} onClick={() => setPrintLedger(true)}>
                    🖨️ Print Ledger
                  </button>
                )}
              </div>
            </div>

            {calculatedHistory.length === 0 ? (
              <p className="fm-empty-state">No transactions recorded yet for this student.</p>
            ) : (
              <>
                <div className="fm-table-scroll">
                  <table className="fm-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Receipt#</th>
                        <th>Total Bill</th>
                        <th>Amount Paid / Add-on</th>
                        <th>Discount</th>
                        <th>Balance Due</th>
                        <th>Method</th>
                        <th style={{ textAlign: "center" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleHistory.map((t, idx) => {
                        const isAddon = t.componentType && t.componentType !== "monthly" && t.componentType !== "refund";
                        return (
                        <tr key={t.id || idx}>
                          <td>{formatDate(t)}</td>
                          <td>{t.receiptNumber || "—"}</td>
                          <td style={{ fontWeight: 600 }}>₹{t.snapshotTotalDue || 0}</td>
                          <td style={{ color: isAddon ? "#2563eb" : "#16a34a", fontWeight: 600 }}>
                            {isAddon ? `₹${t.addOnAmount || 0} (Add-on)` : `₹${t.amountReceived || t.netAmount || 0}`}
                          </td>
                          <td style={{ color: "#059669" }}>{t.discount > 0 ? `-₹${t.discount}` : "—"}</td>
                          <td className={t.runningBalance > 0 ? "fm-due-cell" : ""} style={{ fontWeight: 600 }}>
                            ₹{t.runningBalance}
                          </td>
                          <td>{t.paymentMethod || "Cash"}</td>
                          <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                            
                            <button type="button" title="View Receipt" className="fm-icon-btn" style={{ marginRight: 6 }} onClick={() => handleViewReceipt(t)}>
                              👁️
                            </button>

                            <button type="button" title="Print Receipt" className="fm-icon-btn" style={{ marginRight: 6 }} onClick={() => handleViewReceipt(t)}>
                              🖨️
                            </button>

                            {userRole === "superAdmin" && (
                              <>
                                <button type="button" title="Edit" className="fm-icon-btn" style={{ marginRight: 6 }} onClick={() => setEditingTxn({...t, paymentDate: new Date(t.paymentDate?.seconds ? t.paymentDate.seconds * 1000 : t.paymentDate).toISOString().slice(0, 10)})}>
                                  ✏️
                                </button>
                                
                                <button type="button" title="Delete" className="fm-icon-btn fm-danger-link" onClick={() => handleDeleteTransaction(t)} disabled={deletingId === t.id}>
                                  {deletingId === t.id ? "⏳" : "🗑️"}
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
                {calculatedHistory.length > 5 && (
                  <div style={{ textAlign: "center", marginTop: 12 }}>
                    <button type="button" className="fm-secondary-btn" onClick={() => setShowAllTransactions(!showAllTransactions)}>
                      {showAllTransactions ? "Show First 5 Transactions" : `View All (${calculatedHistory.length}) Transactions`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {promptSlot && (
        <div className="fm-modal-overlay">
          <div className="fm-modal" style={{ maxWidth: 380 }}>
            <h3>{promptSlot === "books" && "Add Books Fee"}{promptSlot === "previousYear" && "Add Previous Year Balance"}{promptSlot === "kit" && "Add Admission / Kit Fee"}</h3>
            <p style={{ margin: "12px 0 4px", fontSize: 14, color: "#4b5563" }}>Enter the amount in ₹</p>
            <input type="number" min="1" autoFocus value={promptValue} onChange={(e) => setPromptValue(e.target.value)} disabled={promptConfirming} style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 6, fontSize: 15, marginBottom: 12 }} />
            
            <p style={{ margin: "0 0 4px", fontSize: 14, color: "#4b5563" }}>Date billed</p>
            <input type="date" required value={promptDate} onChange={(e) => setPromptDate(e.target.value)} disabled={promptConfirming} style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 6, fontSize: 15 }} />

            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button type="button" className="fm-secondary-btn" onClick={cancelPrompt} disabled={promptConfirming}>Cancel</button>
              <button type="button" className="fm-primary-btn" onClick={confirmPrompt} disabled={promptConfirming || !promptValue || Number(promptValue) <= 0 || !promptDate}>{promptConfirming ? "Adding…" : `Add ₹${promptValue || 0}`}</button>
            </div>
          </div>
        </div>
      )}

      {editingTxn && (
        <div className="fm-modal-overlay">
          <div className="fm-modal" style={{ maxWidth: 400 }}>
            <h3>Edit Transaction — {editingTxn.receiptNumber}</h3>
            <form onSubmit={handleEditSubmit}>
              
              {editingTxn.componentType && editingTxn.componentType !== "monthly" && editingTxn.componentType !== "refund" ? (
                <label className="fm-inline-label" style={{ marginBottom: 12 }}>
                  Add-on Amount (₹)
                  <input type="number" value={editingTxn.addOnAmount} onChange={(e) => setEditingTxn({ ...editingTxn, addOnAmount: e.target.value })} />
                </label>
              ) : (
                <>
                  <label className="fm-inline-label" style={{ marginBottom: 12 }}>
                    Amount Paid (₹)
                    <input type="number" value={editingTxn.amountReceived} onChange={(e) => setEditingTxn({ ...editingTxn, amountReceived: e.target.value })} />
                  </label>
                  <label className="fm-inline-label" style={{ marginBottom: 12 }}>
                    Discount (₹)
                    <input type="number" value={editingTxn.discount} onChange={(e) => setEditingTxn({ ...editingTxn, discount: e.target.value })} />
                  </label>
                </>
              )}
              
              <label className="fm-inline-label" style={{ marginBottom: 20 }}>
                Date
                <input type="date" value={editingTxn.paymentDate} onChange={(e) => setEditingTxn({ ...editingTxn, paymentDate: e.target.value })} />
              </label>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button type="button" className="fm-secondary-btn" onClick={() => setEditingTxn(null)}>Cancel</button>
                <button type="submit" className="fm-primary-btn">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <PrintManager active={!!receiptPopup} onClose={() => setReceiptPopup(null)} type="receipt">
        {receiptPopup && <ReceiptPrintSheet receipts={[receiptPopup]} />}
      </PrintManager>

      <PrintManager active={!!printingStudent} onClose={() => setPrintingStudent(null)} type="student">
        {printingStudent && <StudentPrintPage student={printingStudent} />}
      </PrintManager>

      <PrintManager active={printLedger} onClose={() => setPrintLedger(false)} type="student">
        {printLedger && selectedStudent && <LedgerPrintSheet student={selectedStudent} history={calculatedHistory} session={session} currentBalance={finalBalance} />}
      </PrintManager>
    </div>
  );
}
