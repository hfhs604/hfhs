import React, { useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { collectPayment, getMonthlyBill } from "../firebase/feeService";
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
  const [selectedIds, setSelectedIds] = useState(
    () => new Set(preselectedIds)
  );
  const [search, setSearch] = useState("");
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [searchError, setSearchError] = useState(null);

  const [rows, setRows] = useState({});

  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [sharedMethod, setSharedMethod] = useState("Cash");
  const [sharedRemarks, setSharedRemarks] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);
  const [receiptsToPrint, setReceiptsToPrint] = useState(null);

  useEffect(() => {
    let active = true;
    setLoadingStudents(true);
    setSearchError(null);
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
    return () => {
      active = false;
    };
  }, [session]);

  useEffect(() => {
    let active = true;

    (async () => {
      for (const id of selectedIds) {
        const existing = rows[id];
        if (existing && !existing.loadingBill && existing.bill !== undefined) {
          continue;
        }

        setRows((prev) => ({
          ...prev,
          [id]: {
            amount: prev[id]?.amount ?? "",
            discount: prev[id]?.discount ?? 0,
            method: prev[id]?.method ?? sharedMethod,
            ref: prev[id]?.ref ?? "",
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
              amount:
                prev[id]?.amount && prev[id].amount !== ""
                  ? prev[id].amount
                  : bill?.carriedForward
                  ? String(bill.carriedForward)
                  : "",
            },
          }));
        } catch (err) {
          if (!active) return;
          setRows((prev) => ({
            ...prev,
            [id]: {
              ...prev[id],
              bill: null,
              loadingBill: false,
              billError: err.message || String(err),
            },
          }));
        }
      }
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    return (
      String(s.name || "").toLowerCase().includes(t) ||
      String(s.admissionNumber || "").toLowerCase().includes(t) ||
      String(s.fatherName || "").toLowerCase().includes(t) ||
      String(s.motherName || "").toLowerCase().includes(t) ||
      String(s.mobileNumber || "").toLowerCase().includes(t)
    );
  });

  const selectedList = allStudents.filter((s) => selectedIds.has(s.id));

  const grandTotal = selectedList.reduce(
    (sum, s) => sum + Number(rows[s.id]?.amount || 0),
    0
  );

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
      `Record ${selectedList.length} payment${
        selectedList.length !== 1 ? "s" : ""
      }?\n\n` +
        `Total Cash: ₹${grandTotal.toLocaleString()}\n` +
        `Month: ${month}\n\n` +
        `Each student will receive their own receipt.`
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

        const enriched = {
          ...res.receipt,
          studentName: res.receipt.studentName || s.name,
          admissionNumber: res.receipt.admissionNumber || s.admissionNumber,
          className: res.receipt.className || s.className,
          guardianName:
            res.receipt.guardianName || s.guardianName || s.fatherName,
        };
        receipts.push(enriched);
      } catch (err) {
        errors.push({
          student: s.name,
          message: err.message || String(err),
        });
      }
    }

    setResults({ receipts, errors });
    setSubmitting(false);

    if (receipts.length > 0) {
      setReceiptsToPrint(receipts);
    }

    if (errors.length === 0 && onDone) {
      onDone(receipts);
    }
  }

  return (
    <div className="fm-card">
      <div className="fm-row-header">
        <h2>Batch Fee Collection</h2>
        <span className="fm-subtle">
          Billing month: <strong>{month}</strong> · Session: <strong>{session}</strong>
        </span>
      </div>

      {searchError && <p className="fm-error">{searchError}</p>}

      {/* ---------------- Student picker ---------------- */}
      <div className="fm-search-row">
        <input
          type="text"
          placeholder="Search by name, admission no, father, or mother..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          className="fm-secondary-btn"
          onClick={() => setSearch("")}
        >
          Clear
        </button>
      </div>

      {loadingStudents ? (
        <p className="fm-empty-state">Loading students…</p>
      ) : filteredStudents.length === 0 ? (
        <p className="fm-empty-state">No students match this search.</p>
      ) : (
        <div
          className="fm-table-scroll"
          style={{ maxHeight: 300, overflowY: "auto" }}
        >
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
                <tr
                  key={s.id}
                  onClick={() => toggleStudent(s.id)}
                  style={{ cursor: "pointer" }}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(s.id)}
                      onChange={() => toggleStudent(s.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td style={{ fontWeight: 500 }}>{s.name}</td>
                  <td>{s.admissionNumber}</td>
                  <td>
                    {s.className}
                    {s.section ? `-${s.section}` : ""}
                  </td>
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

      {/* ---------------- Shared settings ---------------- */}
      <div
        style={{
          marginTop: 24,
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <label className="fm-inline-label">
          Payment Date
          <input
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
          />
        </label>
        <label className="fm-inline-label">
          Default Method
          <select
            value={sharedMethod}
            onChange={(e) => setSharedMethod(e.target.value)}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="fm-inline-label" style={{ flex: 1, minWidth: 250 }}>
          Shared Remarks (optional)
          <input
            type="text"
            value={sharedRemarks}
            onChange={(e) => setSharedRemarks(e.target.value)}
            placeholder="e.g. Sibling discount applied"
          />
        </label>
      </div>

      {/* ---------------- Selected students ---------------- */}
      {selectedList.length > 0 && (
        <>
          <h3 style={{ marginTop: 32, marginBottom: 16 }}>
            Selected students ({selectedList.length})
          </h3>

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
                      <td>
                        {r.loadingBill ? (
                          <span className="fm-subtle">Loading…</span>
                        ) : r.bill === null ? (
                          <span className="fm-due-cell">No bill</span>
                        ) : (
                          `₹${outstanding.toLocaleString()}`
                        )}
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          value={r.amount ?? ""}
                          onChange={(e) =>
                            updateRow(s.id, "amount", e.target.value)
                          }
                          style={{ width: 100, padding: "6px 8px" }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          value={r.discount ?? 0}
                          onChange={(e) =>
                            updateRow(s.id, "discount", e.target.value)
                          }
                          style={{ width: 100, padding: "6px 8px" }}
                        />
                      </td>
                      <td>
                        <select
                          value={r.method || sharedMethod}
                          onChange={(e) =>
                            updateRow(s.id, "method", e.target.value)
                          }
                          style={{ padding: "6px 8px" }}
                        >
                          {PAYMENT_METHODS.map((m) => (
                            <option key={m}>{m}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="text"
                          value={r.ref || ""}
                          onChange={(e) =>
                            updateRow(s.id, "ref", e.target.value)
                          }
                          style={{ width: 120, padding: "6px 8px" }}
                        />
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <button
                          type="button"
                          title="Remove Student"
                          className="fm-icon-btn fm-danger-link"
                          onClick={() => toggleStudent(s.id)}
                          style={{ 
                            fontSize: 16, 
                            padding: "6px 8px", 
                            border: "1px solid #fecaca", 
                            borderRadius: 6 
                          }}
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div
            style={{
              marginTop: 16,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <strong style={{ fontSize: "1.1em" }}>
              Grand total: ₹{grandTotal.toLocaleString()}
            </strong>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="fm-secondary-btn"
                onClick={() => {
                  setSelectedIds(new Set());
                  setRows({});
                }}
                disabled={submitting}
              >
                Reset
              </button>
              <button
                type="button"
                className="fm-primary-btn"
                onClick={handleSubmit}
                disabled={submitting || selectedList.length === 0}
              >
                {submitting
                  ? "Recording…"
                  : `Record ${selectedList.length} payment${
                      selectedList.length !== 1 ? "s" : ""
                    }`}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ---------------- Result summary ---------------- */}
      {results && (
        <div style={{ marginTop: 20 }}>
          {results.receipts.length > 0 && (
            <p className="fm-success">
              ✅ Recorded {results.receipts.length} payment
              {results.receipts.length !== 1 ? "s" : ""}.
            </p>
          )}
          {results.errors.length > 0 && (
            <div className="fm-error">
              <strong>Some payments failed:</strong>
              <ul style={{ margin: "6px 0 0 20px" }}>
                {results.errors.map((e, i) => (
                  <li key={i}>
                    {e.student}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {results.receipts.length > 0 && (
            <button
              type="button"
              className="fm-primary-btn"
              style={{ marginTop: 10 }}
              onClick={() => setReceiptsToPrint(results.receipts)}
            >
              🖨 Reprint all receipts
            </button>
          )}
        </div>
      )}

      <PrintManager
        active={!!receiptsToPrint}
        onClose={() => setReceiptsToPrint(null)}
        type="receipt"
      >
        {receiptsToPrint && (
          <ReceiptPrintSheet receipts={receiptsToPrint} />
        )}
      </PrintManager>
    </div>
  );
}
