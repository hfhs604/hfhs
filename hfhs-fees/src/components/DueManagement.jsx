import React, { useEffect, useState } from "react";
import { listBillsForMonth, getStudentFeeProfile } from "../firebase/feeService";
import DemandSlipSheet from "./DemandSlipSheet";
import PrintManager from "./PrintManager";
import "../styles/feeManagement.css";

const CLASS_OPTIONS = [
  "Pre-LKG", "NUR", "LKG", "UKG",
  "I", "II", "III", "IV", "V",
  "VI", "VII", "VIII", "IX", "X",
];

export default function DueManagement({ session }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [className, setClassName] = useState("");
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [printingItems, setPrintingItems] = useState(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    listBillsForMonth(session, month)
      .then((rows) => {
        if (!active) return;
        const due = rows
          .filter((b) => (b.carriedForward || 0) > 0)
          .filter((b) => !className || b.className === className)
          .sort((a, b) => (b.carriedForward || 0) - (a.carriedForward || 0));
        setBills(due);
      })
      .catch((err) => {
        if (active) setError(err.message || "Could not load dues.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session, month, className]);

  const totalDue = bills.reduce((sum, b) => sum + (b.carriedForward || 0), 0);

  async function fetchStudentInfo(studentId) {
    try {
      return await getStudentFeeProfile(studentId);
    } catch {
      return null;
    }
  }

  async function printBulkSlips() {
    if (bills.length === 0) return;
    setPrinting(true);
    try {
      const items = await Promise.all(
        bills.map(async (b) => ({
          bill: b,
          student: await fetchStudentInfo(b.studentId),
        }))
      );
      setPrintingItems(items);
    } catch (err) {
      setError(err.message || "Could not prepare slips.");
    } finally {
      setPrinting(false);
    }
  }

  async function printOneSlip(bill) {
    setPrinting(true);
    try {
      const student = await fetchStudentInfo(bill.studentId);
      setPrintingItems([{ bill, student }]);
    } catch (err) {
      setError(err.message || "Could not prepare slip.");
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="fm-card">
      <h2>Due Fees</h2>
      <p className="fm-hint">
        Students with an outstanding balance for the selected month.
      </p>

      <div className="fm-filter-row">
        <label className="fm-inline-label">
          Month
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>

        <label className="fm-inline-label">
          Class
          <select
            value={className}
            onChange={(e) => setClassName(e.target.value)}
          >
            <option value="">All Classes</option>
            {CLASS_OPTIONS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>

        <div className="fm-inline-label">
          <span>Total outstanding</span>
          <strong style={{ fontSize: "1.1em" }}>
            ₹{totalDue.toLocaleString()}
          </strong>
        </div>

        <button
          className="fm-primary-btn"
          onClick={printBulkSlips}
          disabled={printing || bills.length === 0}
          style={{ marginLeft: "auto" }}
        >
          {printing
            ? "Preparing…"
            : `🖨 Print Demand Slips (${bills.length})`}
        </button>
      </div>

      {loading ? (
        <p className="fm-empty-state">Loading…</p>
      ) : error ? (
        <p className="fm-empty-state" style={{ color: "#c62828" }}>
          {error}
        </p>
      ) : bills.length === 0 ? (
        <p className="fm-empty-state">
          No students with outstanding dues for this filter.
        </p>
      ) : (
        <div className="fm-table-scroll">
          <table className="fm-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Adm#</th>
                <th>Class</th>
                <th>Previous Due</th>
                <th>Tuition</th>
                <th>Transport</th>
                <th>Other</th>
                <th>Total Due</th>
                <th>Paid</th>
                <th>Balance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => {
                const other =
                  (b.devFeeBilled || 0) +
                  (b.booksBilled || 0) +
                  (b.previousYearBilled || 0) +
                  (b.kitFeeBilled || 0);
                return (
                  <tr key={b.id}>
                    <td>{b.studentName || "—"}</td>
                    <td>{b.studentId || "—"}</td>
                    <td>{b.className || "—"}</td>
                    <td>₹{b.previousDue || 0}</td>
                    <td>₹{b.tuitionBilled || 0}</td>
                    <td>₹{b.transportBilled || 0}</td>
                    <td>₹{other}</td>
                    <td>₹{b.totalDue || 0}</td>
                    <td>₹{b.totalPaid || 0}</td>
                    <td className="fm-due-cell">
                      🔴 ₹{b.carriedForward || 0}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="fm-link-btn"
                        onClick={() => printOneSlip(b)}
                        disabled={printing}
                      >
                        🖨 Slip
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <PrintManager
        active={!!printingItems}
        onClose={() => setPrintingItems(null)}
        type="slip"
      >
        {printingItems && <DemandSlipSheet items={printingItems} />}
      </PrintManager>
    </div>
  );
}
