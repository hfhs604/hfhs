/**
 * feeService.js
 * Fee Management data layer for Holy Faith High School.
 */

import { db, auth } from "../firebase/config";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, setDoc,
  deleteDoc, getCountFromServer,
  query, where, orderBy, limit as fsLimit,
  runTransaction, serverTimestamp, Timestamp,
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

  for (const variant of nameVariants) {
    try {
      const snap = await getDocs(query(collection(db, COL.students), where("name", ">=", variant), where("name", "<=", variant + "\uf8ff"), fsLimit(20)));
      snap.forEach((d) => results.set(d.id, { id: d.id, ...d.data() }));
    } catch (err) {}
  }
  if (/^\d+$/.test(raw)) {
    try {
      const snap = await getDocs(query(collection(db, COL.students), where("admissionNumber", ">=", raw), where("admissionNumber", "<=", raw + "\uf8ff"), fsLimit(20)));
      snap.forEach((d) => results.set(d.id, { id: d.id, ...d.data() }));
    } catch (err) {}
  }
  if (results.size === 0 && raw.length >= 2) {
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
  if (students.length === 0) throw new Error(`No students found.`);

  for (const student of students) {
    let startMonth = "04"; // Default to April
    if (student.dateOfAdmission) {
      startMonth = String(new Date(student.dateOfAdmission).getMonth() + 1).padStart(2, '0');
    }

    const targetYear = month.split("-")[0];
    const targetMonthNum = parseInt(month.split("-")[1]);

    for (let m = parseInt(startMonth); m <= targetMonthNum; m++) {
      const currentMonthStr = `${targetYear}-${String(m).padStart(2, '0')}`;
      const isApril = m === 4;
      const devFee = isApril ? DEVELOPMENT_FEE : 0;

      let previousDue = 0;
      const prevM = m === 1 ? 12 : m - 1;
      const prevY = m === 1 ? parseInt(targetYear) - 1 : targetYear;
      const prevMonthStr = `${prevY}-${String(prevM).padStart(2, '0')}`;

      const safePrevId = String(student.id).replace(/[\/\\.\*\[\]:;]/g, "-");
      const prevRef = doc(db, COL.monthlyBills, `${session}_${prevMonthStr}_${safePrevId}`);
      const prevSnap = await getDoc(prevRef);
      
      if (prevSnap.exists()) {
        // --- THE FIX: Calculate TRUE balance based on transactions ---
        const prevData = prevSnap.data();
        const totalDue = prevData.totalDue || 0;
        
        // Fetch transactions for previous month to calculate true paid amount
        let totalCash = 0, totalDisc = 0;
        try {
          const txnSnap = await getDocs(query(
            collection(db, COL.transactions),
            where("studentId", "==", student.id),
            where("session", "==", session),
            where("month", "==", prevMonthStr),
            where("voided", "==", false)
          ));
          txnSnap.forEach(t => {
            totalCash += Number(t.data().netAmount || 0);
            totalDisc += Number(t.data().discount || 0);
          });
        } catch(e) {}
        
        previousDue = Math.max(totalDue - totalCash - totalDisc, 0);
      }

      const tuitionBilled = MONTHLY_TUITION[student.className] || 0;
      const transportBilled = student.transportOpted ? (student.transportAmount || 0) : 0;
      
      const safeStudentId = String(student.id).replace(/[\/\\.\*\[\]:;]/g, "-");
      const billId = `${session}_${currentMonthStr}_${safeStudentId}`;
      const billRef = doc(db, COL.monthlyBills, billId);
      const billSnap = await getDoc(billRef);

      if (!billSnap.exists()) {
        const totalDue = previousDue + tuitionBilled + transportBilled + devFee;
        
        await setDoc(billRef, {
          session, 
          month: currentMonthStr, 
          studentId: student.id, 
          studentName: student.name, 
          className: student.className,
          previousDue, 
          tuitionBilled, 
          transportBilled, 
          devFeeBilled: devFee, 
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
    }
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

// ---------------------------------------------------------------------------
// Payment Collection
// ---------------------------------------------------------------------------
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

    const totalCredit = amt + disc;
    const newPaid = (bill.totalPaid || 0) + amt;
    const newCarry = (bill.totalDue || 0) - totalCredit;

    const txnRef = doc(collection(db, COL.transactions));
    const receiptRef = doc(collection(db, COL.receipts));

    tx.set(txnRef, {
      studentId, session, month, componentType: "monthly", amountReceived: amt,
      discount: disc, lateFee: late, netAmount: amt,
      previousDue: bill.previousDue || 0, 
      totalDue: bill.totalDue || 0,       
      remainingDue: Math.max(newCarry, 0),
      paymentDate: Timestamp.fromDate(new Date(paymentDate)),
      paymentMethod, referenceNumber: referenceNumber || null, feeType, remarks,
      collectedBy: user.uid, collectedByEmail: user.email || null, receiptRef: receiptRef.id,
      createdAt: serverTimestamp(), voided: false,
    });

    tx.update(billRef, { totalPaid: newPaid, carriedForward: newCarry, status: newCarry <= 0 ? "PAID" : "PARTIAL", lastPaymentAt: serverTimestamp() });
    tx.set(idemRef, { receiptId: receiptRef.id, createdAt: serverTimestamp() });
    return { alreadyProcessed: false, receiptRef, txnRef, bill, newPaid, totalCredit };
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
    totalDue: result.bill.totalDue || 0, 
    remainingDue: Math.max((result.bill.totalDue || 0) - result.newPaid, 0),
    paymentMethod, referenceNumber: referenceNumber || null, paymentDate, createdAt: serverTimestamp(),
  };
  
  await setDoc(doc(db, COL.receipts, result.receiptRef.id), receiptData);
  await updateDoc(result.txnRef, { receiptNumber }); 

  await writeAuditLog({ action: "PAYMENT_COLLECTED", studentId, newValue: { amountReceived, receiptNumber }, transactionRef: result.txnRef.id });
  return { receiptId: result.receiptRef.id, receipt: receiptData, duplicateBlocked: false };
}

// ---------------------------------------------------------------------------
// Add-on fees & Edit
// ---------------------------------------------------------------------------
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

  await updateDoc(txnRef, {
    amountReceived: Number(newAmount),
    discount: Number(newDiscount),
    netAmount: Number(newAmount),
    paymentDate: Timestamp.fromDate(new Date(newPaymentDate)),
    editedBy: user.email || user.uid,
    editedAt: serverTimestamp()
  });

  await writeAuditLog({ action: "TRANSACTION_EDITED", studentId: txn.studentId, previousValue: txn, newValue: { amount: newAmount, discount: newDiscount, date: newPaymentDate }, transactionRef: transactionId });
  return { success: true };
}

// ... (rest of the file remains the same: getDashboardStats, getDueList, etc.)
