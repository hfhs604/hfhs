import React from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid
} from "recharts";

const COLORS = ["#1e293b", "#2563eb", "#16a34a", "#f59e0b", "#dc2626"];

/** Payment method distribution (pie) */
export function PaymentMethodChart({ data }) {
  const rows = Object.entries(data || {}).map(([name, value]) => ({ name, value }));
  if (rows.length === 0) return <p className="fm-empty-state">No payment data yet.</p>;
  
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <Pie 
          data={rows} 
          dataKey="value" 
          nameKey="name" 
          cx="50%" 
          cy="45%" 
          innerRadius={50}
          outerRadius={75} 
          paddingAngle={2}
          label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
          labelLine={false}
        >
          {rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v) => `₹${v.toLocaleString()}`} />
        <Legend 
          verticalAlign="bottom" 
          height={36} 
          iconType="circle" 
          wrapperStyle={{ fontSize: 11, paddingTop: 10 }} 
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Class-wise Paid vs Due (stacked bar) */
export function ClassWiseChart({ rows }) {
  if (!rows || rows.length === 0) return <p className="fm-empty-state">No class data yet.</p>;
  
  const data = rows.map((r) => ({ 
    className: `${r.className}`, 
    Paid: r.totalPaid, 
    Due: r.totalDue 
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="className" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${v/1000}k`} />
        <Tooltip formatter={(v) => `₹${v.toLocaleString()}`} cursor={{ fill: '#f8fafc' }} />
        <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="Paid" stackId="a" fill="#16a34a" radius={[0, 0, 4, 4]} />
        <Bar dataKey="Due" stackId="a" fill="#dc2626" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Monthly collection trend (line) */
export function MonthlyCollectionChart({ data }) {
  if (!data || data.length === 0) return <p className="fm-empty-state">No collection data yet.</p>;
  
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${v/1000}k`} />
        <Tooltip formatter={(v) => `₹${v.toLocaleString()}`} />
        <Line 
          type="monotone" 
          dataKey="amount" 
          stroke="#2563eb" 
          strokeWidth={3} 
          dot={{ r: 4, fill: "#2563eb", strokeWidth: 2, stroke: "#fff" }}
          activeDot={{ r: 6 }} 
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
