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
  const pages = chunk(receipts, 4);

  return (
    <div className="receipt-print-root">
      {pages.map((pageReceipts, pageIndex) => (
        <div className="a4-page-portrait" key={pageIndex}>
          <div className="a4-grid-4">
            {pageReceipts.map((r) => (
              <div className="a4-cell-4" key={r.receiptId || r.receiptNumber}>
                <ReceiptCard receipt={r} school={SCHOOL} />
              </div>
            ))}
            {Array.from({ length: 4 - pageReceipts.length }).map((_, i) => (
              <div className="a4-cell-4 a4-cell-blank" key={`blank-${i}`} />
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
