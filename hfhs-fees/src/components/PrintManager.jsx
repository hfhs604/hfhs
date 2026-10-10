import React, { useEffect, useRef } from "react";

export default function PrintManager({ active, onClose, type, children }) {
  const printRootRef = useRef(null);

  function handlePrint() {
    const container = printRootRef.current;
    if (!container) return;

    // Create a hidden iframe
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;

    // Copy every <link rel="stylesheet"> from the main document
    const styleLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .map((link) => `<link rel="stylesheet" href="${link.href}">`)
      .join("");

    // Copy every <style> tag from the main document
    const inlineStyles = Array.from(document.querySelectorAll("style"))
      .map((s) => `<style>${s.textContent}</style>`)
      .join("");

    // Determine page orientation
    const pageSize = type === "slip" ? "A4 landscape" : "A4 portrait";

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Print</title>
        ${styleLinks}
        ${inlineStyles}
        <style>
          @page { size: ${pageSize}; margin: 0; }
          html, body {
            margin: 0;
            padding: 0;
            background: #fff;
          }
          .print-only-container {
            display: block !important;
            visibility: visible !important;
            position: static !important;
            width: auto !important;
            height: auto !important;
            padding: 0 !important;
            margin: 0 !important;
            background: #fff !important;
          }
          .print-only-container .print-screen-preview,
          .print-only-container .print-overlay,
          .print-only-container .no-print {
            display: none !important;
          }
          .demand-slip-toolbar,
          .receipt-toolbar {
            display: none !important;
          }
        </style>
      </head>
      <body>${container.innerHTML}</body>
      </html>
    `);
    doc.close();

    // Wait for images + stylesheets to load, then print
    const waitAndPrint = () => {
      setTimeout(() => {
        try {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        } catch (err) {
          console.error("Print failed:", err);
        }
        // Remove the iframe after a delay
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1000);
      }, 500);
    };

    // If the iframe document has loaded, print. Otherwise wait.
    if (doc.readyState === "complete") {
      waitAndPrint();
    } else {
      iframe.contentWindow.onload = waitAndPrint;
    }
  }

  if (!active) return null;

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
