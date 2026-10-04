/**
 * feeService.js
 * Fee Management data layer for Holy Faith High School.
 * Monthly billing model with defensive fallbacks when indexes are missing.
 */

import { db, auth } from "../firebase/config";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, setDoc,
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

export function computeBalanceView(student) {
  const due = student.totalDue || 0;
  const advance = student.totalAdvance || 0;
  let status = "PAID";
  if (due > 0 && (student.totalPaid || 0) > 0) status = "PARTIAL";
  else if (due > 0) status = "DUE";
  else if (advance > 0) status = "ADVANCE";
  return { ...student, totalDue: due, totalAdvance: advance, accountStatus: status };
}

/**
 * Search students by name or admission number (prefix match).
 * Uses client-side filtering to avoid needing composite indexes.
 */
export async function searchStudents(term) {
  const cleanedTerm = (term || "").trim().toLowerCase();
  if (!cleanedTerm) return [];

  // Fetch all students, filter client-side. Works for ~1000 students easily.
  let all = [];
  try {
    const snap = await getDocs(collection(db, COL.students));
    all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("searchStudents: fetch failed:", err.message);
    return [];
  }

  const matches = all.filter((s) => {
    const name = (s.name || "").toLowerCase();
    const adm = String(s.admissionNumber || "").toLowerCase();
    return name.includes(cleanedTerm) || adm.includes(cleanedTerm);
  });

  return matches.slice(0, 30);
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

  // Fetch all students (single-field query, no composite index needed).
  let students = [];
  try {
    const snap = await getDocs(collection(db, COL.students));
    students = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    throw new Error(`Could not read students: ${err.message}`);
  }

  // Filter by session client-side
  students = students.filter((s) => s.session === session);

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
        const prevRef = doc(db, COL.monthlyBills, billDocId(session, prevMonth, student.id));
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

    // Sanitize the bill document ID to prevent path issues
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
    console.warn("listBillsForMonth: using client-side filter:", err.message);
    const snap = await getDocs(collection(db, COL.monthlyBills));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((b) => b.session === session && b.month === month);
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
      carriedForward: Math.max(newCarry, 0),
      status: newCarry <= 0 ? "PAID" : "PARTIAL",
      lastPaymentAt: serverTimestamp(),
    });

    tx.set(idemRef, { receiptId: receiptRef.id, createdAt: serverTimestamp() });
    return { alreadyProcessed: false, receiptRef, txnRef, bill, newPaid, netAmount };
  });

  if (result.alreadyProcessed) {
    const snap = await getDoc(doc(db, COL.receipts, result.receiptId));
    return { receiptId: result.receiptId, receipt: snap.data(), duplicateBlocked: true };
  }

  const receiptNumber = await generateReceiptNumber(session);
  const student = await getStudentFeeProfile(studentId);
  const receiptData = {
    receiptNumber, studentId,
    studentName: student.name,
    admissionNumber: student.admissionNumber,
    className: student.className,
    guardianName: student.guardianName || student.fatherName,
    session, month, feeType,
    amountReceived: Number(amountReceived),
    discount: Number(discount), lateFee: Number(lateFee),
    previousDue: result.bill.previousDue || 0,
    remainingDue: Math.max((result.bill.totalDue || 0) - result.newPaid, 0),
    paymentMethod, referenceNumber: referenceNumber || null,
    paymentDate, createdAt: serverTimestamp(),
  };
  await setDoc(doc(db, COL.receipts, result.receiptRef.id), receiptData);
  await writeAuditLog({
    action: "PAYMENT_COLLECTED", studentId,
    newValue: { amountReceived, receiptNumber },
    transactionRef: result.txnRef.id,
  });
  return { receiptId: result.receiptRef.id, receipt: receiptData, duplicateBlocked: false };
}

