import React from "react";
import schoolLogo from "../assets/school-logo.jpg";

const SCHOOL = {
  name: "HOLY FAITH HIGH SCHOOL",
  address: "Tarwara More, Siwan, Bihar – 841227",
  contact: "+91-9934723574",
  registrationNumber: "21812302021829794631",
  logoUrl: schoolLogo,
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseMonth(monthStr) {
  // monthStr is "2026-10"
  if (!monthStr) return { monthName: "", year: "" };
  const [year, monthNum] = monthStr.split("-").map(Number);
  return {
    monthName: MONTH_NAMES[monthNum - 1] || "",
    year: String(year),
  };
}

function buildParticulars(bill) {
  const items = [];
  if (!bill) return items;

  if ((bill.previousDue || 0) > 0) {
    items.push({ label: "Previous Due", amount: bill.previousDue });
  }
  if ((bill.tuitionBilled || 0) > 0) {
    items.push({ label: "Tuition Fee", amount: bill.tuitionBilled });
  }
  if ((bill.transportBilled || 0) > 0) {
    items.push({ label: "Transport Fee", amount: bill.transportBilled });
  }
  if ((bill.devFeeBilled || 0) > 0) {
    items.push({ label: "Development Fee", amount: bill.devFeeBilled });
  }
  if ((bill.booksBilled || 0) > 0) {
    items.push({ label: "Books Fee", amount: bill.booksBilled });
  }
  if ((bill.previousYearBilled || 0) > 0) {
    items.push({ label: "Previous Year Balance", amount: bill.previousYearBilled });
  }
  if ((bill.kitFeeBilled || 0) > 0) {
    items.push({ label: "Admission / Kit Fee", amount: bill.kitFeeBilled });
  }
  return items;
}

export default function DemandSlipCard({ bill, student }) {
  const { monthName, year } = parseMonth(bill?.month);
  const particulars = buildParticulars(bill);
  const totalDue = bill?.carriedForward || bill?.totalDue || 0;
  const deadline = `10-${monthName}-${year}`;

  return (
    <div className="demand-slip">
      <header className="demand-slip-header">
        <img src={SCHOOL.logoUrl} alt="" className="demand-slip-logo" />
        <div className="demand-slip-header-text">
          <h3>{SCHOOL.name}</h3>
          <p>{SCHOOL.address}</p>
          <p>📞 {SCHOOL.contact}</p>
        </div>
      </header>

      <div className="demand-slip-title">
        FEE DEMAND SLIP — {monthName} {year}
      </div>

      <div className="demand-slip-student">
        <div><strong>Name:</strong> {student?.name || bill?.studentName || "—"}</div>
        <div><strong>Adm#:</strong> {student?.admissionNumber || bill?.studentId || "—"}</div>
        <div><strong>Class:</strong> {student?.className || bill?.className || "—"}</div>
        <div><strong>Roll:</strong> {student?.rollNumber ?? "—"}</div>
        <div className="demand-slip-full">
          <strong>Father:</strong> {student?.fatherName || student?.guardianName || "—"}
        </div>
        {student?.mobileNumber && (
          <div className="demand-slip-full">
            <strong>Mobile:</strong> {student.mobileNumber}
          </div>
        )}
      </div>

      <table className="demand-slip-table">
        <thead>
          <tr>
            <th>Particulars</th>
            <th style={{ textAlign: "right" }}>₹</th>
          </tr>
        </thead>
        <tbody>
          {particulars.length === 0 ? (
            <tr>
              <td colSpan={2} style={{ textAlign: "center", color: "#888" }}>
                No outstanding items
              </td>
            </tr>
          ) : (
            particulars.map((p, i) => (
              <tr key={i}>
                <td>{p.label}</td>
                <td align="right">{Number(p.amount).toFixed(2)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="demand-slip-total">
        <span>TOTAL DUE</span>
        <span>₹{totalDue.toFixed(0)}</span>
      </div>

      <div className="demand-slip-footer">
        Kindly clear the dues by <strong>{deadline}</strong> to avoid late fee.
      </div>
    </div>
  );
}
