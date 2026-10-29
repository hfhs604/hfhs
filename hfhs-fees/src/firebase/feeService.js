/**
 * feeService.js
 * Fee Management data layer for Holy Faith High School.
 */

import { db, auth } from "../firebase/config";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, setDoc,
  deleteDoc, getCountFromServer,
  query, where, orderBy, limit as fsLimit,
  runTransaction, serverTimestamp, Timestamp, writeBatch,
} from "firebase/firestore";

const COL = {
  students: "students", feeStructures: "feeStructures", transactions: "feeTransactions",
  receipts: "receipts", discounts: "discounts", sessions: "academicSessions",
  auditLogs: "auditLogs", counters: "counters", monthlyBills: "monthlyBills",
  attendance: "attendance", exams: "exams",
};

export const MONTHLY_TUITION = {
  "Pre-LKG": 800, "LKG": 800, "NUR": 800, "UKG": 900,  "I": 900,
  "II": 1000,  "III": 1000, "IV": 1100,  "V": 1100, "VI": 1200,  "VII": 1200,
  "VIII": 1300, "IX": 1400, "X": 1500,
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
  } catch (err) { console.warn("writeAuditLog failed:", err.message); }
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

export async function createStudent(data) {
  const user = currentUser();
  const ref = doc(collection(db, COL.students));
  await setDoc(ref, { ...data, section: data.section || "", totalAmountPaid: 0, lastPaymentDate: null, createdBy: user.uid, createdAt: serverTimestamp() });
  await writeAuditLog({ action: "STUDENT_CREATED", studentId: ref.id, newValue: data });
  return ref.id;
}

