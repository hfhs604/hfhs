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
    if (!session) { setLoading(false); setStats(null); return; }
    let active = true;
    setLoading(true); setLoadError(null);

    (async () => {
      const [statsRes, cwRes, mtRes] = await Promise.allSettled([
        getDashboardStats(session),
        getClassWiseCollectionReport({ session }),
        getMonthlyCollectionTrend({ session }),
      ]);
      if (!active) return;
      if (statsRes.status === "fulfilled" && statsRes.value) setStats(statsRes.value); else setStats(null);
      if (cwRes.status === "fulfilled") setClassWise(cwRes.value || []); else setClassWise([]);
      if (mtRes.status === "fulfilled") setMonthlyTrend(mtRes.value || []); else setMonthlyTrend([]);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [session]);

  if (loading) return <div className="fm-card fm-empty-state">Loading dashboard…</div>;
  if (!stats) return <div className="fm-card fm-empty-state">No data for this session yet.</div>;

  const cards = [
    ["Payment Date: Today", `₹${(stats.todayCollection || 0).toLocaleString()}`],
    ["Entered Today (Created)", `₹${(stats.enteredToday || 0).toLocaleString()}`],
    ["This Month's Collection", `₹${(stats.monthCollection || 0).toLocaleString()}`],
    ["Total Collection", `₹${(stats.totalCollection || 0).toLocaleString()}`],
    ["Total Outstanding Due", `₹${(stats.totalOutstandingDue || 0).toLocaleString()}`, "fm-due"],
    ["Total Advance", `₹${(stats.totalAdvance || 0).toLocaleString()}`, "fm-advance"],
    ["Students With Due", stats.studentsWithDue || 0],
    ["Students Fully Paid", stats.studentsFullyPaid || 0],
  ];

  return (
    <div className="fm-dashboard-container">
      {loadError && <div className="fm-error" style={{ marginBottom: 12 }}>{loadError}</div>}
      <div className="fm-dashboard-stats">
        {cards.map(([label, value, cls]) => (
          <div className={`fm-stat-card ${cls || ""}`} key={label}>
            <p className="fm-stat-label">{label}</p>
            <p className="fm-stat-value">{value}</p>
          </div>
        ))}
      </div>

      <div className="fm-dashboard-charts">
        <div className="fm-card fm-chart-card"><h3>Monthly Fee Collection</h3><MonthlyCollectionChart data={monthlyTrend} /></div>
        <div className="fm-card fm-chart-card"><h3>Class-wise Paid vs Due</h3><ClassWiseChart rows={classWise} /></div>
        <div className="fm-card fm-chart-card"><h3>Payment Methods</h3><PaymentMethodChart data={stats.paymentMethodBreakdown} /></div>
      </div>
    </div>
  );
}import React, { useEffect, useState } from "react";
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
    if (!session) { setLoading(false); setStats(null); return; }
    let active = true;
    setLoading(true); setLoadError(null);

    (async () => {
      const [statsRes, cwRes, mtRes] = await Promise.allSettled([
        getDashboardStats(session),
        getClassWiseCollectionReport({ session }),
        getMonthlyCollectionTrend({ session }),
      ]);
      if (!active) return;
      if (statsRes.status === "fulfilled" && statsRes.value) setStats(statsRes.value); else setStats(null);
      if (cwRes.status === "fulfilled") setClassWise(cwRes.value || []); else setClassWise([]);
      if (mtRes.status === "fulfilled") setMonthlyTrend(mtRes.value || []); else setMonthlyTrend([]);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [session]);

  if (loading) return <div className="fm-card fm-empty-state">Loading dashboard…</div>;
  if (!stats) return <div className="fm-card fm-empty-state">No data for this session yet.</div>;

  const cards = [
    ["Payment Date: Today", `₹${(stats.todayCollection || 0).toLocaleString()}`],
    ["Entered Today (Created)", `₹${(stats.enteredToday || 0).toLocaleString()}`],
    ["This Month's Collection", `₹${(stats.monthCollection || 0).toLocaleString()}`],
    ["Total Collection", `₹${(stats.totalCollection || 0).toLocaleString()}`],
    ["Total Outstanding Due", `₹${(stats.totalOutstandingDue || 0).toLocaleString()}`, "fm-due"],
    ["Total Advance", `₹${(stats.totalAdvance || 0).toLocaleString()}`, "fm-advance"],
    ["Students With Due", stats.studentsWithDue || 0],
    ["Students Fully Paid", stats.studentsFullyPaid || 0],
  ];

  return (
    <div className="fm-dashboard-container">
      {loadError && <div className="fm-error" style={{ marginBottom: 12 }}>{loadError}</div>}
      <div className="fm-dashboard-stats">
        {cards.map(([label, value, cls]) => (
          <div className={`fm-stat-card ${cls || ""}`} key={label}>
            <p className="fm-stat-label">{label}</p>
            <p className="fm-stat-value">{value}</p>
          </div>
        ))}
      </div>

      <div className="fm-dashboard-charts">
        <div className="fm-card fm-chart-card"><h3>Monthly Fee Collection</h3><MonthlyCollectionChart data={monthlyTrend} /></div>
        <div className="fm-card fm-chart-card"><h3>Class-wise Paid vs Due</h3><ClassWiseChart rows={classWise} /></div>
        <div className="fm-card fm-chart-card"><h3>Payment Methods</h3><PaymentMethodChart data={stats.paymentMethodBreakdown} /></div>
      </div>
    </div>
  );
}
