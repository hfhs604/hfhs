import React, { useState } from "react";
import {
  getCollectionReport, getClassWiseCollectionReport, getStudentStatement,
  getDueReport, getAdvanceReport, getPaymentMethodReport, getDiscountReport,
  getTransactionHistoryReport, exportToCSV, getAllStudents,
} from "../firebase/reportsService";
import "../styles/feeManagement.css";

const REPORT_TYPES = [
  "Daily Collection", "Monthly Collection", "Annual Collection", "Class-wise Collection",
  "Student-wise Fee Statement", "Due Fees", "Advance Payment", "Payment Method",
  "Discount / Concession", "Transaction History",
];

export default function Reports({ session }) {
  const [reportType, setReportType] = useState(REPORT_TYPES[0]);
  const [filters, setFilters] = useState({ fromDate: "", toDate: "", className: "", paymentMethod: "", studentAdm: "" });
  const [rows, setRows] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  async function runReport() {
    setLoading(true);
    setRows(null);
    setSummary(null);
    try {
      const baseFilters = { session, ...filters };
      switch (reportType) {
        case "Daily Collection":
        case "Monthly Collection":
        case "Annual Collection": {
          const { rows: r, totalCollected, count } = await getCollectionReport(baseFilters);
          setRows(r);
          setSummary(`${count} transactions · Total collected: ₹${totalCollected.toLocaleString()}`);
          break;
        }
        case "Class-wise Collection": {
          const r = await getClassWiseCollectionReport(baseFilters);
          setRows(r);
          break;
        }
        case "Student-wise Fee Statement": {
          if (!filters.studentAdm) { setSummary("Enter an admission number above."); break; }
          const students = await getAllStudents({ session });
          const student = students.find((s) => s.admissionNumber === filters.studentAdm);
          if (!student) { setSummary("Student not found."); break; }
          const r = await getStudentStatement(student.id);
          setRows(r);
          setSummary(`Statement for ${student.name} (Adm# ${student.admissionNumber})`);
          break;
        }
        case "Due Fees": {
          const r = await getDueReport(baseFilters);
          setRows(r);
          break;
        }
        case "Advance Payment": {
          const r = await getAdvanceReport(baseFilters);
          setRows(r);
          break;
        }
        case "Payment Method": {
          const r = await getPaymentMethodReport(baseFilters);
          setRows(Object.entries(r).map(([method, amount]) => ({ method, amount })));
          break;
        }
        case "Discount / Concession": {
          const r = await getDiscountReport(baseFilters);
          setRows(r);
          break;
        }
        case "Transaction History": {
          const r = await getTransactionHistoryReport(baseFilters);
          setRows(r);
          break;
        }
        default:
          break;
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fm-card">
      <h2>Reports</h2>

      <div className="fm-filter-row" style={{ flexWrap: "wrap" }}>
        <select value={reportType} onChange={(e) => setReportType(e.target.value)}>
          {REPORT_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <input type="date" value={filters.fromDate} onChange={(e) => setFilters({ ...filters, fromDate: e.target.value })} />
        <input type="date" value={filters.toDate} onChange={(e) => setFilters({ ...filters, toDate: e.target.value })} />
        <input placeholder="Class" value={filters.className} onChange={(e) => setFilters({ ...filters, className: e.target.value })} />
        {reportType === "Payment Method" || reportType === "Transaction History" ? (
          <select value={filters.paymentMethod} onChange={(e) => setFilters({ ...filters, paymentMethod: e.target.value })}>
            <option value="">All Methods</option>
            {["Cash", "UPI", "Bank Transfer", "Cheque", "Other"].map((m) => <option key={m}>{m}</option>)}
          </select>
        ) : null}
        {reportType === "Student-wise Fee Statement" && (
          <input placeholder="Admission Number" value={filters.studentAdm}
            onChange={(e) => setFilters({ ...filters, studentAdm: e.target.value })} />
        )}
        <button onClick={runReport} className="fm-primary-btn" disabled={loading}>
          {loading ? "Running…" : "Run Report"}
        </button>
        {rows && rows.length > 0 && (
          <>
            <button onClick={() => window.print()}>Print</button>
            <button onClick={() => exportToCSV(rows, reportType.replace(/\s+/g, "_"))}>Export CSV</button>
          </>
        )}
      </div>

      {summary && <p>{summary}</p>}

      {rows && (
        rows.length === 0 ? (
          <p className="fm-empty-state">No data for the selected filters.</p>
        ) : (
          <table className="fm-table">
            <thead>
              <tr>{Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== "object").map((k) => <th key={k}>{k}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id || i}>
                  {Object.entries(row).filter(([k, v]) => typeof v !== "object").map(([k, v]) => <td key={k}>{String(v)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}
