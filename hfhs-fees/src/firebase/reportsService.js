import { db } from "../firebase/config";
import {
  collection, getDocs, query, where, Timestamp,
  orderBy, limit as fsLimit,
} from "firebase/firestore";

const COL = {
  students: "students",
  transactions: "feeTransactions",
  monthlyBills: "monthlyBills",
};

/**
 * getAllStudentsWithBills — Returns exact Array shape.
 * Internally limits to 500 students to prevent massive reads.
 */
export async function getAllStudentsWithBills({ session, className, month, pageSize = 500 } = {}) {
  const targetMonth = month || new Date().toISOString().slice(0, 7);
  let students = [], bills = [], txns = [];

  try {
    const sClauses = [];
    if (session) sClauses.push(where("session", "==", session));
    if (className) sClauses.push(where("className", "==", className));
    const sSnap = await getDocs(query(collection(db, COL.students), ...sClauses, orderBy("name"), fsLimit(pageSize)));
    students = sSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) { 
    // Fallback if no index
    const sClauses = [];
    if (session) sClauses.push(where("session", "==", session));
    if (className) sClauses.push(where("className", "==", className));
    const sSnap = await getDocs(query(collection(db, COL.students), ...sClauses, fsLimit(pageSize)));
    students = sSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  if (students.length > 0) {
    const ids = students.map((s) => s.id);
    for (let i = 0; i < ids.length; i += 10) {
      const chunk = ids.slice(i, i + 10);
      try {
        const bSnap = await getDocs(query(
          collection(db, COL.monthlyBills),
          where("month", "==", targetMonth),
          where("session", "==", session),
          where("studentId", "in", chunk)
        ));
        bills.push(...bSnap.docs.map((d) => d.data()));
      } catch (err) {}
      try {
        const tSnap = await getDocs(query(
          collection(db, COL.transactions),
          where("session", "==", session),
          where("voided", "==", false),
          where("studentId", "in", chunk)
        ));
        txns.push(...tSnap.docs.map((d) => d.data()));
      } catch (err) {}
    }
  }

  const billByStudent = {};
  bills.forEach((b) => { billByStudent[b.studentId] = b; });

  const txnsByStudent = {};
  txns.forEach(t => {
    if (!txnsByStudent[t.studentId]) txnsByStudent[t.studentId] = { paid: 0, discount: 0 };
    if (!t.componentType || t.componentType === "monthly") {
      txnsByStudent[t.studentId].paid += Number(t.amountReceived || t.netAmount || 0);
      txnsByStudent[t.studentId].discount += Number(t.discount || 0);
    }
  });

  return students.map((s) => {
    const bill = billByStudent[s.id];
    const txn = txnsByStudent[s.id] || { paid: 0, discount: 0 };
    const totalFee = bill?.totalDue || 0;
    const totalPaid = txn.paid;
    const totalDiscount = txn.discount;
    const actualDue = Math.max(totalFee - totalPaid - totalDiscount, 0);
    let accountStatus = "DUE";
    if (actualDue === 0 && totalPaid > 0) accountStatus = "PAID";
    return { ...s, month: targetMonth, totalDue: actualDue, totalPaid, totalFee, accountStatus };
  });
}

export async function getAllStudents(opts = {}) {
  return getAllStudentsWithBills(opts);
}

/**
 * getTransactionHistoryReport — Returns exact Array shape.
 * Internally limits to 500 recent transactions by default.
 */
export async function getTransactionHistoryReport({ session, fromDate, toDate, className, pageSize = 500 } = {}) {
  try {
    let clauses = [where("session", "==", session), where("voided", "==", false)];
    if (fromDate) clauses.push(where("createdAt", ">=", Timestamp.fromDate(new Date(fromDate))));
    if (toDate) clauses.push(where("createdAt", "<=", Timestamp.fromDate(new Date(toDate + "T23:59:59"))));

    let q = query(collection(db, COL.transactions), ...clauses, orderBy("createdAt", "desc"), fsLimit(pageSize));

    const snap = await getDocs(q);
    let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (className) rows = rows.filter(r => String(r.className || "").toUpperCase() === String(className).toUpperCase());

    return rows; // Returns Array exactly as before
  } catch (err) {
    console.error(err);
    return []; // Returns Array exactly as before
  }
}

export async function getMonthlyCollectionTrend({ session, monthsBack = 6 } = {}) {
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);

    const snap = await getDocs(query(
      collection(db, COL.transactions),
      where("session", "==", session),
      where("voided", "==", false),
      where("createdAt", ">=", Timestamp.fromDate(start))
    ));

    const buckets = {};
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets[`${d.toLocaleString("default", { month: "short" })} ${d.getFullYear()}`] = 0;
    }

    snap.forEach((d) => {
      const r = d.data();
      let paidAt = r.paymentDate?.toDate?.() || new Date(r.paymentDate || r.createdAt?.toDate?.() || 0);
      if (!paidAt || isNaN(paidAt.getTime())) return;
      const key = `${paidAt.toLocaleString("default", { month: "short" })} ${paidAt.getFullYear()}`;
      if (key in buckets) buckets[key] += Number(r.netAmount || 0);
    });

    return Object.entries(buckets).map(([month, amount]) => ({ month, amount }));
  } catch (err) { return []; }
}