export async function updateStudentProfile(studentId, updates) {
  try {
    const before = await getDoc(doc(db, COL.students, studentId));
    await updateDoc(doc(db, COL.students, studentId), updates);
    await writeAuditLog({ action: "STUDENT_UPDATED", studentId, previousValue: before.exists() ? before.data() : null, newValue: updates });
  } catch (err) { throw err; }
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
  const upper = raw.toUpperCase(), title = raw.toLowerCase().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "), lower = raw.toLowerCase();
  const nameVariants = Array.from(new Set([upper, title, lower]));

  if (/^\d+$/.test(raw)) {
    try {
      const snap = await getDocs(query(collection(db, COL.students), where("admissionNumber", "==", raw), fsLimit(20)));
      snap.forEach((d) => results.set(d.id, { id: d.id, ...d.data() }));
      if (results.size > 0) return Array.from(results.values());
    } catch (err) {}
  }

  if (raw.length >= 3) {
    for (const variant of nameVariants) {
      try {
        const snap = await getDocs(query(collection(db, COL.students), where("name", ">=", variant), where("name", "<=", variant + "\uf8ff"), fsLimit(20)));
        snap.forEach((d) => results.set(d.id, { id: d.id, ...d.data() }));
      } catch (err) {}
    }
  }

  if (results.size === 0 && raw.length >= 3) {
    try {
      const snap = await getDocs(query(collection(db, COL.students), fsLimit(500)));
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

export async function startNewMonth(session, month, { isFirstMonth = false } = {}) {
  let created = 0;
  let students = [];

  try {
    const snap = await getDocs(query(collection(db, COL.students), where("session", "==", session)));
    students = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    throw new Error(`Could not read students: ${err.message}`);
  }

  for (const student of students) {
    const tuition = MONTHLY_TUITION[student.className] || 0;
    const transport = student.transportOpted ? (student.transportAmount || 0) : 0;
    
    const currentMonthNum = parseInt(month.split("-")[1]);
    const devFee = (currentMonthNum === 4 || isFirstMonth) ? DEVELOPMENT_FEE : 0;
    
    const currentMonthTotal = tuition + transport + devFee;

    const txnSnap = await getDocs(query(
      collection(db, COL.transactions),
      where("studentId", "==", student.id),
      where("session", "==", session),
      where("voided", "==", false)
    ));
    
    let totalPaid = 0;
    let totalDiscount = 0;
    txnSnap.forEach(t => {
      const data = t.data();
      if (!data.componentType || data.componentType === "monthly") {
        totalPaid += Number(data.amountReceived || data.netAmount || 0);
        totalDiscount += Number(data.discount || 0);
      }
    });

    let previousDue = 0;
    const prevM = parseInt(month.split("-")[1]) - 1;
    const prevY = parseInt(month.split("-")[0]);
    if (prevM > 0) {
       const prevMonthStr = `${prevY}-${String(prevM).padStart(2, '0')}`;
       const safePrevId = String(student.id).replace(/[\/\\.\*\[\]:;]/g, "-");
       const prevRef = doc(db, COL.monthlyBills, `${session}_${prevMonthStr}_${safePrevId}`);
       const prevSnap = await getDoc(prevRef);
       if (prevSnap.exists()) {
         previousDue = prevSnap.data().carriedForward || 0;
       }
    }

    const totalDue = previousDue + currentMonthTotal;
    const carriedForward = Math.max(totalDue - totalPaid - totalDiscount, 0);

    const safeStudentId = String(student.id).replace(/[\/\\.\*\[\]:;]/g, "-");
    const billRef = doc(db, COL.monthlyBills, `${session}_${month}_${safeStudentId}`);
    
    await setDoc(billRef, {
      session, month, studentId: student.id, studentName: student.name, className: student.className,
      previousDue, 
      tuitionBilled: tuition, 
      transportBilled: transport, 
      devFeeBilled: devFee,
      booksBilled: 0, previousYearBilled: 0, kitFeeBilled: 0,
      totalDue, 
      totalPaid, 
      carriedForward,
      status: carriedForward <= 0 ? "PAID" : "PARTIAL", 
      createdAt: serverTimestamp(),
    }, { merge: true }); 
    
    created++;
  }

  await writeAuditLog({ action: "MONTH_STARTED", newValue: { session, month, isFirstMonth, studentCount: created } });
  return { created, month, session };
}

export async function getMonthlyBill(session, month, studentId) {
  const safeId = String(studentId).replace(/[\/\\.\*\[\]:;]/g, "-");
  const snap = await getDoc(doc(db, COL.monthlyBills, `${session}_${month}_${safeId}`));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listBillsForMonth(session, month) {
  try {
    const snap = await getDocs(query(collection(db, COL.monthlyBills), where("session", "==", session), where("month", "==", month)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) { throw new Error("Index required."); }
}

export async function collectPayment({ studentId, amountReceived, paymentDate, paymentMethod, referenceNumber, feeType, discount = 0, lateFee = 0, remarks = "", session, month, idempotencyKey }) {
  const user = currentUser();
  const safeId = String(studentId).replace(/[\/\\.\*\[\]:;]/g, "-");
  const billRef = doc(db, COL.monthlyBills, `${session}_${month}_${safeId}`);
  const idemRef = doc(db, "paymentIdempotency", idempotencyKey);

  const result = await runTransaction(db, async (tx) => {
    const idemSnap = await tx.get(idemRef);
    if (idemSnap.exists()) return { alreadyProcessed: true, receiptId: idemSnap.data().receiptId };
    
    const billSnap = await tx.get(billRef);
    if (!billSnap.exists()) throw new Error("No bill for this month.");
    const bill = billSnap.data();

    const amt = Number(amountReceived);
    const disc = Number(discount);
    const late = Number(lateFee);

    const currentRunningBalance = bill.carriedForward !== undefined ? bill.carriedForward : bill.totalDue;

    const totalCredit = amt + disc;
    const newPaid = (bill.totalPaid || 0) + amt;
    const newCarry = (bill.totalDue || 0) - totalCredit;

    const txnRef = doc(collection(db, COL.transactions));
    const receiptRef = doc(collection(db, COL.receipts));

    tx.set(txnRef, {
      studentId, session, month, componentType: "monthly", amountReceived: amt,
      discount: disc, lateFee: late, netAmount: amt,
      previousDue: bill.previousDue || 0, 
      totalDue: currentRunningBalance, 
      remainingDue: Math.max(newCarry, 0),
      paymentDate: Timestamp.fromDate(new Date(paymentDate)),
      paymentMethod, referenceNumber: referenceNumber || null, feeType, remarks,
      collectedBy: user.uid, collectedByEmail: user.email || null, receiptRef: receiptRef.id,
      createdAt: serverTimestamp(), voided: false,
    });

    tx.update(billRef, { totalPaid: newPaid, carriedForward: newCarry, status: newCarry <= 0 ? "PAID" : "PARTIAL", lastPaymentAt: serverTimestamp() });
    tx.set(idemRef, { receiptId: receiptRef.id, createdAt: serverTimestamp() });
    return { alreadyProcessed: false, receiptRef, txnRef, bill, newPaid, currentRunningBalance };
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
    session, month, feeType, amountReceived: Number(amountReceived), discount: Number(discount),
    lateFee: Number(lateFee), 
    previousDue: result.bill.previousDue || 0,
    totalDue: result.currentRunningBalance, 
    remainingDue: Math.max((result.bill.totalDue || 0) - result.newPaid, 0),
    paymentMethod, referenceNumber: referenceNumber || null, paymentDate, createdAt: serverTimestamp(),
  };
  
  await setDoc(doc(db, COL.receipts, result.receiptRef.id), receiptData);
  await updateDoc(result.txnRef, { receiptNumber }); 

  await writeAuditLog({ action: "PAYMENT_COLLECTED", studentId, newValue: { amountReceived, receiptNumber }, transactionRef: result.txnRef.id });
  return { receiptId: result.receiptRef.id, receipt: receiptData, duplicateBlocked: false };
}

export async function addLineItem({ studentId, session, month, amount, field, componentType, feeType, remarks, paymentMethod = "Cash", paymentDate, idempotencyKey }) {
  const user = currentUser();
  const safeId = String(studentId).replace(/[\/\\.\*\[\]:;]/g, "-");
  const billRef = doc(db, COL.monthlyBills, `${session}_${month}_${safeId}`);
  const idemRef = doc(db, "paymentIdempotency", idempotencyKey);

  const result = await runTransaction(db, async (tx) => {
    const billSnap = await tx.get(billRef);
    if (!billSnap.exists()) throw new Error("No bill found.");
    const bill = billSnap.data();

    const amt = Number(amount);
    const newDue = (bill.totalDue || 0) + amt;
    const newFieldValue = (bill[field] || 0) + amt;

    const txnRef = doc(collection(db, COL.transactions));
    const receiptRef = doc(collection(db, COL.receipts));

    tx.set(txnRef, {
      studentId, session, month, componentType, amountReceived: 0, netAmount: 0, addOnAmount: amt,
      remainingDue: Math.max(newDue - (bill.totalPaid || 0), 0), 
      paymentDate: Timestamp.fromDate(new Date(paymentDate)), paymentMethod, feeType, remarks,
      collectedBy: user.uid, collectedByEmail: user.email || null, receiptRef: receiptRef.id,
      createdAt: serverTimestamp(), voided: false,
    });

    const newPaid = bill.totalPaid || 0;
    const newCarry = newDue - newPaid;

    tx.update(billRef, { [field]: newFieldValue, totalDue: newDue, totalPaid: newPaid, carriedForward: newCarry, status: newCarry <= 0 ? "PAID" : "PARTIAL" });
    tx.set(idemRef, { receiptId: receiptRef.id, createdAt: serverTimestamp() });
    return { receiptRef, txnRef, bill, amt, newPaid };
  });

  const receiptNumber = await generateReceiptNumber(session);
  const student = await getStudentFeeProfile(studentId);
  const receiptData = {
    receiptNumber, studentId, studentName: student.name, admissionNumber: student.admissionNumber,
    className: student.className, guardianName: student.guardianName || student.fatherName,
    session, month, feeType, amountReceived: 0, discount: 0, addOnAmount: result.amt,
    remainingDue: Math.max((result.bill.totalDue + result.amt) - result.newPaid, 0),
    paymentMethod, paymentDate, createdAt: serverTimestamp(), componentType,
  };
  
  await setDoc(doc(db, COL.receipts, result.receiptRef.id), receiptData);
  await updateDoc(result.txnRef, { receiptNumber });
  await writeAuditLog({ action: `ADD_${componentType.toUpperCase()}`, studentId, newValue: { amount: result.amt, receiptNumber }, transactionRef: result.txnRef.id });
  return { receiptId: result.receiptRef.id, receipt: receiptData, duplicateBlocked: false };
}

export async function addTransportFee(a) { return addLineItem({ ...a, amount: Number(a.amount), field: "transportBilled", componentType: "transport", feeType: "Transport", remarks: "Transport fee" }); }
export async function addBooksFee(a) { return addLineItem({ ...a, field: "booksBilled", componentType: "books", feeType: "Books", remarks: "Books fee" }); }
export async function addPreviousYearBalance(a) { return addLineItem({ ...a, field: "previousYearBilled", componentType: "previousYear", feeType: "Previous Year Balance", remarks: "Previous year dues" }); }
export async function addKitFee(a) { return addLineItem({ ...a, field: "kitFeeBilled", componentType: "kit", feeType: "Admission / Kit", remarks: "Admission / Kit" }); }

export async function editTransaction({ transactionId, newAmount, newDiscount, newPaymentDate }) {
  const user = currentUser();
  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.data()?.role !== "superAdmin") throw new Error("Only Super Admin can edit a transaction.");

  const txnRef = doc(db, COL.transactions, transactionId);
  const txnSnap = await getDoc(txnRef);
  if (!txnSnap.exists()) throw new Error("Transaction not found.");
  const txn = txnSnap.data();
  
  const editTime = serverTimestamp();

  await updateDoc(txnRef, {
    amountReceived: Number(newAmount),
    discount: Number(newDiscount),
    netAmount: Number(newAmount),
    paymentDate: Timestamp.fromDate(new Date(newPaymentDate)),
    editedBy: user.email || user.uid,
    editedAt: editTime 
  });

  if (txn.receiptRef) {
    const receiptRef = doc(db, COL.receipts, txn.receiptRef);
    const receiptSnap = await getDoc(receiptRef);
    if (receiptSnap.exists()) {
      await updateDoc(receiptRef, {
        amountReceived: Number(newAmount),
        discount: Number(newDiscount),
        editedAt: editTime 
      });
    }
  }

  await writeAuditLog({ action: "TRANSACTION_EDITED", studentId: txn.studentId, previousValue: txn, newValue: { amount: newAmount, discount: newDiscount, date: newPaymentDate }, transactionRef: transactionId });
  return { success: true };
}

export async function refundAdvance({ studentId, amount, session, month, reason = "" }) {
  const user = currentUser(); const safeId = String(studentId).replace(/[\/\\.\*\[\]:;]/g, "-");
  const billRef = doc(db, COL.monthlyBills, `${session}_${month}_${safeId}`); const amt = Number(amount);
  if (amt <= 0) throw new Error("Refund amount must be > 0.");

  await runTransaction(db, async (tx) => {
    const billSnap = await tx.get(billRef); if (!billSnap.exists()) throw new Error("No bill found.");
    const bill = billSnap.data(); const carry = bill.carriedForward || 0;
    if (carry >= 0) throw new Error("No advance balance to refund.");
    if (amt > Math.abs(carry)) throw new Error(`Refund exceeds available advance of ₹${Math.abs(carry)}.`);

    const txnRef = doc(collection(db, COL.transactions));
    tx.set(txnRef, { studentId, session, month, componentType: "refund", amountReceived: -amt, netAmount: -amt, paymentDate: Timestamp.now(), paymentMethod: "Cash", feeType: "Refund", remarks: reason, collectedBy: user.uid, collectedByEmail: user.email || null, createdAt: serverTimestamp(), voided: false });
    tx.update(billRef, { carriedForward: carry + amt, status: carry + amt <= 0 ? "PAID" : "PARTIAL" });
  });
  await writeAuditLog({ action: "ADVANCE_REFUNDED", studentId, newValue: { amount: amt, reason } });
  return { success: true };
}

export async function getDueList({ session, month } = {}) {
  try {
    const clauses = []; if (session) clauses.push(where("session", "==", session)); if (month) clauses.push(where("month", "==", month));
    const snap = await getDocs(query(collection(db, COL.monthlyBills), ...clauses));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((b) => (b.carriedForward || 0) > 0).sort((a, b) => (b.carriedForward || 0) - (a.carriedForward || 0));
  } catch (err) { throw new Error("Index required."); }
}

export async function getStudentsWithDue({ session, month, className } = {}) {
  const bills = await getDueList({ session, month: month || monthKey() });
  if (!className) return bills; return bills.filter((b) => b.className === className);
}

export async function getDashboardStats(session, month) {
  const targetMonth = month || monthKey();
  let studentCount = 0, actualMonth = targetMonth;

  try { 
    const c = await getCountFromServer(query(collection(db, COL.students), where("session", "==", session))); 
    studentCount = c.data().count; 
  } catch (err) {}

  let students = [];
  try {
    const sSnap = await getDocs(query(collection(db, COL.students), where("session", "==", session)));
    students = sSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {}

  let transactions = [];
  try {
    const tSnap = await getDocs(query(collection(db, COL.transactions), where("session", "==", session), where("voided", "==", false)));
    transactions = tSnap.docs.map(d => d.data());
  } catch (err) {}

  let bills = [];
  try {
    const bSnap = await getDocs(query(collection(db, COL.monthlyBills), where("session", "==", session)));
    bills = bSnap.docs.map(d => d.data());
  } catch (err) {}

  const txnByStudent = {};
  let paymentMethodBreakdown = {}, todayCollection = 0, todayEntered = 0, totalDiscount = 0;
  let todayCash = 0, todayBank = 0;
  let trueTotalCollection = 0, monthCollection = 0;
  const startOfDayMs = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();

  transactions.forEach((t) => {
    const sid = t.studentId;
    if (!txnByStudent[sid]) txnByStudent[sid] = { paid: 0, discount: 0 };
    
    if (!t.componentType || t.componentType === "monthly") {
      txnByStudent[sid].paid += Number(t.amountReceived || t.netAmount || 0);
      txnByStudent[sid].discount += Number(t.discount || 0);
    }

    const method = t.paymentMethod || "Other"; 
    const amt = Number(t.netAmount || 0); 
    const disc = Number(t.discount || 0);
    
    paymentMethodBreakdown[method] = (paymentMethodBreakdown[method] || 0) + amt;
    totalDiscount += disc;
    
    if (t.componentType === "refund") trueTotalCollection -= amt;
    else trueTotalCollection += amt;

    if (t.month === targetMonth) monthCollection += amt;

    let paidAt = t.paymentDate?.toDate?.() || new Date(t.paymentDate || t.createdAt?.toDate?.() || 0);
    if (paidAt && !isNaN(paidAt.getTime()) && paidAt.getTime() >= startOfDayMs) {
      todayCollection += amt;
      if (method === "Cash") todayCash += amt;
      else todayBank += amt;
    }

    let enteredAt = t.createdAt?.toDate?.() || new Date(0);
    if (enteredAt && !isNaN(enteredAt.getTime()) && enteredAt.getTime() >= startOfDayMs) {
      todayEntered += amt;
    }
  });

  const latestBillByStudent = {};
  bills.forEach(b => {
    if (!latestBillByStudent[b.studentId] || b.month > latestBillByStudent[b.studentId].month) {
      latestBillByStudent[b.studentId] = b;
    }
  });

  let totalOutstandingDue = 0, totalAdvance = 0, studentsWithDue = 0, studentsFullyPaid = 0;

  students.forEach(s => {
    const bill = latestBillByStudent[s.id];
    if (!bill) return; 

    const txn = txnByStudent[s.id] || { paid: 0, discount: 0 };
    
    const expectedTotal = bill.totalDue || 0;
    const actualBalance = expectedTotal - txn.paid - txn.discount;

    if (actualBalance > 0) {
      totalOutstandingDue += actualBalance;
      studentsWithDue++;
    } else if (actualBalance < 0) {
      totalAdvance += Math.abs(actualBalance);
      studentsFullyPaid++;
    } else {
      studentsFullyPaid++;
    }
  });

  return { 
    paymentDateToday: todayCollection, enteredToday: todayEntered, todayCash, todayBank, monthCollection, totalCollection: trueTotalCollection, totalOutstandingDue, totalAdvance, totalDiscount, studentsWithDue, studentsFullyPaid, paymentMethodBreakdown, studentCount, month: actualMonth 
  };
}

export async function setFeeStructure({ session, className, categories, lateFeeRule }) {
  await setDoc(doc(db, COL.feeStructures, `${session}_${className}`), { session, className, categories, lateFeeRule, updatedAt: serverTimestamp() }, { merge: true });
  await writeAuditLog({ action: "FEE_STRUCTURE_UPDATED", newValue: { session, className, categories } });
}

export async function getFeeStructure(session, className) {
  const snap = await getDoc(doc(db, COL.feeStructures, `${session}_${className}`));
  return snap.exists() ? snap.data() : null;
}

export async function getPaymentHistory(studentId) {
  try {
    const snap = await getDocs(query(collection(db, COL.transactions), where("studentId", "==", studentId)));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const timeA = a.createdAt?.toDate?.()?.getTime() || new Date(a.paymentDate || 0).getTime();
        const timeB = b.createdAt?.toDate?.()?.getTime() || new Date(b.paymentDate || 0).getTime();
        return timeA - timeB; 
      });
  } catch (err) {
    console.error("Error fetching history:", err);
    return [];
  }
}

export async function repairStudentHistory(studentId) {
  const user = currentUser();
  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.data()?.role !== "superAdmin") throw new Error("Only Super Admin can repair data.");

  const studentSnap = await getDoc(doc(db, COL.students, studentId));
  if (!studentSnap.exists()) throw new Error("Student not found");
  const student = studentSnap.data();

  const txnsSnap = await getDocs(query(collection(db, COL.transactions), where("studentId", "==", studentId)));
  
  // NEW FIX: Sort strictly by Receipt Number (which is sequential) to guarantee chronological order.
  const txns = txnsSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => {
    const recA = a.receiptNumber || "";
    const recB = b.receiptNumber || "";
    if (recA && recB) return recA.localeCompare(recB);
    // Fallback to date if receipt numbers are missing
    const timeA = a.createdAt?.toDate?.()?.getTime() || new Date(a.paymentDate || 0).getTime();
    const timeB = b.createdAt?.toDate?.()?.getTime() || new Date(b.paymentDate || 0).getTime();
    return timeA - timeB;
  });

  const billsSnap = await getDocs(query(collection(db, COL.monthlyBills), where("studentId", "==", studentId)));
  const bills = billsSnap.docs.map(d => d.data()).sort((a, b) => b.month.localeCompare(a.month)); 
  
  if (bills.length === 0) throw new Error("No bills found.");
  const latestBill = bills[0];

  const latestBillMonth = parseInt(latestBill.month.split("-")[1]);
  const monthsBilled = latestBillMonth >= 4 ? (latestBillMonth - 4 + 1) : 0;
  
  const baseTuition = MONTHLY_TUITION[student.className] || 0;
  const baseTransport = student.transportOpted ? (student.transportAmount || 0) : 0;
  const monthlyFee = baseTuition + baseTransport;
  
  // Start at April.
  const initialBaseBill = (monthlyFee * monthsBilled) + DEVELOPMENT_FEE + (latestBill.booksBilled || 0) + (latestBill.previousYearBilled || 0) + (latestBill.kitFeeBilled || 0);

  let runningTotalBill = initialBaseBill;
  let runningBalance = initialBaseBill;
  let updatedCount = 0;

  const batch = writeBatch(db);

  for (const txn of txns) {
    const amt = Number(txn.amountReceived || txn.netAmount || 0);
    const disc = Number(txn.discount || 0);

    // Snapshot BEFORE transaction
    const billSnapshot = runningTotalBill;
    const balanceSnapshot = runningBalance;

    // Apply transaction
    if (!txn.componentType || txn.componentType === "monthly") {
      runningBalance = Math.max(runningBalance - amt - disc, 0);
    }

    batch.update(doc(db, COL.transactions, txn.id), {
      totalDue: billSnapshot,
      remainingDue: balanceSnapshot
    });

    updatedCount++;
  }

  await batch.commit();
  await writeAuditLog({ action: "HISTORY_REPAIRED", studentId, newValue: { count: updatedCount } });
  return updatedCount;
}

export async function getStudentPaymentSummary(studentId, session, month) {
  try {
    const snap = await getDocs(query(collection(db, COL.transactions), where("studentId", "==", studentId)));
    let sessionTotal = 0, lastPayment = null, monthTotal = 0, totalDiscount = 0;
    snap.docs.forEach((d) => {
      const t = d.data();
      if (session && t.session !== session) return;
      if (t.voided === true) return;
      if (t.componentType && t.componentType !== "monthly" && t.componentType !== "refund") return; 
      
      const amt = Number(t.netAmount || 0);
      const disc = Number(t.discount || 0);
      
      sessionTotal += amt;
      totalDiscount += disc;
      
      if (month && t.month === month) monthTotal += amt;
      
      const paidAt = t.paymentDate?.toDate?.() || new Date(t.paymentDate || t.createdAt?.toDate?.() || 0);
      const ts = paidAt.getTime();
      if (!lastPayment || ts > lastPayment.ts) lastPayment = { ts, amount: amt, date: paidAt };
    });
    return { sessionTotal, monthTotal, totalDiscount, lastPayment: lastPayment ? { amount: lastPayment.amount, date: lastPayment.date } : null };
  } catch (err) { return { sessionTotal: 0, monthTotal: 0, totalDiscount: 0, lastPayment: null }; }
}

export async function getSessionPaidTotal(studentId, session) { return (await getStudentPaymentSummary(studentId, session)).sessionTotal; }
export async function getLastPayment(studentId, session, month) { return (await getStudentPaymentSummary(studentId, session, month)).lastPayment; }

export async function applyDiscount({ studentId, amount, type, reason }) {
  const user = currentUser();
  const ref = await addDoc(collection(db, COL.discounts), { studentId, amount, type, reason, authorizedBy: user.uid, createdAt: serverTimestamp() });
  await writeAuditLog({ action: "DISCOUNT_APPLIED", studentId, newValue: { amount, type, reason } });
  return ref.id;
}

export async function getAuditLogs({ studentId, limitCount = 100 } = {}) {
  try {
    let q = studentId ? query(collection(db, COL.auditLogs), where("studentId", "==", studentId), orderBy("timestamp", "desc"), fsLimit(limitCount)) : query(collection(db, COL.auditLogs), orderBy("timestamp", "desc"), fsLimit(limitCount));
    const snap = await getDocs(q); return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    const snap = await getDocs(query(collection(db, COL.auditLogs), fsLimit(limitCount)));
    let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (studentId) rows = rows.filter((r) => r.studentId === studentId);
    return rows.sort((a, b) => (b.timestamp?.toDate?.() || 0) - (a.timestamp?.toDate?.() || 0)).slice(0, limitCount);
  }
}

export async function createAcademicSession(sessionLabel) {
  await setDoc(doc(db, COL.sessions, sessionLabel), { label: sessionLabel, createdAt: serverTimestamp(), isActive: true });
  await writeAuditLog({ action: "ACADEMIC_SESSION_CREATED", newValue: { session: sessionLabel } });
}

export async function getAcademicSessions() {
  try { const snap = await getDocs(query(collection(db, COL.sessions), orderBy("label", "desc"))); return snap.docs.map((d) => d.data()); } 
  catch (err) { const snap = await getDocs(collection(db, COL.sessions)); return snap.docs.map((d) => d.data()).sort((a, b) => String(b.label).localeCompare(String(a.label))); }
}

export async function setUserRole(uid, role, permissions = {}) {
  await setDoc(doc(db, "users", uid), { role, permissions }, { merge: true });
  await writeAuditLog({ action: "USER_ROLE_SET", newValue: { uid, role, permissions } });
}

export async function getUserRoleOnce(uid, retries = 3, delayMs = 700) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try { const snap = await getDoc(doc(db, "users", uid)); return snap.exists() ? snap.data() : null; } 
    catch (err) { if (attempt === retries - 1) throw err; await new Promise((r) => setTimeout(r, delayMs * (attempt + 1))); }
  }
}
export const getUserRole = getUserRoleOnce;

export async function peekNextAdmissionNumber() {
  try { const snap = await getDoc(doc(db, COL.counters, "admissionNumber")); return (snap.exists() ? snap.data().value : 0) + 1; } 
  catch (err) { return 1; }
}

export async function reserveAdmissionNumber() {
  const counterRef = doc(db, COL.counters, "admissionNumber");
  const next = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef); const value = (snap.exists() ? snap.data().value : 0) + 1;
    tx.set(counterRef, { value }, { merge: true }); return value;
  });
  return String(next);
}

