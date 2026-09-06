import React, { useEffect, useState } from "react";
import { getDashboardStats } from "../firebase/feeService";
import { getClassWiseCollectionReport, getMonthlyCollectionTrend } from "../firebase/reportsService";
import { PaymentMethodChart, ClassWiseChart, MonthlyCollectionChart } from "./DashboardCharts";
import "../styles/feeManagement.css";

export default function FeeDashboard({ session }) {
  const [stats, setStats] = useState(null);
  const [classWise, setClassWise] = useState([]);
  const [monthlyTrend, setMonthlyTrend] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      getDashboardStats(session),
      getClassWiseCollectionReport({ session }),
      getMonthlyCollectionTrend({ session }),
    ])
      .then(([s, cw, mt]) => {
        if (!active) return;
        setStats(s);
        setClassWise(cw);
        setMonthlyTrend(mt);
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [session]);

  if (loading) return <div className="fm-card fm-empty-state">Loading dashboard…</div>;
  if (!stats) return <div className="fm-card fm-empty-state">No data for this session yet.</div>;

  const cards = [
    ["Today's Collection", `₹${stats.todayCollection.toLocaleString()}`],
    ["This Month's Collection", `₹${stats.monthCollection.toLocaleString()}`],
    ["Total Collection", `₹${stats.totalCollection.toLocaleString()}`],
    ["Total Outstanding Due", `₹${stats.totalOutstandingDue.toLocaleString()}`, "fm-due"],
    ["Total Advance", `₹${stats.totalAdvance.toLocaleString()}`, "fm-advance"],
    ["Students With Due", stats.studentsWithDue],
    ["Students Fully Paid", stats.studentsFullyPaid],
  ];

  return (
    <>
      <div className="fm-dashboard-grid">
        {cards.map(([label, value, cls]) => (
          <div className={`fm-stat-card ${cls || ""}`} key={label}>
            <p className="fm-stat-label">{label}</p>
            <p className="fm-stat-value">{value}</p>
          </div>
        ))}
      </div>

      <div className="fm-chart-grid">
        <div className="fm-card">
          <h3>Monthly Fee Collection</h3>
          <MonthlyCollectionChart data={monthlyTrend} />
        </div>
        <div className="fm-card">
          <h3>Class-wise Paid vs Due</h3>
          <ClassWiseChart rows={classWise} />
        </div>
        <div className="fm-card">
          <h3>Payment Method Distribution</h3>
          <PaymentMethodChart data={stats.paymentMethodBreakdown} />
        </div>
      </div>
    </>
  );
}