export async function getClassWiseCollectionReport({ session, month } = {}) {
  try {
    const targetMonth = month || new Date().toISOString().slice(0, 7);
    const bSnap = await getDocs(query(
      collection(db, COL.monthlyBills),
      where("month", "==", targetMonth),
      where("session", "==", session)
    ));
    const bills = bSnap.docs.map((d) => d.data());

    const byClass = {};
    bills.forEach((b) => {
      const key = `${b.className}-${b.section || ""}`;
      if (!byClass[key]) byClass[key] = { className: b.className, section: b.section || "", totalFee: 0, totalPaid: 0, totalDue: 0 };
      byClass[key].totalFee += (b.totalDue || 0);
      byClass[key].totalPaid += (b.totalPaid || 0);
      byClass[key].totalDue += (b.carriedForward || 0);
    });
    return Object.values(byClass).sort((a, b) => String(a.className).localeCompare(String(b.className), undefined, { numeric: true }));
  } catch (err) { return []; }
}

function normalizeName(s) {
  return String(s || "").trim().replace(/\s+/g, " ").toLowerCase().replace(/[.,'"]/g, "");
}

export async function findStudentsByParentName({ session, searchTerm } = {}) {
  const term = String(searchTerm || "").trim();
  if (!term) return { direct: [], groups: [] };

  const needle = normalizeName(term);
  if (needle.length < 3) return { direct: [], groups: [] };

  const variants = Array.from(new Set([term, term.toUpperCase(), term.toLowerCase()]));
  const map = new Map();
  for (const v of variants) {
    try {
      const snap = await getDocs(query(
        collection(db, COL.students),
        where("session", "==", session),
        where("name", ">=", v),
        where("name", "<=", v + "\uf8ff"),
        fsLimit(20)
      ));
      snap.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
    } catch (err) {}
  }
  for (const field of ["fatherName", "motherName", "guardianName"]) {
    try {
      const snap = await getDocs(query(
        collection(db, COL.students),
        where("session", "==", session),
        where(field, ">=", term),
        where(field, "<=", term + "\uf8ff"),
        fsLimit(20)
      ));
      snap.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
    } catch (err) {}
  }

  const direct = Array.from(map.values()).filter((s) => {
    const haystack = [s.name, s.fatherName, s.motherName, s.guardianName].map(normalizeName).join(" | ");
    return haystack.includes(needle);
  });

  const parentKeys = new Set();
  direct.forEach((s) => {
    if (s.fatherName) parentKeys.add(normalizeName(s.fatherName));
    if (s.motherName) parentKeys.add(normalizeName(s.motherName));
    if (s.guardianName && s.guardianName !== s.fatherName) parentKeys.add(normalizeName(s.guardianName));
  });

  const siblings = new Map();
  for (const pk of parentKeys) {
    for (const field of ["fatherName", "motherName", "guardianName"]) {
      try {
        const snap = await getDocs(query(
          collection(db, COL.students),
          where("session", "==", session),
          where(field, "==", direct.find(d => normalizeName(d[field] || d.guardianName) === pk)?.[field] || ""),
          fsLimit(20)
        ));
        snap.forEach((d) => siblings.set(d.id, { id: d.id, ...d.data() }));
      } catch (err) {}
    }
  }

  const groupsMap = new Map();
  Array.from(siblings.values()).forEach((s) => {
    const candidates = [
      { key: normalizeName(s.fatherName), label: s.fatherName, kind: "Father" },
      { key: normalizeName(s.motherName), label: s.motherName, kind: "Mother" },
    ];
    if (s.guardianName && s.guardianName !== s.fatherName) candidates.push({ key: normalizeName(s.guardianName), label: s.guardianName, kind: "Guardian" });
    candidates.forEach(({ key, label, kind }) => {
      if (!key || !parentKeys.has(key)) return;
      if (!groupsMap.has(key)) groupsMap.set(key, { parentKey: key, parentName: label, relation: kind, students: [] });
      groupsMap.get(key).students.push(s);
    });
  });

  const groups = Array.from(groupsMap.values()).sort((a, b) => b.students.length - a.students.length);
  return { direct, groups };
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
