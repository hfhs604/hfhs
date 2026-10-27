import React, { useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { collectPayment, getMonthlyBill, getPaymentHistory } from "../firebase/feeService";
import { getAllStudents } from "../firebase/reportsService";
import ReceiptPrintSheet from "./ReceiptPrintSheet";
import PrintManager from "./PrintManager";
import "../styles/feeManagement.css";

const PAYMENT_METHODS = ["Cash", "UPI", "Bank Transfer", "Cheque", "Other"];

export default function BatchFeeCollection({ session, month, preselectedIds = [], onDone }) {
  const [allStudents, setAllStudents] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set(preselectedIds));
  const [search, setSearch] = useState("");
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [searchError, setSearchError] = useState(null);

  const [rows, setRows] = useState({});
  const [histories, setHistories] = useState({});

  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [sharedMethod, setSharedMethod] = useState("Cash");
  const [sharedRemarks, setSharedRemarks] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);
  const [receiptsToPrint, setReceiptsToPrint] = useState(null);

  useEffect(() => {
    let active = true;
    setLoadingStudents(true);
    getAllStudents({ session })
      .then((list) => {
        if (!active) return;
        setAllStudents(list);
      })
      .catch((err) => {
        if (!active) return;
        setSearchError(err.message || "Could not load students.");
      })
      .finally(() => {
        if (active) setLoadingStudents(false);
      });
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    let active = true;

    (async () => {
      let newRows = { ...rows };
      let newHistories = { ...histories };

      for (const id of selectedIds) {
        const existing = rows[id];
        
        if (!existing || existing.bill === undefined) {
          newRows[id] = {
            ...existing,
            amount: existing?.amount ?? "",
            discount: existing?.discount ?? 0,
            method: existing?.method ?? sharedMethod,
            ref: existing?.ref ?? "",
            bill: undefined,
            loadingBill: true,
          };

          try {
            const [bill, hist] = await Promise.all([
              getMonthlyBill(session, month, id),
              getPaymentHistory(id)
            ]);
            if (!active) return;

            newRows[id] = {
              ...newRows[id],
              bill,
              loadingBill: false,
              amount: newRows[id].amount !== "" ? newRows[id].amount : (bill?.carriedForward ? String(bill.carriedForward) : ""),
            };
            newHistories[id] = hist || [];
            
          } catch (err) {
            if (!active) return;
            newRows[id] = { ...newRows[id], bill: null, loadingBill: false };
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

  function toggleStudent(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function updateRow(id, field, value) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], [field]: String(value) } }));
  }

  const filteredStudents = allStudents.filter((s) => {
    if (!search.trim()) return true;
    const t = search.trim().toLowerCase();
    return (
      String(s.name || "").toLowerCase().includes(t) ||
      String(s.admissionNumber || "").toLowerCase().includes(t) ||
      String(s.fatherName || "").toLowerCase().includes(t) ||
      String(s.motherName || "").toLowerCase().includes(t) ||
      String(s.mobileNumber || "").toLowerCase().includes(t)
    );
  });

  const selectedList = allStudents.filter((s) => selectedIds.has(s.id));

  // --- LIVE MATH FOR KPI CARDS (100% FROM DATABASE) ---
  let calculatedPaid = 0;
  let calculatedDiscount = 0;
  let calculatedOutstanding = 0;

  selectedList.forEach((s) => {
    const r = rows[s.id] || {};
    
    // Outstanding comes strictly from the database bill
    if (r.bill) calculatedOutstanding += r.bill.carriedForward || 0;

    // Paid and Discount come from history
    const hist = histories[s.id] || [];
    hist.forEach(t => {
      if (t.session === session && t.voided !== true && (!t.componentType || t.componentType === "monthly")) {
        calculatedPaid += Number(t.amountReceived || t.netAmount || 0);
        calculatedDiscount += Number(t.discount || 0);
      }
    });
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

        receipts.push({ ...res.receipt, studentName: s.name, className: s.className });
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
          clearedRows[s.id].bill = undefined; 
        }
      });
      setRows(clearedRows);
      setHistories({}); 
      setSelectedIds(new Set(selectedIds)); 
    }

    if (errors.length === 0 && onDone) onDone(receipts);
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

      <div className="fm-search-row">
        <input
          type="text"
          placeholder="Search by name, admission no, father, or mother..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="fm-secondary-btn" onClick={() => setSearch("")}>Clear</button>
      </div>

      {loadingStudents ? (
        <p className="fm-empty-state">Loading students…</p>
      ) : filteredStudents.length === 0 ? (
        <p className="fm-empty-state">No students match this search.</p>
      ) : (
        <div className="fm-table-scroll" style={{ maxHeight: 300, overflowY: "auto" }}>
          <table className="fm-table">
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th>Adm#</th>
                <th>Class</th>
                <th>Father</th>
                <th>Mother</th>
                <th>Mobile</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredStudents.map((s) => (
                <tr key={s.id} onClick={() => toggleStudent(s.id)} style={{ cursor: "pointer" }}>
                  <td>
                    <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => toggleStudent(s.id)} onClick={(e) => e.stopPropagation()} />
                  </td>
                  <td style={{ fontWeight: 500 }}>{s.name}</td>
                  <td>{s.admissionNumber}</td>
                  <td>{s.className}{s.section ? `-${s.section}` : ""}</td>
                  <td>{s.fatherName || "—"}</td>
                  <td>{s.motherName || "—"}</td>
                  <td>{s.mobileNumber || s.fatherMobile || "—"}</td>
                  <td>
                    <span className={`fm-badge fm-badge-${(s.accountStatus || "PAID").toLowerCase()}`}>
                      {s.accountStatus || "PAID"}
                    </span>
                  </td>
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
                  const outstanding = r.bill?.carriedForward || 0;
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
                        <button type="button" className="fm-icon-btn fm-danger-link" onClick={() => toggleStudent(s.id)} style={{ fontSize: 16, padding: "6px 8px", border: "1px solid #fecaca", borderRadius: 6 }}>🗑️</button>
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
              <button type="button" className="fm-secondary-btn" onClick={() => { setSelectedIds(new Set()); setRows({}); }} disabled={submitting}>Reset</button>
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
                      <button type="button" title="View Receipt" className="fm-icon-btn" style={{ marginRight: 8 }} onClick={() => setReceiptsToPrint([t])}>
                        👁️
                      </button>
                      <button type="button" title="Print Receipt" className="fm-icon-btn" style={{ marginRight: 8 }} onClick={() => setReceiptsToPrint([t])}>
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
