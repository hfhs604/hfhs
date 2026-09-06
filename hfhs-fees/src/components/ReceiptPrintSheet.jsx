import React from "react";
import ReceiptCard from "./ReceiptCard";
import "../styles/receipt.css";
import schoolLogo from "../assets/school-logo.jpg";

const SCHOOL = {
  name: "HOLY FAITH HIGH SCHOOL",
  tagline: "NURTURING FAITH \uD83D\uDD38 BUILDING FUTURE",
  address: "Tarwara More, Siwan, Bihar – 841227",
  registrationNumber: "21812302021829794631",
  // Imported (not a hardcoded "/assets/..." path) so it resolves correctly
  // whether this site is deployed at a domain root or a GitHub Pages
  // project subpath like username.github.io/repo-name/.
  logoUrl: schoolLogo,
};

/**
 * `receipts`: array of receipt objects (1 or many).
 * Chunks them into groups of 4; each group becomes one A4 page with a
 * 2x2 grid. A page with fewer than 4 receipts still reserves all four
 * quarter-slots (blank cells) so the grid — and cut lines — stay aligned.
 * Passing a single receipt renders one page with that receipt occupying
 * a single quarter-page slot, not a full page.
 */
export default function ReceiptPrintSheet({ receipts }) {
  const pages = chunk(receipts, 4);

  return (
    <div className="receipt-print-root">
      <div className="receipt-toolbar no-print">
        <button onClick={() => window.print()}>Print Receipt</button>
        <button onClick={() => window.print()}>Print 4 Receipts per A4</button>
        <span className="receipt-toolbar-hint">
          {receipts.length} receipt{receipts.length !== 1 ? "s" : ""} · {pages.length} A4 page{pages.length !== 1 ? "s" : ""}
        </span>
      </div>

      {pages.map((pageReceipts, pageIndex) => (
        <div className="a4-page" key={pageIndex}>
          <div className="a4-grid">
            {pageReceipts.map((r) => (
              <div className="a4-cell" key={r.receiptId || r.receiptNumber}>
                <ReceiptCard receipt={r} school={SCHOOL} />
              </div>
            ))}
            {/* Fill remaining quarter-slots so the 2x2 grid and cut-guides stay intact */}
            {Array.from({ length: 4 - pageReceipts.length }).map((_, i) => (
              <div className="a4-cell a4-cell-blank" key={`blank-${i}`} />
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
