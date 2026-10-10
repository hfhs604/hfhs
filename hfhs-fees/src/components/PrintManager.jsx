import React, { useEffect, useRef } from "react";

export default function PrintManager({ active, onClose, type, children }) {
  const printRootRef = useRef(null);

  useEffect(() => {
    if (!active) return;

    const handleBeforePrint = () => {
      // Force the print container to be visible via inline styles
      const container = document.querySelector(".print-only-container");
      if (container) {
        container.style.setProperty("display", "block", "important");
        container.style.setProperty("visibility", "visible", "important");
        container.style.setProperty("position", "absolute", "important");
        container.style.setProperty("left", "0", "important");
        container.style.setProperty("top", "0", "important");
        container.style.setProperty("width", "100%", "important");
        container.style.setProperty("background", "#fff", "important");
        container.style.setProperty("z-index", "999999", "important");
      }

      // Hide everything else
      document.querySelectorAll(".fm-app, .print-overlay, .print-screen-preview").forEach((el) => {
        el.style.setProperty("display", "none", "important");
        el.style.setProperty("visibility", "hidden", "important");
      });
    };

    const handleAfterPrint = () => {
      const container = document.querySelector(".print-only-container");
      if (container) {
        container.style.removeProperty("display");
        container.style.removeProperty("visibility");
        container.style.removeProperty("position");
        container.style.removeProperty("left");
        container.style.removeProperty("top");
        container.style.removeProperty("width");
        container.style.removeProperty("background");
        container.style.removeProperty("z-index");
      }

      document.querySelectorAll(".fm-app, .print-overlay, .print-screen-preview").forEach((el) => {
        el.style.removeProperty("display");
        el.style.removeProperty("visibility");
      });
    };

    window.addEventListener("beforeprint", handleBeforePrint);
    window.addEventListener("afterprint", handleAfterPrint);

    return () => {
      window.removeEventListener("beforeprint", handleBeforePrint);
      window.removeEventListener("afterprint", handleAfterPrint);
      handleAfterPrint();
    };
  }, [active]);

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

      <div className="print-only-container" ref={printRootRef}>
        {children}
      </div>
    </>
  );
}
