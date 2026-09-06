/**
 * reportsService.js
 * All report queries + CSV export helper. Sits alongside feeService.js and
 * reuses the same `db` import — kept in its own file since Reports is a
 * distinct, growing surface (12 report types) and shouldn't bloat the core
 * transactional service.
 */

import { db } from "../firebase/config";
import {
  collection, getDocs, query, where, orderBy, Timestamp,
} from "firebase/firestore";
import { computeBalanceView } from "./feeService";

const COL = {
  students: "students",
  transactions: "feeTransactions",
  discounts: "discounts",
};

function toDateRangeClauses(field, fromDate, toDate) {
  const clauses = [];
  if (fromDate) clauses.push(where(field, ">=", Timestamp.fromDate(new Date(fromDate))));
  if (toDate) clauses.push(where(field, "<=", Timestamp.fromDate(new Date(toDate + "T23:59:59"))));
  return clauses;
}

async function fetchTransactions({ fromDate, toDate, session, paymentMethod, className }) {
  let clauses = [where("voided", "==", false)];
  if (session) clauses.push(where("session", "==", session));
  if (paymentMethod) clauses.push(where("paymentMethod", "==", paymentMethod));
  clauses = clauses.concat(toDateRangeClauses("createdAt", fromDate, toDate));

  const snap = await getDocs(query(collection(db, COL.transactions), ...clauses, orderBy("createdAt", "desc")));
  let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // className isn't stored on the transaction itself in the base schema —
  // join against students when that filter is requested.
  if (className) {
    const studentIds = new Set(rows.map((r) => r.studentId));
    const classStudents = await getAllStudents({ className });
    const allowed = new Set(classStudents.map((s) => s.id));
    rows = rows.filter((r) => allowed.has(r.studentId));
  }
  return rows;
}

export async function getAllStudents({ className, session } = {}) {
  let clauses = [];
  if (className) clauses.push(where("className", "==", className));
  if (session) clauses.push(where("session", "==", session));
  const snap = await getDocs(clauses.length ? query(collection(db, COL.students), ...clauses) : collection(db, COL.students));
  return snap.docs.map((d) => computeBalanceView({ id: d.id, ...d.data() }));
}

// ---------------------------------------------------------------------------
// Collection reports (daily / monthly / annual / class-wise all share shape)
// ---------------------------------------------------------------------------

export async function getCollectionReport(filters) {
  const rows = await fetchTransactions(filters);
  const totalCollected = rows.reduce((s, r) => s + (r.netAmount || 0), 0);
  return { rows, totalCollected, count: rows.length };
}

export async function getClassWiseCollectionReport({ session, fromDate, toDate }) {
  const students = await getAllStudents({ session });
  const byClass = {};
  students.forEach((s) => {
    const key = `${s.className}-${s.section}`;
    byClass[key] = byClass[key] || { className: s.className, section: s.section, totalFee: 0, totalPaid: 0, totalDue: 0 };
    byClass[key].totalFee += s.totalAnnualFee || 0;
    byClass[key].totalPaid += s.totalAmountPaid || 0;
    byClass[key].totalDue += s.totalDue || 0;
  });
  return Object.values(byClass).sort((a, b) => a.className - b.className);
}

export async function getStudentStatement(studentId) {
  const snap = await getDocs(query(collection(db, COL.transactions), where("studentId", "==", studentId), orderBy("createdAt", "asc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getDueReport({ session, className }) {
  const students = await getAllStudents({ session, className });
  return students.filter((s) => s.totalDue > 0).sort((a, b) => b.totalDue - a.totalDue);
}

export async function getAdvanceReport({ session, className }) {
  const students = await getAllStudents({ session, className });
  return students.filter((s) => s.totalAdvance > 0).sort((a, b) => b.totalAdvance - a.totalAdvance);
}

export async function getPaymentMethodReport(filters) {
  const rows = await fetchTransactions(filters);
  const byMethod = {};
  rows.forEach((r) => {
    byMethod[r.paymentMethod] = (byMethod[r.paymentMethod] || 0) + (r.netAmount || 0);
  });
  return byMethod;
}

export async function getDiscountReport({ fromDate, toDate } = {}) {
  const clauses = toDateRangeClauses("createdAt", fromDate, toDate);
  const snap = await getDocs(clauses.length ? query(collection(db, COL.discounts), ...clauses) : collection(db, COL.discounts));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getTransactionHistoryReport(filters) {
  return fetchTransactions(filters);
}

export async function getMonthlyCollectionTrend({ session, monthsBack = 6 }) {
  const rows = await fetchTransactions({ session });
  const buckets = {};
  const now = new Date();
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets[`${d.toLocaleString("default", { month: "short" })} ${d.getFullYear()}`] = 0;
  }
  rows.forEach((r) => {
    const paidAt = r.paymentDate ? new Date(r.paymentDate) : r.createdAt?.toDate?.();
    if (!paidAt) return;
    const key = `${paidAt.toLocaleString("default", { month: "short" })} ${paidAt.getFullYear()}`;
    if (key in buckets) buckets[key] += r.netAmount || 0;
  });
  return Object.entries(buckets).map(([month, amount]) => ({ month, amount }));
}

// ---------------------------------------------------------------------------
// CSV export — works for any flat array of objects
// ---------------------------------------------------------------------------

export function exportToCSV(rows, filename) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== "object");
  const csvLines = [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`).join(",")
    ),
  ];
  const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
