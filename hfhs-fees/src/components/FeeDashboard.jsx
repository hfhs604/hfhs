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

  const hour = new Date().getHours();
  let greeting = "Good Evening";
  if (hour < 12) greeting = "Good Morning";
  else if (hour < 17) greeting = "Good Afternoon";
  else if (hour < 21) greeting = "Good Evening";
  else greeting = "Good Night";

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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h2 style={{ margin: 0, fontSize: "1.2rem", color: "#0f172a" }}>Dashboard</h2>
        <h2 style={{ margin: 0, fontSize: "1.2rem", color: "#0f172a" }}>
          {greeting}, <span style={{ color: "#2563eb" }}>Admin</span>
        </h2>
      </div>

      {/* TOP SECTION: KPIs */}
      <div style={{ display: "flex", gap: "16px", marginBottom: "16px", flexWrap: "wrap" }}>
        
        {/* Top Left: 6 Small Cards */}
        <div style={{ flex: "1 1 60%", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", gap: "12px" }}>
            <div className="fm-stat-card" style={{ flex: 1, padding: "12px" }}>
              <p className="fm-stat-label">Payments Today</p>
              <p style={{ fontSize: "10px", color: "#64748b", margin: "-4px 0 4px 0" }}>({formattedDate})</p>
              <p className="fm-stat-value">₹{(stats.paymentDateToday || 0).toLocaleString()}</p>
            </div>
            <div className="fm-stat-card" style={{ flex: 1, padding: "12px" }}>
              <p className="fm-stat-label">Entered Today</p>
              <p className="fm-stat-value">₹{(stats.enteredToday || 0).toLocaleString()}</p>
              <p style={{ fontSize: "10px", color: "#94a3b8", marginTop: "4px" }}>Cash: ₹{cashInHand.toLocaleString()} | Bank: ₹{bankAmount.toLocaleString()}</p>
            </div>
            <div className="fm-stat-card" style={{ flex: 1, padding: "12px" }}>
              <p className="fm-stat-label">This Month's Coll.</p>
              <p className="fm-stat-value">₹{(stats.monthCollection || 0).toLocaleString()}</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: "12px" }}>
            <div className="fm-stat-card" style={{ flex: 1, padding: "12px" }}>
              <p className="fm-stat-label">Students Fully Paid</p>
              <p className="fm-stat-value">{stats.studentsFullyPaid || 0}</p>
            </div>
            <div className="fm-stat-card" style={{ flex: 1, padding: "12px" }}>
              <p className="fm-stat-label">Students with Due</p>
              <p className="fm-stat-value">{stats.studentsWithDue || 0}</p>
            </div>
            <div className="fm-stat-card" style={{ flex: 1, padding: "12px" }}>
              <p className="fm-stat-label">Total Advance</p>
              <p className="fm-stat-value fm-advance">₹{(stats.totalAdvance || 0).toLocaleString()}</p>
            </div>
          </div>
        </div>

        {/* Top Right: 3 Wide Cards */}
        <div style={{ flex: "1 1 35%", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div className="fm-stat-card" style={{ padding: "12px 16px" }}>
            <p className="fm-stat-label">Total Collection</p>
            <p className="fm-stat-value">₹{(stats.totalCollection || 0).toLocaleString()}</p>
          </div>
          <div className="fm-stat-card" style={{ padding: "12px 16px" }}>
            <p className="fm-stat-label">Total Discount</p>
            <p className="fm-stat-value fm-discount">₹{(stats.totalDiscount || 0).toLocaleString()}</p>
          </div>
          <div className="fm-stat-card" style={{ padding: "12px 16px" }}>
            <p className="fm-stat-label">Total Outstanding</p>
            <p className="fm-stat-value fm-due">₹{(stats.totalOutstandingDue || 0).toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* BOTTOM SECTION: 3 Charts */}
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", flex: 1 }}>
        <div className="fm-card" style={{ flex: 1, padding: "16px", display: "flex", flexDirection: "column" }}>
          <h3 style={{ margin: "0 0 12px 0", fontSize: "13px", textTransform: "uppercase", color: "#64748b" }}>Monthly Fee Collection</h3>
          <div style={{ flex: 1, minHeight: "200px", width: "100%" }}>
            <MonthlyCollectionChart data={monthlyTrend} />
          </div>
        </div>
        <div className="fm-card" style={{ flex: 1, padding: "16px", display: "flex", flexDirection: "column" }}>
          <h3 style={{ margin: "0 0 12px 0", fontSize: "13px", textTransform: "uppercase", color: "#64748b" }}>Class-wise Paid vs Due</h3>
          <div style={{ flex: 1, minHeight: "200px", width: "100%" }}>
            <ClassWiseChart rows={classWise} />
          </div>
        </div>
        <div className="fm-card" style={{ flex: 1, padding: "16px", display: "flex", flexDirection: "column" }}>
          <h3 style={{ margin: "0 0 12px 0", fontSize: "13px", textTransform: "uppercase", color: "#64748b" }}>Payment Methods</h3>
          <div style={{ flex: 1, minHeight: "200px", width: "100%" }}>
            <PaymentMethodChart data={stats.paymentMethodBreakdown} />
          </div>
        </div>
      </div>

      <footer className="fm-footer" style={{ marginTop: "20px" }}>
        All rights reserved © Holy Faith
      </footer>
    </>
  );
}
