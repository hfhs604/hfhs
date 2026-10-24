/**
 * reportsService.js
 * Report queries + CSV export for the monthly billing model.
 */

import { db } from "../firebase/config";
import {
  collection, getDocs, query, where, orderBy, limit as fsLimit, Timestamp,
} from "firebase/firestore";

const COL = {
  students: "students",
  transactions: "feeTransactions",
  discounts: "discounts",
  monthlyBills: "monthlyBills",
};

const MAX_QUERY_RESULTS = 500;

export async function getTransactionHistoryReport({ session, fromDate, toDate, className } = {}) {
  try {
    let clauses = [where("session", "==", session), where("voided", "==", false)];
    
    // Only add date filters if they actually exist
    if (fromDate) clauses.push(where("createdAt", ">=", Timestamp.fromDate(new Date(fromDate))));
    if (toDate) clauses.push(where("createdAt", "<=", Timestamp.fromDate(new Date(toDate + "T23:59:59"))));

    const snap = await getDocs(
      query(collection(db, COL.transactions), ...clauses, fsLimit(MAX_QUERY_RESULTS))
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

export async function getAllStudentsWithBills({ session, className, month } = {}) {
  const targetMonth = month || new Date().toISOString().slice(0, 7);
  let students = [], bills = [];

  try {
    let sClauses = [];
    if (session) sClauses.push(where("session", "==", session));
    if (className) sClauses.push(where("className", "==", className));
    const sSnap = await getDocs(query(collection(db, COL.students), ...sClauses, fsLimit(MAX_QUERY_RESULTS)));
    students = sSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {}

  try {
    let bClauses = [where("month", "==", targetMonth)];
    if (session) bClauses.push(where("session", "==", session));
    const bSnap = await getDocs(query(collection(db, COL.monthlyBills), ...bClauses, fsLimit(MAX_QUERY_RESULTS)));
    bills = bSnap.docs.map((d) => d.data());
  } catch (err) {}

  const billByStudent = {};
  bills.forEach((b) => { billByStudent[b.studentId] = b; });

  return students.map((s) => {
    const bill = billByStudent[s.id];
    const totalDue = bill?.carriedForward || 0;
    const totalPaid = bill?.totalPaid || 0;
    const totalFee = bill?.totalDue || 0;
    let accountStatus = "PAID";
    if (totalDue > 0 && totalPaid > 0) accountStatus = "PARTIAL";
    else if (totalDue > 0) accountStatus = "DUE";

    return { ...s, month: targetMonth, totalDue, totalPaid, totalFee, totalAdvance: 0, accountStatus };
  });
}

export async function getAllStudents(opts = {}) {
  return getAllStudentsWithBills(opts);
}

export async function exportToCSV(rows, filename) {
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
