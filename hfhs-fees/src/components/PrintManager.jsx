import React, { useEffect } from "react";

export default function PrintManager({ active, onClose, type, children }) {
  useEffect(() => {
    if (!active) return;

    document.body.classList.add(`printing-${type}`);

    const handleBeforePrint = () => {
      const printContainer = document.querySelector(".print-only-container");
      if (printContainer) {
        printContainer.setAttribute("data-active", "true");
      }
    };

    const handleAfterPrint = () => {
      const printContainer = document.querySelector(".print-only-container");
      if (printContainer) {
        printContainer.removeAttribute("data-active");
      }
    };

    window.addEventListener("beforeprint", handleBeforePrint);
    window.addEventListener("afterprint", handleAfterPrint);

    return () => {
      document.body.classList.remove(`printing-${type}`);
      window.removeEventListener("beforeprint", handleBeforePrint);
      window.removeEventListener("afterprint", handleAfterPrint);
    };
  }, [active, type]);

  if (!active) return null;

  return (
    <>
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

      <div className="print-screen-preview">
        <div className="print-scroll">
          {children}
        </div>
      </div>

      <div className="print-only-container" data-print-type={type}>
        {children}
      </div>
    </>
  );
}
