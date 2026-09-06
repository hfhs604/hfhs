import React, { useEffect, useState } from "react";
import { auth } from "../firebase/config";
import { getUserRole } from "../firebase/feeService";
import { getStudentFeeProfile, getPaymentHistory } from "../firebase/feeService";
import ReceiptPrintSheet from "./ReceiptPrintSheet";
import schoolLogo from "../assets/school-logo.jpg";
import "../styles/feeManagement.css";

/**
 * Renders only the logged-in student/parent's OWN data. The linkedStudentId
 * comes from their `users/{uid}` doc (set by an admin when the account is
 * created) — never from a value the client can pass in, so there's no way
 * for a student to view another student's record by editing a prop/URL.
 * Firestore security rules enforce this same restriction server-side.
 */
export default function StudentPortal() {
  const [profile, setProfile] = useState(null);
  const [history, setHistory] = useState([]);
  const [viewingReceipt, setViewingReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const user = auth.currentUser;
        if (!user) throw new Error("Please log in.");
        const userDoc = await getUserRole(user.uid);
        if (!userDoc?.linkedStudentId) throw new Error("No student record linked to this account.");
        const [p, h] = await Promise.all([
          getStudentFeeProfile(userDoc.linkedStudentId),
          getPaymentHistory(userDoc.linkedStudentId),
        ]);
        setProfile(p);
        setHistory(h);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function openReceipt(txn) {
    const { getDoc, doc } = await import("firebase/firestore");
    const { db } = await import("../firebase/config");
    const snap = await getDoc(doc(db, "receipts", txn.receiptRef));
    if (snap.exists()) setViewingReceipt({ receiptId: snap.id, ...snap.data() });
  }

  if (loading) return <div className="fm-card fm-empty-state">Loading your fee details…</div>;
  if (error) return <div className="fm-card fm-empty-state">{error}</div>;

  if (viewingReceipt) {
    return (
      <div>
        <button className="fm-primary-btn" style={{ margin: 16 }} onClick={() => setViewingReceipt(null)}>
          ← Back
        </button>
        <ReceiptPrintSheet receipts={[viewingReceipt]} />
      </div>
    );
  }

  return (
    <div className="fm-card">
      <div className="fm-app-brand" style={{ marginBottom: 12 }}>
        <img src={schoolLogo} alt="Holy Faith High School" className="fm-app-logo" />
        <h2 style={{ margin: 0 }}>{profile.name}'s Fee Summary</h2>
      </div>
      <p>Admission# {profile.admissionNumber} · Class {profile.className}-{profile.section} · Session {profile.session}</p>

      <div className="fm-summary-grid">
        <div>Total Fee<strong>₹{profile.totalAnnualFee}</strong></div>
        <div>Paid<strong>₹{profile.totalAmountPaid}</strong></div>
        <div className="fm-due">Due<strong>₹{profile.totalDue}</strong></div>
        <div className="fm-advance">Advance<strong>₹{profile.totalAdvance}</strong></div>
      </div>

      <h3>Payment History</h3>
      {history.length === 0 ? (
        <p className="fm-empty-state">No payments yet.</p>
      ) : (
        <table className="fm-table">
          <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Receipt#</th><th></th></tr></thead>
          <tbody>
            {history.map((t) => (
              <tr key={t.id}>
                <td>{t.paymentDate ? new Date(t.paymentDate).toLocaleDateString() : "—"}</td>
                <td>₹{t.amountReceived}</td>
                <td>{t.paymentMethod}</td>
                <td>{t.receiptRef ? t.receiptRef.slice(0, 8) : "—"}</td>
                <td>{t.receiptRef && <button className="fm-link-btn" onClick={() => openReceipt(t)}>View / Download</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
