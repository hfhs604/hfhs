import React, { useEffect, useState } from "react";
import { getPaymentHistory } from "../firebase/feeService";
import ReceiptPrintSheet from "./ReceiptPrintSheet";
import "../styles/feeManagement.css";

export default function PaymentHistory({ studentId }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewingReceipt, setViewingReceipt] = useState(null); // full receipt object once fetched

  useEffect(() => {
    if (!studentId) return;
    setLoading(true);
    getPaymentHistory(studentId).then((h) => { setHistory(h); setLoading(false); });
  }, [studentId]);

  async function openReceipt(txn) {
    // In collectPayment(), the receipt doc id is stored on the transaction
    // as `receiptRef`. Fetch it lazily only when the user asks to view it.
    const { getDoc, doc } = await import("firebase/firestore");
    const { db } = await import("../firebase/config");
    const snap = await getDoc(doc(db, "receipts", txn.receiptRef));
    if (snap.exists()) setViewingReceipt({ receiptId: snap.id, ...snap.data() });
  }

  if (viewingReceipt) {
    return (
      <div>
        <button className="fm-primary-btn" style={{ margin: 16 }} onClick={() => setViewingReceipt(null)}>
          ← Back to History
        </button>
        <ReceiptPrintSheet receipts={[viewingReceipt]} />
      </div>
    );
  }

  return (
    <div className="fm-card">
      <h2>Payment History</h2>
      {loading ? (
        <p className="fm-empty-state">Loading…</p>
      ) : history.length === 0 ? (
        <p className="fm-empty-state">No payments recorded yet.</p>
      ) : (
        <table className="fm-table">
          <thead>
            <tr>
              <th>Date</th><th>Amount</th><th>Category</th><th>Method</th>
              <th>Ref#</th><th>Discount</th><th>Late Fee</th><th>Collected By</th><th>Remarks</th><th></th>
            </tr>
          </thead>
          <tbody>
            {history.map((t) => (
              <tr key={t.id} style={t.voided ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
                <td>{t.paymentDate ? new Date(t.paymentDate).toLocaleDateString() : "—"}</td>
                <td>₹{t.amountReceived}</td>
                <td>{t.feeType}</td>
                <td>{t.paymentMethod}</td>
                <td>{t.referenceNumber || "—"}</td>
                <td>₹{t.discount || 0}</td>
                <td>₹{t.lateFee || 0}</td>
                <td>{t.collectedByEmail || t.collectedBy}</td>
                <td>{t.remarks || "—"}</td>
                <td>
                  {!t.voided && t.receiptRef && (
                    <button className="fm-link-btn" onClick={() => openReceipt(t)}>View / Print</button>
                  )}
                  {t.voided && <span title={t.voidReason}>Voided</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
