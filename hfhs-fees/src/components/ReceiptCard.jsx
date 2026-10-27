import React from "react";

export default function ReceiptCard({ receipt, school }) {
  const {
    receiptNumber, paymentDate, session, studentName, admissionNumber,
    className, section, guardianName, feeType, amountReceived, discount,
    lateFee, remainingDue, paymentMethod, referenceNumber,
    particulars: passedParticulars,
    totalDue,
  } = receipt;

  const disc = Number(discount || 0);
  const late = Number(lateFee || 0);
  const thisAmount = Number(amountReceived || 0);

  // Format the paymentDate to include both Date and Time
  let formattedDate = "—";
  if (paymentDate) {
    let dateObj = null;
    if (typeof paymentDate === "object" && paymentDate.seconds) {
      dateObj = new Date(paymentDate.seconds * 1000);
    } else if (paymentDate.toDate) {
      dateObj = paymentDate.toDate();
    } else {
      dateObj = new Date(paymentDate);
    }

    if (dateObj && !isNaN(dateObj.getTime())) {
      formattedDate = dateObj.toLocaleString("en-GB", {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      });
    }
  }

  let rows = Array.isArray(passedParticulars) ? [...passedParticulars] : [];
  if (rows.length === 0 && thisAmount > 0) {
    rows.push({ label: feeType || "Fee Payment", amount: thisAmount });
  }
  if (late > 0) {
    rows.push({ label: "Late Fee", amount: late });
  }

  // If the receipt has a saved grossTotal, use it. Otherwise, fallback to summing the rows.
  const grossTotal = Number(totalDue || 0) || rows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const netBill = grossTotal - disc;
  const finalBalance = Number(remainingDue || 0);

  return (
    <div className="receipt-card">
      <header className="receipt-header">
        <div className="receipt-header-top">
          <span>UDISE: 10161201603</span>
          <span>Reg. No. : 21812302021829794631</span>
        </div>
        <div className="receipt-header-row">
          <img src={school.logoUrl} alt="" className="receipt-logo" />
          <div className="receipt-header-text">
            <h2 className="receipt-school-name">{school.name}</h2>
            <p className="receipt-address">Tarwara More, Siwan, Bihar (841227)</p>
            <p className="receipt-managed">Run &amp; Managed by: Saumya Foundation Trust</p>
            <p className="receipt-tagline">NURTURING FAITH ♦ BUILDING FUTURE</p>
            <p className="receipt-contact">holyfaithsiwan604@gmail.com | +91-9934723574</p>
          </div>
        </div>
      </header>

      <div className="receipt-meta-row">
        <span><strong>Receipt#</strong> {receiptNumber}</span>
        <span><strong>Date & Time</strong> {formattedDate}</span>
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
          {rows.map((p, i) => (
            <tr key={i}>
              <td>{p.label}</td>
              <td align="right">{Number(p.amount).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="receipt-summary-block">
        <div className="receipt-summary-line">
          <span>Gross Total</span>
          <span>₹{grossTotal.toFixed(0)}</span>
        </div>

        {disc > 0 && (
          <div className="receipt-summary-line" style={{ color: "#059669", fontWeight: 600 }}>
            <span>Discount Applied</span>
            <span>- ₹{disc.toFixed(0)}</span>
          </div>
        )}

        <div className="receipt-summary-line" style={{ fontWeight: 700, fontSize: "11px", marginTop: 4 }}>
          <span>Net Bill</span>
          <span>₹{netBill.toFixed(0)}</span>
        </div>

        <div className="receipt-summary-line" style={{ marginTop: 8, borderTop: "1px dashed #cbd5e1", paddingTop: 8 }}>
          <span>Amount Received</span>
          <span>₹{thisAmount.toFixed(0)}</span>
        </div>

        <div className="receipt-summary-line receipt-summary-balance">
          <span>Balance Due</span>
          <span>₹{finalBalance.toFixed(0)}</span>
        </div>
      </div>

      <div className="receipt-payment-row">
        <span>Paid via <strong>{paymentMethod}</strong>{referenceNumber ? ` · Ref: ${referenceNumber}` : ""}</span>
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