// ---------------------------------------------------------------------------
// Add-on fees
// ---------------------------------------------------------------------------
async function addLineItem({
  studentId, session, month, amount, field, componentType, feeType, remarks,
  paymentMethod = "Cash", paymentDate, idempotencyKey,
}) {
  const user = currentUser();
  const safeStudentId = String(studentId).replace(/[\/\\.\*\[\]:;]/g, "-");
  const billRef = doc(db, COL.monthlyBills, `${session}_${month}_${safeStudentId}`);
  const idemRef = doc(db, "paymentIdempotency", idempotencyKey);

  const result = await runTransaction(db, async (tx) => {
    const idemSnap = await tx.get(idemRef);
    if (idemSnap.exists()) return { alreadyProcessed: true, receiptId: idemSnap.data().receiptId };
    const billSnap = await tx.get(billRef);
    if (!billSnap.exists()) throw new Error("No bill for this month — run Start New Month first.");
    const bill = billSnap.data();

    const amt = Number(amount);
    const newDue = (bill.totalDue || 0) + amt;
    const newFieldValue = (bill[field] || 0) + amt;

    const txnRef = doc(collection(db, COL.transactions));
    const receiptRef = doc(collection(db, COL.receipts));

    tx.set(txnRef, {
      studentId, session, month, componentType,
      amountReceived: amt, netAmount: amt,
      paymentDate: Timestamp.fromDate(new Date(paymentDate)),
      paymentMethod, feeType, remarks,
      collectedBy: user.uid, collectedByEmail: user.email || null,
      receiptRef: receiptRef.id,
      createdAt: serverTimestamp(),
      voided: false,
    });

    const newPaid = (bill.totalPaid || 0) + amt;
    const newCarry = newDue - newPaid;

    tx.update(billRef, {
      [field]: newFieldValue,
      totalDue: newDue,
      totalPaid: newPaid,
      carriedForward: Math.max(newCarry, 0),
      status: newCarry <= 0 ? "PAID" : "PARTIAL",
    });

    tx.set(idemRef, { receiptId: receiptRef.id, createdAt: serverTimestamp() });
    return { alreadyProcessed: false, receiptRef, txnRef, bill, amt, newPaid };
  });

  if (result.alreadyProcessed) {
    const snap = await getDoc(doc(db, COL.receipts, result.receiptId));
    return { receiptId: result.receiptId, receipt: snap.data(), duplicateBlocked: true };
  }
  const receiptNumber = await generateReceiptNumber(session);
  const student = await getStudentFeeProfile(studentId);
  const receiptData = {
    receiptNumber, studentId,
    studentName: student.name,
    admissionNumber: student.admissionNumber,
    className: student.className,
    guardianName: student.guardianName || student.fatherName,
    session, month, feeType,
    amountReceived: result.amt,
    previousDue: result.bill.previousDue || 0,
    remainingDue: Math.max((result.bill.totalDue + result.amt) - result.newPaid, 0),
    paymentMethod, paymentDate, createdAt: serverTimestamp(),
    componentType,
  };
  await setDoc(doc(db, COL.receipts, result.receiptRef.id), receiptData);
  await writeAuditLog({
    action: `ADD_${componentType.toUpperCase()}`,
    studentId, newValue: { amount: result.amt, receiptNumber },
    transactionRef: result.txnRef.id,
  });
  return { receiptId: result.receiptRef.id, receipt: receiptData, duplicateBlocked: false };
}

export async function addTransportFee({ studentId, amount, session, month, paymentDate, paymentMethod, idempotencyKey }) {
  if (!TRANSPORT_OPTIONS.includes(Number(amount))) throw new Error("Transport must be 800 or 1500.");
  return addLineItem({
    studentId, session, month, amount,
    field: "transportBilled", componentType: "transport",
    feeType: "Transport", remarks: "Transport fee",
    paymentDate, paymentMethod, idempotencyKey,
  });
}

export async function addBooksFee({ studentId, amount, session, month, paymentDate, paymentMethod = "Cash", idempotencyKey }) {
  if (Number(amount) <= 0) throw new Error("Books amount must be greater than 0.");
  return addLineItem({
    studentId, session, month, amount,
    field: "booksBilled", componentType: "books",
    feeType: "Books", remarks: "Books fee",
    paymentDate, paymentMethod, idempotencyKey,
  });
}

