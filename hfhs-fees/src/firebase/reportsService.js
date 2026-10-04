/**
 * reportsService.js
 * Report queries + CSV export. Rewritten for the monthly billing model,
 * with defensive fallbacks when composite indexes are missing.
 */

import { db } from "../firebase/config";
import {
  collection, getDocs, query, where, orderBy, Timestamp,
} from "firebase/firestore";

const COL = {
  students: "students",
  transactions: "feeTransactions",
  discounts: "discounts",
  monthlyBills: "monthlyBills",
};

function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function toDateRangeClauses(field, fromDate, toDate) {
  const clauses = [];
  if (fromDate) clauses.push(where(field, ">=", Timestamp.fromDate(new Date(fromDate))));
  if (toDate) clauses.push(where(field, "<=", Timestamp.fromDate(new Date(toDate + "T23:59:59"))));
  return clauses;
}

// ---------------------------------------------------------------------------
// Students + bills (joined view)
// ---------------------------------------------------------------------------

export async function getAllStudentsWithBills({ session, className, month } = {}) {
  const targetMonth = month || currentMonthKey();

  // 1. Load students — with fallback if the (session, name) index is missing.
  let students = [];
  try {
    let sClauses = [];
    if (session) sClauses.push(where("session", "==", session));
    if (className) sClauses.push(where("className", "==", className));

    const sSnap = await getDocs(
      sClauses.length
        ? query(collection(db, COL.students), ...sClauses)
        : collection(db, COL.students)
    );
    students = sSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn(
      "getAllStudentsWithBills: filtered student query failed, using client-side filter:",
      err.message
    );
    const allSnap = await getDocs(collection(db, COL.students));
    students = allSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => !session || s.session === session)
      .filter((s) => !className || s.className === className);
  }

  // 2. Load bills for the target month — defensive fallback too.
  let bills = [];
  try {
    let bClauses = [where("month", "==", targetMonth)];
    if (session) bClauses.push(where("session", "==", session));
    const bSnap = await getDocs(query(collection(db, COL.monthlyBills), ...bClauses));
    bills = bSnap.docs.map((d) => d.data());
  } catch (err) {
    console.warn(
      "getAllStudentsWithBills: bill query failed, treating as empty:",
      err.message
    );
    bills = [];
  }

  // 3. Merge students + bills
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
    return {
      ...s,
      month: targetMonth,
      totalDue,
      totalPaid,
      totalFee,
      totalAdvance: 0,
      accountStatus,
    };
  });
}

// Backwards-compatible alias
export async function getAllStudents(opts = {}) {
  return getAllStudentsWithBills(opts);
}

// ---------------------------------------------------------------------------
// Transaction-based reports
// ---------------------------------------------------------------------------

async function fetchTransactions({ fromDate, toDate, session, paymentMethod, className }) {
  let clauses = [where("voided", "==", false)];
  if (session) clauses.push(where("session", "==", session));
  if (paymentMethod) clauses.push(where("paymentMethod", "==", paymentMethod));
  clauses = clauses.concat(toDateRangeClauses("createdAt", fromDate, toDate));

  let rows = [];
  try {
    const snap = await getDocs(
      query(collection(db, COL.transactions), ...clauses, orderBy("createdAt", "desc"))
    );
    rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("fetchTransactions: index missing, using client-side filter:", err.message);
    // Fallback: fetch all, filter & sort in JS
    const allSnap = await getDocs(collection(db, COL.transactions));
    rows = allSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    rows = rows.filter((r) => r.voided !== true);
    if (session) rows = rows.filter((r) => r.session === session);
    if (paymentMethod) rows = rows.filter((r) => r.paymentMethod === paymentMethod);
    if (fromDate) rows = rows.filter((r) => r.createdAt?.toDate?.() >= new Date(fromDate));
    if (toDate) rows = rows.filter((r) => r.createdAt?.toDate?.() <= new Date(toDate + "T23:59:59"));
    rows.sort((a, b) => (b.createdAt?.toDate?.() || 0) - (a.createdAt?.toDate?.() || 0));
  }

  if (className) {
    const classStudents = await getAllStudents({ className });
    const allowed = new Set(classStudents.map((s) => s.id));
    rows = rows.filter((r) => allowed.has(r.studentId));
  }
  return rows;
}

export async function getCollectionReport(filters) {
  const rows = await fetchTransactions(filters);
  const totalCollected = rows.reduce((s, r) => s + (r.netAmount || 0), 0);
  return { rows, totalCollected, count: rows.length };
}

export async function getClassWiseCollectionReport({ session, month }) {
  const students = await getAllStudentsWithBills({ session, month });
  const byClass = {};
  students.forEach((s) => {
    const key = `${s.className}-${s.section || ""}`;
    byClass[key] = byClass[key] || {
      className: s.className,
      section: s.section || "",
      totalFee: 0,
      totalPaid: 0,
      totalDue: 0,
    };
    byClass[key].totalFee += s.totalFee || 0;
    byClass[key].totalPaid += s.totalPaid || 0;
    byClass[key].totalDue += s.totalDue || 0;
  });
  return Object.values(byClass).sort((a, b) =>
    String(a.className).localeCompare(String(b.className))
  );
}

export async function getStudentStatement(studentId) {
  let rows = [];
  try {
    const snap = await getDocs(
      query(
        collection(db, COL.transactions),
        where("studentId", "==", studentId),
        orderBy("createdAt", "asc")
      )
    );
    rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("getStudentStatement: index missing, using client-side filter:", err.message);
    const allSnap = await getDocs(collection(db, COL.transactions));
    rows = allSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((r) => r.studentId === studentId)
      .sort((a, b) => (a.createdAt?.toDate?.() || 0) - (b.createdAt?.toDate?.() || 0));
  }
  return rows;
}

export async function getDueReport({ session, className, month }) {
  const students = await getAllStudentsWithBills({ session, className, month });
  return students
    .filter((s) => s.totalDue > 0)
    .sort((a, b) => b.totalDue - a.totalDue);
}

export async function getAdvanceReport() {
  return [];
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
  let rows = [];
  try {
    const clauses = toDateRangeClauses("createdAt", fromDate, toDate);
    const snap = await getDocs(
      clauses.length
        ? query(collection(db, COL.discounts), ...clauses)
        : collection(db, COL.discounts)
    );
    rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("getDiscountReport: using fallback:", err.message);
    const snap = await getDocs(collection(db, COL.discounts));
    rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return rows;
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
    const paidAt = r.paymentDate
      ? new Date(r.paymentDate)
      : r.createdAt?.toDate?.();
    if (!paidAt) return;
    const key = `${paidAt.toLocaleString("default", { month: "short" })} ${paidAt.getFullYear()}`;
    if (key in buckets) buckets[key] += r.netAmount || 0;
  });
  return Object.entries(buckets).map(([month, amount]) => ({ month, amount }));
}

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
