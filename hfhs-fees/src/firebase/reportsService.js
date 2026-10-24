/**
 * reportsService.js
 * Report queries + CSV export for the monthly billing model.
 */

import { db } from "../firebase/config";
import {
  collection, getDocs, query, where, Timestamp,
} from "firebase/firestore";

const COL = {
  students: "students",
  transactions: "feeTransactions",
  discounts: "discounts",
  monthlyBills: "monthlyBills",
};

const MAX_QUERY_RESULTS = 500;

// ---------------------------------------------------------------------------
// 1. Transaction History (For the Reports Page)
// ---------------------------------------------------------------------------
export async function getTransactionHistoryReport({ session, fromDate, toDate, className } = {}) {
  try {
    let clauses = [where("session", "==", session), where("voided", "==", false)];
    
    // Only add date filters if they actually exist
    if (fromDate) clauses.push(where("createdAt", ">=", Timestamp.fromDate(new Date(fromDate))));
    if (toDate) clauses.push(where("createdAt", "<=", Timestamp.fromDate(new Date(toDate + "T23:59:59"))));

    const snap = await getDocs(
      query(collection(db, COL.transactions), ...clauses)
    );
    
    let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Client-side sort to avoid missing index errors
    rows.sort((a, b) => {
      const da = a.createdAt?.toDate?.() || new Date(a.paymentDate || 0);
      const db = b.createdAt?.toDate?.() || new Date(b.paymentDate || 0);
      return db - da;
    });

    // Client-side class filter to avoid complex composite indexes
    if (className) {
      rows = rows.filter(r => String(r.className || "").toUpperCase() === String(className).toUpperCase());
    }

    return rows;
  } catch (err) {
    console.error("fetchTransactions failed:", err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 2. Dashboard Charts (For the Dashboard Page)
// ---------------------------------------------------------------------------
export async function getMonthlyCollectionTrend({ session, monthsBack = 6 } = {}) {
  try {
    const rows = await getTransactionHistoryReport({ session });
    
    const buckets = {};
    const now = new Date();
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.toLocaleString("default", { month: "short" })} ${d.getFullYear()}`;
      buckets[key] = 0;
    }

    rows.forEach((r) => {
      let paidAt = r.paymentDate?.toDate?.() || new Date(r.paymentDate || r.createdAt?.toDate?.() || 0);
      if (!paidAt || isNaN(paidAt.getTime())) return;
      
      const key = `${paidAt.toLocaleString("default", { month: "short" })} ${paidAt.getFullYear()}`;
      if (key in buckets) {
        buckets[key] += Number(r.netAmount || 0);
      }
    });

    return Object.entries(buckets).map(([month, amount]) => ({ month, amount }));
  } catch (err) {
    console.warn("getMonthlyCollectionTrend failed:", err.message);
    return [];
  }
}

export async function getClassWiseCollectionReport({ session, month } = {}) {
  try {
    const targetMonth = month || new Date().toISOString().slice(0, 7);
    let students = [], bills = [];

    try {
      let sClauses = [where("session", "==", session)];
      const sSnap = await getDocs(query(collection(db, COL.students), ...sClauses));
      students = sSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {}

    try {
      let bClauses = [where("month", "==", targetMonth), where("session", "==", session)];
      const bSnap = await getDocs(query(collection(db, COL.monthlyBills), ...bClauses));
      bills = bSnap.docs.map((d) => d.data());
    } catch (err) {}

    const billByStudent = {};
    bills.forEach((b) => { billByStudent[b.studentId] = b; });

    const byClass = {};
    students.forEach((s) => {
      const bill = billByStudent[s.id];
      const key = `${s.className}-${s.section || ""}`;
      
      if (!byClass[key]) {
        byClass[key] = {
          className: s.className,
          section: s.section || "",
          totalFee: 0,
          totalPaid: 0,
          totalDue: 0,
        };
      }
      
      byClass[key].totalFee += (bill?.totalDue || 0);
      byClass[key].totalPaid += (bill?.totalPaid || 0);
      byClass[key].totalDue += (bill?.carriedForward || 0);
    });

    return Object.values(byClass).sort((a, b) =>
      String(a.className).localeCompare(String(b.className), undefined, { numeric: true })
    );
  } catch (err) {
    console.warn("getClassWiseCollectionReport failed:", err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 3. Helpers
// ---------------------------------------------------------------------------
export async function getAllStudents(opts = {}) {
  const { session, className } = opts;
  try {
    let clauses = [];
    if (session) clauses.push(where("session", "==", session));
    if (className) clauses.push(where("className", "==", className));
    
    const snap = await getDocs(query(collection(db, COL.students), ...clauses));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    return [];
  }
}

export function exportToCSV(rows, filename) {
  if (!rows || rows.length === 0) return;
  const headers = Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== "object");
  const csvLines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`).join(",")),
  ];
  const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
