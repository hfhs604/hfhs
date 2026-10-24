import React, { useEffect, useState } from "react";
import { getTransactionHistoryReport, exportToCSV } from "../firebase/reportsService";
import { getStudentFeeProfile } from "../firebase/feeService";
import { auth } from "../firebase/config";
import "../styles/feeManagement.css";

export default function Reports({ session }) {
  const [recentTxns, setRecentTxns] = useState([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [error, setError] = useState(null);

  const [reportType, setReportType] = useState("Daily Collection");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [className, setClassName] = useState("");

  const [reportRows, setReportRows] = useState(null);
  const [runningReport, setRunningReport] = useState(false);

  // Load the recent 5 transactions on mount
  useEffect(() => {
    let active = true;
    setLoadingRecent(true);
    
    // We call the transactions report with no filters to get the latest ones
    getTransactionHistoryReport({ session })
      .then((rows) => {
        if (!active) return;
        // Sort descending by date and take top 5
        const sorted = rows.sort((a, b) => {
          const da = a.createdAt?.toDate?.() || new Date(a.paymentDate || 0);
          const db = b.createdAt?.toDate?.() || new Date(b.paymentDate || 0);
          return db - da;
        });
        setRecentTxns(sorted.slice(0, 5));
      })
      .catch((err) => {
        if (active) setError(err.message || "Failed to load recent transactions.");
      })
      .finally(() => {
        if (active) setLoadingRecent(false);
      });

    return () => { active = false; };
  }, [session]);

  async function handleRunReport() {
    setRunningReport(true);
    setError(null);
    setReportRows(null);
    try {
      const filters = {
        session,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        className: className || undefined,
      };

      // Only "Transaction History" and "Daily Collection" use these specific filters right now
      const rows = await getTransactionHistoryReport(filters);
      setReportRows(rows);
    } catch (err) {
      setError(err.message || "Failed to generate report.");
    } finally {
      setRunningReport(false);
    }
  }

  const renderTable = (rows) => {
    if (!rows || rows.length === 0) {
      return <p className="fm-empty-state">No transactions found for these filters.</p>;
    }

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
              <th>Ref#</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id || i}>
                <td>{r.paymentDate ? new Date(r.paymentDate).toLocaleDateString("en-GB") : "—"}</td>
                <td>{r.receiptNumber || "—"}</td>
                <td>{r.studentName || "—"}</td>
                <td>{r.className || "—"}</td>
                <td style={{ fontWeight: 600 }}>₹{r.amountReceived || r.netAmount || 0}</td>
                <td style={{ color: "#059669" }}>{r.discount > 0 ? `-₹${r.discount}` : "—"}</td>
                <td>{r.paymentMethod || "—"}</td>
                <td>{r.referenceNumber || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="fm-card">
      
      {/* Recent Transactions Section */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>Recent Transactions</h3>
        <button 
          className="fm-primary-btn" 
          onClick={() => {
            setFromDate("");
            setToDate("");
            setClassName("");
            setReportType("Transaction History");
            handleRunReport();
          }}
        >
          View All History
        </button>
      </div>

      {loadingRecent ? (
        <p className="fm-empty-state">Loading recent transactions…</p>
      ) : recentTxns.length === 0 ? (
        <p className="fm-empty-state">No transactions recorded yet.</p>
      ) : (
        renderTable(recentTxns)
      )}

      <hr style={{ margin: "32px 0", border: "none", borderTop: "1px solid #e5e7eb" }} />

      {/* Generate Report Section */}
      <h3>Generate Report</h3>
      <div className="fm-filter-row" style={{ marginTop: 16 }}>
        <select value={reportType} onChange={(e) => setReportType(e.target.value)}>
          <option value="Daily Collection">Daily Collection</option>
          <option value="Monthly Collection">Monthly Collection</option>
          <option value="Transaction History">Transaction History</option>
        </select>

        <input 
          type="date" 
          value={fromDate} 
          onChange={(e) => setFromDate(e.target.value)} 
          title="From Date"
        />
        <input 
          type="date" 
          value={toDate} 
          onChange={(e) => setToDate(e.target.value)} 
          title="To Date"
        />
        <input 
          type="text" 
          placeholder="Class (e.g. X)" 
          value={className} 
          onChange={(e) => setClassName(e.target.value)} 
        />

        <button 
          className="fm-primary-btn" 
          onClick={handleRunReport} 
          disabled={runningReport}
        >
          {runningReport ? "Running…" : "Run Report"}
        </button>

        {reportRows && reportRows.length > 0 && (
          <button 
            className="fm-secondary-btn" 
            onClick={() => exportToCSV(reportRows, `${reportType.replace(/\s+/g, "_")}_Report`)}
          >
            Export CSV
          </button>
        )}
      </div>

      {error && <p className="fm-error" style={{ marginTop: 16 }}>{error}</p>}

      {reportRows && (
        <div style={{ marginTop: 24 }}>
          <h4>Results ({reportRows.length})</h4>
          {renderTable(reportRows)}
        </div>
      )}

    </div>
  );
}
