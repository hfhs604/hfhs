import React, { useEffect, useState } from "react";
import { auth } from "../firebase/config";
import { getUserRole, getStudentFeeProfile, getPaymentHistory } from "../firebase/feeService";
import ReceiptPrintSheet from "./ReceiptPrintSheet";
import schoolLogo from "../assets/school-logo.jpg";
import "../styles/feeManagement.css";

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

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Loading your fee details…</div>;
  if (error) return <div style={{ padding: 40, textAlign: "center", color: "var(--danger-red)" }}>{error}</div>;

  if (viewingReceipt) {
    return (
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <button className="fm-secondary-btn" style={{ marginBottom: 20 }} onClick={() => setViewingReceipt(null)}>
          ← Back to Portal
        </button>
        <ReceiptPrintSheet receipts={[viewingReceipt]} />
      </div>
    );
  }

  return (
    <div className="fm-card">
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24, paddingBottom: 16, borderBottom: "1px solid var(--border-color)" }}>
        <img src={schoolLogo} alt="Holy Faith High School" style={{ width: 48, height: 48, borderRadius: "50%" }} />
        <div>
          <h2 style={{ margin: 0, fontSize: "1.3em" }}>{profile.name}'s Fee Summary</h2>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
            Admission# {profile.admissionNumber} · Class {profile.className}-{profile.section} · Session {profile.session}
          </p>
        </div>
      </div>

      <div className="fm-dashboard-stats" style={{ marginBottom: 24 }}>
        <div className="fm-stat-card">
          <p className="fm-stat-label">Total Fee</p>
          <p className="fm-stat-value">₹{profile.totalAnnualFee || 0}</p>
        </div>
        <div className="fm-stat-card">
          <p className="fm-stat-label">Paid</p>
          <p className="fm-stat-value" style={{ color: "var(--success-green)" }}>₹{profile.totalAmountPaid || 0}</p>
        </div>
        <div className="fm-stat-card fm-due">
          <p className="fm-stat-label">Due</p>
          <p className="fm-stat-value">₹{profile.totalDue || 0}</p>
        </div>
        <div className="fm-stat-card fm-advance">
          <p className="fm-stat-label">Advance</p>
          <p className="fm-stat-value">₹{profile.totalAdvance || 0}</p>
        </div>
      </div>

      <h3 style={{ fontSize: "1.1em", marginBottom: 12 }}>Payment History</h3>
      
      {history.length === 0 ? (
        <p className="fm-empty-state">No payments recorded yet.</p>
      ) : (
        <div className="fm-table-scroll">
          <table className="fm-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Receipt#</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {history.map((t) => (
                <tr key={t.id}>
                  <td>{t.paymentDate ? new Date(t.paymentDate).toLocaleDateString() : "—"}</td>
                  <td>₹{t.amountReceived}</td>
                  <td>{t.paymentMethod}</td>
                  <td>{t.receiptRef ? t.receiptRef.slice(0, 8) : "—"}</td>
                  <td>
                    {t.receiptRef && (
                      <button className="fm-btn-sm" onClick={() => openReceipt(t)}>
                        View / Print
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
