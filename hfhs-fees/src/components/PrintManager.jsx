import React from "react";

export default function PrintManager({ active, onClose, type, children }) {
  if (!active) return null;

  function handlePrint() {
    const printRoot = document.querySelector(".print-only-container");
    if (!printRoot) {
      alert("Nothing to print.");
      return;
    }

    const w = window.open("", "_blank", "width=1000,height=800");
    if (!w) {
      alert(
        "Please allow pop-ups for this site to print. " +
          "Click the pop-up blocked icon in the address bar and choose 'Always allow for this site'."
      );
      return;
    }

    const pageSize = type === "slip" ? "A4 landscape" : "A4 portrait";

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
            @page {
              size: ${pageSize};
              margin: 0;
            }

            html, body {
              margin: 0 !important;
              padding: 0 !important;
              background: #fff !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }

            /* Neutralize any app-level layout wrappers */
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
              overflow: visible !important;
            }

            .print-overlay,
            .no-print {
              display: none !important;
            }

            /* Prevent the last page from being extra-blank */
            html, body {
              height: auto !important;
              min-height: 0 !important;
            }

            /* Force every printed A4 page to break correctly */
            .a4-page-portrait,
            .a4-page-landscape,
            .demand-a4-page {
              page-break-after: always;
              page-break-inside: avoid;
              overflow: hidden;
            }
            .a4-page-portrait:last-child,
            .a4-page-landscape:last-child,
            .demand-a4-page:last-child {
              page-break-after: auto;
            }

            /* The student print page should NOT force extra height */
            .sp-page {
              width: 210mm !important;
              min-height: 0 !important;
              height: auto !important;
              padding: 14mm !important;
              box-sizing: border-box !important;
            }

            /* Receipt cards should not force page breaks */
            .receipt-print-root,
            .demand-slip-root {
              padding: 0 !important;
              margin: 0 !important;
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
                // Auto-close the print window after the dialog dismisses
                setTimeout(function() { window.close(); }, 500);
              }, 400);
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

      <div className="print-screen-preview">
        <div className="print-scroll">{children}</div>
      </div>

      <div className="print-only-container">{children}</div>
    </>
  );
}
