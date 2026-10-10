/**
 * feeService.js
 * Fee Management data layer for Holy Faith High School.
 * Optimized for minimal Firestore reads.
 */

import { db, auth } from "../firebase/config";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, setDoc,
  deleteDoc,
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
 * Server-side prefix search on name OR admissionNumber.
 * Reads at most ~30 docs instead of the whole collection.
 */
export async function searchStudents(term) {
  const t = (term || "").trim();
  if (!t) return [];

  const results = new Map();

  // Try name prefix
  try {
    const nameQuery = query(
      collection(db, COL.students),
      where("name", ">=", t),
      where("name", "<=", t + "\uf8ff"),
      fsLimit(20)
    );
    const snap = await getDocs(nameQuery);
    snap.forEach((d) => results.set(d.id, { id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("searchStudents: name query failed:", err.message);
  }

  // Try admissionNumber prefix (only if term looks numeric)
  if (/^\d+$/.test(t)) {
    try {
      const admQuery = query(
        collection(db, COL.students),
        where("admissionNumber", ">=", t),
        where("admissionNumber", "<=", t + "\uf8ff"),
        fsLimit(20)
      );
      const snap = await getDocs(admQuery);
      snap.forEach((d) => results.set(d.id, { id: d.id, ...d.data() }));
    } catch (err) {
      console.warn("searchStudents: admissionNumber query failed:", err.message);
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

    const newPaid = bill.totalPaid || 0;
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
  const amt = Number(amount);
  if (amt < 800 || amt > 1500) {
    throw new Error("Transport must be between ₹800 and ₹1500.");
  }
  return addLineItem({
    studentId, session, month, amount: amt,
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
    const snap = await getDocs(
      query(collection(db, COL.students), where("session", "==", session))
    );
    students = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("getDashboardStats: students read failed:", err.message);
  }

  let bills = [];
  try {
    const snap = await getDocs(
      query(
        collection(db, COL.monthlyBills),
        where("session", "==", session),
        where("month", "==", targetMonth)
      )
    );
    bills = snap.docs.map((d) => d.data());
  } catch (err) {
    console.warn("getDashboardStats: bills read failed:", err.message);
  }

  let txns = [];
  try {
    const snap = await getDocs(
      query(collection(db, COL.transactions), where("session", "==", session))
    );
    txns = snap.docs.map((d) => d.data()).filter((t) => t.voided !== true);
  } catch (err) {
    console.warn("getDashboardStats: transactions read failed:", err.message);
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);

  let todayCollection = 0, monthCollection = 0, totalCollection = 0;
  const byMethod = {};

  txns.forEach((t) => {
    if (t.componentType && t.componentType !== "monthly") return;
    const paidAt = t.paymentDate ? new Date(t.paymentDate) : t.createdAt?.toDate?.();
    const amt = t.netAmount || 0;
    totalCollection += amt;
    if (paidAt && paidAt >= startOfMonth) monthCollection += amt;
    if (paidAt && paidAt >= startOfToday) todayCollection += amt;
    if (t.paymentMethod) byMethod[t.paymentMethod] = (byMethod[t.paymentMethod] || 0) + amt;
  });

  const totalOutstandingDue = bills.reduce((s, b) => s + (b.carriedForward || 0), 0);
  const studentsWithDue = bills.filter((b) => (b.carriedForward || 0) > 0).length;
  const studentsFullyPaid = bills.filter((b) => (b.carriedForward || 0) === 0).length;

  return {
    todayCollection, monthCollection, totalCollection,
    totalOutstandingDue, totalAdvance: 0,
    studentsWithDue, studentsFullyPaid,
    paymentMethodBreakdown: byMethod,
    studentCount: students.length,
    month: targetMonth,
  };
}

// ---------------------------------------------------------------------------
// Fee structures (backward compat)
// ---------------------------------------------------------------------------
export async function setFeeStructure({ session, className, categories, lateFeeRule }) {
  const id = `${session}_${className}`;
  await setDoc(
    doc(db, COL.feeStructures, id),
    { session, className, categories, lateFeeRule, updatedAt: serverTimestamp() },
    { merge: true }
  );
  await writeAuditLog({
    action: "FEE_STRUCTURE_UPDATED",
    newValue: { session, className, categories },
  });
}

export async function getFeeStructure(session, className) {
  const snap = await getDoc(doc(db, COL.feeStructures, `${session}_${className}`));
  return snap.exists() ? snap.data() : null;
}

// ---------------------------------------------------------------------------
// Payment history — indexed by studentId
// ---------------------------------------------------------------------------
export async function getPaymentHistory(studentId) {
  try {
    const q = query(
      collection(db, COL.transactions),
      where("studentId", "==", studentId),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("getPaymentHistory: falling back (likely missing index):", err.message);
    const snap = await getDocs(
      query(collection(db, COL.transactions), where("studentId", "==", studentId))
    );
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toDate?.() || 0) - (a.createdAt?.toDate?.() || 0));
  }
}

/**
 * Combines "session paid total" and "last payment" into ONE query.
 * Returns both numbers with only one read pass over this student's txns.
 */
export async function getStudentPaymentSummary(studentId, session, month) {
  try {
    const q = query(
      collection(db, COL.transactions),
      where("studentId", "==", studentId)
    );
    const snap = await getDocs(q);

    let sessionTotal = 0;
    let lastPayment = null;
    let monthTotal = 0;

    snap.docs.forEach((d) => {
      const t = d.data();
      if (session && t.session !== session) return;
      if (t.voided === true) return;
      if (t.componentType && t.componentType !== "monthly") return;

      const amt = Number(t.netAmount || 0);
      sessionTotal += amt;

      if (month && t.month === month) {
        monthTotal += amt;
      }

      const paidAt =
        t.paymentDate && typeof t.paymentDate.toDate === "function"
          ? t.paymentDate.toDate()
          : new Date(t.paymentDate || t.createdAt?.toDate?.() || 0);
      const ts = paidAt.getTime();
      if (!lastPayment || ts > lastPayment.ts) {
        lastPayment = { ts, amount: amt, date: paidAt };
      }
    });

    return {
      sessionTotal,
      monthTotal,
      lastPayment: lastPayment
        ? { amount: lastPayment.amount, date: lastPayment.date }
        : null,
    };
  } catch (err) {
    console.warn("getStudentPaymentSummary failed:", err.message);
    return { sessionTotal: 0, monthTotal: 0, lastPayment: null };
  }
}

// Legacy wrappers (still exported to avoid breaking call sites)
export async function getSessionPaidTotal(studentId, session) {
  const s = await getStudentPaymentSummary(studentId, session);
  return s.sessionTotal;
}

export async function getLastPayment(studentId, session, month) {
  const s = await getStudentPaymentSummary(studentId, session, month);
  return s.lastPayment;
}

// ---------------------------------------------------------------------------
// Discounts
// ---------------------------------------------------------------------------
export async function applyDiscount({ studentId, amount, type, reason }) {
  const user = currentUser();
  const ref = await addDoc(collection(db, COL.discounts), {
    studentId, amount, type, reason,
    authorizedBy: user.uid,
    createdAt: serverTimestamp(),
  });
  await writeAuditLog({
    action: "DISCOUNT_APPLIED", studentId,
    newValue: { amount, type, reason },
  });
  return ref.id;
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
export async function getAuditLogs({ studentId, limitCount = 100 } = {}) {
  try {
    let q = collection(db, COL.auditLogs);
    q = studentId
      ? query(q, where("studentId", "==", studentId), orderBy("timestamp", "desc"), fsLimit(limitCount))
      : query(q, orderBy("timestamp", "desc"), fsLimit(limitCount));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("getAuditLogs: falling back:", err.message);
    const snap = await getDocs(collection(db, COL.auditLogs));
    let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (studentId) rows = rows.filter((r) => r.studentId === studentId);
    rows.sort((a, b) => (b.timestamp?.toDate?.() || 0) - (a.timestamp?.toDate?.() || 0));
    return rows.slice(0, limitCount);
  }
}

// ---------------------------------------------------------------------------
// Academic sessions / users
// ---------------------------------------------------------------------------
export async function createAcademicSession(sessionLabel) {
  await setDoc(doc(db, COL.sessions, sessionLabel), {
    label: sessionLabel, createdAt: serverTimestamp(), isActive: true,
  });
  await writeAuditLog({ action: "ACADEMIC_SESSION_CREATED", newValue: { session: sessionLabel } });
}

export async function getAcademicSessions() {
  try {
    const snap = await getDocs(query(collection(db, COL.sessions), orderBy("label", "desc")));
    return snap.docs.map((d) => d.data());
  } catch (err) {
    console.warn("getAcademicSessions: using fallback:", err.message);
    const snap = await getDocs(collection(db, COL.sessions));
    return snap.docs
      .map((d) => d.data())
      .sort((a, b) => String(b.label).localeCompare(String(a.label)));
  }
}

export async function setUserRole(uid, role, permissions = {}) {
  await setDoc(doc(db, "users", uid), { role, permissions }, { merge: true });
  await writeAuditLog({ action: "USER_ROLE_SET", newValue: { uid, role, permissions } });
}

export async function getUserRoleOnce(uid, retries = 3, delayMs = 700) {
  const ref = doc(db, "users", uid);
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const snap = await getDoc(ref);
      return snap.exists() ? snap.data() : null;
    } catch (err) {
      const isOffline = err?.code === "unavailable" || err?.message?.includes("client is offline");
      if (!isOffline || attempt === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
}
export const getUserRole = getUserRoleOnce;

// ---------------------------------------------------------------------------
// Admission number auto-increment
// ---------------------------------------------------------------------------
export async function peekNextAdmissionNumber() {
  try {
    const counterRef = doc(db, COL.counters, "admissionNumber");
    const snap = await getDoc(counterRef);
    const current = snap.exists() ? snap.data().value : 0;
    return current + 1;
  } catch (err) {
    console.warn("peekNextAdmissionNumber failed:", err.message);
    return 1;
  }
}

export async function reserveAdmissionNumber() {
  const counterRef = doc(db, COL.counters, "admissionNumber");
  const next = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? snap.data().value : 0;
    const value = current + 1;
    tx.set(counterRef, { value }, { merge: true });
    return value;
  });
  return String(next);
}

// ---------------------------------------------------------------------------
// Full student update
// ---------------------------------------------------------------------------
export async function updateStudentFull(studentId, updates) {
  const user = currentUser();

  const userDoc = await getDoc(doc(db, "users", user.uid));
  const role = userDoc.exists() ? userDoc.data().role : null;
  if (!["superAdmin", "admin", "accountant"].includes(role)) {
    throw new Error("You don't have permission to edit students.");
  }

  const ref = doc(db, COL.students, studentId);
  const before = await getDoc(ref);
  if (!before.exists()) throw new Error("Student not found.");

  await updateDoc(ref, {
    ...updates,
    updatedBy: user.uid,
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog({
    action: "STUDENT_UPDATED",
    studentId,
    previousValue: before.data(),
    newValue: updates,
  });

  return true;
}

// ---------------------------------------------------------------------------
// Delete student + all related data
// ---------------------------------------------------------------------------
export async function deleteStudentCompletely(studentId, studentName) {
  const user = currentUser();

  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (!userDoc.exists() || userDoc.data().role !== "superAdmin") {
    throw new Error("Only a Super Admin can delete a student.");
  }

  const studentRef = doc(db, COL.students, studentId);
  const studentSnap = await getDoc(studentRef);
  if (!studentSnap.exists()) throw new Error("Student not found.");

  const student = studentSnap.data();
  const summary = {
    studentId,
    name: student.name || studentName || "Unknown",
    admissionNumber: student.admissionNumber || null,
    billsDeleted: 0,
    transactionsDeleted: 0,
    receiptsDeleted: 0,
    discountsDeleted: 0,
  };

  await deleteDoc(studentRef);

  try {
    const billsSnap = await getDocs(
      query(collection(db, COL.monthlyBills), where("studentId", "==", studentId))
    );
    for (const d of billsSnap.docs) {
      await deleteDoc(doc(db, COL.monthlyBills, d.id));
      summary.billsDeleted++;
    }
  } catch (err) {
    console.warn("Could not delete bills:", err.message);
  }

  try {
    const txnsSnap = await getDocs(
      query(collection(db, COL.transactions), where("studentId", "==", studentId))
    );
    for (const d of txnsSnap.docs) {
      await deleteDoc(doc(db, COL.transactions, d.id));
      summary.transactionsDeleted++;
    }
  } catch (err) {
    console.warn("Could not delete transactions:", err.message);
  }

  try {
    const receiptsSnap = await getDocs(
      query(collection(db, COL.receipts), where("studentId", "==", studentId))
    );
    for (const d of receiptsSnap.docs) {
      await deleteDoc(doc(db, COL.receipts, d.id));
      summary.receiptsDeleted++;
    }
  } catch (err) {
    console.warn("Could not delete receipts:", err.message);
  }

  try {
    const discountsSnap = await getDocs(
      query(collection(db, COL.discounts), where("studentId", "==", studentId))
    );
    for (const d of discountsSnap.docs) {
      await deleteDoc(doc(db, COL.discounts, d.id));
      summary.discountsDeleted++;
    }
  } catch (err) {
    console.warn("Could not delete discounts:", err.message);
  }

  await writeAuditLog({
    action: "STUDENT_DELETED",
    studentId,
    previousValue: {
      name: student.name,
      admissionNumber: student.admissionNumber,
      className: student.className,
      session: student.session,
    },
    newValue: {
      deletedBy: user.email || user.uid,
      deletedAt: new Date().toISOString(),
      summary,
    },
  });

  return summary;
}

// ---------------------------------------------------------------------------
// Transport fee management
// ---------------------------------------------------------------------------
export async function setStudentTransport(studentId, amount) {
  const user = currentUser();
  const userDoc = await getDoc(doc(db, "users", user.uid));
  const role = userDoc.exists() ? userDoc.data().role : null;
  if (role !== "superAdmin") {
    throw new Error("Only a Super Admin can change transport settings.");
  }

  const amt = Number(amount);
  if (amt !== 0 && (amt < 800 || amt > 1500)) {
    throw new Error("Transport must be 0 (off) or between ₹800 and ₹1500.");
  }

  const studentRef = doc(db, COL.students, studentId);
  const before = await getDoc(studentRef);
  if (!before.exists()) throw new Error("Student not found.");

  await updateDoc(studentRef, {
    transportOpted: amt > 0,
    transportAmount: amt,
  });

  const month = monthKey();
  const session = before.data().session;
  if (session) {
    const safeId = String(studentId).replace(/[\/\\.\*\[\]:;]/g, "-");
    const billRef = doc(db, COL.monthlyBills, `${session}_${month}_${safeId}`);
    const billSnap = await getDoc(billRef);
    if (billSnap.exists()) {
      const bill = billSnap.data();
      const oldTransport = bill.transportBilled || 0;
      if ((bill.totalPaid || 0) === 0) {
        const newTotalDue = (bill.totalDue || 0) - oldTransport + amt;
        const newCarry = newTotalDue - (bill.totalPaid || 0);
        await updateDoc(billRef, {
          transportBilled: amt,
          totalDue: newTotalDue,
          carriedForward: Math.max(newCarry, 0),
        });
      }
    }
  }

  await writeAuditLog({
    action: "TRANSPORT_UPDATED",
    studentId,
    previousValue: {
      transportOpted: before.data().transportOpted,
      transportAmount: before.data().transportAmount,
    },
    newValue: { transportOpted: amt > 0, transportAmount: amt },
  });

  return { transportOpted: amt > 0, transportAmount: amt };
}
// ---------------------------------------------------------------------------
// Delete a single transaction (super admin only)
// ---------------------------------------------------------------------------
export async function deleteTransaction(transactionId, reason = "") {
  const user = currentUser();

  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (!userDoc.exists() || userDoc.data().role !== "superAdmin") {
    throw new Error("Only a Super Admin can delete a transaction.");
  }

  const txnRef = doc(db, COL.transactions, transactionId);
  const txnSnap = await getDoc(txnRef);
  if (!txnSnap.exists()) throw new Error("Transaction not found.");

  const txn = txnSnap.data();

  // Reverse from bill
  if (txn.studentId && txn.session && txn.month) {
    const safeId = String(txn.studentId).replace(/[\/\\.\*\[\]:;]/g, "-");
    const billRef = doc(db, COL.monthlyBills, `${txn.session}_${txn.month}_${safeId}`);
    const billSnap = await getDoc(billRef);
    if (billSnap.exists()) {
      const bill = billSnap.data();
      const amt = Number(txn.netAmount || 0);

      if (!txn.componentType || txn.componentType === "monthly") {
        // Real payment — reduce totalPaid
        const newPaid = Math.max((bill.totalPaid || 0) - amt, 0);
        const newCarry = (bill.totalDue || 0) - newPaid;
        await updateDoc(billRef, {
          totalPaid: newPaid,
          carriedForward: Math.max(newCarry, 0),
          status: newCarry <= 0 ? "PAID" : "PARTIAL",
        });
      } else {
        // Add-on — reduce the corresponding bill field
        const fieldMap = {
          books: "booksBilled",
          kit: "kitFeeBilled",
          previousYear: "previousYearBilled",
          transport: "transportBilled",
        };
        const field = fieldMap[txn.componentType];
        if (field) {
          const newFieldValue = Math.max((bill[field] || 0) - amt, 0);
          const newDue = Math.max((bill.totalDue || 0) - amt, 0);
          const newCarry = newDue - (bill.totalPaid || 0);
          await updateDoc(billRef, {
            [field]: newFieldValue,
            totalDue: newDue,
            carriedForward: Math.max(newCarry, 0),
            status: newCarry <= 0 ? "PAID" : "PARTIAL",
          });
        }
      }
    }
  }

  await deleteDoc(txnRef);

  if (txn.receiptRef) {
    try {
      await deleteDoc(doc(db, COL.receipts, txn.receiptRef));
    } catch (err) {
      console.warn("Could not delete receipt:", err.message);
    }
  }

  await writeAuditLog({
    action: "TRANSACTION_DELETED",
    studentId: txn.studentId || null,
    previousValue: txn,
    newValue: {
      deletedBy: user.email || user.uid,
      reason: reason || "Not specified",
      deletedAt: new Date().toISOString(),
    },
  });

  return { success: true };
}
