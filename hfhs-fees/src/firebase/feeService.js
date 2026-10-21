/**
 * feeService.js
 * Fee Management data layer for Holy Faith High School.
 * Optimized for minimal Firestore reads (Aggregation Queries).
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

export async function searchStudents(term) {
  const raw = (term || "").trim();
  if (!raw) return [];

  const results = new Map();
  const upper = raw.toUpperCase();
  const title = raw.toLowerCase().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
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
    } catch (err) {}
  }

  // Search by Admission Number
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
    } catch (err) {}
  }

  // Search by Mobile Number (Exact match)
  if (raw.length >= 10) {
    try {
      const mobileQuery = query(collection(db, COL.students), where("mobileNumber", "==", raw), fsLimit(20));
      const snap = await getDocs(mobileQuery);
      snap.forEach((d) => results.set(d.id, { id: d.id, ...d.data() }));

      const fatherMobileQuery = query(collection(db, COL.students), where("fatherMobile", "==", raw), fsLimit(20));
      const snap2 = await getDocs(fatherMobileQuery);
      snap2.forEach((d) => results.set(d.id, { id: d.id, ...d.data() }));
    } catch (err) {}
  }

  // Fallback for partial parent names
  if (results.size === 0 && raw.length >= 2) {
    try {
      const snap = await getDocs(query(collection(db, COL.students), fsLimit(100)));
      const needle = raw.toLowerCase();
      snap.forEach((d) => {
        const s = d.data();
        const hay = `${s.name || ""} ${s.fatherName || ""} ${s.motherName || ""} ${s.guardianName || ""}`.toLowerCase();
        if (hay.includes(needle)) results.set(d.id, { id: d.id, ...s });
      });
    } catch (err) {}
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
    const snap = await getDocs(query(collection(db, COL.students), where("session", "==", session)));
    students = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    throw new Error(`Could not read students: ${err.message}`);
  }

  if (students.length === 0) throw new Error(`No students found for session "${session}".`);

  let created = 0;
  for (const student of students) {
    let previousDue = 0;
    if (!isFirstMonth) {
      try {
        const safePrevId = String(student.id).replace(/[\/\\.\*\[\]:;]/g, "-");
        const prevRef = doc(db, COL.monthlyBills, `${session}_${prevMonth}_${safePrevId}`);
        const prevSnap = await getDoc(prevRef);
        if (prevSnap.exists()) previousDue = prevSnap.data().carriedForward || 0;
      } catch (err) {}
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
      studentName: student.name, className: student.className,
      previousDue, tuitionBilled, transportBilled, devFeeBilled: devFeeThisMonth,
      booksBilled: 0, previousYearBilled: 0, kitFeeBilled: 0,
      totalDue, totalPaid: 0, carriedForward: totalDue,
      status: totalDue > 0 ? "DUE" : "PAID",
      createdAt: serverTimestamp(),
    });
    created++;
  }

  await writeAuditLog({ action: "MONTH_STARTED", newValue: { session, month, isFirstMonth, studentCount: created } });
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
    const q = query(collection(db, COL.monthlyBills), where("session", "==", session), where("month", "==", month));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    throw new Error("Could not load bills. Firestore index missing.");
  }
}

// ---------------------------------------------------------------------------
// Payment collection & Refunds
// ---------------------------------------------------------------------------
export async function collectPayment({
  studentId, amountReceived, paymentDate, paymentMethod, referenceNumber,
  feeType, discount = 0, lateFee = 0, remarks = "", session, month, idempotencyKey,
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
    const amount = Number(amountReceived);
    const netAmount = amount + Number(lateFee) - Number(discount);
    const newPaid = (bill.totalPaid || 0) + netAmount;
    const newCarry = (bill.totalDue || 0) - newPaid;

    const txnRef = doc(collection(db, COL.transactions));
    const receiptRef = doc(collection(db, COL.receipts));

    tx.set(txnRef, {
      studentId, session, month, componentType: "monthly", isCharge: false,
      amountReceived: amount, discount: Number(discount), lateFee: Number(lateFee),
      netAmount, paymentDate: Timestamp.fromDate(new Date(paymentDate)),
      paymentMethod, referenceNumber: referenceNumber || null, feeType, remarks,
      collectedBy: user.uid, collectedByEmail: user.email || null,
      receiptRef: receiptRef.id, createdAt: serverTimestamp(), voided: false,
    });

    tx.update(billRef, {
      totalPaid: newPaid, carriedForward: newCarry,
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
    receiptNumber, studentId, studentName: student.name, admissionNumber: student.admissionNumber,
    className: student.className, guardianName: student.guardianName || student.fatherName,
    session, month, feeType, isCharge: false,
    amountReceived: Number(amountReceived), discount: Number(discount), lateFee: Number(lateFee),
    previousDue: result.bill.previousDue || 0,
    remainingDue: Math.max((result.bill.totalDue || 0) - result.newPaid, 0),
    paymentMethod, referenceNumber: referenceNumber || null, paymentDate, createdAt: serverTimestamp(),
  };
  
  await setDoc(doc(db, COL.receipts, result.receiptRef.id), receiptData);
  await writeAuditLog({ action: "PAYMENT_COLLECTED", studentId, newValue: { amountReceived, receiptNumber }, transactionRef: result.txnRef.id });
  
  return { receiptId: result.receiptRef.id, receipt: receiptData, duplicateBlocked: false };
}

export async function refundAdvance({ studentId, session, month, idempotencyKey }) {
  const user = currentUser();
  const safeStudentId = String(studentId).replace(/[\/\\.\*\[\]:;]/g, "-");
  const billRef = doc(db, COL.monthlyBills, `${session}_${month}_${safeStudentId}`);
  const idemRef = doc(db, "paymentIdempotency", idempotencyKey);

  const result = await runTransaction(db, async (tx) => {
    const idemSnap = await tx.get(idemRef);
    if (idemSnap.exists()) return { alreadyProcessed: true, receiptId: idemSnap.data().receiptId };
    
    const billSnap = await tx.get(billRef);
    if (!billSnap.exists()) throw new Error("No bill found.");
    
    const bill = billSnap.data();
    const advanceAmount = Math.abs(bill.carriedForward || 0);
    if (advanceAmount === 0) throw new Error("No advance to refund.");

    const newCarry = 0;
    const txnRef = doc(collection(db, COL.transactions));
    const receiptRef = doc(collection(db, COL.receipts));

    tx.set(txnRef, {
      studentId, session, month, componentType: "refund", isCharge: false,
      amountReceived: -advanceAmount, netAmount: -advanceAmount,
      paymentDate: serverTimestamp(), paymentMethod: "Cash",
      feeType: "Advance Refund", remarks: "Advance refunded to parent.",
      collectedBy: user.uid, collectedByEmail: user.email || null,
      receiptRef: receiptRef.id, createdAt: serverTimestamp(), voided: false,
    });

    tx.update(billRef, { carriedForward: newCarry, status: "PAID" });
    tx.set(idemRef, { receiptId: receiptRef.id, createdAt: serverTimestamp() });
    
    return { alreadyProcessed: false, receiptRef, txnRef, bill, advanceAmount };
  });

  if (result.alreadyProcessed) {
    const snap = await getDoc(doc(db, COL.receipts, result.receiptId));
    return { receiptId: result.receiptId, receipt: snap.data(), duplicateBlocked: true };
  }

  const receiptNumber = await generateReceiptNumber(session);
  const student = await getStudentFeeProfile(studentId);
  
  const receiptData = {
    receiptNumber, studentId, studentName: student.name, admissionNumber: student.admissionNumber,
    className: student.className, guardianName: student.guardianName || student.fatherName,
    session, month, feeType: "Advance Refund", isCharge: false,
    amountReceived: -result.advanceAmount, previousDue: result.bill.totalDue || 0, remainingDue: 0,
    paymentMethod: "Cash", paymentDate: new Date().toISOString(), createdAt: serverTimestamp(),
  };
  
  await setDoc(doc(db, COL.receipts, result.receiptRef.id), receiptData);
  await writeAuditLog({ action: "ADVANCE_REFUNDED", studentId, newValue: { amount: result.advanceAmount, receiptNumber }, transactionRef: result.txnRef.id });
  
  return { receiptId: result.receiptRef.id, receipt: receiptData, duplicateBlocked: false };
}

// ---------------------------------------------------------------------------
// Add-on fees (CHARGES)
// ---------------------------------------------------------------------------
async function addLineItem({ studentId, session, month, amount, field, componentType, feeType, remarks, paymentDate, idempotencyKey }) {
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
    if (!amt || amt <= 0) throw new Error("Charge amount must be greater than 0.");

    const newFieldValue = (bill[field] || 0) + amt;
    const newDue = (bill.totalDue || 0) + amt;
    const newPaid = bill.totalPaid || 0;
    const newCarry = newDue - newPaid;

    const txnRef = doc(collection(db, COL.transactions));
    const receiptRef = doc(collection(db, COL.receipts));

    tx.set(txnRef, {
      studentId, session, month, componentType, isCharge: true, chargedAmount: amt,
      amountReceived: 0, netAmount: 0, discount: 0, lateFee: 0,
      paymentDate: paymentDate ? Timestamp.fromDate(new Date(paymentDate)) : serverTimestamp(),
      paymentMethod: null, referenceNumber: null, feeType, remarks: remarks || null,
      collectedBy: user.uid, collectedByEmail: user.email || null,
      receiptRef: receiptRef.id, createdAt: serverTimestamp(), voided: false,
    });

    tx.update(billRef, {
      [field]: newFieldValue, totalDue: newDue, totalPaid: newPaid, carriedForward: newCarry,
      status: newCarry <= 0 ? "PAID" : (newPaid > 0 ? "PARTIAL" : "DUE"),
    });

    tx.set(idemRef, { receiptId: receiptRef.id, createdAt: serverTimestamp() });
    return { alreadyProcessed: false, receiptRef, txnRef, bill, amt, newPaid, newDue };
  });

  if (result.alreadyProcessed) {
    const snap = await getDoc(doc(db, COL.receipts, result.receiptId));
    return { receiptId: result.receiptId, receipt: snap.data(), duplicateBlocked: true };
  }

  const receiptNumber = await generateReceiptNumber(session);
  const student = await getStudentFeeProfile(studentId);

  const receiptData = {
    receiptNumber, studentId, studentName: student.name, admissionNumber: student.admissionNumber,
    className: student.className, guardianName: student.guardianName || student.fatherName,
    session, month, feeType, componentType, isCharge: true, chargedAmount: result.amt,
    amountReceived: 0, discount: 0, lateFee: 0, previousDue: result.bill.previousDue || 0,
    remainingDue: Math.max(result.newDue - result.newPaid, 0),
    paymentMethod: null, referenceNumber: null, paymentDate: null, createdAt: serverTimestamp(),
  };

  await setDoc(doc(db, COL.receipts, result.receiptRef.id), receiptData);
  await writeAuditLog({ action: `CHARGE_ADDED_${componentType.toUpperCase()}`, studentId, newValue: { amount: result.amt, receiptNumber, isCharge: true }, transactionRef: result.txnRef.id });

  return { receiptId: result.receiptRef.id, receipt: receiptData, duplicateBlocked: false };
}

export async function addTransportFee({ studentId, amount, session, month, paymentDate, idempotencyKey }) {
  const amt = Number(amount);
  if (amt < 800 || amt > 1500) throw new Error("Transport must be between ₹800 and ₹1500.");
  return addLineItem({ studentId, session, month, amount: amt, field: "transportBilled", componentType: "transport", feeType: "Transport", remarks: "Transport fee", paymentDate, idempotencyKey });
}
export async function addBooksFee({ studentId, amount, session, month, paymentDate, idempotencyKey }) {
  if (Number(amount) <= 0) throw new Error("Books amount must be greater than 0.");
  return addLineItem({ studentId, session, month, amount, field: "booksBilled", componentType: "books", feeType: "Books", remarks: "Books fee", paymentDate, idempotencyKey });
}
export async function addPreviousYearBalance({ studentId, amount, session, month, paymentDate, idempotencyKey }) {
  if (Number(amount) <= 0) throw new Error("Previous year balance must be greater than 0.");
  return addLineItem({ studentId, session, month, amount, field: "previousYearBilled", componentType: "previousYear", feeType: "Previous Year Balance", remarks: "Previous year dues", paymentDate, idempotencyKey });
}
export async function addKitFee({ studentId, amount, session, month, paymentDate, idempotencyKey }) {
  if (Number(amount) <= 0) throw new Error("Kit amount must be greater than 0.");
  return addLineItem({ studentId, session, month, amount, field: "kitFeeBilled", componentType: "kit", feeType: "Admission / Kit", remarks: "Admission / Tie / Belt / Batch / Diary", paymentDate, idempotencyKey });
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
    throw new Error("Could not load due list. Firestore index missing.");
  }
}

export async function getStudentsWithDue({ session, month, className, section } = {}) {
  const targetMonth = month || monthKey();
  const bills = await getDueList({ session, month: targetMonth });
  if (!className && !section) return bills;
  return bills.filter((b) => !className || b.className === className);
}

// ---------------------------------------------------------------------------
// Dashboard stats - OPTIMIZED FOR MINIMAL READS
// ---------------------------------------------------------------------------
export async function getDashboardStats(session, month) {
  const targetMonth = month || monthKey();
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  let studentCount = 0;
  let todayCollection = 0;
  let enteredToday = 0;
  let monthCollection = 0;
  let totalCollection = 0;
  let totalOutstandingDue = 0;
  let totalAdvance = 0;
  let studentsWithDue = 0;
  let studentsFullyPaid = 0;
  let paymentMethodBreakdown = {};

  try {
    const countSnap = await getCountFromServer(query(collection(db, COL.students), where("session", "==", session)));
    studentCount = countSnap.data().count;

    const billsSnap = await getDocs(query(collection(db, COL.monthlyBills), where("session", "==", session), where("month", "==", targetMonth)));
    billsSnap.forEach((doc) => {
      const b = doc.data();
      const carry = b.carriedForward || 0;
      if (carry > 0) { totalOutstandingDue += carry; studentsWithDue++; }
      else if (carry < 0) { totalAdvance += -carry; studentsFullyPaid++; }
      else { studentsFullyPaid++; }
    });

    const yearStart = new Date(now.getFullYear(), 0, 1);
    const txnsSnap = await getDocs(query(
      collection(db, COL.transactions),
      where("session", "==", session),
      where("voided", "==", false),
      where("createdAt", ">=", Timestamp.fromDate(yearStart))
    ));

    txnsSnap.forEach((doc) => {
      const t = doc.data();
      if (t.isCharge === true) return;
      
      const amt = Number(t.netAmount || 0);
      if (amt <= 0) return;

      totalCollection += amt;
      const method = t.paymentMethod || "Other";
      paymentMethodBreakdown[method] = (paymentMethodBreakdown[method] || 0) + amt;

      let paidAt = t.paymentDate ? t.paymentDate.toDate() : (t.createdAt?.toDate() || new Date(0));
      if (!isNaN(paidAt.getTime())) {
        if (paidAt.getTime() >= startOfDay) todayCollection += amt;
        const paidYearMonth = `${paidAt.getFullYear()}-${String(paidAt.getMonth() + 1).padStart(2, "0")}`;
        if (paidYearMonth === currentYearMonth) monthCollection += amt;
      }

      let enteredAt = t.createdAt?.toDate();
      if (enteredAt && enteredAt.getTime() >= startOfDay) {
        enteredToday += amt;
      }
    });
  } catch (err) {
    console.warn("getDashboardStats aggregate failed:", err.message);
  }

  return {
    todayCollection, enteredToday, monthCollection, totalCollection,
    totalOutstandingDue, totalAdvance, studentsWithDue, studentsFullyPaid,
    paymentMethodBreakdown, studentCount, month: targetMonth,
  };
}

// ---------------------------------------------------------------------------
// Other functions
// ---------------------------------------------------------------------------
export async function setFeeStructure({ session, className, categories, lateFeeRule }) {
  const id = `${session}_${className}`;
  await setDoc(doc(db, COL.feeStructures, id), { session, className, categories, lateFeeRule, updatedAt: serverTimestamp() }, { merge: true });
  await writeAuditLog({ action: "FEE_STRUCTURE_UPDATED", newValue: { session, className, categories } });
}

export async function getFeeStructure(session, className) {
  const snap = await getDoc(doc(db, COL.feeStructures, `${session}_${className}`));
  return snap.exists() ? snap.data() : null;
}

export async function getPaymentHistory(studentId) {
  try {
    const q = query(collection(db, COL.transactions), where("studentId", "==", studentId), orderBy("createdAt", "desc"), fsLimit(50));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    return [];
  }
}

export async function getStudentPaymentSummary(studentId, session, month) {
  try {
    const q = query(collection(db, COL.transactions), where("studentId", "==", studentId), where("session", "==", session));
    const snap = await getDocs(q);

    let sessionTotal = 0, lastPayment = null, monthTotal = 0;

    snap.docs.forEach((d) => {
      const t = d.data();
      if (t.isCharge === true || t.voided === true) return;
      if (t.componentType && t.componentType !== "monthly") return;

      const amt = Number(t.netAmount || 0);
      if (amt <= 0) return;

      sessionTotal += amt;
      if (month && t.month === month) monthTotal += amt;

      const paidAt = t.paymentDate ? t.paymentDate.toDate() : (t.createdAt?.toDate?.() || new Date(0));
      const ts = paidAt.getTime();
      if (!lastPayment || ts > lastPayment.ts) lastPayment = { ts, amount: amt, date: paidAt };
    });

    return { sessionTotal, monthTotal, lastPayment: lastPayment ? { amount: lastPayment.amount, date: lastPayment.date } : null };
  } catch (err) {
    return { sessionTotal: 0, monthTotal: 0, lastPayment: null };
  }
}

export async function applyDiscount({ studentId, amount, type, reason }) {
  const user = currentUser();
  const ref = await addDoc(collection(db, COL.discounts), { studentId, amount, type, reason, authorizedBy: user.uid, createdAt: serverTimestamp() });
  await writeAuditLog({ action: "DISCOUNT_APPLIED", studentId, newValue: { amount, type, reason } });
  return ref.id;
}

export async function getAuditLogs({ studentId, limitCount = 100 } = {}) {
  try {
    let q = collection(db, COL.auditLogs);
    q = studentId ? query(q, where("studentId", "==", studentId), orderBy("timestamp", "desc"), fsLimit(limitCount)) : query(q, orderBy("timestamp", "desc"), fsLimit(limitCount));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    return [];
  }
}

export async function createAcademicSession(sessionLabel) {
  await setDoc(doc(db, COL.sessions, sessionLabel), { label: sessionLabel, createdAt: serverTimestamp(), isActive: true });
  await writeAuditLog({ action: "ACADEMIC_SESSION_CREATED", newValue: { session: sessionLabel } });
}

export async function getAcademicSessions() {
  try {
    const snap = await getDocs(query(collection(db, COL.sessions), orderBy("label", "desc")));
    return snap.docs.map((d) => d.data());
  } catch (err) {
    return [];
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
      if (attempt === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
}
export const getUserRole = getUserRoleOnce;

export async function peekNextAdmissionNumber() {
  try {
    const snap = await getDoc(doc(db, COL.counters, "admissionNumber"));
    return (snap.exists() ? snap.data().value : 0) + 1;
  } catch (err) { return 1; }
}

export async function reserveAdmissionNumber() {
  const counterRef = doc(db, COL.counters, "admissionNumber");
  const next = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const value = (snap.exists() ? snap.data().value : 0) + 1;
    tx.set(counterRef, { value }, { merge: true });
    return value;
  });
  return String(next);
}

export async function updateStudentFull(studentId, updates) {
  const user = currentUser();
  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (!["superAdmin", "admin", "accountant"].includes(userDoc.data()?.role)) throw new Error("Unauthorized");

  const ref = doc(db, COL.students, studentId);
  const before = await getDoc(ref);
  if (!before.exists()) throw new Error("Student not found.");

  await updateDoc(ref, { ...updates, updatedBy: user.uid, updatedAt: serverTimestamp() });
  await writeAuditLog({ action: "STUDENT_UPDATED", studentId, previousValue: before.data(), newValue: updates });
  return true;
}

export async function deleteStudentCompletely(studentId, studentName) {
  const user = currentUser();
  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.data()?.role !== "superAdmin") throw new Error("Only a Super Admin can delete a student.");

  const studentRef = doc(db, COL.students, studentId);
  const studentSnap = await getDoc(studentRef);
  if (!studentSnap.exists()) throw new Error("Student not found.");

  const student = studentSnap.data();
  const summary = { studentId, name: student.name, admissionNumber: student.admissionNumber, billsDeleted: 0, transactionsDeleted: 0, receiptsDeleted: 0, discountsDeleted: 0 };

  try {
    const { deleteStudentPhoto } = await import("./photoService");
    await deleteStudentPhoto(studentId);
  } catch (err) {}

  await deleteDoc(studentRef);

  try {
    const billsSnap = await getDocs(query(collection(db, COL.monthlyBills), where("studentId", "==", studentId)));
    for (const d of billsSnap.docs) { await deleteDoc(d.ref); summary.billsDeleted++; }
  } catch (err) {}

  try {
    const txnsSnap = await getDocs(query(collection(db, COL.transactions), where("studentId", "==", studentId)));
    for (const d of txnsSnap.docs) { await deleteDoc(d.ref); summary.transactionsDeleted++; }
  } catch (err) {}

  try {
    const receiptsSnap = await getDocs(query(collection(db, COL.receipts), where("studentId", "==", studentId)));
    for (const d of receiptsSnap.docs) { await deleteDoc(d.ref); summary.receiptsDeleted++; }
  } catch (err) {}

  try {
    const discountsSnap = await getDocs(query(collection(db, COL.discounts), where("studentId", "==", studentId)));
    for (const d of discountsSnap.docs) { await deleteDoc(d.ref); summary.discountsDeleted++; }
  } catch (err) {}

  await writeAuditLog({ action: "STUDENT_DELETED", studentId, previousValue: { name: student.name }, newValue: { deletedBy: user.email || user.uid, summary } });
  return summary;
}

export async function setStudentTransport(studentId, amount) {
  const user = currentUser();
  if ((await getDoc(doc(db, "users", user.uid))).data()?.role !== "superAdmin") throw new Error("Unauthorized");

  const amt = Number(amount);
  if (amt !== 0 && (amt < 800 || amt > 1500)) throw new Error("Transport must be 0 or between ₹800 and ₹1500.");

  const studentRef = doc(db, COL.students, studentId);
  const before = await getDoc(studentRef);
  if (!before.exists()) throw new Error("Student not found.");

  await updateDoc(studentRef, { transportOpted: amt > 0, transportAmount: amt });

  const month = monthKey();
  const session = before.data().session;
  if (session) {
    const safeId = String(studentId).replace(/[\/\\.\*\[\]:;]/g, "-");
    const billRef = doc(db, COL.monthlyBills, `${session}_${month}_${safeId}`);
    const billSnap = await getDoc(billRef);
    if (billSnap.exists() && (billSnap.data().totalPaid || 0) === 0) {
      const bill = billSnap.data();
      const newTotalDue = (bill.totalDue || 0) - (bill.transportBilled || 0) + amt;
      await updateDoc(billRef, { transportBilled: amt, totalDue: newTotalDue, carriedForward: newTotalDue });
    }
  }
  return { transportOpted: amt > 0, transportAmount: amt };
}

export async function deleteTransaction(transactionId, reason = "") {
  const user = currentUser();
  if ((await getDoc(doc(db, "users", user.uid))).data()?.role !== "superAdmin") throw new Error("Unauthorized");

  const txnRef = doc(db, COL.transactions, transactionId);
  const txnSnap = await getDoc(txnRef);
  if (!txnSnap.exists()) throw new Error("Transaction not found.");

  const txn = txnSnap.data();
  const isCharge = txn.isCharge === true;
  const amt = isCharge ? Number(txn.chargedAmount || 0) : Number(txn.netAmount || 0);

  if (txn.studentId && txn.session && txn.month) {
    const safeId = String(txn.studentId).replace(/[\/\\.\*\[\]:;]/g, "-");
    const billRef = doc(db, COL.monthlyBills, `${txn.session}_${txn.month}_${safeId}`);
    const billSnap = await getDoc(billRef);
    
    if (billSnap.exists()) {
      const bill = billSnap.data();
      if (isCharge) {
        const fieldMap = { books: "booksBilled", kit: "kitFeeBilled", previousYear: "previousYearBilled", transport: "transportBilled" };
        const field = fieldMap[txn.componentType];
        const updates = {};
        if (field) updates[field] = Math.max((bill[field] || 0) - amt, 0);
        updates.totalDue = Math.max((bill.totalDue || 0) - amt, 0);
        updates.carriedForward = updates.totalDue - (bill.totalPaid || 0);
        updates.status = updates.carriedForward <= 0 ? "PAID" : ((bill.totalPaid || 0) > 0 ? "PARTIAL" : "DUE");
        await updateDoc(billRef, updates);
      } else {
        const newPaid = Math.max((bill.totalPaid || 0) - amt, 0);
        const newCarry = (bill.totalDue || 0) - newPaid;
        await updateDoc(billRef, { totalPaid: newPaid, carriedForward: newCarry, status: newCarry <= 0 ? "PAID" : (newPaid > 0 ? "PARTIAL" : "DUE") });
      }
    }
  }

  await deleteDoc(txnRef);
  if (txn.receiptRef) await deleteDoc(doc(db, COL.receipts, txn.receiptRef)).catch(() => {});

  await writeAuditLog({ action: isCharge ? "CHARGE_DELETED" : "TRANSACTION_DELETED", studentId: txn.studentId || null, previousValue: txn, newValue: { deletedBy: user.email || user.uid, reason: reason || "Not specified" } });
  return { success: true };
}
