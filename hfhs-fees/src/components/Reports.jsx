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

// Explicit column definitions per report type. This fixes the field-order
// mismatch bug where different transaction rows had their keys in different
// orders, causing React to render cells into the wrong columns.
const COLUMNS = {
  collection: [
    { key: "receiptNumber",   label: "Receipt#" },
    { key: "paymentDate",     label: "Date", format: formatDate },
    { key: "studentName",     label: "Student" },
    { key: "studentId",       label: "Adm#" },
    { key: "feeType",         label: "Fee Type" },
    { key: "componentType",   label: "Component" },
    { key: "paymentMethod",   label: "Method" },
    { key: "netAmount",       label: "Amount (₹)", format: fmtMoney },
    { key: "discount",        label: "Discount", format: fmtMoney },
    { key: "lateFee",         label: "Late Fee", format: fmtMoney },
    { key: "referenceNumber", label: "Ref#" },
    { key: "collectedByEmail", label: "Collected By" },
    { key: "remarks",         label: "Remarks" },
  ],
  classWise: [
    { key: "className",  label: "Class" },
    { key: "section",    label: "Section" },
    { key: "totalFee",   label: "Total Billed",  format: fmtMoney },
    { key: "totalPaid",  label: "Total Paid",    format: fmtMoney },
    { key: "totalDue",   label: "Total Due",     format: fmtMoney },
  ],
  due: [
    { key: "studentName",  label: "Student" },
    { key: "admissionNumber", label: "Adm#" },
    { key: "className",    label: "Class" },
    { key: "guardianName", label: "Guardian" },
    { key: "mobileNumber", label: "Mobile" },
    { key: "totalFee",     label: "Total Fee",   format: fmtMoney },
    { key: "totalPaid",    label: "Paid",        format: fmtMoney },
    { key: "totalDue",     label: "Due",         format: fmtMoney },
  ],
  paymentMethod: [
    { key: "method", label: "Method" },
    { key: "amount", label: "Amount (₹)", format: fmtMoney },
  ],
  studentStatement: [
    { key: "createdAt",     label: "Date",       format: formatTimestamp },
    { key: "componentType", label: "Component" },
    { key: "feeType",       label: "Fee Type" },
    { key: "paymentMethod", label: "Method" },
    { key: "netAmount",     label: "Amount (₹)", format: fmtMoney },
    { key: "discount",      label: "Discount",   format: fmtMoney },
    { key: "lateFee",       label: "Late Fee",   format: fmtMoney },
    { key: "remarks",       label: "Remarks" },
  ],
};

function fmtMoney(v) {
  const n = Number(v || 0);
  return n === 0 ? "—" : `₹${n.toLocaleString()}`;
}

function formatDate(v) {
  if (!v) return "—";
  try {
    const d = typeof v === "string" ? new Date(v) : v?.toDate?.();
    return d ? d.toLocaleDateString() : "—";
  } catch {
    return "—";
  }
}

function formatTimestamp(v) {
  if (!v) return "—";
  try {
    const d = v?.toDate?.() || new Date(v);
    return isNaN(d) ? "—" : d.toLocaleString();
  } catch {
    return "—";
  }
}

