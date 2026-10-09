import React from "react";
import DemandSlipCard from "./DemandSlipCard";
import "../styles/demandSlip.css";

/**
 * DemandSlipSheet
 * 6 slips per A4 landscape page (3 columns × 2 rows).
 *
 * `items` — array of { bill, student } pairs
 */
export default function DemandSlipSheet({ items }) {
  const pages = chunk(items, 6);

  return (
    <div className="demand-slip-root">
      <div className="demand-slip-toolbar no-print">
        <button onClick={() => window.print()}>🖨 Print</button>
        <span className="demand-slip-toolbar-hint">
          {items.length} slip{items.length !== 1 ? "s" : ""} ·{" "}
          {pages.length} A4 page{pages.length !== 1 ? "s" : ""} (6 per page, landscape)
        </span>
      </div>

      {pages.map((pageItems, pageIndex) => (
        <div className="demand-a4-page" key={pageIndex}>
          <div className="demand-a4-grid">
            {pageItems.map((item, i) => (
              <div className="demand-a4-cell" key={item.bill?.id || i}>
                <DemandSlipCard bill={item.bill} student={item.student} />
              </div>
            ))}
            {Array.from({ length: 6 - pageItems.length }).map((_, i) => (
              <div className="demand-a4-cell demand-a4-cell-blank" key={`blank-${i}`} />
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
