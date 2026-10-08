import React from "react";

export default function ReceiptCard({ receipt, school }) {
  const {
    receiptNumber, paymentDate, session, studentName, admissionNumber,
    className, section, guardianName, feeType, amountReceived, discount,
    lateFee, previousDue, remainingDue, paymentMethod, referenceNumber,
    transportFee, componentType,
  } = receipt;

  const transport = Number(transportFee || 0);
  const tuition = Number(amountReceived || 0) - transport;
  const disc = Number(discount || 0);
  const late = Number(lateFee || 0);
  const total = Number(amountReceived || 0) + late - disc;

  // Build the list of particulars that actually appear in this transaction.
  const particulars = [];

  if (componentType === "books") {
    particulars.push({ label: "Books Fee", amount: Number(amountReceived || 0) });
  } else if (componentType === "previousYear") {
    particulars.push({ label: "Previous Year Balance", amount: Number(amountReceived || 0) });
  } else if (componentType === "kit") {
    particulars.push({ label: "Admission / Kit Fee", amount: Number(amountReceived || 0) });
  } else if (componentType === "transport") {
    particulars.push({ label: "Transport Fee", amount: Number(amountReceived || 0) });
  } else {
    if (tuition > 0) {
      particulars.push({ label: feeType || "Tuition Fee", amount: tuition });
    }
    if (transport > 0) {
      particulars.push({ label: "Transport Fee", amount: transport });
    }
  }

  if (late > 0) particulars.push({ label: "Late Fee", amount: late });
  if (disc > 0) particulars.push({ label: "Discount", amount: -disc, isDiscount: true });

  return (
    <div className="receipt-card">
      <header className="receipt-header">
        {school.logoUrl && <img src={school.logoUrl} alt="" className="receipt-logo" />}
        <div className="receipt-header-text">
          <h3>{school.name}</h3>
          <p className="receipt-tagline">{school.tagline}</p>
          <p className="receipt-address">{school.address}</p>
          <p className="receipt-reg">Reg. No.: {school.registrationNumber}</p>
        </div>
      </header>

      <div className="receipt-meta-row">
        <span><strong>Receipt#</strong> {receiptNumber}</span>
        <span><strong>Date</strong> {paymentDate}</span>
        <span><strong>Session</strong> {session}</span>
      </div>

      <div className="receipt-student-row">
        <span><strong>Name:</strong> {studentName}</span>
        <span><strong>Adm#:</strong> {admissionNumber}</span>
        <span><strong>Class:</strong> {className}{section ? `-${section}` : ""}</span>
        <span><strong>Guardian:</strong> {guardianName}</span>
      </div>

      <table className="receipt-table">
        <thead>
          <tr>
            <th>Particulars</th>
            <th style={{ textAlign: "right" }}>Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {particulars.map((p, i) => (
            <tr key={i}>
              <td>{p.label}</td>
              <td align="right">
                {p.isDiscount ? `-${Math.abs(p.amount).toFixed(2)}` : p.amount.toFixed(2)}
              </td>
            </tr>
          ))}
          <tr className="receipt-total-row">
            <td>Total Received</td>
            <td align="right">{total.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>

      <div className="receipt-balance-block">
        <div className="receipt-balance-line">
          <span>Previous Due</span>
          <span className="receipt-balance-value">₹{Number(previousDue || 0).toFixed(0)}</span>
        </div>
        <div className="receipt-balance-line receipt-balance-highlight">
          <span>Remaining Due</span>
          <span className="receipt-balance-value">₹{Number(remainingDue || 0).toFixed(0)}</span>
        </div>
      </div>

      <div className="receipt-payment-row">
        <span>
          Paid via <strong>{paymentMethod}</strong>
          {referenceNumber ? ` · Ref: ${referenceNumber}` : ""}
        </span>
      </div>

      <footer className="receipt-footer">
        <div className="receipt-sign-area">
          <div className="receipt-stamp-box">School Stamp</div>
          <div className="receipt-signature-box">Authorised Signature</div>
        </div>
        <p className="receipt-computer-generated">This is a computer-generated receipt.</p>
      </footer>
    </div>
  );
}