export async function updateStudentFull(studentId, updates) {
  const user = currentUser(); const userDoc = await getDoc(doc(db, "users", user.uid));
  if (!["superAdmin", "admin", "accountant"].includes(userDoc.data()?.role)) throw new Error("Permission denied.");
  await updateDoc(doc(db, COL.students, studentId), { ...updates, updatedBy: user.uid, updatedAt: serverTimestamp() });
  await writeAuditLog({ action: "STUDENT_UPDATED", studentId, newValue: updates });
  return true;
}

export async function deleteStudentCompletely(studentId, studentName) {
  const user = currentUser(); const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.data()?.role !== "superAdmin") throw new Error("Only Super Admin can delete.");
  const studentRef = doc(db, COL.students, studentId); const studentSnap = await getDoc(studentRef);
  if (!studentSnap.exists()) throw new Error("Student not found.");
  const student = studentSnap.data();
  const summary = { studentId, name: student.name || studentName, billsDeleted: 0, transactionsDeleted: 0, receiptsDeleted: 0, discountsDeleted: 0 };
  
  await deleteDoc(studentRef);
  const deleteColl = async (coll, key, val, summaryKey) => {
    try { const snap = await getDocs(query(collection(db, coll), where(key, "==", val))); for (const d of snap.docs) { await deleteDoc(doc(db, coll, d.id)); summary[summaryKey]++; } } catch (err) {}
  };
  await deleteColl(COL.monthlyBills, "studentId", studentId, "billsDeleted");
  await deleteColl(COL.transactions, "studentId", studentId, "transactionsDeleted");
  await deleteColl(COL.receipts, "studentId", studentId, "receiptsDeleted");
  await deleteColl(COL.discounts, "studentId", studentId, "discountsDeleted");
  
  await writeAuditLog({ action: "STUDENT_DELETED", studentId, previousValue: { name: student.name, admissionNumber: student.admissionNumber }, newValue: { deletedBy: user.email || user.uid, summary } });
  return summary;
}

