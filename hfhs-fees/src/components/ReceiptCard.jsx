import React from "react";

/**
 * Renders one receipt. Used both stand-alone (quarter-page print) and
 * inside ReceiptPrintSheet (4-per-A4 grid). Sizing/borders/page-break
 * behavior all live in receipt.css so this component stays print-context
 * agnostic — it never needs to know whether it's 1-of-1 or 1-of-4.
 */
export default function ReceiptCard({ receipt, school }) {
  const {
    receiptNumber, paymentDate, session, studentName, admissionNumber,
    className, section, guardianName, feeType, amountReceived, discount,
    lateFee, previousDue, remainingDue, advanceAmount, paymentMethod, referenceNumber,
  } = receipt;

  const total = Number(amountReceived) + Number(lateFee || 0) - Number(discount || 0);

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
        <span><strong>Class:</strong> {className}-{section}</span>
        <span><strong>Guardian:</strong> {guardianName}</span>
      </div>

      <table className="receipt-table">
        <thead>
          <tr><th>Particulars</th><th>Amount (₹)</th></tr>
        </thead>
        <tbody>
          <tr><td>{feeType}</td><td>{Number(amountReceived).toFixed(2)}</td></tr>
          {Number(lateFee) > 0 && <tr><td>Late Fee</td><td>{Number(lateFee).toFixed(2)}</td></tr>}
          {Number(discount) > 0 && <tr><td>Discount</td><td>-{Number(discount).toFixed(2)}</td></tr>}
          <tr className="receipt-total-row"><td>Total</td><td>{total.toFixed(2)}</td></tr>
        </tbody>
      </table>

      <div className="receipt-balance-row">
        <span>Prev. Due: ₹{Number(previousDue || 0).toFixed(2)}</span>
        <span>Remaining Due: ₹{Number(remainingDue || 0).toFixed(2)}</span>
        <span>Advance: ₹{Number(advanceAmount || 0).toFixed(2)}</span>
      </div>

      <div className="receipt-payment-row">
        <span>{paymentMethod}{referenceNumber ? ` · Ref: ${referenceNumber}` : ""}</span>
      </div>

      <footer className="receipt-footer">
        <div className="receipt-sign-area">
          <div className="receipt-stamp-box">School Stamp</div>
          <div className="receipt-signature-box">Authorized Signature</div>
        </div>
        <p className="receipt-computer-generated">This is a computer-generated receipt.</p>
      </footer>
    </div>
  );
}
