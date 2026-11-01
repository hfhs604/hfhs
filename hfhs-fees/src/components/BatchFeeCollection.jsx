import React, { useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { collectPayment, getPaymentHistory, searchStudents, getMonthlyBill, billToParticulars } from "../firebase/feeService";
import ReceiptPrintSheet from "./ReceiptPrintSheet";
import PrintManager from "./PrintManager";
import "../styles/feeManagement.css";

const PAYMENT_METHODS = ["Cash", "UPI", "Bank Transfer", "Cheque", "Other"];

export default function BatchFeeCollection({ session, month, preselectedIds = [], onDone }) {
  const [searchResults, setSearchResults] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set(preselectedIds));
  const [search, setSearch] = useState("");
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [searchError, setSearchError] = useState(null);

  const [rows, setRows] = useState({});
  const [bills, setBills] = useState({});
  const [histories, setHistories] = useState({});
  const [selectedStudentProfiles, setSelectedStudentProfiles] = useState({});

  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [sharedMethod, setSharedMethod] = useState("Cash");
  const [sharedRemarks, setSharedRemarks] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);
  const [receiptsToPrint, setReceiptsToPrint] = useState(null);

  async function handleSearch(e) {
    e.preventDefault();
    const term = search.trim();
    
    if (!/^\d+$/.test(term) && term.length < 3) {
      setSearchError("Please enter at least 3 characters for a name, or a valid Admission No.");
      return;
    }
    
    setLoadingStudents(true);
    setSearchError(null);
    setSearchResults([]); 
    
    try {
      const found = await searchStudents(term);
      if (found.length === 0) setSearchError("No students found.");
      setSearchResults(found);

      // Preload each result's bill so the Status column (DUE / PAID) is accurate before selecting
      found.slice(0, 20).forEach(async (st) => {
        try {
          const safeId = String(st.id).replace(/[\/\\.\*\[\]:;]/g, "-");
          const snap = await getDoc(doc(db, "monthlyBills", `${session}_${month}_${safeId}`));
          setBills((prev) => ({ ...prev, [st.id]: snap.exists() ? { id: snap.id, ...snap.data() } : null }));
        } catch (e) {}
      });
    } catch (err) {
      setSearchError(err.message || "Could not load students.");
    } finally {
      setLoadingStudents(false);
    }
  }

  function handleClear() {
    setSearch("");
    setSearchResults([]);
    setSelectedIds(new Set());
    setSelectedStudentProfiles({});
    setRows({});
    setBills({});
    setHistories({});
    setSearchError(null);
    setResults(null);
  }

  // Fetch the bill and full history whenever a selected student's data is missing
  async function loadStudentData(id) {
    const safeId = String(id).replace(/[\/\\.\*\[\]:;]/g, "-");
    const billRef = doc(db, "monthlyBills", `${session}_${month}_${safeId}`);
    const [billSnap, hist] = await Promise.all([getDoc(billRef), getPaymentHistory(id)]);
    return {
      bill: billSnap.exists() ? { id: billSnap.id, ...billSnap.data() } : null,
      hist: hist || [],
    };
  }

  useEffect(() => {
    let active = true;

    selectedIds.forEach((id) => {
      // Skip only if BOTH bill and history are already loaded
      if (bills[id] !== undefined && histories[id]) return;

      setRows((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          amount: prev[id]?.amount ?? "",
          discount: prev[id]?.discount ?? 0,
          method: prev[id]?.method ?? sharedMethod,
          ref: prev[id]?.ref ?? "",
          loadingBill: true,
        },
      }));

      loadStudentData(id)
        .then(({ bill, hist }) => {
          if (!active) return;
          setBills((prev) => ({ ...prev, [id]: bill }));
          setHistories((prev) => ({ ...prev, [id]: hist }));
          setRows((prev) => ({ ...prev, [id]: { ...prev[id], loadingBill: false } }));
        })
        .catch(() => {
          if (!active) return;
          setRows((prev) => ({ ...prev, [id]: { ...prev[id], loadingBill: false } }));
        });
    });

    return () => { active = false; };
  }, [selectedIds, session, month]);

  function toggleStudent(student) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(student.id)) {
        next.delete(student.id);
        setSelectedStudentProfiles(profiles => {
          const copy = { ...profiles };
          delete copy[student.id];
          return copy;
        });
      } else {
        next.add(student.id);
        setSelectedStudentProfiles(profiles => ({ ...profiles, [student.id]: student }));
      }
      return next;
    });
  }

  function updateRow(id, field, value) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], [field]: String(value) } }));
  }

  const selectedList = Object.values(selectedStudentProfiles).filter(s => selectedIds.has(s.id));

  // Single source of truth: the bill's running balance, maintained atomically
  // by collectPayment / addLineItem (already includes discounts and add-ons).
  const calculateOutstanding = (studentId) => {
    const bill = bills[studentId];
    if (!bill) return 0;
    const balance = bill.carriedForward !== undefined
      ? bill.carriedForward
      : (bill.totalDue || 0) - (bill.totalPaid || 0);
    return Math.max(balance, 0);
  };

  let calculatedPaid = 0;
  let calculatedDiscount = 0;
  let calculatedOutstanding = 0;

  selectedList.forEach((s) => {
    const hist = histories[s.id] || [];
    hist.forEach(t => {
      if (t.session === session && t.voided !== true && (!t.componentType || t.componentType === "monthly")) {
        calculatedPaid += Number(t.amountReceived || t.netAmount || 0);
        calculatedDiscount += Number(t.discount || 0);
      }
    });

    calculatedOutstanding += calculateOutstanding(s.id);
  });

  const currentTotalPaid = selectedList.reduce((sum, s) => sum + (parseFloat(rows[s.id]?.amount) || 0), 0);
  const currentTotalDiscount = selectedList.reduce((sum, s) => sum + (parseFloat(rows[s.id]?.discount) || 0), 0);

  async function handleSubmit() {
    if (submitting || selectedList.length === 0) return;

    for (const s of selectedList) {
      const amt = parseFloat(rows[s.id]?.amount) || 0;
      const disc = parseFloat(rows[s.id]?.discount) || 0;
      if (amt < 0 || disc < 0) {
        alert(`Amount and discount cannot be negative for ${s.name}.`);
        return;
      }
      if (amt + disc <= 0) {
        alert(`Enter a cash amount or a discount for ${s.name}.`);
        return;
      }
    }

    const confirmed = window.confirm(
      `Record ${selectedList.length} payment(s)?\n\nCash received: ₹${currentTotalPaid.toLocaleString()}\nDiscount (not cash): ₹${currentTotalDiscount.toLocaleString()}\nBalance reduced by: ₹${(currentTotalPaid + currentTotalDiscount).toLocaleString()}`
    );
    if (!confirmed) return;

    setSubmitting(true);
    setResults(null);

    const receipts = [];
    const errors = [];
    const successfulStudentIds = [];

    for (const s of selectedList) {
      const r = rows[s.id] || {};
      const currentOutstanding = calculateOutstanding(s.id);
      const bill = bills[s.id];
      
      try {
        const res = await collectPayment({
          studentId: s.id,
          session,
          month,
          idempotencyKey: uuidv4(),
          amountReceived: parseFloat(r.amount) || 0,
          discount: parseFloat(r.discount) || 0,
          paymentDate,
          paymentMethod: r.method || sharedMethod,
          referenceNumber: r.ref || "",
          feeType: "Tuition Fee",
          lateFee: 0,
          remarks: sharedRemarks,
        });

        const actualParticulars = [];
        if (bill) {
          if ((bill.previousDue || 0) > 0) actualParticulars.push({ label: "Previous Due", amount: bill.previousDue });
          if ((bill.tuitionBilled || 0) > 0) actualParticulars.push({ label: "Tuition Fee", amount: bill.tuitionBilled });
          if ((bill.transportBilled || 0) > 0) actualParticulars.push({ label: "Transport Fee", amount: bill.transportBilled });
          if ((bill.devFeeBilled || 0) > 0) actualParticulars.push({ label: "Development Fee", amount: bill.devFeeBilled });
          if ((bill.booksBilled || 0) > 0) actualParticulars.push({ label: "Books Fee", amount: bill.booksBilled });
          if ((bill.previousYearBilled || 0) > 0) actualParticulars.push({ label: "Previous Year", amount: bill.previousYearBilled });
          if ((bill.kitFeeBilled || 0) > 0) actualParticulars.push({ label: "Admission / Kit", amount: bill.kitFeeBilled });
        }

        receipts.push({
          ...res.receipt,
          studentName: s.name,
          className: s.className,
          particulars: res.receipt.particulars?.length ? res.receipt.particulars : actualParticulars,
          totalDue: currentOutstanding,
          // Trust the balance computed inside the DB transaction
          remainingDue: res.receipt.remainingDue,
        });

        successfulStudentIds.push(s.id);
      } catch (err) {
        errors.push({ student: s.name, message: err.message });
      }
    }

    setResults({ receipts, errors });
    setSubmitting(false);

    if (receipts.length > 0) {
      setReceiptsToPrint(receipts);
      
      // Reload fresh bill + history (real balances, session/month fields) for paid students
      await Promise.all(successfulStudentIds.map(async (id) => {
        try {
          const { bill, hist } = await loadStudentData(id);
          setBills((prev) => ({ ...prev, [id]: bill }));
          setHistories((prev) => ({ ...prev, [id]: hist }));
        } catch (e) { /* will be re-fetched on next selection */ }
      }));

      // Remove successful students from the selection and reset their rows
      setSelectedIds(prev => {
        const next = new Set(prev);
        successfulStudentIds.forEach(id => next.delete(id));
        return next;
      });
      
      const newRows = { ...rows };
      successfulStudentIds.forEach(id => {
        delete newRows[id];
      });
      setRows(newRows);
    }

    if (errors.length === 0 && onDone) onDone(receipts);
  }

  async function handleViewReceipt(txn) {
    if (!txn.receiptRef) {
      alert("No receipt found for this transaction.");
      return;
    }
    
    try {
      const snap = await getDoc(doc(db, "receipts", txn.receiptRef));
      if (snap.exists()) {
        const receiptData = { ...snap.data(), id: snap.id };
        
        let particulars = Array.isArray(receiptData.particulars) ? receiptData.particulars : [];
        const hasSnapshot = particulars.length > 0;
        if (particulars.length === 0) {
          const b = await getMonthlyBill(receiptData.session || session, receiptData.month || month, receiptData.studentId || txn.studentId);
          particulars = billToParticulars(b);
        }
        let grossTotal = particulars.reduce((sum, p) => sum + Number(p.amount || 0), 0);
        if (!hasSnapshot && txn.totalDue && grossTotal > txn.totalDue) {
          particulars = [...particulars, { label: "Less: Paid / Discount Earlier", amount: -(grossTotal - txn.totalDue) }];
          grossTotal = txn.totalDue;
        }

        setReceiptsToPrint([{
          ...receiptData,
          particulars,
          // Old receipts without a saved snapshot use the ledger's figures so the numbers tie out
          totalDue: hasSnapshot ? (receiptData.totalDue ?? grossTotal) : (txn.totalDue || grossTotal),
          remainingDue: hasSnapshot ? (receiptData.remainingDue || 0) : (txn.remainingDue ?? 0),
        }]);
      } else {
        alert("Receipt document not found in the database.");
      }
    } catch (err) {
      console.error("Failed to load receipt:", err);
      alert(`Failed to load receipt: ${err.message}`);
    }
  }

  const allTransactions = selectedList.flatMap(s => {
    const hist = histories[s.id] || [];
    return hist.map(t => ({ ...t, studentName: s.name }));
  }).sort((a, b) => {
    const dateA = a.paymentDate?.toDate?.() || new Date(a.paymentDate || a.createdAt?.toDate?.() || 0);
    const dateB = b.paymentDate?.toDate?.() || new Date(b.paymentDate || b.createdAt?.toDate?.() || 0);
    return dateA - dateB;
  });

  return (
    <div className="fm-card">
      <div className="fm-row-header">
        <h2>Batch Fee Collection</h2>
        <span className="fm-subtle">Month: <strong>{month}</strong> · Session: <strong>{session}</strong></span>
      </div>

      {selectedList.length > 0 && (
        <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
          <div style={{ flex: 1, background: "#eff6ff", padding: 16, borderRadius: 8, border: "1px solid #bfdbfe" }}>
            <p style={{ margin: "0 0 4px 0", fontSize: 12, color: "#1d4ed8", fontWeight: 600, textTransform: "uppercase" }}>Session Paid (Total)</p>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#1d4ed8" }}>₹{calculatedPaid.toLocaleString()}</p>
          </div>
          <div style={{ flex: 1, background: "#f0fdf4", padding: 16, borderRadius: 8, border: "1px solid #bbf7d0" }}>
            <p style={{ margin: "0 0 4px 0", fontSize: 12, color: "#15803d", fontWeight: 600, textTransform: "uppercase" }}>Discount Given</p>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#15803d" }}>₹{calculatedDiscount.toLocaleString()}</p>
          </div>
          <div style={{ flex: 1, background: "#fef2f2", padding: 16, borderRadius: 8, border: "1px solid #fecaca" }}>
            <p style={{ margin: "0 0 4px 0", fontSize: 12, color: "#b91c1c", fontWeight: 600, textTransform: "uppercase" }}>Outstanding Due</p>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#b91c1c" }}>₹{calculatedOutstanding.toLocaleString()}</p>
          </div>
        </div>
      )}

      {searchError && <p className="fm-error">{searchError}</p>}

      <form onSubmit={handleSearch} className="fm-search-row">
        <input
          type="text"
          placeholder="Search student by name (min 3 chars), parent name, mobile, or Admission No."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="submit" disabled={loadingStudents}>
          {loadingStudents ? "Searching..." : "Search"}
        </button>
        <button type="button" className="fm-secondary-btn" onClick={handleClear}>
          Clear All
        </button>
      </form>

      {searchResults.length > 0 && (
        <div className="fm-table-scroll" style={{ maxHeight: 300, overflowY: "auto", marginBottom: 24, border: "1px solid #e2e8f0", borderRadius: 8 }}>
          <table className="fm-table">
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th>Adm#</th>
                <th>Roll</th>
                <th>Class</th>
                <th>Father</th>
                <th>Mother</th>
                <th>Mobile</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {searchResults.map((s) => {
                const listStatus = bills[s.id] ? (calculateOutstanding(s.id) > 0 ? "DUE" : "PAID") : "—";
                return (
                <tr key={s.id} onClick={() => toggleStudent(s)} style={{ cursor: "pointer", background: selectedIds.has(s.id) ? "#f0fdf4" : "transparent" }}>
                  <td>
                    <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => {}} />
                  </td>
                  <td style={{ fontWeight: 500 }}>{s.name}</td>
                  <td>{s.admissionNumber}</td>
                  <td>{s.rollNumber ?? "—"}</td>
                  <td>{s.className}{s.section ? `-${s.section}` : ""}</td>
                  <td>{s.fatherName || "—"}</td>
                  <td>{s.motherName || "—"}</td>
                  <td>{s.mobileNumber || s.fatherMobile || "—"}</td>
                  <td>
                    <span className={`fm-badge fm-badge-${listStatus.toLowerCase()}`}>
                      {listStatus}
                    </span>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      )}

      {selectedList.length > 0 && (
        <>
          <h3 style={{ marginTop: 32, marginBottom: 16 }}>Selected students ({selectedList.length})</h3>
          
          <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
            <label className="fm-inline-label">Payment Date <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></label>
            <label className="fm-inline-label">Default Method <select value={sharedMethod} onChange={(e) => setSharedMethod(e.target.value)}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
            <label className="fm-inline-label" style={{ flex: 1 }}>Shared Remarks <input type="text" value={sharedRemarks} onChange={(e) => setSharedRemarks(e.target.value)} placeholder="e.g. Sibling discount applied" /></label>
          </div>

          <div className="fm-table-scroll">
            <table className="fm-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Outstanding</th>
                  <th>Balance After</th>
                  <th>Amount (₹)</th>
                  <th>Discount (₹)</th>
                  <th>Method</th>
                  <th>Ref#</th>
                  <th style={{ width: 60, textAlign: "center" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {selectedList.map((s) => {
                  const r = rows[s.id] || {};
                  const outstanding = calculateOutstanding(s.id);
                  return (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 500 }}>{s.name}</td>
                      <td className={outstanding > 0 ? "fm-due-cell" : ""}>
                        {r.loadingBill ? "Loading…" : `₹${outstanding.toLocaleString()}`}
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {r.loadingBill ? "…" : `₹${Math.max(outstanding - (parseFloat(r.amount) || 0) - (parseFloat(r.discount) || 0), 0).toLocaleString()}`}
                      </td>
                      <td><input type="number" min="0" value={r.amount ?? ""} onChange={(e) => updateRow(s.id, "amount", e.target.value)} style={{ width: 100, padding: "6px 8px" }} /></td>
                      <td><input type="number" min="0" value={r.discount ?? 0} onChange={(e) => updateRow(s.id, "discount", e.target.value)} style={{ width: 100, padding: "6px 8px" }} /></td>
                      <td><select value={r.method || sharedMethod} onChange={(e) => updateRow(s.id, "method", e.target.value)} style={{ padding: "6px 8px" }}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select></td>
                      <td><input type="text" value={r.ref || ""} onChange={(e) => updateRow(s.id, "ref", e.target.value)} style={{ width: 120, padding: "6px 8px" }} /></td>
                      <td style={{ textAlign: "center" }}>
                        <button type="button" className="fm-icon-btn fm-danger-link" onClick={() => toggleStudent(s)} style={{ fontSize: 16, padding: "6px 8px", border: "1px solid #fecaca", borderRadius: 6 }}>🗑️</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: "1.1em" }}>
              <span style={{ color: "#64748b" }}>Total Cash: </span>
              <strong style={{ color: "#2563eb" }}>₹{currentTotalPaid.toLocaleString()}</strong>
              <span style={{ color: "#64748b", marginLeft: 16 }}>Total Discount: </span>
              <strong style={{ color: "#059669" }}>₹{currentTotalDiscount.toLocaleString()}</strong>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="fm-secondary-btn" onClick={handleClear} disabled={submitting}>Reset All</button>
              <button type="button" className="fm-primary-btn" onClick={handleSubmit} disabled={submitting || selectedList.length === 0}>
                {submitting ? "Recording…" : `Record ${selectedList.length} payment(s)`}
              </button>
            </div>
          </div>
        </>
      )}

      {selectedList.length > 0 && (
        <div style={{ marginTop: 40, borderTop: "1px solid #e2e8f0", paddingTop: 20 }}>
          <h3>Transaction History (Selected Students)</h3>
          <div className="fm-table-scroll">
            <table className="fm-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Student</th>
                  <th>Receipt#</th>
                  <th>Amount</th>
                  <th>Discount</th>
                  <th>Method</th>
                  <th style={{ textAlign: "center" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {allTransactions.map(t => (
                  <tr key={t.id}>
                    <td>
                      {t.paymentDate?.toDate 
                        ? t.paymentDate.toDate().toLocaleDateString("en-GB") 
                        : new Date(t.paymentDate || t.createdAt?.toDate?.() || 0).toLocaleDateString("en-GB")}
                    </td>
                    <td>{t.studentName}</td>
                    <td style={{ fontWeight: 600 }}>{t.receiptNumber || "—"}</td>
                    <td style={{ fontWeight: 600 }}>₹{(t.amountReceived || t.netAmount || 0).toLocaleString()}</td>
                    <td style={{ color: "#059669" }}>{t.discount > 0 ? `-₹${t.discount}` : "—"}</td>
                    <td>{t.paymentMethod || "Cash"}</td>
                    <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                      <button type="button" title="View Receipt" className="fm-icon-btn" style={{ marginRight: 8 }} onClick={() => handleViewReceipt(t)}>
                        👁️
                      </button>
                      <button type="button" title="Print Receipt" className="fm-icon-btn" style={{ marginRight: 8 }} onClick={() => handleViewReceipt(t)}>
                        🖨️
                      </button>
                    </td>
                  </tr>
                ))}
                {allTransactions.length === 0 && (
                  <tr><td colSpan="7" style={{ textAlign: "center", padding: 20 }}>No past transactions found for these students.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {results && (
        <div style={{ marginTop: 20 }}>
          {results.receipts.length > 0 && <p className="fm-success">✅ Recorded {results.receipts.length} payment(s).</p>}
          {results.errors.length > 0 && <div className="fm-error"><strong>Some payments failed:</strong><ul>{results.errors.map((e, i) => <li key={i}>{e.student}: {e.message}</li>)}</ul></div>}
          {results.receipts.length > 0 && <button type="button" className="fm-primary-btn" style={{ marginTop: 10 }} onClick={() => setReceiptsToPrint(results.receipts)}>🖨 Reprint all receipts</button>}
        </div>
      )}

      <PrintManager active={!!receiptsToPrint} onClose={() => setReceiptsToPrint(null)} type="receipt">
        {receiptsToPrint && <ReceiptPrintSheet receipts={receiptsToPrint} />}
      </PrintManager>
    </div>
  );
}
