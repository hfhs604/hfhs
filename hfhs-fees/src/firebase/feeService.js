/**
 * feeService.js
 * Fee Management data layer for Holy Faith High School.
 * Optimized for minimal Firestore reads.
 */

import { db, auth } from "../firebase/config";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, setDoc,
  deleteDoc, getCountFromServer,
  query, where, orderBy, limit as fsLimit,
  runTransaction, serverTimestamp, Timestamp,
} from "firebase/firestore";

const COL = {
  students: "students",
  feeStructures: "feeStructures",
  transactions: "feeTransactions",
  receipts: "receipts",
  discounts: "discounts",
  sessions: "academicSessions",
  auditLogs: "auditLogs",
  counters: "counters",
  monthlyBills: "monthlyBills",
};

export const MONTHLY_TUITION = {
  "Pre-LKG": 800, "LKG": 800, "NUR": 800,
  "UKG": 900,  "I": 900,
  "II": 1000,  "III": 1000,
  "IV": 1100,  "V": 1100,
  "VI": 1200,  "VII": 1200,
  "VIII": 1300,
  "IX": 1400,
  "X": 1500,
};

export const DEVELOPMENT_FEE = 3150;
export const TRANSPORT_OPTIONS = [800, 1500];

const MAX_QUERY_RESULTS = 300;

