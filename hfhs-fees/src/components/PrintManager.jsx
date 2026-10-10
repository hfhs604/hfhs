import React from "react";

export default function PrintManager({ active, onClose, type, children }) {
  if (!active) return null;

  function handlePrint() {
    const printRoot = document.querySelector(".print-only-container");
    if (!printRoot) {
      alert("Nothing to print.");
      return;
    }

    // Open a new window with an empty document
    const w = window.open("", "_blank", "width=1000,height=800");
    if (!w) {
      alert("Please allow pop-ups for this site to print.");
      return;
    }

    // Determine page size by type
    const pageSize =
      type === "slip" ? "A4 landscape" : "A4 portrait";

    // Serialize styles
    const stylesHtml = Array.from(
      document.querySelectorAll('link[rel="stylesheet"], style')
    )
      .map((node) => {
        if (node.tagName === "LINK") {
          return `<link rel="stylesheet" href="${node.href}">`;
        }
        return `<style>${node.textContent}</style>`;
      })
      .join("\n");

    // Grab the printable HTML
    const printableHtml = printRoot.innerHTML;

    w.document.open();
    w.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Print</title>
          ${stylesHtml}
          <style>
            /* Force the correct page size */
            @page {
              size: ${pageSize};
              margin: 0;
            }

            /* Reset page background */
            html, body {
              margin: 0 !important;
              padding: 0 !important;
              background: #fff !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }

            /* The print container inside the new window is a plain block */
            .print-only-container,
            .print-screen-preview,
            .print-overlay,
            .no-print {
              display: block !important;
              visibility: visible !important;
              position: static !important;
              width: auto !important;
              height: auto !important;
              padding: 0 !important;
              margin: 0 !important;
              background: #fff !important;
              box-shadow: none !important;
            }

            /* Hide the app chrome if it slipped in */
            .print-overlay,
            .no-print {
              display: none !important;
            }
          </style>
        </head>
        <body>
          ${printableHtml}
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.focus();
                window.print();
              }, 300);
            };
          </script>
        </body>
      </html>
    `);
    w.document.close();
  }

  return (
    <>
      <div className="print-overlay no-print">
        <div className="print-overlay-toolbar">
          <button
            type="button"
            className="fm-primary-btn"
            onClick={handlePrint}
          >
            🖨 Print
          </button>
          <button type="button" className="fm-secondary-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {/* On-screen preview */}
      <div className="print-screen-preview">
        <div className="print-scroll">{children}</div>
      </div>

      {/* Hidden container for print HTML extraction */}
      <div className="print-only-container">{children}</div>
    </>
  );
}
