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
      const [statsRes, cwRes, mtRes] = await Promise.allSettled([
        getDashboardStats(session),
        getClassWiseCollectionReport({ session }),
        getMonthlyCollectionTrend({ session }),
      ]);

      if (!active) return;

      if (statsRes.status === "fulfilled" && statsRes.value) setStats(statsRes.value);
      else setStats(null);

      if (cwRes.status === "fulfilled") setClassWise(cwRes.value || []);
      else setClassWise([]);

      if (mtRes.status === "fulfilled") setMonthlyTrend(mtRes.value || []);
      else setMonthlyTrend([]);

      const failures = [statsRes, cwRes, mtRes].filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        setLoadError(failures.map((f) => f.reason?.message || String(f.reason)).join(" | "));
      }

      setLoading(false);
    })();

    return () => { active = false; };
  }, [session]);

  if (loading) return <div className="fm-card fm-empty-state">Loading dashboard…</div>;
  if (!stats) return <div className="fm-card fm-empty-state">No data for this session yet.</div>;

  const currentMonthName = new Date().toLocaleString('default', { month: 'long' });

  // You can dynamically calculate Cash vs Bank here if you have the data
  // For now, we will just display the total from the stats.
  const cashInHand = stats.enteredToday || 0; 
  const bankAmount = 0; 

  const cards = [
    { 
      label: "Payments on Sys Date", 
      value: `₹${(stats.paymentDateToday || 0).toLocaleString()}` 
    },
    { 
      label: "Today's Income", 
      value: `₹${(stats.enteredToday || 0).toLocaleString()}`,
      sub: `Cash: ₹${cashInHand.toLocaleString()} | Bank: ₹${bankAmount.toLocaleString()}`
    },
    { 
      label: `${currentMonthName}'s Collection`, 
      value: `₹${(stats.monthCollection || 0).toLocaleString()}` 
    },
    { 
      label: "Total Collection (Cash)", 
      value: `₹${(stats.totalCollection || 0).toLocaleString()}` 
    },
    { 
      label: "Discount", 
      value: `₹${(stats.totalDiscount || 0).toLocaleString()}`, 
      cls: "fm-discount" 
    },
    { 
      label: "Outstanding Due", 
      value: `₹${(stats.totalOutstandingDue || 0).toLocaleString()}`, 
      cls: "fm-due" 
    },
    { 
      label: "Advance", 
      value: `₹${(stats.totalAdvance || 0).toLocaleString()}`, 
      cls: "fm-advance" 
    },
    { 
      label: "Students with Due", 
      value: stats.studentsWithDue || 0 
    },
    { 
      label: "Students Fully Paid", 
      value: stats.studentsFullyPaid || 0 
    },
  ];

  return (
    <>
      {loadError && (
        <div className="fm-card" style={{ padding: 12, marginBottom: 12, background: "#fff4e5", borderLeft: "4px solid #ef6c00", fontSize: 13 }}>
          <strong>Partial data:</strong> {loadError}
        </div>
      )}

      <div className="fm-dashboard-grid">
        {cards.map((card, idx) => (
          <div className={`fm-stat-card ${card.cls || ""}`} key={idx}>
            <p className="fm-stat-label">{card.label}</p>
            <p className="fm-stat-value">{card.value}</p>
            {card.sub && <p className="fm-stat-sub">{card.sub}</p>}
          </div>
        ))}
      </div>

      <div className="fm-chart-grid">
        <div className="fm-card">
          <h3>Monthly Fee Collection</h3>
          <div className="chart-container">
            <MonthlyCollectionChart data={monthlyTrend} />
          </div>
        </div>
        <div className="fm-card">
          <h3>Class-wise Paid vs Due</h3>
          <div className="chart-container">
            <ClassWiseChart rows={classWise} />
          </div>
        </div>
        <div className="fm-card">
          <h3>Payment Methods</h3>
          <div className="chart-container">
            <PaymentMethodChart data={stats.paymentMethodBreakdown} />
          </div>
        </div>
      </div>
    </>
  );
}