function currentUser() {
  const u = auth.currentUser;
  if (!u) throw new Error("Not authenticated");
  return u;
}

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function writeAuditLog({ action, studentId, previousValue, newValue, transactionRef }) {
  try {
    const user = currentUser();
    await addDoc(collection(db, COL.auditLogs), {
      userId: user.uid, userEmail: user.email || null, action,
      studentId: studentId || null, transactionRef: transactionRef || null,
      previousValue: previousValue ?? null, newValue: newValue ?? null,
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    console.warn("writeAuditLog failed (non-fatal):", err.message);
  }
}

async function generateReceiptNumber(session) {
  const year = session?.split("-")[0] || new Date().getFullYear().toString();
  const counterRef = doc(db, COL.counters, `receipts_${year}`);
  const nextNumber = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? snap.data().value : 0;
    const next = current + 1;
    tx.set(counterRef, { value: next }, { merge: true });
    return next;
  });
  return `HFHS-${year}-${String(nextNumber).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------
export async function createStudent(data) {
  const user = currentUser();
  const ref = doc(collection(db, COL.students));
  await setDoc(ref, {
    ...data,
    section: data.section || "",
    totalAmountPaid: 0,
    lastPaymentDate: null,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
  });
  await writeAuditLog({ action: "STUDENT_CREATED", studentId: ref.id, newValue: data });
  return ref.id;
}

export async function updateStudentProfile(studentId, updates) {
  try {
    const before = await getDoc(doc(db, COL.students, studentId));
    await updateDoc(doc(db, COL.students, studentId), updates);
    await writeAuditLog({
      action: "STUDENT_UPDATED", studentId,
      previousValue: before.exists() ? before.data() : null,
      newValue: updates,
    });
  } catch (err) {
    console.warn("updateStudentProfile failed:", err.message);
    throw err;
  }
}

export async function getStudentFeeProfile(studentId) {
  const snap = await getDoc(doc(db, COL.students, studentId));
  if (!snap.exists()) throw new Error("Student not found");
  return { id: snap.id, ...snap.data() };
}

/**
 * Case-insensitive prefix search on name OR admissionNumber, with a
 * client-side fallback substring scan for parent names and odd casings.
 */
export async function searchStudents(term) {
  const raw = (term || "").trim();
  if (!raw) return [];

  const results = new Map();

  const upper = raw.toUpperCase();
  const title = raw
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const lower = raw.toLowerCase();

  const nameVariants = Array.from(new Set([upper, title, lower]));

  for (const variant of nameVariants) {
    try {
      const nameQuery = query(
        collection(db, COL.students),
        where("name", ">=", variant),
        where("name", "<=", variant + "\uf8ff"),
        fsLimit(20)
      );
      const snap = await getDocs(nameQuery);
      snap.forEach((d) => results.set(d.id, { id: d.id, ...d.data() }));
    } catch (err) {
      console.warn(`searchStudents: name query failed for "${variant}":`, err.message);
    }
  }

  if (/^\d+$/.test(raw)) {
    try {
      const admQuery = query(
        collection(db, COL.students),
        where("admissionNumber", ">=", raw),
        where("admissionNumber", "<=", raw + "\uf8ff"),
        fsLimit(20)
      );
      const snap = await getDocs(admQuery);
      snap.forEach((d) => results.set(d.id, { id: d.id, ...d.data() }));
    } catch (err) {
      console.warn("searchStudents: admissionNumber query failed:", err.message);
    }
  }

  if (results.size === 0 && raw.length >= 2) {
    try {
      const snap = await getDocs(
        query(collection(db, COL.students), fsLimit(500))
      );
      const needle = raw.toLowerCase();
      snap.forEach((d) => {
        const s = d.data();
        const hay = `${s.name || ""} ${s.fatherName || ""} ${s.motherName || ""} ${
          s.guardianName || ""
        }`.toLowerCase();
        if (hay.includes(needle)) {
          results.set(d.id, { id: d.id, ...s });
        }
      });
    } catch (err) {
      console.warn("searchStudents: fallback scan failed:", err.message);
    }
  }

  return Array.from(results.values());
}

// ---------------------------------------------------------------------------
// Monthly bills
// ---------------------------------------------------------------------------
export function billDocId(session, month, studentId) {
  return `${session}_${month}_${studentId}`;
}

export async function startNewMonth(session, month, { isFirstMonth = false } = {}) {
  const [startYear, startMonthNum] = month.split("-").map(Number);
  const prevDate = new Date(startYear, startMonthNum - 2, 1);
  const prevMonth = monthKey(prevDate);

  let students = [];
  try {
    const snap = await getDocs(
      query(collection(db, COL.students), where("session", "==", session))
    );
    students = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    throw new Error(`Could not read students: ${err.message}`);
  }

  if (students.length === 0) {
    throw new Error(
      `No students found for session "${session}". Import students first, or check the session field.`
    );
  }

  let created = 0;
  for (const student of students) {
    let previousDue = 0;
    if (!isFirstMonth) {
      try {
        const safePrevId = String(student.id).replace(/[\/\\.\*\[\]:;]/g, "-");
        const prevRef = doc(db, COL.monthlyBills, `${session}_${prevMonth}_${safePrevId}`);
        const prevSnap = await getDoc(prevRef);
        if (prevSnap.exists()) previousDue = prevSnap.data().carriedForward || 0;
      } catch (err) {
        console.warn(`Could not read prev month bill for ${student.id}:`, err.message);
      }
    }

    const tuitionBilled = MONTHLY_TUITION[student.className] || 0;
    const devFeeThisMonth = isFirstMonth ? DEVELOPMENT_FEE : 0;
    const transportBilled = student.transportOpted ? (student.transportAmount || 0) : 0;
    const totalDue = previousDue + tuitionBilled + transportBilled + devFeeThisMonth;

    const safeStudentId = String(student.id).replace(/[\/\\.\*\[\]:;]/g, "-");
    const billId = `${session}_${month}_${safeStudentId}`;

    const billRef = doc(db, COL.monthlyBills, billId);
    await setDoc(billRef, {
      session, month, studentId: student.id,
      studentName: student.name,
      className: student.className,
      previousDue,
      tuitionBilled,
      transportBilled,
      devFeeBilled: devFeeThisMonth,
      booksBilled: 0,
      previousYearBilled: 0,
      kitFeeBilled: 0,
      totalDue,
      totalPaid: 0,
      carriedForward: totalDue,
      status: totalDue > 0 ? "DUE" : "PAID",
      createdAt: serverTimestamp(),
    });
    created++;
  }

  await writeAuditLog({
    action: "MONTH_STARTED",
    newValue: { session, month, isFirstMonth, studentCount: created },
  });
  return { created, month, session };
}

export async function getMonthlyBill(session, month, studentId) {
  const safeStudentId = String(studentId).replace(/[\/\\.\*\[\]:;]/g, "-");
  const ref = doc(db, COL.monthlyBills, `${session}_${month}_${safeStudentId}`);
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listBillsForMonth(session, month) {
  try {
    const q = query(
      collection(db, COL.monthlyBills),
      where("session", "==", session),
      where("month", "==", month)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("listBillsForMonth: query failed (index missing?):", err.message);
    throw new Error(
      "Could not load bills. Please ask the admin to create the required Firestore index."
    );
  }
}

// ---------------------------------------------------------------------------
// Payment collection
// ---------------------------------------------------------------------------
export async function collectPayment({
  studentId, amountReceived,
  paymentDate, paymentMethod, referenceNumber,
  feeType, discount = 0, lateFee = 0,
  remarks = "", session, month,
  idempotencyKey,
}) {
  const user = currentUser();
  const safeStudentId = String(studentId).replace(/[\/\\.\*\[\]:;]/g, "-");
  const billRef = doc(db, COL.monthlyBills, `${session}_${month}_${safeStudentId}`);
  const idemRef = doc(db, "paymentIdempotency", idempotencyKey);

  const result = await runTransaction(db, async (tx) => {
    const idemSnap = await tx.get(idemRef);
    if (idemSnap.exists()) {
      return { alreadyProcessed: true, receiptId: idemSnap.data().receiptId };
    }
    const billSnap = await tx.get(billRef);
    if (!billSnap.exists()) throw new Error("No bill for this month — run Start New Month first.");
    const bill = billSnap.data();

    const amount = Number(amountReceived);
    const netAmount = amount + Number(lateFee) - Number(discount);
    const newPaid = (bill.totalPaid || 0) + netAmount;
    const newCarry = (bill.totalDue || 0) - newPaid;

    const txnRef = doc(collection(db, COL.transactions));
    const receiptRef = doc(collection(db, COL.receipts));

    tx.set(txnRef, {
      studentId, session, month,
      componentType: "monthly",
      amountReceived: amount,
      discount: Number(discount), lateFee: Number(lateFee),
      netAmount,
      paymentDate: Timestamp.fromDate(new Date(paymentDate)),
      paymentMethod, referenceNumber: referenceNumber || null,
      feeType, remarks,
      collectedBy: user.uid, collectedByEmail: user.email || null,
      receiptRef: receiptRef.id,
      createdAt: serverTimestamp(),
      voided: false,
    });

    tx.update(billRef, {
      totalPaid: newPaid,
      carriedForward: newCarry,   // negative = advance (credit) for next month
      status: newCarry <= 0 ? "PAID" : "PARTIAL",
      lastPaymentAt: serverTimestamp(),
    });

    tx.set(idemRef, { receiptId: receiptRef.id, createdAt: serverTimestamp() });
    return { alreadyProcessed: false, receiptRef, txnRef, bill, newPaid, netAmount };
  });

  if (result.alreadyProcessed) {
    const snap = await getDoc(doc(db, COL.receipts,
