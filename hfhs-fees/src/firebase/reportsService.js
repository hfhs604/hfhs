/**
 * reportsService.js
 * Report queries + CSV export for the monthly billing model.
 * Optimized for minimal Firestore reads.
 */

import { db } from "../firebase/config";
import {
  collection, getDocs, getCountFromServer, query, where, orderBy, limit as fsLimit, Timestamp,
} from "firebase/firestore";

const COL = {
  students: "students",
  transactions: "feeTransactions",
  discounts: "discounts",
  monthlyBills: "monthlyBills",
};

// Hard cap to prevent accidental full-collection scans.
const MAX_QUERY_RESULTS = 500;

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

  // 1. Load students (with filter + hard limit).
  let students = [];
  try {
    let sClauses = [];
    if (session) sClauses.push(where("session", "==", session));
    if (className) sClauses.push(where("className", "==", className));

    const sSnap = await getDocs(
      sClauses.length
        ? query(collection(db, COL.students), ...sClauses, fsLimit(MAX_QUERY_RESULTS))
        : query(collection(db, COL.students), fsLimit(MAX_QUERY_RESULTS))
    );
    students = sSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("getAllStudentsWithBills: students query failed:", err.message);
    students = [];
  }

  // 2. Load bills for the target month (with filter + hard limit).
  let bills = [];
  try {
    let bClauses = [where("month", "==", targetMonth)];
    if (session) bClauses.push(where("session", "==", session));
    const bSnap = await getDocs(
      query(collection(db, COL.monthlyBills), ...bClauses, fsLimit(MAX_QUERY_RESULTS))
    );
    bills = bSnap.docs.map((d) => d.data());
  } catch (err) {
    console.error("getAllStudentsWithBills: bills query failed:", err.message);
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

  try {
    const snap = await getDocs(
      query(
        collection(db, COL.transactions),
        ...clauses,
        orderBy("createdAt", "desc"),
        fsLimit(MAX_QUERY_RESULTS)
      )
    );
    let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (className) {
      const classStudents = await getAllStudents({ className });
      const allowed = new Set(classStudents.map((s) => s.id));
      rows = rows.filter((r) => allowed.has(r.studentId));
    }
    return rows;
  } catch (err) {
    console.error("fetchTransactions failed (index missing?):", err.message);
    throw new Error(
      "Report query failed. Please ask the admin to create the required Firestore index. " +
        "Details: " + err.message
    );
  }
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
  try {
    const snap = await getDocs(
      query(
        collection(db, COL.transactions),
        where("studentId", "==", studentId),
        orderBy("createdAt", "asc")
      )
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("getStudentStatement: retry without orderBy:", err.message);
    const snap = await getDocs(
      query(collection(db, COL.transactions), where("studentId", "==", studentId))
    );
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.createdAt?.toDate?.() || 0) - (b.createdAt?.toDate?.() || 0));
  }
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
  try {
    const clauses = toDateRangeClauses("createdAt", fromDate, toDate);
    const snap = await getDocs(
      clauses.length
        ? query(collection(db, COL.discounts), ...clauses, fsLimit(MAX_QUERY_RESULTS))
        : query(collection(db, COL.discounts), fsLimit(MAX_QUERY_RESULTS))
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("getDiscountReport failed:", err.message);
    return [];
  }
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

/**
 * Fast count of students for the session — 1 read instead of N.
 */
export async function getStudentCount(session) {
  try {
    const snap = await getCountFromServer(
      query(collection(db, COL.students), where("session", "==", session))
    );
    return snap.data().count;
  } catch (err) {
    console.warn("getStudentCount failed:", err.message);
    return 0;
  }
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
