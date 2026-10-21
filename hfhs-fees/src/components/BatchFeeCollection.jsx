import React, { useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { collectPayment, getMonthlyBill } from "../firebase/feeService";
import { getAllStudentsWithBills } from "../firebase/reportsService";
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

  const [rows, setRows] = useState({});

  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [sharedMethod, setSharedMethod] = useState("Cash");
  const [sharedRemarks, setSharedRemarks] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);
  const [receiptsToPrint, setReceiptsToPrint] = useState(null);

  // Load students WITH their current bills (to show the outstanding amount in the table)
  useEffect(() => {
    let active = true;
    setLoadingStudents(true);
    setSearchError(null);
    getAllStudentsWithBills({ session, month })
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
  }, [session, month]);

  useEffect(() => {
    let active = true;
    (async () => {
      for (const id of selectedIds) {
        const existing = rows[id];
        if (existing && !existing.loadingBill && existing.bill !== undefined) continue;

        setRows((prev) => ({
          ...prev,
          [id]: {
            amount: prev[id]?.amount ?? "",
            method: prev[id]?.method ?? sharedMethod,
            ref: prev[id]?.ref ?? "",
            discount: prev[id]?.discount ?? 0,
            lateFee: prev[id]?.lateFee ?? 0,
            remarks: prev[id]?.remarks ?? "",
            bill: undefined,
            loadingBill: true,
            billError: null,
          },
        }));

        try {
          const bill = await getMonthlyBill(session, month, id);
          if (!active) return;
          setRows((prev) => ({
            ...prev,
            [id]: {
              ...prev[id],
              bill,
              loadingBill: false,
              amount: prev[id]?.amount && prev[id].amount !== "" ? prev[id].amount : bill?.carriedForward ? String(bill.carriedForward) : "",
            },
          }));
        } catch (err) {
          if (!active) return;
          setRows((prev) => ({
            ...prev,
            [id]: { ...prev[id], bill: null, loadingBill: false, billError: err.message || String(err) },
          }));
        }
      }
    })();
    return () => { active = false; };
  }, [selectedIds, session, month, sharedMethod]);

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
    const searchString = [
      s.name, s.admissionNumber, s.fatherName, s.motherName, s.guardianName,
      s.mobileNumber, s.fatherMobile
    ].filter(Boolean).join(" ").toLowerCase();
    return searchString.includes(t);
  });

  const selectedList = allStudents.filter((s) => selectedIds.has(s.id));
  const grandTotal = selectedList.reduce((sum, s) => sum + Number(rows[s.id]?.amount || 0), 0);

  async function handleSubmit() {
    if (submitting) return;
    if (selectedList.length === 0) return;

    for (const s of selectedList) {
      const amt = Number(rows[s.id]?.amount || 0);
      if (amt <= 0) {
        alert(`Enter an amount greater than 0 for ${s.name}.`);
        return;
      }
    }

    const confirmed = window.confirm(`Record ${selectedList.length} payments totaling ₹${grandTotal.toLocaleString()}?`);
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
          paymentDate,
          paymentMethod: r.method || sharedMethod,
          referenceNumber: r.ref || "",
          feeType: "Tuition Fee",
          discount: Number(r.discount || 0),
          lateFee: Number(r.lateFee || 0),
          remarks: [r.remarks, sharedRemarks].filter(Boolean).join(" · "),
        });
        receipts.push({ ...res.receipt, studentName: res.receipt.studentName || s.name });
      } catch (err) {
        errors.push({ student: s.name, message: err.message || String(err) });
      }
    }

    setResults({ receipts, errors });
    setSubmitting(false);
    if (receipts.length > 0) setReceiptsToPrint(receipts);
    if (errors.length === 0 && typeof onDone === "function") onDone(receipts);
  }

  function resetAll() {
    setSelectedIds(new Set());
    setRows({});
    setResults(null);
    setSearch("");
    setSharedRemarks("");
  }

  return (
    <div className="fm-card">
      <div className="fm-row-header">
        <h2>Batch Collection</h2>
        <span className="fm-subtle">Month: <strong>{month}</strong></span>
      </div>

      {searchError && <p className="fm-error">{searchError}</p>}

      <div className="fm-search-row">
        <input
          type="text"
          placeholder="Search by student name, admission no, or parent name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="fm-secondary-btn" onClick={() => setSearch("")}>Clear</button>
      </div>

      {loadingStudents ? (
        <p className="fm-empty-state">Loading students…</p>
      ) : (
        <div className="fm-table-scroll" style={{ maxHeight: 300, overflowY: "auto", marginBottom: 20 }}>
          <table className="fm-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}></th>
                <th>Name</th>
                <th>Adm#</th>
                <th>Class</th>
                <th>Father / Guardian</th>
                <th>Mother</th>
                <th>Mobile</th>
                <th style={{ color: "var(--danger-red)" }}>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: 20 }}>
                    No students matched your search.
                  </td>
                </tr>
              ) : (
                filteredStudents.map((s) => {
                  const due = s.totalDue || 0;
                  return (
                    <tr key={s.id} onClick={() => toggleStudent(s.id)} style={{ cursor: "pointer" }}>
                      <td>
                        <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => toggleStudent(s.id)} onClick={(e) => e.stopPropagation()} />
                      </td>
                      <td className="wrap-text" style={{ fontWeight: 600 }}>{s.name}</td>
                      <td>{s.admissionNumber}</td>
                      <td>{s.className}{s.section ? `-${s.section}` : ""}</td>
                      <td className="wrap-text">{s.fatherName || s.guardianName || "—"}</td>
                      <td className="wrap-text">{s.motherName || "—"}</td>
                      <td>{s.mobileNumber || s.fatherMobile || "—"}</td>
                      <td className="fm-due-cell">
                        {due > 0 ? `₹${due.toLocaleString()}` : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedList.length > 0 && (
        <>
          <h3 style={{ marginTop: 22, marginBottom: 12 }}>Selected students ({selectedList.length})</h3>
          <div className="fm-table-scroll">
            <table className="fm-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Outstanding</th>
                  <th>Amount (₹)</th>
                  <th>Method</th>
                  <th>Ref#</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {selectedList.map((s) => {
                  const r = rows[s.id] || {};
                  const rowDue = s.totalDue || r.bill?.carriedForward || 0;
                  return (
                    <tr key={s.id}>
                      <td className="wrap-text" style={{ fontWeight: 600 }}>{s.name}</td>
                      <td className="fm-due-cell">
                        {r.loadingBill ? "Loading…" : r.bill === null ? "No bill" : `₹${rowDue.toLocaleString()}`}
                      </td>
                      <td>
                        <input type="number" min="0" value={r.amount ?? ""} onChange={(e) => updateRow(s.id, "amount", e.target.value)} style={{ width: 100, padding: 8, border: "1px solid #cbd5e1", borderRadius: 4 }} />
                      </td>
                      <td>
                        <select value={r.method || sharedMethod} onChange={(e) => updateRow(s.id, "method", e.target.value)} style={{ padding: 8, border: "1px solid #cbd5e1", borderRadius: 4 }}>
                          {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
                        </select>
                      </td>
                      <td><input type="text" value={r.ref || ""} onChange={(e) => updateRow(s.id, "ref", e.target.value)} style={{ width: 120, padding: 8, border: "1px solid #cbd5e1", borderRadius: 4 }} /></td>
                      <td><button type="button" className="fm-link-btn" onClick={() => toggleStudent(s.id)}>Remove</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20 }}>
            <strong style={{ fontSize: "1.1em" }}>Grand total: ₹{grandTotal.toLocaleString()}</strong>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="fm-secondary-btn" onClick={resetAll} disabled={submitting}>Reset</button>
              <button type="button" className="fm-primary-btn" onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Recording…" : `Record ${selectedList.length} payments`}
              </button>
            </div>
          </div>
        </>
      )}

      {results && (
        <div style={{ marginTop: 20 }}>
          {results.receipts.length > 0 && <p className="fm-success">✅ Recorded {results.receipts.length} payments.</p>}
          {results.errors.length > 0 && (
            <div className="fm-error">
              <strong>Some payments failed:</strong>
              <ul style={{ margin: "6px 0 0 20px" }}>
                {results.errors.map((e, i) => <li key={i}>{e.student}: {e.message}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      <PrintManager active={!!receiptsToPrint} onClose={() => setReceiptsToPrint(null)} type="receipt">
        {receiptsToPrint && <ReceiptPrintSheet receipts={receiptsToPrint} />}
      </PrintManager>
    </div>
  );
}
