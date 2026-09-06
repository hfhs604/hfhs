import React, { useEffect, useState } from "react";
import { getStudentsWithDue } from "../firebase/feeService";
import "../styles/feeManagement.css";

export default function DueManagement({ session }) {
  const [filters, setFilters] = useState({ className: "", section: "" });
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getStudentsWithDue({ session, ...filters })
      .then((list) => active && setStudents(list))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [session, filters.className, filters.section]);

  return (
    <div className="fm-card">
      <h2>Due Fees</h2>
      <div className="fm-filter-row">
        <input placeholder="Class" value={filters.className}
          onChange={(e) => setFilters({ ...filters, className: e.target.value })} />
        <input placeholder="Section" value={filters.section}
          onChange={(e) => setFilters({ ...filters, section: e.target.value })} />
      </div>

      {loading ? (
        <p className="fm-empty-state">Loading…</p>
      ) : students.length === 0 ? (
        <p className="fm-empty-state">No students with outstanding dues for this filter.</p>
      ) : (
        <table className="fm-table">
          <thead>
            <tr>
              <th>Student</th><th>Adm#</th><th>Class</th><th>Guardian</th>
              <th>Mobile</th><th>Total Fee</th><th>Paid</th><th>Due</th><th>Last Payment</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.admissionNumber}</td>
                <td>{s.className}-{s.section}</td>
                <td>{s.guardianName}</td>
                <td>{s.mobileNumber}</td>
                <td>₹{s.totalAnnualFee}</td>
                <td>₹{s.totalAmountPaid}</td>
                <td className="fm-due-cell">🔴 ₹{s.totalDue}</td>
                <td>{s.lastPaymentDate?.toDate?.().toLocaleDateString?.() || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