export async function addPreviousYearBalance({ studentId, amount, session, month, paymentDate, paymentMethod = "Cash", idempotencyKey }) {
  if (Number(amount) <= 0) throw new Error("Previous year balance must be greater than 0.");
  return addLineItem({
    studentId, session, month, amount,
    field: "previousYearBilled", componentType: "previousYear",
    feeType: "Previous Year Balance", remarks: "Previous year dues",
    paymentDate, paymentMethod, idempotencyKey,
  });
}

export async function addKitFee({ studentId, amount, session, month, paymentDate, paymentMethod = "Cash", idempotencyKey }) {
  if (Number(amount) <= 0) throw new Error("Kit amount must be greater than 0.");
  return addLineItem({
    studentId, session, month, amount,
    field: "kitFeeBilled", componentType: "kit",
    feeType: "Admission / Kit", remarks: "Admission / Tie / Belt / Batch / Diary",
    paymentDate, paymentMethod, idempotencyKey,
  });
}

// ---------------------------------------------------------------------------
// Due list
// ---------------------------------------------------------------------------
export async function getDueList({ session, month } = {}) {
  try {
    const clauses = [];
    if (session) clauses.push(where("session", "==", session));
    if (month) clauses.push(where("month", "==", month));
    const q = query(collection(db, COL.monthlyBills), ...clauses);
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((b) => (b.carriedForward || 0) > 0)
      .sort((a, b) => (b.carriedForward || 0) - (a.carriedForward || 0));
  } catch (err) {
    console.warn("getDueList: using fallback:", err.message);
    const snap = await getDocs(collection(db, COL.monthlyBills));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((b) => (!session || b.session === session) && (!month || b.month === month))
      .filter((b) => (b.carriedForward || 0) > 0)
      .sort((a, b) => (b.carriedForward || 0) - (a.carriedForward || 0));
  }
}

export async function getStudentsWithDue({ session, month, className, section } = {}) {
  const targetMonth = month || monthKey();
  const bills = await getDueList({ session, month: targetMonth });
  if (!className && !section) return bills;
  return bills.filter((b) => !className || b.className === className);
}

// ---------------------------------------------------------------------------
// Dashboard stats
// ---------------------------------------------------------------------------
export async function getDashboardStats(session, month) {
  const targetMonth = month || monthKey();

  let students = [];
  try {
    const snap = await getDocs(collection(db, COL.students));
    students = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => s.session === session);
  } catch (err) {
    console.warn("getDashboardStats: students read failed:", err.message);
  }

  let bills = [];
  try {
    const snap = await getDocs(collection(db, COL.monthlyBills));
    bills = snap.docs.map((d) => d.data())
      .filter((b) => b.session === session && b.month === targetMonth);
  } catch (err) {
    console.warn("getDashboardStats: bills read failed:", err.message);
  }

  let txns = [];
  try {
    const snap = await getDocs(collection(db, COL.transactions));
    txns = snap.docs.map((d) => d.data())
      .filter((t) => t.session === session && t.voided !== true);
  } catch (err) {
    console.warn("getDashboardStats: transactions read failed:", err.message);
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);

  let todayCollection = 0, monthCollection = 0, totalCollection = 0;
  const byMethod = {};

  txns.forEach((t) => {
    const paidAt = t.paymentDate ? new Date(t.paymentDate) : t.createdAt?.toDate?.();
    const amt = t.netAmount || 0;
    totalCollection += amt;
    if (paidAt && paidAt >= startOfMonth) monthCollection += amt;
    if (paidAt && paidAt >= startOfToday) todayCollection += amt;
    if (t.paymentMethod) byMethod[t.paymentMethod] = (byMethod[t.paymentMethod] || 0) + amt;
  });

  const totalOutstandingDue = bills.reduce((s, b) => s + (b.carriedForward || 0), 0);
  const studentsWithDue = bills.filter((b) => (b.carriedForward