export default function Reports({ session }) {
  const [reportType, setReportType] = useState(REPORT_TYPES[0]);
  const [filters, setFilters] = useState({
    fromDate: "", toDate: "", className: "", paymentMethod: "", studentAdm: "",
  });
  const [rows, setRows] = useState(null);
  const [summary, setSummary] = useState(null);
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(false);

  async function runReport() {
    setLoading(true);
    setRows(null);
    setSummary(null);
    setColumns([]);
    try {
      const baseFilters = { session, ...filters };
      switch (reportType) {
        case "Daily Collection":
        case "Monthly Collection":
        case "Annual Collection": {
          const { rows: r, totalCollected, count } = await getCollectionReport(baseFilters);
          setRows(r);
          setColumns(COLUMNS.collection);
          setSummary(`${count} transactions · Total collected: ₹${totalCollected.toLocaleString()}`);
          break;
        }
        case "Class-wise Collection": {
          const r = await getClassWiseCollectionReport(baseFilters);
          setRows(r);
          setColumns(COLUMNS.classWise);
          break;
        }
        case "Student-wise Fee Statement": {
          if (!filters.studentAdm) { setSummary("Enter an admission number above."); break; }
          const students = await getAllStudents({ session });
          const student = students.find((s) => s.admissionNumber === filters.studentAdm);
          if (!student) { setSummary("Student not found."); break; }
          const r = await getStudentStatement(student.id);
          setRows(r);
          setColumns(COLUMNS.studentStatement);
          setSummary(`Statement for ${student.name} (Adm# ${student.admissionNumber})`);
          break;
        }
        case "Due Fees": {
          const r = await getDueReport(baseFilters);
          setRows(r);
          setColumns(COLUMNS.due);
          setSummary(`${r.length} students with outstanding dues`);
          break;
        }
        case "Advance Payment": {
          const r = await getAdvanceReport(baseFilters);
          setRows(r);
          setColumns([]);
          break;
        }
        case "Payment Method": {
          const r = await getPaymentMethodReport(baseFilters);
          const arr = Object.entries(r).map(([method, amount]) => ({ method, amount }));
          setRows(arr);
          setColumns(COLUMNS.paymentMethod);
          break;
        }
        case "Discount / Concession": {
          const r = await getDiscountReport(baseFilters);
          setRows(r);
          setColumns([
            { key: "studentId", label: "Student ID" },
            { key: "amount",    label: "Amount",   format: fmtMoney },
            { key: "type",      label: "Type" },
            { key: "reason",    label: "Reason" },
          ]);
          break;
        }
        case "Transaction History": {
          const r = await getTransactionHistoryReport(baseFilters);
          setRows(r);
          setColumns(COLUMNS.collection);
          break;
        }
        default:
          break;
      }
    } catch (err) {
      console.error("Report failed:", err);
      setSummary(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  const activeColumns = columns.length > 0
    ? columns
    : (rows && rows.length > 0
        ? Object.keys(rows[0]).map((k) => ({ key: k, label: k }))
        : []);

  return (
    <div className="fm-card">
      <h2>Reports</h2>

      <div className="fm-filter-row" style={{ flexWrap: "wrap" }}>
        <select value={reportType} onChange={(e) => setReportType(e.target.value)}>
          {REPORT_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <input type="date" value={filters.fromDate}
          onChange={(e) => setFilters({ ...filters, fromDate: e.target.value })} />
        <input type="date" value={filters.toDate}
          onChange={(e) => setFilters({ ...filters, toDate: e.target.value })} />
        <input placeholder="Class" value={filters.className}
          onChange={(e) => setFilters({ ...filters, className: e.target.value })} />
        {(reportType === "Payment Method" || reportType === "Transaction History") && (
          <select value={filters.paymentMethod}
            onChange={(e) => setFilters({ ...filters, paymentMethod: e.target.value })}>
            <option value="">All Methods</option>
            {["Cash", "UPI", "Bank Transfer", "Cheque", "Other"].map((m) => <option key={m}>{m}</option>)}
          </select>
        )}
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

      {summary && <p style={{ fontWeight: 500 }}>{summary}</p>}

      {rows && (
        rows.length === 0 ? (
          <p className="fm-empty-state">No data for the selected filters.</p>
        ) : (
          <div className="fm-table-scroll">
            <table className="fm-table">
              <thead>
                <tr>
                  {activeColumns.map((c) => <th key={c.key}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.id || i}>
                    {activeColumns.map((c) => {
                      const raw = row[c.key];
                      const val = c.format ? c.format(raw) : (raw ?? "—");
                      return <td key={c.key}>{String(val)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
