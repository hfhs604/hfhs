import React, { useEffect } from "react";

export default function PrintManager({ active, onClose, type, children }) {
  useEffect(() => {
    if (!active) return;
    document.body.classList.add(`printing-${type}`);
    return () => {
      document.body.classList.remove(`printing-${type}`);
    };
  }, [active, type]);

  if (!active) return null;

  return (
    <>
      {/* On-screen toolbar */}
      <div className="print-overlay no-print">
        <div className="print-overlay-toolbar">
          <button
            type="button"
            className="fm-primary-btn"
            onClick={() => window.print()}
          >
            🖨 Print
          </button>
          <button type="button" className="fm-secondary-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {/* On-screen preview (hidden when printing) */}
      <div className="print-screen-preview">
        <div className="print-scroll">
          {children}
        </div>
      </div>

      {/* Print-only container — hidden on screen, shown when printing */}
      <div className="print-only-container">
        {children}
      </div>
    </>
  );
}
