/**
 * reportsService.js
 * Report queries + CSV export for the monthly billing model.
 * Hardened: every read degrades gracefully; no function throws to the caller.
 */

import { db } from "../firebase/config";
import {
  collection,
  getDocs,
  getCountFromServer,
  query,
  where,
  orderBy,
  limit as fsLimit,
  Timestamp,
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
  if (fromDate) {
    clauses.push(where(field, ">=", Timestamp.fromDate(new Date(fromDate))));
  }
  if (toDate) {
    clauses.push(
      where(field, "<=", Timestamp.fromDate(new Date(toDate + "T23:59:59")))
    );
  }
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
    const sClauses = [];
    if (session) sClauses.push(where("session", "==", session));
    if (className) sClauses.push(where("className", "==", className));

    const sSnap = await getDocs(
      sClauses.length
        ? query(
            collection(db, COL.students),
            ...sClauses,
            fsLimit(MAX_QUERY_RESULTS)
          )
        : query(collection(db, COL.students), fsLimit(MAX_QUERY_RESULTS))
    );
    students = sSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (students.length === MAX_QUERY_RESULTS) {
      console.warn(
        `getAllStudentsWithBills: student query hit the ${MAX_QUERY_RESULTS}-doc cap.`
      );
    }
  } catch (err) {
    console.warn("getAllStudentsWithBills: students query failed:", err.message);
    students = [];
  }

  // 2. Load bills for the target month (with filter + hard limit).
  let bills = [];
  try {
    const bClauses = [where("month", "==", targetMonth)];
    if (session) bClauses.push(where("session", "==", session));

    const bSnap = await getDocs(
      query(
        collection(db, COL.monthlyBills),
        ...bClauses,
        fsLimit(MAX_QUERY_RESULTS)
      )
    );
    bills = bSnap.docs.map((d) => d.data());
    if (bills.length === MAX_QUERY_RESULTS) {
      console.warn(
        `getAllStudentsWithBills: bill query hit the ${MAX_QUERY_RESULTS}-doc cap.`
      );
    }
  } catch (err) {
    // This is the query that usually needs a composite index on
    // (month ASC, session ASC). Log the full message so the dashboard's
    // "Partial data" banner can show the Firestore index URL.
    console.warn("getAllStudentsWithBills: bills query failed:", err.message);
    console.warn(
      "→ If this mentions an index, open the link in DevTools → Console to create it."
    );
    bills = [];
  }

  // 3. Merge students + bills.
  const billByStudent = {};
  bills.forEach((b) => {
    billByStudent[b.studentId] = b;
  });

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
async function fetchTransactions({
  fromDate,
  toDate,
  session,
  paymentMethod,
  className,
} = {}) {
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

    if (rows.length === MAX_QUERY_RESULTS) {
      console.warn(
        `fetchTransactions: hit the ${MAX_QUERY_RESULTS}-doc cap; results truncated.`
      );
    }

    return rows;
  } catch (err) {
    console.warn("fetchTransactions failed:", err.message);
    console.warn(
      "→ If this mentions an index, open the link in DevTools → Console to create it."
    );
    return [];
  }
}

export async function getCollectionReport(filters = {}) {
  const rows = await fetchTransactions(filters);
  const totalCollected = rows.reduce((s, r) => s + (r.netAmount || 0), 0);
  return { rows, totalCollected, count: rows.length };
}

export async function getClassWiseCollectionReport({ session, month } = {}) {
  try {
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
  } catch (err) {
    console.warn("getClassWiseCollectionReport failed:", err.message);
    return [];
  }
}

export async function getStudentStatement(studentId) {
  if (!studentId) return [];
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
    try {
      const snap = await getDocs(
        query(
          collection(db, COL.transactions),
          where("studentId", "==", studentId)
        )
      );
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort(
          (a, b) =>
            (a.createdAt?.toDate?.() || 0) - (b.createdAt?.toDate?.() || 0)
        );
    } catch (err2) {
      console.warn("getStudentStatement failed completely:", err2.message);
      return [];
    }
  }
}

export async function getDueReport({ session, className, month } = {}) {
  const students = await getAllStudentsWithBills({ session, className, month });
  return students
    .filter((s) => s.totalDue > 0)
    .sort((a, b) => b.totalDue - a.totalDue);
}

export async function getAdvanceReport() {
  return [];
}

export async function getPaymentMethodReport(filters = {}) {
  const rows = await fetchTransactions(filters);
  const byMethod = {};
  rows.forEach((r) => {
    const method = r.paymentMethod || "Unknown";
    byMethod[method] = (byMethod[method] || 0) + (r.netAmount || 0);
  });
  return byMethod;
}

export async function getDiscountReport({ fromDate, toDate } = {}) {
  try {
    const clauses = toDateRangeClauses("createdAt", fromDate, toDate);
    const snap = await getDocs(
      clauses.length
        ? query(
            collection(db, COL.discounts),
            ...clauses,
            fsLimit(MAX_QUERY_RESULTS)
          )
        : query(collection(db, COL.discounts), fsLimit(MAX_QUERY_RESULTS))
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("getDiscountReport failed:", err.message);
    return [];
  }
}

export async function getTransactionHistoryReport(filters = {}) {
  return fetchTransactions(filters);
}

export async function getMonthlyCollectionTrend({ session, monthsBack = 6 } = {}) {
  try {
    // Fetch all non-voided transactions for the session (existing index covers this).
    let rows = [];
    try {
      const snap = await getDocs(
        query(
          collection(db, COL.transactions),
          where("session", "==", session),
          where("voided", "==", false)
        )
      );
      rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.warn("getMonthlyCollectionTrend: query failed:", err.message);
      return [];
    }

    // Build empty buckets for the last N months.
    const buckets = {};
    const now = new Date();
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.toLocaleString("default", { month: "short" })} ${d.getFullYear()}`;
      buckets[key] = 0;
    }

    // Add each transaction to the correct bucket.
    rows.forEach((r) => {
      // paymentDate can be: Firestore Timestamp, ISO string, or missing.
      let paidAt = null;
      if (r.paymentDate) {
        if (typeof r.paymentDate.toDate === "function") {
          paidAt = r.paymentDate.toDate();          // Firestore Timestamp
        } else if (typeof r.paymentDate === "string") {
          paidAt = new Date(r.paymentDate);         // ISO string
        } else if (typeof r.paymentDate === "number") {
          paidAt = new Date(r.paymentDate);         // epoch millis
        }
      }
      if (!paidAt && r.createdAt?.toDate) {
        paidAt = r.createdAt.toDate();              // fallback
      }
      if (!paidAt || isNaN(paidAt.getTime())) return; // skip unparseable rows

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
}/**
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

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------
export function exportToCSV(rows, filename) {
  if (!rows || rows.length === 0) return;

  const headers = Object.keys(rows[0]).filter(
    (k) => typeof rows[0][k] !== "object"
  );

  const csvLines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`)
        .join(",")
    ),
  ];

  const blob = new Blob([csvLines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