export async function setStudentTransport(studentId, amount) {
  const user = currentUser(); const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.data()?.role !== "superAdmin") throw new Error("Only Super Admin can change transport.");
  const amt = Number(amount); if (amt !== 0 && (amt < 800 || amt > 1500)) throw new Error("Transport must be 0 or between ₹800 and ₹1500.");
  
  const studentRef = doc(db, COL.students, studentId); const before = await getDoc(studentRef);
  if (!before.exists()) throw new Error("Student not found.");
  await updateDoc(studentRef, { transportOpted: amt > 0, transportAmount: amt });
  
  const month = monthKey(); const session = before.data().session;
  if (session) {
    const safeId = String(studentId).replace(/[\/\\.\*\[\]:;]/g, "-"); const billRef = doc(db, COL.monthlyBills, `${session}_${month}_${safeId}`);
    const billSnap = await getDoc(billRef);
    if (billSnap.exists() && (billSnap.data().totalPaid || 0) === 0) {
      const bill = billSnap.data(); const oldTransport = bill.transportBilled || 0;
      const newTotalDue = (bill.totalDue || 0) - oldTransport + amt;
      await updateDoc(billRef, { transportBilled: amt, totalDue: newTotalDue, carriedForward: newTotalDue - (bill.totalPaid || 0) });
    }
  }
  await writeAuditLog({ action: "TRANSPORT_UPDATED", studentId, previousValue: { opted: before.data().transportOpted }, newValue: { opted: amt > 0 } });
  return { transportOpted: amt > 0, transportAmount: amt };
}

