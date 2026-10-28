import React from "react";
import schoolLogo from "../assets/school-logo.jpg";

const SCHOOL = {
  name: "HOLY FAITH HIGH SCHOOL",
  address: "Tarwara More, Siwan, Bihar (841227)",
  managed: "Run & Managed by: Saumya Foundation Trust",
  logoUrl: schoolLogo,
};

export default function LedgerPrintSheet({ student, history, session, currentBalance }) {
  return (
    <div className="sp-page" style={{ width: "210mm", minHeight: "297mm", padding: "15mm" }}>
      
      {/* Header */}
      <header className="sp-header-wrap" style={{ borderBottom: "2px solid #1a3d6d", paddingBottom: 10, marginBottom: 20, textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 15 }}>
          <img src={SCHOOL.logoUrl} alt="" style={{ width: 60, height: 60, objectFit: "contain" }} />
          <div>
            <h1 style={{ margin: 0, fontFamily: "Georgia, serif", fontSize: 24, color: "#c8102e" }}>{SCHOOL.name}</h1>
            <p style={{ margin: "2px 0 0", fontSize: 12, fontWeight: 700, color: "#1a3d6d" }}>{SCHOOL.address}</p>
            <p style={{ margin: "2px 0 0", fontSize: 10, fontWeight: 700, color: "#1a3d6d" }}>{SCHOOL.managed}</p>
          </div>
        </div>
      </header>

      <div style={{ textAlign: "center", background: "#1a3d6d", color: "#fff", padding: "6px 0", borderRadius: 4, fontSize: 14, fontWeight: 600, marginBottom: 20 }}>
        STUDENT FEE LEDGER — Session {session}
      </div>

      {/* Student Info */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, fontSize: 12, marginBottom: 20 }}>
        <div><strong>Name:</strong> {student?.name}</div>
        <div><strong>Adm No:</strong> {student?.admissionNumber}</div>
        <div><strong>Class:</strong> {student?.className}</div>
        <div><strong>Father:</strong> {student?.fatherName}</div>
        <div><strong>Mother:</strong> {student?.motherName}</div>
        <div><strong>Current Balance:</strong> <span style={{ color: currentBalance > 0 ? "#dc2626" : "#16a34a", fontWeight: 700 }}>₹{currentBalance}</span></div>
      </div>

      {/* Ledger Table */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr style={{ background: "#f1f5f9", borderBottom: "2px solid #cbd5e1" }}>
            <th style={{ padding: 8, textAlign: "left", border: "1px solid #cbd5e1" }}>Date</th>
            <th style={{ padding: 8, textAlign: "left", border: "1px solid #cbd5e1" }}>Receipt#</th>
            <th style={{ padding: 8, textAlign: "right", border: "1px solid #cbd5e1" }}>Total Bill</th>
            <th style={{ padding: 8, textAlign: "right", border: "1px solid #cbd5e1" }}>Amount Paid</th>
            <th style={{ padding: 8, textAlign: "right", border: "1px solid #cbd5e1" }}>Discount</th>
            <th style={{ padding: 8, textAlign: "right", border: "1px solid #cbd5e1" }}>Balance Due</th>
            <th style={{ padding: 8, textAlign: "left", border: "1px solid #cbd5e1" }}>Method</th>
          </tr>
        </thead>
        <tbody>
          {history.map((t, idx) => (
            <tr key={t.id || idx} style={{ borderBottom: "1px solid #e2e8f0" }}>
              <td style={{ padding: 6, border: "1px solid #cbd5e1" }}>
                {t.paymentDate ? new Date(t.paymentDate?.seconds ? t.paymentDate.seconds * 1000 : t.paymentDate).toLocaleDateString("en-GB") : "—"}
              </td>
              <td style={{ padding: 6, border: "1px solid #cbd5e1" }}>{t.receiptNumber || "—"}</td>
              <td style={{ padding: 6, textAlign: "right", border: "1px solid #cbd5e1" }}>₹{t.snapshotTotalDue || 0}</td>
              <td style={{ padding: 6, textAlign: "right", border: "1px solid #cbd5e1", color: "#16a34a", fontWeight: 600 }}>₹{t.amountReceived || t.netAmount || 0}</td>
              <td style={{ padding: 6, textAlign: "right", border: "1px solid #cbd5e1" }}>{t.discount > 0 ? `-₹${t.discount}` : "—"}</td>
              <td style={{ padding: 6, textAlign: "right", border: "1px solid #cbd5e1", fontWeight: 700, color: t.runningBalance > 0 ? "#dc2626" : "#16a34a" }}>₹{t.runningBalance || 0}</td>
              <td style={{ padding: 6, border: "1px solid #cbd5e1" }}>{t.paymentMethod || "Cash"}</td>
            </tr>
          ))}
          {history.length === 0 && (
            <tr><td colSpan="7" style={{ padding: 20, textAlign: "center", border: "1px solid #cbd5e1" }}>No transactions recorded.</td></tr>
          )}
        </tbody>
      </table>

      <div style={{ marginTop: 40, display: "flex", justifyContent: "space-between", fontSize: 10, color: "#64748b" }}>
        <div>Generated on: {new Date().toLocaleString("en-GB")}</div>
        <div>Authorised Signature</div>
      </div>

    </div>
  );
}
