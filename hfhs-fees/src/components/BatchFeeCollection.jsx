import React, { useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { collectPayment, getMonthlyBill, getPaymentHistory, searchStudents } from "../firebase/feeService";
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
  const [histories, setHistories] = useState({});
  const [selectedStudentProfiles, setSelectedStudentProfiles] = useState({});

  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [sharedMethod, setSharedMethod] = useState("Cash");
  const [sharedRemarks, setSharedRemarks] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);
  const [receiptsToPrint, setReceiptsToPrint] = useState(null);
  const [loadingReceipt, setLoadingReceipt] = useState(false);

  async function handleSearch(e) {
    e.preventDefault();
    const term = search.trim();
    
    if (!/^\d+$/.test(term) && term.length < 3) {
      setSearchError("Please enter at least 3 characters for a name, or a valid Admission No.");
      return;
    }
    
    setLoadingStudents(true);
    setSearchError(null);
    try {
      const found = await searchStudents(term);
      if (found.length === 0) setSearchError("No students found.");
      setSearchResults(found);
    } catch (err) {
      setSearchError(err.message || "Could not load students.");
    } finally {
      setLoadingStudents(false);
    }
  }

  useEffect(() => {
    let active = true;

    (async () => {
      let newRows = { ...rows };
      let newHistories = { ...histories };

      for (const id of selectedIds) {
        if (!histories[id]) {
          newRows[id] = {
            ...newRows[id],
            amount: newRows[id]?.amount ?? "",
            discount: newRows[id]?.discount ?? 0,
            method: newRows[id]?.method ?? sharedMethod,
            ref: newRows[id]?.ref ?? "",
            loadingBill: true,
          };

          try {
            const hist = await getPaymentHistory(id);
            if (!active) return;
            
            newHistories[id] = hist || [];
            newRows[id].loadingBill = false;
          } catch (err) {
            if (!active) return;
            newRows[id].loadingBill = false;
          }
        }
      }

      if (active) {
        setRows(newRows);
        setHistories(newHistories);
      }
    })();

    return () => { active = false; };
  }, [selectedIds, session, month]);

  function toggleStudent(student) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(student.id)) {
        next.delete(student.id);
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

  const calculateOutstandingFromHistory = (student) => {
    const baseFee = student.className === "IV" ? 1100 : student.className === "VI" ? 1200 : 0;
    const transport = student.transportOpted ? (student.transportAmount || 0) : 0;
    const monthlyTotal = baseFee + transport;

    const currentMonth = new Date().getMonth() + 1;
    const monthsBilled = currentMonth >= 4 ? (currentMonth - 4 + 1) : 0; 

    const totalExpectedBill = (monthlyTotal * monthsBilled) + 3150;
    
    const hist = histories[student.id] || [];
    let totalCash = 0;
    let totalDiscount = 0;
    let addOns = 0;

    hist.forEach(t => {
      if (t.session === session && t.voided !== true) {
        if (t.componentType === "monthly" || !t.componentType) {
          totalCash += Number(t.amountReceived || t.netAmount || 0);
          totalDiscount += Number(t.discount || 0);
        } else if (["books", "kit", "previousYear", "transport"].includes(t.componentType)) {
          addOns += Number(t.addOnAmount || 0);
        }
      }
    });

    return totalExpectedBill + addOns - totalCash - totalDiscount;
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

    calculatedOutstanding += calculateOutstandingFromHistory(s);
  });

  const currentTotalPaid = selectedList.reduce((sum, s) => sum + (parseFloat(rows[s.id]?.amount) || 0), 0);
  const currentTotalDiscount = selectedList.reduce((sum, s) => sum + (parseFloat(rows[s.id]?.discount) || 0), 0);

  async function handleSubmit() {
    if (submitting || selectedList.length === 0) return;

    for (const s of selectedList) {
      const amt = parseFloat(rows[s.id]?.amount) || 0;
      if (amt <= 0) {
        alert(`Enter an amount greater than 0 for ${s.name}.`);
        return;
      }
    }

    const confirmed = window.confirm(
      `Record ${selectedList.length} payment(s)?\n\nCash: ₹${currentTotalPaid.toLocaleString()}\nDiscount: ₹${currentTotalDiscount.toLocaleString()}`
    );
    if (!confirmed) return;

    setSubmitting(true);
    setResults(null);

    const receipts = [];
    const errors = [];

    for (const s of selectedList) {
      const r = rows[s.id] || {};
      const currentOutstanding = calculateOutstandingFromHistory(s);
      
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

        const baseFee = s.className === "IV" ? 1100 : s.className === "VI" ? 1200 : 0;
        const transport = s.transportOpted ? (s.transportAmount || 0) : 0;
        const particulars = [];
        if (baseFee > 0) particulars.push({ label: "Tuition Fee", amount: baseFee });
        if (transport > 0) particulars.push({ label: "Transport Fee", amount: transport });

        const newBalance = currentOutstanding - (parseFloat(r.amount) || 0) - (parseFloat(r.discount) || 0);

        receipts.push({ 
          ...res.receipt, 
          studentName: s.name, 
          className: s.className,
          particulars: particulars,
          totalDue: currentOutstanding,
          remainingDue: Math.max(newBalance, 0),
        });
      } catch (err) {
        errors.push({ student: s.name, message: err.message });
      }
    }

    setResults({ receipts, errors });
    setSubmitting(false);

    if (receipts.length > 0) {
      setReceiptsToPrint(receipts);
      const clearedRows = { ...rows };
      selectedList.forEach(s => {
        if (clearedRows[s.id]) {
          clearedRows[s.id].amount = "";
          clearedRows[s.id].discount = 0;
        }
      });
      setRows(clearedRows);
      setHistories({}); 
      setSelectedIds(new Set()); 
      setSelectedStudentProfiles({});
      setSearchResults([]);
    }

    if (errors.length === 0 && onDone) onDone(receipts);
  }

  async function handleViewReceipt(txn) {
    if (!txn.receiptRef) {
      alert("No receipt found for this transaction.");
      return;
    }
    
    setLoadingReceipt(true);
    try {
      const snap = await getDoc(doc(db, "receipts", txn.receiptRef));
      if (snap.exists()) {
        const receiptData = { ...snap.data(), id: snap.id };
        
        const particulars = [];
        if (receiptData.previousDue > 0) particulars.push({ label: "Previous Due", amount: receiptData.previousDue });
        if (receiptData.feeType) particulars.push({ label: receiptData.feeType, amount: receiptData.amountReceived || 0 });

        const totalAmt = Number(receiptData.amountReceived || 0) + Number(receiptData.discount || 0) + Number(receiptData.previousDue || 0) + Number(receiptData.lateFee || 0);

        setReceiptsToPrint([{
          ...receiptData,
          particulars: particulars,
          totalDue: totalAmt,
          remainingDue: receiptData.remainingDue || 0,
        }]);
      } else {
        alert("Receipt document not found in the database.");
      }
    } catch (err) {
      console.error("Failed to load receipt:", err);
      alert(`Failed to load receipt: ${err.message}`);
    } finally {
      setLoadingReceipt(false);
    }
  }

  const allTransactions = selectedList.flatMap(s => {
    const hist = histories[s.id] || [];
    return hist.map(t => ({ ...t, studentName: s.name }));
  }).sort((a, b) => {
    const dateA = a.paymentDate?.toDate?.() || new Date(a.createdAt?.toDate?.() || 0);
    const dateB = b.paymentDate?.toDate?.() || new Date(b.createdAt?.toDate?.() || 0);
    return dateB - dateA;
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
        {searchResults.length > 0 && (
          <button type="button" className="fm-secondary-btn" onClick={() => { setSearch(""); setSearchResults([]); }}>
            Clear
          </button>
        )}
      </form>

      {searchResults.length > 0 && (
        <div className="fm-table-scroll" style={{ maxHeight: 300, overflowY: "auto", marginBottom: 24, border: "1px solid #e2e8f0", borderRadius: 8 }}>
          <table className="fm-table">
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th>Adm#</th>
                <th>Class</th>
                <th>Father</th>
                <th>Mobile</th>
              </tr>
            </thead>
            <tbody>
              {searchResults.map((s) => (
                <tr key={s.id} onClick={() => toggleStudent(s)} style={{ cursor: "pointer", background: selectedIds.has(s.id) ? "#f0fdf4" : "transparent" }}>
                  <td>
                    <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => {}} />
                  </td>
                  <td style={{ fontWeight: 500 }}>{s.name}</td>
                  <td>{s.admissionNumber}</td>
                  <td>{s.className}{s.section ? `-${s.section}` : ""}</td>
                  <td>{s.fatherName || "—"}</td>
                  <td>{s.mobileNumber || s.fatherMobile || "—"}</td>
                </tr>
              ))}
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
                  const outstanding = calculateOutstandingFromHistory(s);
                  return (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 500 }}>{s.name}</td>
                      <td className={outstanding > 0 ? "fm-due-cell" : ""}>
                        {r.loadingBill ? "Loading…" : `₹${outstanding.toLocaleString()}`}
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
              <button type="button" className="fm-secondary-btn" onClick={() => { setSelectedIds(new Set()); setRows({}); setSelectedStudentProfiles({}); }} disabled={submitting}>Reset</button>
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
                    <td>{t.receiptNumber || "—"}</td>
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
