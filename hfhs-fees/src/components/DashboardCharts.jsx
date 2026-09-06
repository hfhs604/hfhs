import React from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const COLORS = ["#1a3d6d", "#2e7d32", "#ef6c00", "#c62828", "#6a1b9a"];

/** Payment method distribution (pie) — feed with stats.paymentMethodBreakdown */
export function PaymentMethodChart({ data }) {
  const rows = Object.entries(data || {}).map(([name, value]) => ({ name, value }));
  if (rows.length === 0) return <p className="fm-empty-state">No payment data yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="name" outerRadius={90} label>
          {rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v) => `₹${v.toLocaleString()}`} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Class-wise Paid vs Due (stacked bar) — feed with rows from getClassWiseCollectionReport */
export function ClassWiseChart({ rows }) {
  if (!rows || rows.length === 0) return <p className="fm-empty-state">No class data yet.</p>;
  const data = rows.map((r) => ({ className: `${r.className}-${r.section}`, Paid: r.totalPaid, Due: r.totalDue }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data}>
        <XAxis dataKey="className" />
        <YAxis />
        <Tooltip formatter={(v) => `₹${v.toLocaleString()}`} />
        <Legend />
        <Bar dataKey="Paid" stackId="a" fill="#2e7d32" />
        <Bar dataKey="Due" stackId="a" fill="#c62828" />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Monthly collection trend (line) — feed with [{month: "Jan", amount: 12000}, ...] */
export function MonthlyCollectionChart({ data }) {
  if (!data || data.length === 0) return <p className="fm-empty-state">No collection data yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data}>
        <XAxis dataKey="month" />
        <YAxis />
        <Tooltip formatter={(v) => `₹${v.toLocaleString()}`} />
        <Line type="monotone" dataKey="amount" stroke="#1a3d6d" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}
