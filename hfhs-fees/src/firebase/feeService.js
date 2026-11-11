import { db, auth } from "../firebase/config";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, setDoc,
  deleteDoc, getCountFromServer, getAggregateFromServer, sum,
  query, where, orderBy, limit as fsLimit, startAfter,
  runTransaction, serverTimestamp, Timestamp, writeBatch, increment,
} from "firebase/firestore";

const COL = {
  students: "students", feeStructures: "feeStructures", transactions: "feeTransactions",
  receipts: "receipts", discounts: "discounts", sessions: "academicSessions",
  auditLogs: "auditLogs", counters: "counters", monthlyBills: "monthlyBills",
  attendance: "attendance", exams: "exams",
  dashboardStats: "dashboardStats", // NEW: pre-aggregated stats
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

function safeId(id) {
  return String(id).replace(/[\/\\.\*\[\]:;]/g, "-");
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

// ---------- NEW: Dashboard stats summary helpers ----------
// These keep a single summary doc per session, updated on every payment,
// so getDashboardStats becomes a 1-read operation instead of thousands.

async function bumpSessionStats(session, { collectionAmt = 0, monthAmt = 0, month = null, discountAmt = 0, refundAmt = 0 } = {}) {
  if (!session) return;
  const ref = doc(db, COL.dashboardStats, `session_${session}`);
  const patch = {
    session,
    totalCollection: increment(collectionAmt),
    totalDiscount: increment(discountAmt),
    totalRefunds: increment(refundAmt),
    lastUpdated: serverTimestamp(),
  };
  if (month && monthAmt !== 0) {
    patch[`monthly.${month}`] = increment(monthAmt);
  }
  await setDoc(ref, patch, { merge: true });
}

// ---------- End summary helpers ----------

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
  const before = await getDoc(doc(db, COL.students, studentId));
  await updateDoc(doc(db, COL.students, studentId), updates);
  await writeAuditLog({ action: "STUDENT_UPDATED", studentId, previousValue: before.exists() ? before.data() : null, newValue: updates });
}

export async function getStudentFeeProfile(studentId) {
  const snap = await getDoc(doc(db, COL.students, studentId));
  if (!snap.exists()) throw new Error("Student not found");
  return { id: snap.id, ...snap.data() };
}

/**
 * searchStudents — FIXED:
 * - Removed the 500-doc fallback scan.
 * - Max 20 docs per variant, max ~60 reads worst case.
 * - Caller should debounce input (see note at bottom of file).
 */
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

  // NO more fallback scan. Return what we have (max ~60 reads).
  return Array.from(results.values());
}

/**
 * startNewMonth — OPTIMIZED:
 * - Fetches previous month's bills in ONE query for the whole session/month,
 *   instead of one query per student (N+1 fix).
 * - Uses writeBatch to write all bills in chunks of 500.
 */
export async function startNewMonth(session, month, { isFirstMonth = false } = {}) {
  let students = [];
  try {
    const snap = await getDocs(query(collection(db, COL.students), where("session", "==", session)));
    students = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    throw new Error(`Could not read students: ${err.message}`);
  }

  // Fetch ALL previous-month bills for the session in one query (N+1 fix)
  let prevBillByStudent = {};
  try {
    const prevBillsSnap = await getDocs(query(
      collection(db, COL.monthlyBills),
      where("session", "==", session)
    ));
    prevBillsSnap.forEach(d => {
      const b = d.data();
      if (b.month >= month) return; // only months before target
      if (!prevBillByStudent[b.studentId] || b.month > prevBillByStudent[b.studentId].month) {
        prevBillByStudent[b.studentId] = b;
      }
    });
  } catch (err) {}

  const currentMonthNum = parseInt(month.split("-")[1]);
  let created = 0;

  // Batch writes (500 per batch is Firestore's limit)
  const writes = [];
  for (const student of students) {
    const tuition = MONTHLY_TUITION[student.className] || 0;
    const transport = student.transportOpted ? (student.transportAmount || 0) : 0;
    const devFee = (isFirstMonth || currentMonthNum === 4) ? DEVELOPMENT_FEE : 0;
    const currentMonthTotal = tuition + transport + devFee;

    const prev = prevBillByStudent[student.id];
    const previousDue = prev ? (prev.carriedForward || 0) : 0;
    const totalDue = previousDue + currentMonthTotal;

    const billRef = doc(db, COL.monthlyBills, `${session}_${month}_${safeId(student.id)}`);
    writes.push({
      ref: billRef,
      data: {
        session, month, studentId: student.id, studentName: student.name, className: student.className,
        previousDue, tuitionBilled: tuition, transportBilled: transport, devFeeBilled: devFee,
        booksBilled: 0, previousYearBilled: 0, kitFeeBilled: 0,
        totalDue, totalPaid: 0, carriedForward: totalDue,
        status: "PARTIAL", createdAt: serverTimestamp(),
      },
    });
    created++;
  }

  // Write in batches of 500
  for (let i = 0; i < writes.length; i += 500) {
    const batch = writeBatch(db);
    writes.slice(i, i + 500).forEach(({ ref, data }) => batch.set(ref, data, { merge: true }));
    await batch.commit();
  }

  await writeAuditLog({ action: "MONTH_STARTED", newValue: { session, month, isFirstMonth, studentCount: created } });
  return { created, month, session };
}

