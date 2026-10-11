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
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (!session) {
      setLoading(false);
      setStats(null);
      return;
    }

    let active = true;
    setLoading(true);
    setLoadError(null);

    (async () => {
      // allSettled: one failing report can't blank the whole dashboard.
      const [statsRes, cwRes, mtRes] = await Promise.allSettled([
        getDashboardStats(session),
        getClassWiseCollectionReport({ session }),
        getMonthlyCollectionTrend({ session }),
      ]);

      if (!active) return;

      if (statsRes.status === "fulfilled" && statsRes.value) {
        setStats(statsRes.value);
      } else {
        setStats(null);
        console.error("getDashboardStats failed:", statsRes.reason);
      }

      if (cwRes.status === "fulfilled") {
        setClassWise(cwRes.value || []);
      } else {
        setClassWise([]);
        console.error("getClassWiseCollectionReport failed:", cwRes.reason);
      }

      if (mtRes.status === "fulfilled") {
        setMonthlyTrend(mtRes.value || []);
      } else {
        setMonthlyTrend([]);
        console.error("getMonthlyCollectionTrend failed:", mtRes.reason);
      }

      const failures = [statsRes, cwRes, mtRes].filter(
        (r) => r.status === "rejected"
      );
      if (failures.length > 0) {
        setLoadError(
          failures.map((f) => f.reason?.message || String(f.reason)).join(" | ")
        );
      }

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [session]);

  if (loading) {
    return <div className="fm-card fm-empty-state">Loading dashboard…</div>;
  }

  // Show the real error, not "no data" — so you can fix the missing index.
  if (!stats && loadError) {
    return (
      <div className="fm-card fm-empty-state" style={{ padding: 24, textAlign: "left" }}>
        <p style={{ fontWeight: 600, color: "#c62828" }}>
          Could not load dashboard data.
        </p>
        <p style={{ fontSize: 13, marginTop: 8, color: "#4b5563" }}>
          {loadError}
        </p>
        <p style={{ fontSize: 12, marginTop: 12, color: "#6b7280" }}>
          If the message mentions an index, open the link in DevTools → Console
          to create it, then reload.
        </p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="fm-card fm-empty-state">
        No data for this session yet.
      </div>
    );
  }

  const cards = [
    ["Today's Collection", `₹${(stats.todayCollection || 0).toLocaleString()}`],
    ["This Month's Collection", `₹${(stats.monthCollection || 0).toLocaleString()}`],
    ["Total Collection", `₹${(stats.totalCollection || 0).toLocaleString()}`],
    ["Total Outstanding Due", `₹${(stats.totalOutstandingDue || 0).toLocaleString()}`, "fm-due"],
    ["Total Advance", `₹${(stats.totalAdvance || 0).toLocaleString()}`, "fm-advance"],
    ["Students With Due", stats.studentsWithDue || 0],
    ["Students Fully Paid", stats.studentsFullyPaid || 0],
  ];

  return (
    <>
      {loadError && (
        <div
          className="fm-card"
          style={{
            padding: 12,
            marginBottom: 12,
            background: "#fff4e5",
            borderLeft: "4px solid #ef6c00",
            fontSize: 13,
          }}
        >
          <strong>Partial data:</strong> {loadError}
        </div>
      )}

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
