/**
 * reportsService.js
 * Report queries + CSV export for the monthly billing model.
 * 
 * INVARIANT: collection/revenue reports only ever count real payments.
 * Charge transactions (isCharge=true) are excluded from all money totals.
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

function normalizeName(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[.,'"]/g, "");
}

// ---------------------------------------------------------------------------
// Students + bills (joined view)
// ---------------------------------------------------------------------------
export async function getAllStudentsWithBills({ session, className, month } = {}) {
  const targetMonth = month || currentMonthKey();

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

  let bills = [];
  try {
    // 1. First try to get bills for the specific target month (usually the current calendar month)
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

    // 2. FALLBACK: If no bills exist for the current calendar month, find the LATEST available bill for this session.
    // This fixes the issue where pre-generated bills (e.g. Oct 2026) show as "PAID" if today is not Oct 2026.
    if (bills.length === 0 && session) {
      const allSnap = await getDocs(
        query(collection(db, COL.monthlyBills), where("session", "==", session))
      );
      const allBills = allSnap.docs.map((d) => d.data());
      
      // Find the maximum month string (e.g. "2026-10" > "2026-04")
      const months = [...new Set(allBills.map((b) => b.month))].sort();
      const latestMonth = months[months.length - 1];

      if (latestMonth) {
        bills = allBills.filter((b) => b.month === latestMonth);
      }
    }
  } catch (err) {
    console.warn("getAllStudentsWithBills: bills query failed:", err.message);
    bills = [];
  }

  const billByStudent = {};
  bills.forEach((b) => {
    billByStudent[b.studentId] = b;
  });

  return students.map((s) => {
    const bill = billByStudent[s.id];
    
    // If no bill exists at all, they are considered PAID (no dues).
    // If a bill exists, calculate the actual status.
    const totalDue = bill?.carriedForward || 0;
    const totalPaid = bill?.totalPaid || 0;
    const totalFee = bill?.totalDue || 0;

    let accountStatus = "PAID";
    if (totalDue > 0 && totalPaid > 0) accountStatus = "PARTIAL";
    else if (totalDue > 0) accountStatus = "DUE";

    return {
      ...s,
      month: bill?.month || targetMonth,
      totalDue,
      totalPaid,
      totalFee,
      totalAdvance: totalDue < 0 ? Math.abs(totalDue) : 0,
      accountStatus,
    };
  });
}

export async function getAllStudents(opts = {}) {
  return getAllStudentsWithBills(opts);
}

// ---------------------------------------------------------------------------
// Transaction-based reports (payments only)
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
    // Exclude charge transactions client-side.
    let rows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((r) => r.isCharge !== true && Number(r.netAmount || 0) > 0);

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
    if (r.isCharge === true) return;
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
  const { fromDate, toDate, session, className } = filters || {};
  let clauses = [where("voided", "==", false)];
  if (session) clauses.push(where("session", "==", session));
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
    let rows = snap.docs.map((d) => {
      const r = { id: d.id, ...d.data() };
      if (r.isCharge === true) {
        r.netAmount = r.chargedAmount || 0;
        r.feeType = `${r.feeType || "Charge"} (charge)`;
        r.paymentMethod = "—";
      }
      return r;
    });

    if (className) {
      const classStudents = await getAllStudents({ className });
      const allowed = new Set(classStudents.map((s) => s.id));
      rows = rows.filter((r) => allowed.has(r.studentId));
    }
    return rows;
  } catch (err) {
    console.warn("getTransactionHistoryReport failed:", err.message);
    return [];
  }
}

export async function getMonthlyCollectionTrend({ session, monthsBack = 6 } = {}) {
  try {
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

    const buckets = {};
    const now = new Date();
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.toLocaleString("default", {
        month: "short",
      })} ${d.getFullYear()}`;
      buckets[key] = 0;
    }

    rows.forEach((r) => {
      if (r.isCharge === true) return;

      let paidAt = null;
      if (r.paymentDate) {
        if (typeof r.paymentDate.toDate === "function") {
          paidAt = r.paymentDate.toDate();
        } else if (typeof r.paymentDate === "string") {
          paidAt = new Date(r.paymentDate);
        } else if (typeof r.paymentDate === "number") {
          paidAt = new Date(r.paymentDate);
        }
      }
      if (!paidAt && r.createdAt?.toDate) {
        paidAt = r.createdAt.toDate();
      }
      if (!paidAt || isNaN(paidAt.getTime())) return;

      const key = `${paidAt.toLocaleString("default", {
        month: "short",
      })} ${paidAt.getFullYear()}`;
      if (key in buckets) {
        buckets[key] += Number(r.netAmount || 0);
      }
    });

    return Object.entries(buckets).map(([month, amount]) => ({
      month,
      amount,
    }));
  } catch (err) {
    console.warn("getMonthlyCollectionTrend failed:", err.message);
    return [];
  }
}

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
// Related-student lookup
// ---------------------------------------------------------------------------
export async function findStudentsByParentName({ session, searchTerm } = {}) {
  const term = String(searchTerm || "").trim();
  if (!term) return { direct: [], groups: [] };

  const all = await getAllStudents({ session });
  if (all.length === 0) return { direct: [], groups: [] };

  const needle = normalizeName(term);

  const direct = all.filter((s) => {
    const haystack = [s.name, s.fatherName, s.motherName, s.guardianName]
      .map(normalizeName)
      .join(" | ");
    return haystack.includes(needle);
  });

  const parentKeys = new Set();
  direct.forEach((s) => {
    if (s.fatherName) parentKeys.add(normalizeName(s.fatherName));
    if (s.motherName) parentKeys.add(normalizeName(s.motherName));
    if (s.guardianName && s.guardianName !== s.fatherName) {
      parentKeys.add(normalizeName(s.guardianName));
    }
  });

  all.forEach((s) => {
    const parents = [s.fatherName, s.motherName, s.guardianName]
      .map(normalizeName)
      .filter(Boolean);
    if (parents.some((p) => p.includes(needle))) {
      parents.forEach((p) => parentKeys.add(p));
    }
  });

  const groupsMap = new Map();

  all.forEach((s) => {
    const candidates = [
      { key: normalizeName(s.fatherName), label: s.fatherName, kind: "Father" },
      { key: normalizeName(s.motherName), label: s.motherName, kind: "Mother" },
    ];
    if (s.guardianName && s.guardianName !== s.fatherName) {
      candidates.push({
        key: normalizeName(s.guardianName),
        label: s.guardianName,
        kind: "Guardian",
      });
    }

    candidates.forEach(({ key, label, kind }) => {
      if (!key || !parentKeys.has(key)) return;
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          parentKey: key,
          parentName: label,
          relation: kind,
          students: [],
        });
      }
      groupsMap.get(key).students.push(s);
    });
  });

  const groups = Array.from(groupsMap.values())
    .filter((g) => g.students.length > 0)
    .sort((a, b) => {
      if (b.students.length !== a.students.length) {
        return b.students.length - a.students.length;
      }
      return String(a.parentName).localeCompare(String(b.parentName));
    });

  groups.forEach((g) => {
    g.students.sort((a, b) =>
      String(a.className).localeCompare(String(b.className), undefined, {
        numeric: true,
      })
    );
  });

  return { direct, groups };
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
