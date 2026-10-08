import React from "react";

export default function ReceiptCard({ receipt, school }) {
  const {
    receiptNumber, paymentDate, session, studentName, admissionNumber,
    className, section, guardianName, feeType, amountReceived, discount,
    lateFee, previousDue, remainingDue, paymentMethod, referenceNumber,
    transportFee, componentType, totalDue,
  } = receipt;

  const transport = Number(transportFee || 0);
  const tuition = Number(amountReceived || 0) - transport;
  const disc = Number(discount || 0);
  const late = Number(lateFee || 0);
  const prevDue = Number(previousDue || 0);
  const totalReceived = Number(amountReceived || 0) + late - disc;
  const totalDueAmount = Number(totalDue || 0) || (prevDue + totalReceived);
  const totalPaidAmount = totalReceived;
  const balanceAmount = Number(remainingDue || 0);

  const rows = [];

  if (componentType === "books") {
    rows.push({ label: "Books Fee", amount: Number(amountReceived || 0) });
  } else if (componentType === "previousYear") {
    rows.push({ label: "Previous Year Balance", amount: Number(amountReceived || 0) });
  } else if (componentType === "kit") {
    rows.push({ label: "Admission / Kit Fee", amount: Number(amountReceived || 0) });
  } else if (componentType === "transport") {
    rows.push({ label: "Transport Fee", amount: Number(amountReceived || 0) });
  } else {
    if (tuition > 0) rows.push({ label: feeType || "Tuition Fee", amount: tuition });
    if (transport > 0) rows.push({ label: "Transport Fee", amount: transport });
  }

  if (late > 0) rows.push({ label: "Late Fee", amount: late });
  if (disc > 0) rows.push({ label: "Discount", amount: -disc, isDiscount: true });

  return (
    <div className="receipt-card">
      <header className="receipt-header">
        <img src={school.logoUrl} alt="" className="receipt-logo" />
        <div className="receipt-header-text">
          <h2 className="receipt-school-name">{school.name}</h2>
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
          {prevDue > 0 && (
            <tr>
              <td>Previous Due</td>
              <td align="right">{prevDue.toFixed(2)}</td>
            </tr>
          )}
          {rows.map((p, i) => (
            <tr key={i}>
              <td>{p.label}</td>
              <td align="right">
                {p.isDiscount ? `-${Math.abs(p.amount).toFixed(2)}` : p.amount.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="receipt-summary-block">
        <div className="receipt-summary-line">
          <span>Total Amount</span>
          <span>₹{totalDueAmount.toFixed(0)}</span>
        </div>
        <div className="receipt-summary-line">
          <span>Amount Received</span>
          <span>₹{totalPaidAmount.toFixed(0)}</span>
        </div>
        <div className="receipt-summary-line receipt-summary-balance">
          <span>Balance</span>
          <span>₹{balanceAmount.toFixed(0)}</span>
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
          <div className="receipt-signature-box">Authorised Signature</div>
        </div>
        <p className="receipt-computer-generated">This is a computer-generated receipt.</p>
      </footer>
    </div>
  );
}
