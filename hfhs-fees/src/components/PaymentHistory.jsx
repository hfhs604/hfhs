import React, { useEffect, useState } from "react";
import { auth } from "../firebase/config";
import {
  getPaymentHistory,
  deleteTransaction,
  getUserRoleOnce,
} from "../firebase/feeService";
import ReceiptPrintSheet from "./ReceiptPrintSheet";
import PrintManager from "./PrintManager";
import "../styles/feeManagement.css";

export default function PaymentHistory({ studentId }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewingReceipt, setViewingReceipt] = useState(null);
  const [role, setRole] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState("");

  async function loadHistory() {
    if (!studentId) return;
    setLoading(true);
    try {
      const h = await getPaymentHistory(studentId);
      setHistory(h);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  useEffect(() => {
    (async () => {
      const u = auth.currentUser;
      if (!u) return;
      const doc = await getUserRoleOnce(u.uid);
      setRole(doc?.role || null);
    })();
  }, []);

  const isSuperAdmin = role === "superAdmin";

  async function openReceipt(txn) {
    const { getDoc, doc } = await import("firebase/firestore");
    const { db } = await import("../firebase/config");
    const snap = await getDoc(doc(db, "receipts", txn.receiptRef));
    if (snap.exists()) setViewingReceipt({ receiptId: snap.id, ...snap.data() });
  }

  async function handleDelete(txn) {
    const ok = window.confirm(
      `Delete this transaction?\n\n` +
        `Amount: ₹${txn.netAmount || 0}\n` +
        `Type: ${txn.componentType || "monthly"}\n` +
        `Date: ${txn.paymentDate ? new Date(txn.paymentDate).toLocaleDateString() : "—"}\n\n` +
        `This will:\n` +
        `• Remove the transaction\n` +
        `• Reverse it from the bill\n` +
        `• Delete the receipt\n` +
        `• Log the action in the audit trail\n\n` +
        `This cannot be undone.`
    );
    if (!ok) return;

    setBusyId(txn.id);
    setMsg("");
    try {
      await deleteTransaction(txn.id, "Manual correction");
      setMsg("✅ Transaction deleted and bill reversed.");
      await loadHistory();
    } catch (err) {
      setMsg(`❌ ${err.message}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fm-card">
      <h2>Payment History</h2>
      {msg && <p style={{ margin: "4px 0" }}>{msg}</p>}
      {loading ? (
        <p className="fm-empty-state">Loading…</p>
      ) : history.length === 0 ? (
        <p className="fm-empty-state">No payments recorded yet.</p>
      ) : (
        <div className="fm-table-scroll">
          <table className="fm-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Category</th>
                <th>Method</th>
                <th>Ref#</th>
                <th>Discount</th>
                <th>Late Fee</th>
                <th>Collected By</th>
                <th>Remarks</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {history.map((t) => (
                <tr
                  key={t.id}
                  style={t.voided ? { opacity: 0.5, textDecoration: "line-through" } : undefined}
                >
                  <td>{t.paymentDate ? new Date(t.paymentDate).toLocaleDateString() : "—"}</td>
                  <td>₹{t.amountReceived}</td>
                  <td>{t.feeType}</td>
                  <td>{t.paymentMethod}</td>
                  <td>{t.referenceNumber || "—"}</td>
                  <td>₹{t.discount || 0}</td>
                  <td>₹{t.lateFee || 0}</td>
                  <td>{t.collectedByEmail || t.collectedBy}</td>
                  <td>{t.remarks || "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {!t.voided && t.receiptRef && (
                      <button
                        className="fm-link-btn"
                        onClick={() => openReceipt(t)}
                        style={{ marginRight: 8 }}
                      >
                        View / Print
                      </button>
                    )}
                    {isSuperAdmin && !t.voided && (
                      <button
                        className="fm-link-btn fm-danger-link"
                        onClick={() => handleDelete(t)}
                        disabled={busyId === t.id}
                      >
                        {busyId === t.id ? "Deleting…" : "Delete"}
                      </button>
                    )}
                    {t.voided && <span title={t.voidReason}>Voided</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PrintManager
        active={!!viewingReceipt}
        onClose={() => setViewingReceipt(null)}
        type="receipt"
      >
        {viewingReceipt && <ReceiptPrintSheet receipts={[viewingReceipt]} />}
      </PrintManager>
    </div>
  );
}