export async function deleteTransaction(transactionId, reason = "") {
  const user = currentUser(); const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.data()?.role !== "superAdmin") throw new Error("Only Super Admin can delete a transaction.");
  const txnRef = doc(db, COL.transactions, transactionId); const txnSnap = await getDoc(txnRef);
  if (!txnSnap.exists()) throw new Error("Transaction not found."); const txn = txnSnap.data();

  if (txn.studentId && txn.session && txn.month) {
    const safeId = String(txn.studentId).replace(/[\/\\.\*\[\]:;]/g, "-"); const billRef = doc(db, COL.monthlyBills, `${txn.session}_${txn.month}_${safeId}`);
    const billSnap = await getDoc(billRef);
    if (billSnap.exists()) {
      const bill = billSnap.data(); const amt = Number(txn.netAmount || 0); const disc = Number(txn.discount || 0);
      
      if (!txn.componentType || txn.componentType === "monthly" || txn.componentType === "refund") {
        const newPaid = Math.max((bill.totalPaid || 0) - amt, 0); 
        const newCarry = (bill.totalDue || 0) - newPaid + disc; 
        await updateDoc(billRef, { totalPaid: newPaid, carriedForward: newCarry, status: newCarry <= 0 ? "PAID" : "PARTIAL" });
      } else {
        const field = { books: "booksBilled", kit: "kitFeeBilled", previousYear: "previousYearBilled", transport: "transportBilled" }[txn.componentType];
        if (field) {
          const newFieldValue = Math.max((bill[field] || 0) - amt, 0); const newDue = Math.max((bill.totalDue || 0) - amt, 0); const newCarry = newDue - (bill.totalPaid || 0);
          await updateDoc(billRef, { [field]: newFieldValue, totalDue: newDue, carriedForward: newCarry, status: newCarry <= 0 ? "PAID" : "PARTIAL" });
        }
      }
    }
  }
  await deleteDoc(txnRef); if (txn.receiptRef) { try { await deleteDoc(doc(db, COL.receipts, txn.receiptRef)); } catch (err) {} }
  await writeAuditLog({ action: "TRANSACTION_DELETED", studentId: txn.studentId || null, previousValue: txn, newValue: { deletedBy: user.email || user.uid, reason: reason || "Not specified" } });
  return { success: true };
}

