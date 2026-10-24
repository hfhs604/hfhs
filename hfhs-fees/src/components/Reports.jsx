import React, { useEffect, useState } from "react";
import { getTransactionHistoryReport, exportToCSV, getAllStudents } from "../firebase/reportsService";
import { deleteTransaction, getUserRole } from "../firebase/feeService";
import { auth } from "../firebase/config";
import "../styles/feeManagement.css";

export default function Reports({ session }) {
  const [recentTxns, setRecentTxns] = useState([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState("");
  
  const [studentMap, setStudentMap] = useState({});
  const [role, setRole] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const [reportType, setReportType] = useState("Daily Collection");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [className, setClassName] = useState("");

  const [reportRows, setReportRows] = useState(null);
  const [runningReport, setRunningReport] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadingRecent(true);
    
    async function loadData() {
      try {
        const u = auth.currentUser;
        if (u) {
          const userDoc = await getUserRole(u.uid);
          if (active) setRole(userDoc?.role || null);
        }

        const allStudents = await getAllStudents({ session });
        const map = {};
        allStudents.forEach(s => { map[s.id] = s; });
        if (active) setStudentMap(map);

        const rows = await getTransactionHistoryReport({ session });
        const sorted = rows.sort((a, b) => {
          const da = a.createdAt?.toDate?.() || new Date(a.paymentDate || 0);
          const db = b.createdAt?.toDate?.() || new Date(b.paymentDate || 0);
          return db - da;
        });
        
        if (active) setRecentTxns(sorted.slice(0, 5));
      } catch (err) {
        if (active) setError(err.message || "Failed to load transactions.");
      } finally {
        if (active) setLoadingRecent(false);
      }
    }

    loadData();
    return () => { active = false; };
  }, [session]);

  async function handleRunReport() {
    setRunningReport(true);
    setError(null);
    setReportRows(null);
    try {
      const filters = { session, fromDate: fromDate || undefined, toDate: toDate || undefined, className: className || undefined };
      const rows = await getTransactionHistoryReport(filters);
      setReportRows(rows);
    } catch (err) {
      setError(err.message || "Failed to generate report.");
    } finally {
      setRunningReport(false);
    }
  }

  async function handleDelete(txn) {
    const student = studentMap[txn.studentId] || {};
    const studentName = txn.studentName || student.name || "Unknown Student";
    
    const ok = window.confirm(
      `Are you sure you want to DELETE this transaction?\n\nStudent: ${studentName}\nAmount: ₹${txn.amountReceived || txn.netAmount || 0}\nThis CANNOT be undone.`
    );
    if (!ok) return;

    setDeletingId(txn.id);
    setMsg("");
    setError(null);

    try {
      await deleteTransaction(txn.id, "Deleted via Reports page");
      setMsg("✅ Transaction deleted successfully.");
      
      if (reportRows) handleRunReport();
      const rows = await getTransactionHistoryReport({ session });
      setRecentTxns(rows.slice(0, 5));
      setTimeout(() => setMsg(""), 5000);
    } catch (err) {
      setError(`❌ Failed to delete: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  }

  function formatDate(txn) {
    let d = null;
    if (txn.paymentDate) d = txn.paymentDate.toDate ? txn.paymentDate.toDate() : new Date(txn.paymentDate);
    else if (txn.createdAt) d = txn.createdAt.toDate ? txn.createdAt.toDate() : new Date(txn.createdAt);
    if (!d || isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-GB");
  }

  const renderTable = (rows) => {
    if (!rows || rows.length === 0) return <p className="fm-empty-state">No transactions found.</p>;

    return (
      <div className="fm-table-scroll" style={{ marginTop: 16 }}>
        <table className="fm-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Receipt#</th>
              <th>Student</th>
              <th>Class</th>
              <th>Amount</th>
              <th>Discount</th>
              <th>Method</th>
              {role === "superAdmin" && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const student = studentMap[r.studentId] || {};
              const studentName = r.studentName || student.name || "—";
              const studentClass = r.className || student.className || "—";
              const receiptNum = r.receiptNumber || "—";

              return (
                <tr key={r.id || i}>
                  <td>{formatDate(r)}</td>
                  <td>{receiptNum}</td>
                  <td>{studentName}</td>
                  <td>{studentClass}</td>
                  <td style={{ fontWeight: 600 }}>₹{r.amountReceived || r.netAmount || 0}</td>
                  <td style={{ color: "#059669" }}>{r.discount > 0 ? `-₹${r.discount}` : "—"}</td>
                  <td>{r.paymentMethod || "—"}</td>
                  {role === "superAdmin" && (
                    <td>
                      <button className="fm-link-btn fm-danger-link" onClick={() => handleDelete(r)} disabled={deletingId === r.id}>
                        {deletingId === r.id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="fm-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>Recent Transactions</h3>
        <button className="fm-primary-btn" onClick={() => { setFromDate(""); setToDate(""); setClassName(""); setReportType("Transaction History"); handleRunReport(); }}>
          View All History
        </button>
      </div>

      {msg && <div className="fm-success" style={{ marginBottom: 16 }}>{msg}</div>}
      {error && <div className="fm-error" style={{ marginBottom: 16 }}>{error}</div>}

      {loadingRecent ? <p className="fm-empty-state">Loading recent transactions…</p> : renderTable(recentTxns)}

      <hr style={{ margin: "32px 0", border: "none", borderTop: "1px solid #e5e7eb" }} />

      <h3>Generate Report</h3>
      <div className="fm-filter-row" style={{ marginTop: 16 }}>
        <select value={reportType} onChange={(e) => setReportType(e.target.value)}>
          <option value="Daily Collection">Daily Collection</option>
          <option value="Monthly Collection">Monthly Collection</option>
          <option value="Transaction History">Transaction History</option>
        </select>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        <input type="text" placeholder="Class (e.g. X)" value={className} onChange={(e) => setClassName(e.target.value)} />
        <button className="fm-primary-btn" onClick={handleRunReport} disabled={runningReport}>
          {runningReport ? "Running…" : "Run Report"}
        </button>
        {reportRows && reportRows.length > 0 && (
          <button className="fm-secondary-btn" onClick={() => exportToCSV(reportRows, "Report")}>Export CSV</button>
        )}
      </div>

      {reportRows && (
        <div style={{ marginTop: 24 }}>
          <h4>Results ({reportRows.length})</h4>
          {renderTable(reportRows)}
        </div>
      )}
    </div>
  );
}