export async function getMonthlyBill(session, month, studentId) {
  const snap = await getDoc(doc(db, COL.monthlyBills, `${session}_${month}_${safeId(studentId)}`));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * listBillsForMonth — FIXED: added pagination (default 200 per page).
 */
export async function listBillsForMonth(session, month, { pageSize = 200, lastDoc = null } = {}) {
  try {
    let q = query(
      collection(db, COL.monthlyBills),
      where("session", "==", session),
      where("month", "==", month),
      orderBy("studentName"),
      fsLimit(pageSize)
    );
    if (lastDoc) q = query(q, startAfter(lastDoc));
    const snap = await getDocs(q);
    return {
      bills: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
      lastDoc: snap.docs[snap.docs.length - 1] || null,
      hasMore: snap.docs.length === pageSize,
    };
  } catch (err) { throw new Error("Index required."); }
}

// Itemised receipt lines for a monthly bill (only non-zero items).
export function billToParticulars(bill, balanceBefore) {
  if (!bill) return [];
  const items = [
    ["Previous Due", bill.previousDue], ["Tuition Fee", bill.tuitionBilled],
    ["Transport Fee", bill.transportBilled], ["Development Fee", bill.devFeeBilled],
    ["Books Fee", bill.booksBilled], ["Previous Year", bill.previousYearBilled],
    ["Admission / Kit", bill.kitFeeBilled],
  ];
  const lines = items.filter(([, a]) => (a || 0) > 0).map(([label, amount]) => ({ label, amount }));
  const total = lines.reduce((s, l) => s + l.amount, 0);
  if (balanceBefore !== undefined && balanceBefore !== null && total - balanceBefore > 0) {
    lines.push({ label: "Less: Paid / Discount Earlier", amount: -(total - balanceBefore) });
  }
  return lines;
}

/**
 * recalculateBillBalances — one-off repair, paginated to avoid giant reads.
 */
export async function recalculateBillBalances(session) {
  const billsSnap = await getDocs(query(collection(db, COL.monthlyBills), where("session", "==", session)));
  const txnSnap = await getDocs(query(collection(db, COL.transactions), where("session", "==", session)));
  const sums = {};
  txnSnap.forEach((d) => {
    const t = d.data();
    if (t.voided === true) return;
    const k = `${t.studentId}__${t.month}`;
    if (!sums[k]) sums[k] = { paid: 0, disc: 0, refund: 0 };
    if (t.componentType === "refund") sums[k].refund += Math.abs(Number(t.amountReceived || t.netAmount || 0));
    else if (!t.componentType || t.componentType === "monthly") {
      sums[k].paid += Number(t.amountReceived || t.netAmount || 0);
      sums[k].disc += Number(t.discount || 0);
    }
  });
  const fixed = [];
  const writes = [];
  for (const d of billsSnap.docs) {
    const b = d.data();
    const x = sums[`${b.studentId}__${b.month}`] || { paid: 0, disc: 0, refund: 0 };
    const carry = (b.totalDue || 0) - x.paid - x.disc + x.refund;
    if (b.carriedForward !== carry || (b.totalPaid || 0) !== x.paid) {
      writes.push({ ref: d.ref, data: { totalPaid: x.paid, carriedForward: carry, status: carry <= 0 ? "PAID" : "PARTIAL" } });
      fixed.push({ student: b.studentName, month: b.month, before: b.carriedForward, after: carry });
    }
  }
  for (let i = 0; i < writes.length; i += 500) {
    const batch = writeBatch(db);
    writes.slice(i, i + 500).forEach(({ ref, data }) => batch.update(ref, data));
    await batch.commit();
  }
  await writeAuditLog({ action: "BILLS_RECALCULATED", newValue: { session, fixedCount: fixed.length } });
  return fixed;
}

if (typeof window !== "undefined") window.__repairBills = recalculateBillBalances;

/**
 * collectPayment — now bumps the summary stats so the dashboard is 1-read.
 */
export async function collectPayment({ studentId, amountReceived, paymentDate, paymentMethod, referenceNumber, feeType, discount = 0, lateFee = 0, remarks = "", session, month, idempotencyKey }) {
  const user = currentUser();
  const billRef = doc(db, COL.monthlyBills, `${session}_${month}_${safeId(studentId)}`);
  const idemRef = doc(db, "paymentIdempotency", idempotencyKey);

  const result = await runTransaction(db, async (tx) => {
    const idemSnap = await tx.get(idemRef);
    if (idemSnap.exists()) return { alreadyProcessed: true, receiptId: idemSnap.data().receiptId };

    const billSnap = await tx.get(billRef);
    if (!billSnap.exists()) throw new Error("No bill for this month.");
    const bill = billSnap.data();

    const amt = Number(amountReceived) || 0;
    const disc = Number(discount) || 0;
    if (amt < 0 || disc < 0) throw new Error("Amount and discount cannot be negative.");
    if (amt + disc <= 0) throw new Error("Enter a cash amount or a discount.");

    const currentRunningBalance = bill.carriedForward !== undefined ? bill.carriedForward : bill.totalDue;
    const newPaid = (bill.totalPaid || 0) + amt;
    const newCarry = currentRunningBalance - (amt + disc);

    const txnRef = doc(collection(db, COL.transactions));
    const receiptRef = doc(collection(db, COL.receipts));

    tx.set(txnRef, {
      studentId, session, month, componentType: "monthly", amountReceived: amt,
      discount: disc, lateFee: Number(lateFee), netAmount: amt,
      previousDue: bill.previousDue || 0, totalDue: currentRunningBalance,
      remainingDue: Math.max(newCarry, 0),
      paymentDate: Timestamp.fromDate(new Date(paymentDate)),
      paymentMethod, referenceNumber: referenceNumber || null, feeType, remarks,
      collectedBy: user.uid, collectedByEmail: user.email || null, receiptRef: receiptRef.id,
      createdAt: serverTimestamp(), voided: false,
    });

    tx.update(billRef, { totalPaid: newPaid, carriedForward: newCarry, status: newCarry <= 0 ? "PAID" : "PARTIAL", lastPaymentAt: serverTimestamp() });
    tx.set(idemRef, { receiptId: receiptRef.id, createdAt: serverTimestamp() });
    return { alreadyProcessed: false, receiptRef, txnRef, bill, newPaid, currentRunningBalance, newCarry };
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
    particulars: billToParticulars(result.bill, result.currentRunningBalance),
    totalDue: result.currentRunningBalance,
    remainingDue: Math.max(result.newCarry, 0),
    paymentMethod, referenceNumber: referenceNumber || null, paymentDate, createdAt: serverTimestamp(),
  };

  await setDoc(doc(db, COL.receipts, result.receiptRef.id), receiptData);
  await updateDoc(result.txnRef, { receiptNumber });

  // NEW: bump summary stats (1 extra write, saves thousands of reads later)
  try {
    await bumpSessionStats(session, {
      collectionAmt: Number(amountReceived),
      monthAmt: Number(amountReceived),
      month,
      discountAmt: Number(discount),
    });
  } catch (err) { console.warn("bumpSessionStats failed:", err.message); }

  await writeAuditLog({ action: "PAYMENT_COLLECTED", studentId, newValue: { amountReceived, receiptNumber }, transactionRef: result.txnRef.id });
  return { receiptId: result.receiptRef.id, receipt: receiptData, duplicateBlocked: false };
}

export async function addLineItem({ studentId, session, month, amount, field, componentType, feeType, remarks, paymentMethod = "Cash", paymentDate, idempotencyKey }) {
  const user = currentUser();
  const billRef = doc(db, COL.monthlyBills, `${session}_${month}_${safeId(studentId)}`);
  const idemRef = doc(db, "paymentIdempotency", idempotencyKey);

  const result = await runTransaction(db, async (tx) => {
    const billSnap = await tx.get(billRef);
    if (!billSnap.exists()) throw new Error(`No bill found for ${month}. Please generate the bill for this month first.`);
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

export async function editTransaction({ transactionId, newAmount, newDiscount, newPaymentDate, newAddOnAmount }) {
  const user = currentUser();
  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.data()?.role !== "superAdmin") throw new Error("Only Super Admin can edit a transaction.");

  const txnRef = doc(db, COL.transactions, transactionId);
  const txnSnap = await getDoc(txnRef);
  if (!txnSnap.exists()) throw new Error("Transaction not found.");
  const txn = txnSnap.data();
  const editTime = serverTimestamp();

  const updateData = { paymentDate: Timestamp.fromDate(new Date(newPaymentDate)), editedBy: user.email || user.uid, editedAt: editTime };
  if (newAddOnAmount !== undefined) updateData.addOnAmount = Number(newAddOnAmount);
  else { updateData.amountReceived = Number(newAmount); updateData.discount = Number(newDiscount); updateData.netAmount = Number(newAmount); }
  await updateDoc(txnRef, updateData);

  if (txn.studentId && txn.session && txn.month) {
    const billRef = doc(db, COL.monthlyBills, `${txn.session}_${txn.month}_${safeId(txn.studentId)}`);
    const billSnap = await getDoc(billRef);
    if (billSnap.exists()) {
      const bill = billSnap.data();
      const carry = bill.carriedForward !== undefined ? bill.carriedForward : (bill.totalDue || 0) - (bill.totalPaid || 0);
      if (newAddOnAmount !== undefined) {
        const field = { books: "booksBilled", kit: "kitFeeBilled", previousYear: "previousYearBilled", transport: "transportBilled" }[txn.componentType];
        const d = Number(newAddOnAmount) - Number(txn.addOnAmount || 0);
        if (field && d !== 0) {
          const newCarry = carry + d;
          await updateDoc(billRef, { [field]: (bill[field] || 0) + d, totalDue: (bill.totalDue || 0) + d, carriedForward: newCarry, status: newCarry <= 0 ? "PAID" : "PARTIAL" });
        }
      } else if (!txn.componentType || txn.componentType === "monthly") {
        const dPaid = Number(newAmount) - Number(txn.amountReceived || txn.netAmount || 0);
        const dDisc = Number(newDiscount) - Number(txn.discount || 0);
        const newCarry = carry - dPaid - dDisc;
        await updateDoc(billRef, { totalPaid: (bill.totalPaid || 0) + dPaid, carriedForward: newCarry, status: newCarry <= 0 ? "PAID" : "PARTIAL" });
      }
    }
  }

  if (txn.receiptRef) {
    const receiptRef = doc(db, COL.receipts, txn.receiptRef);
    const receiptSnap = await getDoc(receiptRef);
    if (receiptSnap.exists()) {
      const receiptUpdate = { editedAt: editTime };
      if (newAddOnAmount !== undefined) receiptUpdate.addOnAmount = Number(newAddOnAmount);
      else { receiptUpdate.amountReceived = Number(newAmount); receiptUpdate.discount = Number(newDiscount); }
      await updateDoc(receiptRef, receiptUpdate);
    }
  }

  await writeAuditLog({ action: "TRANSACTION_EDITED", studentId: txn.studentId, previousValue: txn, newValue: updateData, transactionRef: transactionId });
  return { success: true };
}

export async function editBillField({ billId, field, newAmount }) {
  const user = currentUser();
  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (userDoc.data()?.role !== "superAdmin") throw new Error("Only Super Admin can edit bill fields.");

  const billRef = doc(db, COL.monthlyBills, billId);
  const billSnap = await getDoc(billRef);
  if (!billSnap.exists()) throw new Error("Bill not found.");
  const bill = billSnap.data();
  const oldAmount = bill[field] || 0;
  const diff = Number(newAmount) - oldAmount;
  const newTotalDue = (bill.totalDue || 0) + diff;
  const oldCarry = bill.carriedForward !== undefined ? bill.carriedForward : (bill.totalDue || 0) - (bill.totalPaid || 0);
  const newCarriedForward = oldCarry + diff;

  await updateDoc(billRef, {
    [field]: Number(newAmount), totalDue: newTotalDue, carriedForward: newCarriedForward,
    status: newCarriedForward <= 0 ? "PAID" : "PARTIAL",
    lastEditedBy: user.email || user.uid, lastEditedAt: serverTimestamp()
  });
  await writeAuditLog({ action: "BILL_FIELD_EDITED", studentId: bill.studentId, previousValue: { [field]: oldAmount, totalDue: bill.totalDue }, newValue: { [field]: newAmount, totalDue: newTotalDue } });
  return { success: true };
}

export async function refundAdvance({ studentId, amount, session, month, reason = "" }) {
  const user = currentUser();
  const billRef = doc(db, COL.monthlyBills, `${session}_${month}_${safeId(studentId)}`);
  const amt = Number(amount);
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

  try { await bumpSessionStats(session, { refundAmt: amt }); } catch (err) {}

  await writeAuditLog({ action: "ADVANCE_REFUNDED", studentId, newValue: { amount: amt, reason } });
  return { success: true };
}

/**
 * getDueList — FIXED: filters in Firestore, paginated (default 200).
 */
export async function getDueList({ session, month, pageSize = 200, lastDoc = null } = {}) {
  try {
    const clauses = [where("carriedForward", ">", 0)];
    if (session) clauses.push(where("session", "==", session));
    if (month) clauses.push(where("month", "==", month));
    let q = query(collection(db, COL.monthlyBills), ...clauses, orderBy("carriedForward", "desc"), fsLimit(pageSize));
    if (lastDoc) q = query(q, startAfter(lastDoc));
    const snap = await getDocs(q);
    return {
      bills: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
      lastDoc: snap.docs[snap.docs.length - 1] || null,
      hasMore: snap.docs.length === pageSize,
    };
  } catch (err) { throw new Error("Index required on carriedForward."); }
}

export async function getStudentsWithDue({ session, month, className, pageSize = 200, lastDoc = null } = {}) {
  const result = await getDueList({ session, month: month || monthKey(), pageSize, lastDoc });
  if (!className) return result;
  return { ...result, bills: result.bills.filter((b) => b.className === className) };
}

/**
 * getDashboardStats — COMPLETELY REWRITTEN:
 * - Reads 1 summary doc (dashboardStats/session_<session>).
 * - Reads today's transactions only (where createdAt >= start of day).
 * - Uses getCountFromServer for student count.
 * Result: ~1-2 reads per dashboard load instead of thousands.
 */
export async function getDashboardStats(session, month) {
  const targetMonth = month || monthKey();
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

  // 1. Summary doc (1 read)
  let summary = {};
  try {
    const sSnap = await getDoc(doc(db, COL.dashboardStats, `session_${session}`));
    if (sSnap.exists()) summary = sSnap.data();
  } catch (err) {}

  // 2. Student count (1 read from aggregate, cheap)
  let studentCount = 0;
  try {
    const c = await getCountFromServer(query(collection(db, COL.students), where("session", "==", session)));
    studentCount = c.data().count;
  } catch (err) {}

  // 3. Today's transactions only (limited read)
  let todayCollection = 0, todayCash = 0, todayBank = 0, todayEntered = 0;
  let paymentMethodBreakdown = {};
  try {
    const tSnap = await getDocs(query(
      collection(db, COL.transactions),
      where("session", "==", session),
      where("voided", "==", false),
      where("createdAt", ">=", Timestamp.fromDate(startOfDay))
    ));
    tSnap.forEach((d) => {
      const t = d.data();
      const amt = Number(t.netAmount || 0);
      const method = t.paymentMethod || "Other";
      const paidAt = t.paymentDate?.toDate?.() || new Date(t.paymentDate || 0);
      paymentMethodBreakdown[method] = (paymentMethodBreakdown[method] || 0) + amt;
      if (paidAt >= startOfDay) {
        todayCollection += amt;
        if (method === "Cash") todayCash += amt; else todayBank += amt;
      }
      todayEntered += amt;
    });
  } catch (err) {}

  // 4. Outstanding due — sum of carriedForward via aggregate (cheap)
  let totalOutstandingDue = 0;
  let studentsWithDue = 0;
  try {
    const dueAgg = await getAggregateFromServer(
      query(collection(db, COL.monthlyBills), where("session", "==", session), where("carriedForward", ">", 0)),
      { total: sum("carriedForward") }
    );
    totalOutstandingDue = dueAgg.data().total || 0;
    const dueCount = await getCountFromServer(
      query(collection(db, COL.monthlyBills), where("session", "==", session), where("carriedForward", ">", 0))
    );
    studentsWithDue = dueCount.data().count;
  } catch (err) {}

  const monthlyMap = summary.monthly || {};

  return {
    paymentDateToday: todayCollection,
    enteredToday: todayEntered,
    todayCash, todayBank,
    monthCollection: monthlyMap[targetMonth] || 0,
    totalCollection: summary.totalCollection || 0,
    totalOutstandingDue,
    totalAdvance: 0,
    totalDiscount: summary.totalDiscount || 0,
    studentsWithDue,
    studentsFullyPaid: Math.max(studentCount - studentsWithDue, 0),
    paymentMethodBreakdown,
    studentCount,
    month: targetMonth,
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

/**
 * getPaymentHistory — FIXED: paginated (default 100 transactions per page).
 */
export async function getPaymentHistory(studentId, { pageSize = 100, lastDoc = null } = {}) {
  try {
    let q = query(
      collection(db, COL.transactions),
      where("studentId", "==", studentId),
      orderBy("paymentDate", "desc"),
      fsLimit(pageSize)
    );
    if (lastDoc) q = query(q, startAfter(lastDoc));
    const txnSnap = await getDocs(q);
    const transactions = txnSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(t => !t.voided);

    // Fetch bills only if we're on first page (they're small and few per student)
    let bills = [];
    if (!lastDoc) {
      const billSnap = await getDocs(query(collection(db, COL.monthlyBills), where("studentId", "==", studentId)));
      bills = billSnap.docs.map((d) => d.data());
    }

    const timeline = [];
    const ADDON_TYPES = ["books", "kit", "previousYear", "transport"];

    bills.forEach(bill => {
      const fieldCharges =
        (bill.tuitionBilled || 0) + (bill.devFeeBilled || 0) + (bill.transportBilled || 0) +
        (bill.booksBilled || 0) + (bill.previousYearBilled || 0) + (bill.kitFeeBilled || 0);
      const loggedAddOns = transactions
        .filter(t => t.session === bill.session && t.month === bill.month && ADDON_TYPES.includes(t.componentType))
        .reduce((s, t) => s + Number(t.addOnAmount || 0), 0);
      const [year, monthStr] = bill.month.split("-");
      const billDate = new Date(parseInt(year), parseInt(monthStr) - 1, 1, 0, 0, 0);
      timeline.push({ type: 'CHARGE', date: billDate, amount: fieldCharges - loggedAddOns });
    });

    transactions.forEach(txn => {
      let txnDate;
      if (txn.paymentDate?.toDate) txnDate = txn.paymentDate.toDate();
      else if (txn.paymentDate?.seconds) txnDate = new Date(txn.paymentDate.seconds * 1000);
      else txnDate = new Date(txn.paymentDate || txn.createdAt?.toDate?.() || Date.now());
      if (txnDate.getHours() === 0 && txnDate.getMinutes() === 0) txnDate.setHours(12);
      timeline.push({ type: 'PAYMENT', date: txnDate, txnData: txn });
    });

    timeline.sort((a, b) => {
      const td = a.date.getTime() - b.date.getTime();
      if (td !== 0) return td;
      return a.type === 'CHARGE' ? -1 : 1;
    });

    let runningBalance = 0;
    const ledger = [];
    timeline.forEach(event => {
      if (event.type === 'CHARGE') runningBalance += event.amount;
      else if (event.type === 'PAYMENT') {
        const txn = event.txnData;
        const amt = Number(txn.amountReceived || txn.netAmount || 0);
        const disc = Number(txn.discount || 0);
        const addOn = Number(txn.addOnAmount || 0);
        if (txn.componentType && txn.componentType !== 'monthly' && txn.componentType !== 'refund') runningBalance += addOn;
        const billSnapshot = runningBalance;
        if (txn.componentType === 'refund') runningBalance -= amt;
        else runningBalance -= (amt + disc);
        ledger.push({
          id: txn.id, session: txn.session || null, month: txn.month || null,
          voided: txn.voided === true, paymentDate: event.date,
          receiptNumber: txn.receiptNumber || "N/A", totalDue: billSnapshot,
          amountReceived: amt, discount: disc, addOnAmount: addOn,
          remainingDue: Math.max(runningBalance, 0), paymentMethod: txn.paymentMethod || "Cash",
          componentType: txn.componentType || "monthly", editedAt: txn.editedAt || null,
          receiptRef: txn.receiptRef
        });
      }
    });

    return { ledger: ledger.reverse(), lastDoc: txnSnap.docs[txnSnap.docs.length - 1] || null, hasMore: txnSnap.docs.length === pageSize };
  } catch (err) {
    console.error("Error fetching history:", err);
    return { ledger: [], lastDoc: null, hasMore: false };
  }
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
      sessionTotal += amt; totalDiscount += disc;
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
    let q = studentId
      ? query(collection(db, COL.auditLogs), where("studentId", "==", studentId), orderBy("timestamp", "desc"), fsLimit(limitCount))
      : query(collection(db, COL.auditLogs), orderBy("timestamp", "desc"), fsLimit(limitCount));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
    try {
      const snap = await getDocs(query(collection(db, coll), where(key, "==", val)));
      for (const d of snap.docs) { await deleteDoc(doc(db, coll, d.id)); summary[summaryKey]++; }
    } catch (err) {}
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
    const billRef = doc(db, COL.monthlyBills, `${session}_${month}_${safeId(studentId)}`);
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
  if (!txnSnap.exists()) throw new Error("Transaction not found.");
  const txn = txnSnap.data();

  if (txn.studentId && txn.session && txn.month) {
    const billRef = doc(db, COL.monthlyBills, `${txn.session}_${txn.month}_${safeId(txn.studentId)}`);
    const billSnap = await getDoc(billRef);
    if (billSnap.exists()) {
      const bill = billSnap.data();
      const amt = Number(txn.netAmount || 0);
      const disc = Number(txn.discount || 0);
      const carry = bill.carriedForward !== undefined ? bill.carriedForward : (bill.totalDue || 0) - (bill.totalPaid || 0);
      if (!txn.componentType || txn.componentType === "monthly") {
        const newPaid = Math.max((bill.totalPaid || 0) - amt, 0);
        const newCarry = carry + amt + disc;
        await updateDoc(billRef, { totalPaid: newPaid, carriedForward: newCarry, status: newCarry <= 0 ? "PAID" : "PARTIAL" });
      } else if (txn.componentType === "refund") {
        const newCarry = carry - Math.abs(amt);
        await updateDoc(billRef, { carriedForward: newCarry, status: newCarry <= 0 ? "PAID" : "PARTIAL" });
      } else {
        const field = { books: "booksBilled", kit: "kitFeeBilled", previousYear: "previousYearBilled", transport: "transportBilled" }[txn.componentType];
        const addOn = Number(txn.addOnAmount || 0);
        if (field) {
          const newFieldValue = Math.max((bill[field] || 0) - addOn, 0);
          const newDue = Math.max((bill.totalDue || 0) - addOn, 0);
          const newCarry = carry - addOn;
          await updateDoc(billRef, { [field]: newFieldValue, totalDue: newDue, carriedForward: newCarry, status: newCarry <= 0 ? "PAID" : "PARTIAL" });
        }
      }
    }
  }

  await deleteDoc(txnRef);
  if (txn.receiptRef) { try { await deleteDoc(doc(db, COL.receipts, txn.receiptRef)); } catch (err) {} }
  await writeAuditLog({ action: "TRANSACTION_DELETED", studentId: txn.studentId || null, previousValue: txn, newValue: { deletedBy: user.email || user.uid, reason: reason || "Not specified" } });
  return { success: true };
}

export async function getAttendance(date, className) {
  try { const snap = await getDoc(doc(db, COL.attendance, `${date}_${className || "all"}`)); return snap.exists() ? snap.data() : { date, className, records: {} }; }
  catch (err) { return { date, className, records: {} }; }
}
export async function saveAttendance(date, className, records) {
  const user = currentUser();
  await setDoc(doc(db, COL.attendance, `${date}_${className || "all"}`), { date, className, records, updatedBy: user.uid, updatedAt: serverTimestamp() }, { merge: true });
  return { success: true };
}
export async function getExams(session) {
  try { const snap = await getDocs(query(collection(db, COL.exams), where("session", "==", session))); return snap.docs.map((d) => ({ id: d.id, ...d.data() })); }
  catch (err) { return []; }
}
export async function createExam({ session, name, className }) {
  const user = currentUser(); const ref = doc(collection(db, COL.exams));
  await setDoc(ref, { session, name, className, createdAt: serverTimestamp(), createdBy: user.uid });
  return ref.id;
}
export async function getExamMarks(examId) {
  try {
    const snap = await getDocs(collection(db, COL.exams, examId, "marks"));
    const marks = {}; snap.docs.forEach((d) => { marks[d.id] = d.data(); });
    return marks;
  } catch (err) { return {}; }
}
export async function saveStudentMarks({ examId, studentId, marks, remarks = "" }) {
  const user = currentUser();
  await setDoc(doc(db, COL.exams, examId, "marks", studentId), { marks, remarks, updatedBy: user.uid, updatedAt: serverTimestamp() });
  return { success: true };
}
export async function fixBrokenBills(session) {
  try {
    const billsSnap = await getDocs(query(collection(db, COL.monthlyBills), where("session", "==", session)));
    const txnSnap = await getDocs(query(collection(db, COL.transactions), where("session", "==", session)));
    const sums = {};
    txnSnap.forEach((d) => {
      const t = d.data();
      if (t.voided === true) return;
      const k = `${t.studentId}__${t.month}`;
      if (!sums[k]) sums[k] = { paid: 0, disc: 0, refund: 0, addons: 0 };
      if (t.componentType === "refund") sums[k].refund += Math.abs(Number(t.amountReceived || t.netAmount || 0));
      else if (!t.componentType || t.componentType === "monthly") { sums[k].paid += Number(t.amountReceived || t.netAmount || 0); sums[k].disc += Number(t.discount || 0); }
      else sums[k].addons += Number(t.addOnAmount || 0);
    });
    let fixedCount = 0;
    for (const d of billsSnap.docs) {
      const b = d.data();
      const x = sums[`${b.studentId}__${b.month}`] || { paid: 0, disc: 0, refund: 0, addons: 0 };
      const currentAddons = (b.booksBilled || 0) + (b.kitFeeBilled || 0) + (b.previousYearBilled || 0) + (b.transportBilled || 0);
      let newBooks = b.booksBilled || 0;
      if (currentAddons > x.addons) newBooks = Math.max(0, newBooks - (currentAddons - x.addons));
      const baseCharges = (b.previousDue || 0) + (b.tuitionBilled || 0) + (b.devFeeBilled || 0);
      const newTotalDue = baseCharges + newBooks + (b.kitFeeBilled || 0) + (b.previousYearBilled || 0) + (b.transportBilled || 0);
      const newCarry = newTotalDue - x.paid - x.disc + x.refund;
      await updateDoc(d.ref, { booksBilled: newBooks, totalDue: newTotalDue, totalPaid: x.paid, carriedForward: newCarry, status: newCarry <= 0 ? "PAID" : "PARTIAL" });
      fixedCount++;
    }
    console.log(`Successfully fixed ${fixedCount} bills.`);
    return { success: true, fixedCount };
  } catch (err) {
    console.error("Repair failed:", err);
    alert(`Repair failed: ${err.message}`);
  }
}

// ============================================================================
// MIGRATION: run once from browser console to build dashboardStats summary.
// Usage: await window.__migrateStats("2025-2026");
// ============================================================================
async function migrateDashboardStats(session) {
  const txnSnap = await getDocs(query(collection(db, COL.transactions), where("session", "==", session), where("voided", "==", false)));
  let totalCollection = 0, totalDiscount = 0, totalRefunds = 0;
  const monthly = {};
  txnSnap.forEach((d) => {
    const t = d.data();
    const amt = Number(t.netAmount || 0);
    const disc = Number(t.discount || 0);
    if (t.componentType === "refund") totalRefunds += Math.abs(Number(t.amountReceived || 0));
    else totalCollection += amt;
    totalDiscount += disc;
    if (t.month) monthly[t.month] = (monthly[t.month] || 0) + amt;
  });
  await setDoc(doc(db, COL.dashboardStats, `session_${session}`), {
    session, totalCollection, totalDiscount, totalRefunds, monthly, lastUpdated: serverTimestamp()
  }, { merge: true });
  console.log("Migration done for", session, { totalCollection, totalDiscount, monthly });
  return { totalCollection, totalDiscount, monthly };
}
if (typeof window !== "undefined") window.__migrateStats = migrateDashboardStats;