export async function getAttendance(date, className) {
  try { const snap = await getDoc(doc(db, COL.attendance, `${date}_${className || "all"}`)); return snap.exists() ? snap.data() : { date, className, records: {} }; } catch (err) { return { date, className, records: {} }; }
}
export async function saveAttendance(date, className, records) {
  const user = currentUser(); await setDoc(doc(db, COL.attendance, `${date}_${className || "all"}`), { date, className, records, updatedBy: user.uid, updatedAt: serverTimestamp() }, { merge: true }); return { success: true };
}
export async function getExams(session) {
  try { const snap = await getDocs(query(collection(db, COL.exams), where("session", "==", session))); return snap.docs.map((d) => ({ id: d.id, ...d.data() })); } catch (err) { return []; }
}
export async function createExam({ session, name, className }) {
  const user = currentUser(); const ref = doc(collection(db, COL.exams)); await setDoc(ref, { session, name, className, createdAt: serverTimestamp(), createdBy: user.uid }); return ref.id;
}
export async function getExamMarks(examId) {
  try { const snap = await getDocs(collection(db, COL.exams, examId, "marks")); const marks = {}; snap.docs.forEach((d) => { marks[d.id] = d.data(); }); return marks; } catch (err) { return {}; }
}
export async function saveStudentMarks({ examId, studentId, marks, remarks = "" }) {
  const user = currentUser(); await setDoc(doc(db, COL.exams, examId, "marks", studentId), { marks, remarks, updatedBy: user.uid, updatedAt: serverTimestamp() }); return { success: true };
}
