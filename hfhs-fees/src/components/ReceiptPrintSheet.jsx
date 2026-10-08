import React from "react";
import ReceiptCard from "./ReceiptCard";
import "../styles/receipt.css";
import schoolLogo from "../assets/school-logo.jpg";

const SCHOOL = {
  name: "HOLY FAITH HIGH SCHOOL",
  tagline: "NURTURING FAITH \uD83D\uDD38 BUILDING FUTURE",
  address: "Tarwara More, Siwan, Bihar – 841227",
  registrationNumber: "21812302021829794631",
  logoUrl: schoolLogo,
};

export default function ReceiptPrintSheet({ receipts }) {
  const pages = chunk(receipts, 6);

  return (
    <div className="receipt-print-root">
      <div className="receipt-toolbar no-print">
        <button onClick={() => window.print()}>Print</button>
        <span className="receipt-toolbar-hint">
          {receipts.length} receipt{receipts.length !== 1 ? "s" : ""} ·{" "}
          {pages.length} A4 page{pages.length !== 1 ? "s" : ""} (6 per page)
        </span>
      </div>

      {pages.map((pageReceipts, pageIndex) => (
        <div className="a4-page" key={pageIndex}>
          <div className="a4-grid-6">
            {pageReceipts.map((r) => (
              <div className="a4-cell-6" key={r.receiptId || r.receiptNumber}>
                <ReceiptCard receipt={r} school={SCHOOL} />
              </div>
            ))}
            {Array.from({ length: 6 - pageReceipts.length }).map((_, i) => (
              <div className="a4-cell-6 a4-cell-blank" key={`blank-${i}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out.length ? out : [[]];
}
