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

  const today = new Date();
  const formattedDate = today.toLocaleDateString("en-GB", { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
  
  const cashInHand = stats.enteredToday || 0; 
  const bankAmount = 0; 

  return (
    <>
      {loadError && (
        <div className="fm-card" style={{ padding: 12, marginBottom: 12, background: "#fff4e5", borderLeft: "4px solid #ef6c00", fontSize: 13 }}>
          <strong>Partial data:</strong> {loadError}
        </div>
      )}

      {/* TOP SECTION: KPIs */}
      <div style={{ display: "flex", gap: "16px", marginBottom: "16px", flexWrap: "wrap" }}>
        
        {/* Top Left: 6 Small Cards */}
        <div style={{ flex: "1 1 60%", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", gap: "12px" }}>
            <div className="fm-stat-card" style={{ flex: 1, padding: "12px" }}>
              <p className="fm-stat-label">Payments Today</p>
              <p style={{ fontSize: "10px", color: "#64748b", margin: "-4px 0 4px 0" }}>({formattedDate})</p>
              <span className="kpi-pill kpi-blue">₹{(stats.paymentDateToday || 0).toLocaleString()}</span>
            </div>
            <div className="fm-stat-card" style={{ flex: 1, padding: "12px" }}>
              <p className="fm-stat-label">Entered Today</p>
              <span className="kpi-pill kpi-green">₹{(stats.enteredToday || 0).toLocaleString()}</span>
              <p style={{ fontSize: "10px", color: "#94a3b8", marginTop: "6px" }}>Cash: ₹{cashInHand.toLocaleString()} | Bank: ₹{bankAmount.toLocaleString()}</p>
            </div>
            <div className="fm-stat-card" style={{ flex: 1, padding: "12px" }}>
              <p className="fm-stat-label">This Month's Coll.</p>
              <span className="kpi-pill kpi-blue">₹{(stats.monthCollection || 0).toLocaleString()}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: "12px" }}>
            <div className="fm-stat-card" style={{ flex: 1, padding: "12px" }}>
              <p className="fm-stat-label">Students Fully Paid</p>
              <span className="kpi-pill kpi-green">{stats.studentsFullyPaid || 0}</span>
            </div>
            <div className="fm-stat-card" style={{ flex: 1, padding: "12px" }}>
              <p className="fm-stat-label">Students with Due</p>
              <span className="kpi-pill kpi-red">{stats.studentsWithDue || 0}</span>
            </div>
            <div className="fm-stat-card" style={{ flex: 1, padding: "12px" }}>
              <p className="fm-stat-label">Total Advance</p>
              <span className="kpi-pill kpi-green">₹{(stats.totalAdvance || 0).toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Top Right: 3 Wide Cards */}
        <div style={{ flex: "1 1 35%", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div className="fm-stat-card" style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p className="fm-stat-label" style={{ margin: 0 }}>Total Collection</p>
            <span className="kpi-pill kpi-blue">₹{(stats.totalCollection || 0).toLocaleString()}</span>
          </div>
          <div className="fm-stat-card" style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p className="fm-stat-label" style={{ margin: 0 }}>Total Discount</p>
            <span className="kpi-pill kpi-green">₹{(stats.totalDiscount || 0).toLocaleString()}</span>
          </div>
          <div className="fm-stat-card" style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p className="fm-stat-label" style={{ margin: 0 }}>Total Outstanding</p>
            <span className="kpi-pill kpi-red">₹{(stats.totalOutstandingDue || 0).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* BOTTOM SECTION: 3 Charts Symmetrical */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
        <div className="fm-card" style={{ padding: "16px", display: "flex", flexDirection: "column", margin: 0 }}>
          <h3 style={{ margin: "0 0 12px 0", fontSize: "13px", textTransform: "uppercase", color: "#64748b" }}>Monthly Fee Collection</h3>
          <div style={{ flex: 1, minHeight: "180px", width: "100%" }}>
            <MonthlyCollectionChart data={monthlyTrend} />
          </div>
        </div>
        <div className="fm-card" style={{ padding: "16px", display: "flex", flexDirection: "column", margin: 0 }}>
          <h3 style={{ margin: "0 0 12px 0", fontSize: "13px", textTransform: "uppercase", color: "#64748b" }}>Class-wise Paid vs Due</h3>
          <div style={{ flex: 1, minHeight: "180px", width: "100%" }}>
            <ClassWiseChart rows={classWise} />
          </div>
        </div>
        <div className="fm-card" style={{ padding: "16px", display: "flex", flexDirection: "column", margin: 0 }}>
          <h3 style={{ margin: "0 0 12px 0", fontSize: "13px", textTransform: "uppercase", color: "#64748b" }}>Payment Methods</h3>
          <div style={{ flex: 1, minHeight: "180px", width: "100%" }}>
            <PaymentMethodChart data={stats.paymentMethodBreakdown} />
          </div>
        </div>
      </div>
    </>
  );
}
