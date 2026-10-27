import React, { useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { collectPayment, getMonthlyBill, getPaymentHistory, getStudentPaymentSummary } from "../firebase/feeService";
import { getAllStudents } from "../firebase/reportsService";
import ReceiptPrintSheet from "./ReceiptPrintSheet";
import PrintManager from "./PrintManager";
import "../styles/feeManagement.css";

const PAYMENT_METHODS = ["Cash", "UPI", "Bank Transfer", "Cheque", "Other"];

export default function BatchFeeCollection({
  session,
  month,
  preselectedIds = [],
  onDone,
}) {
  const [allStudents, setAllStudents] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set(preselectedIds));
  const [search, setSearch] = useState("");
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [searchError, setSearchError] = useState(null);

  // Per-student row state
  const [rows, setRows] = useState({});
  const [histories, setHistories] = useState({});
  const [summary, setSummary] = useState({ totalPaid: 0, totalDiscount: 0, totalOutstanding: 0 });

  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [sharedMethod, setSharedMethod] = useState("Cash");
  const [sharedRemarks, setSharedRemarks] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);
  const [receiptsToPrint, setReceiptsToPrint] = useState(null);

  // -------- Load all students --------
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

  // -------- Fetch fresh bill & history when selection changes --------
  useEffect(() => {
    let active = true;

    (async () => {
      let newRows = { ...rows };
      let newHistories = { ...histories };
      let calculatedPaid = 0;
      let calculatedDiscount = 0;
      let calculatedOutstanding = 0;

      for (const id of selectedIds) {
        const existing = rows[id];
        // Only fetch if we don't have the bill yet or if we are forcing a refresh
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
            const [bill, hist, sum] = await Promise.all([
              getMonthlyBill(session, month, id),
              getPaymentHistory(id),
              getStudentPaymentSummary(id, session, month)
            ]);
            if (!active) return;

            newRows[id] = {
              ...newRows[id],
              bill,
              loadingBill: false,
              amount: newRows[id].amount !== "" ? newRows[id].amount : (bill?.carriedForward ? String(bill.carriedForward) : ""),
            };
            newHistories[id] = hist || [];
            
            // Calculate totals for the summary KPI
            calculatedPaid += sum.sessionTotal || 0;
            calculatedOutstanding += bill?.carriedForward || 0;
          } catch (err) {
            if (!active) return;
            newRows[id] = { ...newRows[id], bill: null, loadingBill: false };
          }
        }
      }

      // Also calculate from existing rows if we aren't re-fetching
      selectedIds.forEach(id => {
        if (newRows[id]?.bill) {
          calculatedOutstanding += newRows[id].bill.carriedForward || 0;
        }
      });

      if (active) {
        setRows(newRows);
        setHistories(newHistories);
        setSummary(prev => ({ ...prev, totalOutstanding: calculatedOutstanding }));
      }
    })();

    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
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

  // Live calculations for the form
  const currentTotalPaid = selectedList.reduce((sum, s) => sum + Number(rows[s.id]?.amount || 0), 0);
  const currentTotalDiscount = selectedList.reduce((sum, s) => sum + Number(rows[s.id]?.discount || 0), 0);

  async function handleSubmit() {
    if (submitting || selectedList.length === 0) return;

    for (const s of selectedList) {
      const amt = Number(rows[s.id]?.amount || 0);
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
          amountReceived: Number(r.amount || 0),
          discount: Number(r.discount || 0),
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
      // CLEAR the form inputs for the next transaction
      const clearedRows = { ...rows };
      selectedList.forEach(s => {
        if (clearedRows[s.id]) {
          clearedRows[s.id].amount = "";
          clearedRows[s.id].discount = 0;
          clearedRows[s.id].bill = undefined; // Force re-fetch of new balance
        }
      });
      setRows(clearedRows);
      // Force the useEffect to re-run by slightly changing the state
      setSelectedIds(new Set(selectedIds)); 
    }

    if (errors.length === 0 && onDone) onDone(receipts);
  }

  return (
    <div className="fm-card">
      <div className="fm-row-header">
        <h2>Batch Fee Collection</h2>
        <span className="fm-subtle">Month: <strong>{month}</strong> · Session: <strong>{session}</strong></span>
      </div>

      {/* Summary KPI Cards */}
      {selectedList.length > 0 && (
        <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
          <div style={{ flex: 1, background: "#eff6ff", padding: 16, borderRadius: 8, border: "1px solid #bfdbfe" }}>
            <p style={{ margin: "0 0 4px 0", fontSize: 12, color: "#1d4ed8", fontWeight: 600, textTransform: "uppercase" }}>Session Paid (Total)</p>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#1d4ed8" }}>₹{summary.totalPaid.toLocaleString()}</p>
          </div>
          <div style={{ flex: 1, background: "#f0fdf4", padding: 16, borderRadius: 8, border: "1px solid #bbf7d0" }}>
            <p style={{ margin: "0 0 4px 0", fontSize: 12, color: "#15803d", fontWeight: 600, textTransform: "uppercase" }}>Discount Given</p>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#15803d" }}>₹{summary.totalDiscount.toLocaleString()}</p>
          </div>
          <div style={{ flex: 1, background: "#fef2f2", padding: 16, borderRadius: 8, border: "1px solid #fecaca" }}>
            <p style={{ margin: "0 0 4px 0", fontSize: 12, color: "#b91c1c", fontWeight: 600, textTransform: "uppercase" }}>Outstanding Due</p>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#b91c1c" }}>₹{summary.totalOutstanding.toLocaleString()}</p>
          </div>
        </div>
      )}

      {searchError && <p className="fm-error">{searchError}</p>}

      {/* Search Bar */}
      <div className="fm-search-row">
        <input
          type="text"
          placeholder="Search by name, admission no, father, or mother..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="fm-secondary-btn" onClick={() => setSearch("")}>Clear</button>
      </div>

      {/* Student List */}
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

      {/* Payment Form */}
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
                      <td>{r.loadingBill ? "Loading…" : r.bill === null ? <span className="fm-due-cell">No bill</span> : `₹${outstanding.toLocaleString()}`}</td>
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

      {/* Transaction History */}
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
                  <th>Method</th>
                </tr>
              </thead>
              <tbody>
                {selectedList.flatMap(s => {
                  const hist = histories[s.id] || [];
                  return hist.map(t => (
                    <tr key={t.id}>
                      <td>{t.createdAt?.toDate?.().toLocaleDateString("en-GB") || "—"}</td>
                      <td>{s.name}</td>
                      <td>{t.receiptNumber || "—"}</td>
                      <td style={{ fontWeight: 600 }}>₹{(t.amountReceived || t.netAmount || 0).toLocaleString()}</td>
                      <td>{t.paymentMethod || "Cash"}</td>
                    </tr>
                  ));
                })}
                {Object.keys(histories).length === 0 && (
                  <tr><td colSpan="5" style={{ textAlign: "center", padding: 20 }}>No past transactions found for these students.</td></tr>
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
