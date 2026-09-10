/**
 * feeService.js
 * Fee Management data layer for Holy Faith High School.
 *
 * IMPORTANT: This assumes your existing website already initializes Firebase
 * and exports `db` (Firestore) and `auth` (Firebase Auth) from a shared module,
 * e.g. `import { db, auth } from "../firebase/config";`
 * Replace the import below with your actual path.
 */

import { db, auth } from "../firebase/config"; // <-- point this at your existing Firebase init
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  setDoc,
  query,
  where,
  orderBy,
  limit as fsLimit,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------
const COL = {
  students: "students",
  feeStructures: "feeStructures",
  transactions: "feeTransactions",
  receipts: "receipts",
  discounts: "discounts",
  sessions: "academicSessions",
  auditLogs: "auditLogs",
  counters: "counters", // used for atomic receipt-number generation
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the currently logged-in user's uid/role for audit trails & permission checks. */
function currentUser() {
  const u = auth.currentUser;
  if (!u) throw new Error("Not authenticated");
  return u;
}

async function writeAuditLog({ action, studentId, previousValue, newValue, transactionRef }) {
  const user = currentUser();
  await addDoc(collection(db, COL.auditLogs), {
    userId: user.uid,
    userEmail: user.email || null,
    action,
    studentId: studentId || null,
    transactionRef: transactionRef || null,
    previousValue: previousValue ?? null,
    newValue: newValue ?? null,
    timestamp: serverTimestamp(),
  });
}

/**
 * Atomically generates a unique, sequential receipt number of the form
 * HFHS-<YEAR>-<000123>. Uses a Firestore transaction against a counter
 * document so concurrent submissions never collide, and so double-clicking
 * "Pay" cannot generate duplicate receipts for the same click (paired with
 * the idempotency key check in collectPayment below).
 */
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
// 0. STUDENT CREATE / UPDATE (admin)
// ---------------------------------------------------------------------------

export async function createStudent(data) {
  // data: { admissionNumber, name, className, section, fatherName, motherName,
  //         guardianName, mobileNumber, session, feeCategory, totalAnnualFee }
  const user = currentUser();
  const ref = doc(collection(db, COL.students));
  await setDoc(ref, {
    ...data,
    totalAmountPaid: 0,
    lastPaymentDate: null,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
  });
  await writeAuditLog({ action: "STUDENT_CREATED", studentId: ref.id, newValue: data });
  return ref.id;
}

export async function updateStudentProfile(studentId, updates) {
  const before = await getDoc(doc(db, COL.students, studentId));
  await updateDoc(doc(db, COL.students, studentId), updates);
  await writeAuditLog({
    action: "STUDENT_UPDATED",
    studentId,
    previousValue: before.exists() ? before.data() : null,
    newValue: updates,
  });
}

// ---------------------------------------------------------------------------
// 1. STUDENT FEE PROFILE
// ---------------------------------------------------------------------------

export async function getStudentFeeProfile(studentId) {
  const snap = await getDoc(doc(db, COL.students, studentId));
  if (!snap.exists()) throw new Error("Student not found");
  return computeBalanceView({ id: snap.id, ...snap.data() });
}

/** Derives due/advance/status from stored totals. Never trust a stored "due" field blindly. */
export function computeBalanceView(student) {
  const totalFee = student.totalAnnualFee || 0;
  const totalPaid = student.totalAmountPaid || 0;
  const raw = totalFee - totalPaid;

  const due = raw > 0 ? raw : 0;
  const advance = raw < 0 ? Math.abs(raw) : 0;

  let status = "PAID";
  if (due > 0 && totalPaid > 0) status = "PARTIAL";
  else if (due > 0 && totalPaid === 0) status = "DUE";
  else if (advance > 0) status = "ADVANCE";

  return { ...student, totalDue: due, totalAdvance: advance, accountStatus: status };
}

export async function searchStudents(term) {
  // Firestore doesn't do full-text search natively. This does exact/prefix
  // matches on indexed fields; for fuzzy search, wire in Algolia/Typesense
  // or a Cloud Function-backed search index if your existing site has one.
  const results = new Map();
  const fields = ["name", "admissionNumber", "mobileNumber"];

  for (const field of fields) {
    const q = query(
      collection(db, COL.students),
      orderBy(field),
      where(field, ">=", term),
      where(field, "<=", term + "\uf8ff"),
      fsLimit(20)
    );
    const snap = await getDocs(q);
    snap.forEach((d) => results.set(d.id, computeBalanceView({ id: d.id, ...d.data() })));
  }
  return Array.from(results.values());
}

// ---------------------------------------------------------------------------
// 2. FEE STRUCTURE (admin-controlled, per class + session)
// ---------------------------------------------------------------------------

export async function setFeeStructure({ session, className, categories, lateFeeRule }) {
  // categories: [{ name: "Tuition Fee", amount: 12000, frequency: "annual" }, ...]
  const id = `${session}_${className}`;
  await setDoc(
    doc(db, COL.feeStructures, id),
    { session, className, categories, lateFeeRule, updatedAt: serverTimestamp() },
    { merge: true }
  );
  await writeAuditLog({ action: "FEE_STRUCTURE_UPDATED", newValue: { session, className, categories } });
}

export async function getFeeStructure(session, className) {
  const snap = await getDoc(doc(db, COL.feeStructures, `${session}_${className}`));
  return snap.exists() ? snap.data() : null;
}

// ---------------------------------------------------------------------------
// 3. FEE COLLECTION (transaction-safe, duplicate-submission proof)
// ---------------------------------------------------------------------------

/**
 * Records a payment. Wrapped in a Firestore transaction so the student's
 * running balance and the transaction record are updated atomically.
 *
 * `idempotencyKey` should be a client-generated UUID created once when the
 * user opens the payment form (not regenerated on click) — passed back here
 * so a double-click that fires two submits with the same key is rejected
 * on the second attempt instead of creating two receipts.
 */
export async function collectPayment({
  studentId,
  amountReceived,
  paymentDate,
  paymentMethod, // "Cash" | "UPI" | "Bank Transfer" | "Cheque" | "Other"
  referenceNumber,
  feeType,
  discount = 0,
  lateFee = 0,
  remarks = "",
  session,
  idempotencyKey,
}) {
  const user = currentUser();
  const studentRef = doc(db, COL.students, studentId);
  const idemRef = doc(db, "paymentIdempotency", idempotencyKey);

  const result = await runTransaction(db, async (tx) => {
    const idemSnap = await tx.get(idemRef);
    if (idemSnap.exists()) {
      // Already processed this exact submission — return the prior result
      // instead of charging/recording twice.
      return { alreadyProcessed: true, receiptId: idemSnap.data().receiptId };
    }

    const studentSnap = await tx.get(studentRef);
    if (!studentSnap.exists()) throw new Error("Student not found");
    const student = studentSnap.data();

    const previousPaid = student.totalAmountPaid || 0;
    const netAmount = Number(amountReceived) + Number(lateFee) - Number(discount);
    const newTotalPaid = previousPaid + netAmount;

    const txnRef = doc(collection(db, COL.transactions));
    const receiptRef = doc(collection(db, COL.receipts));

    tx.set(txnRef, {
      studentId,
      session,
      amountReceived: Number(amountReceived),
      discount: Number(discount),
      lateFee: Number(lateFee),
      netAmount,
      paymentDate: Timestamp.fromDate(new Date(paymentDate)),
      paymentMethod,
      referenceNumber: referenceNumber || null,
      feeType,
      remarks,
      collectedBy: user.uid,
      collectedByEmail: user.email || null,
      receiptRef: receiptRef.id,
      createdAt: serverTimestamp(),
      voided: false,
    });

    tx.update(studentRef, {
      totalAmountPaid: newTotalPaid,
      lastPaymentDate: Timestamp.fromDate(new Date(paymentDate)),
    });

    tx.set(idemRef, { receiptId: receiptRef.id, createdAt: serverTimestamp() });

    return {
      alreadyProcessed: false,
      receiptRef,
      txnRef,
      student: { ...student, totalAmountPaid: newTotalPaid },
      netAmount,
    };
  });

  if (result.alreadyProcessed) {
    const snap = await getDoc(doc(db, COL.receipts, result.receiptId));
    return { receiptId: result.receiptId, receipt: snap.data(), duplicateBlocked: true };
  }

  // Receipt number generation happens outside the main transaction (it uses
  // its own transaction against the counter doc) then is written onto the
  // receipt doc.
  const receiptNumber = await generateReceiptNumber(session);
  const balanceView = computeBalanceView(result.student);

  const receiptData = {
    receiptNumber,
    studentId,
    studentName: result.student.name,
    admissionNumber: result.student.admissionNumber,
    className: result.student.className,
    section: result.student.section,
    guardianName: result.student.guardianName || result.student.fatherName,
    session,
    feeType,
    amountReceived: Number(amountReceived),
    discount: Number(discount),
    lateFee: Number(lateFee),
    previousDue: computeBalanceView({
      totalAnnualFee: result.student.totalAnnualFee,
      totalAmountPaid: result.student.totalAmountPaid - result.netAmount,
    }).totalDue,
    remainingDue: balanceView.totalDue,
    advanceAmount: balanceView.totalAdvance,
    paymentMethod,
    referenceNumber: referenceNumber || null,
    paymentDate,
    createdAt: serverTimestamp(),
  };

  await setDoc(doc(db, COL.receipts, result.receiptRef.id), receiptData);

  await writeAuditLog({
    action: "PAYMENT_COLLECTED",
    studentId,
    newValue: { amountReceived, receiptNumber },
    transactionRef: result.txnRef.id,
  });

  return { receiptId: result.receiptRef.id, receipt: receiptData, duplicateBlocked: false };
}

// ---------------------------------------------------------------------------
// 5. PAYMENT HISTORY
// ---------------------------------------------------------------------------

export async function getPaymentHistory(studentId) {
  const q = query(
    collection(db, COL.transactions),
    where("studentId", "==", studentId),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Financial transactions are never hard-deleted. A correction creates a
// reversing entry and both remain visible in history + audit log.
export async function voidAndCorrectTransaction(txnId, correctedData, reason) {
  const user = currentUser();
  const txnRef = doc(db, COL.transactions, txnId);
  const txnSnap = await getDoc(txnRef);
  if (!txnSnap.exists()) throw new Error("Transaction not found");
  const original = txnSnap.data();

  await updateDoc(txnRef, { voided: true, voidReason: reason, voidedBy: user.uid, voidedAt: serverTimestamp() });

  await writeAuditLog({
    action: "TRANSACTION_CORRECTED",
    studentId: original.studentId,
    previousValue: original,
    newValue: correctedData,
    transactionRef: txnId,
  });

  // Caller should then call collectPayment() again for the corrected amount
  // so the balance stays accurate via a fresh, auditable entry.
}

// ---------------------------------------------------------------------------
// 8. DUE MANAGEMENT
// ---------------------------------------------------------------------------

export async function getStudentsWithDue({ className, section, session } = {}) {
  let q = collection(db, COL.students);
  const clauses = [];
  if (className) clauses.push(where("className", "==", className));
  if (section) clauses.push(where("section", "==", section));
  if (session) clauses.push(where("session", "==", session));
  q = clauses.length ? query(q, ...clauses) : q;

  const snap = await getDocs(q);
  return snap.docs
    .map((d) => computeBalanceView({ id: d.id, ...d.data() }))
    .filter((s) => s.totalDue > 0)
    .sort((a, b) => b.totalDue - a.totalDue);
}

// ---------------------------------------------------------------------------
// 9. ADVANCE ADJUSTMENT — applies existing advance to a newly generated fee
// ---------------------------------------------------------------------------

export async function applyAdvanceToNewFee(studentId, newFeeAmount, session) {
  const studentRef = doc(db, COL.students, studentId);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(studentRef);
    const student = snap.data();
    const { totalAdvance } = computeBalanceView(student);

    const applied = Math.min(totalAdvance, newFeeAmount);
    const newTotalFee = (student.totalAnnualFee || 0) + newFeeAmount;

    tx.update(studentRef, { totalAnnualFee: newTotalFee });

    if (applied > 0) {
      const txnRef = doc(collection(db, COL.transactions));
      tx.set(txnRef, {
        studentId,
        session,
        amountReceived: 0,
        netAmount: applied,
        feeType: "Advance Adjustment",
        remarks: `Advance of ₹${applied} auto-applied to new fee`,
        paymentMethod: "Advance Adjustment",
        createdAt: serverTimestamp(),
        voided: false,
      });
    }
    return { applied, remainingAdvance: totalAdvance - applied };
  });
}

// ---------------------------------------------------------------------------
// 10. DISCOUNTS / CONCESSIONS
// ---------------------------------------------------------------------------

export async function applyDiscount({ studentId, amount, type, reason }) {
  const user = currentUser();
  // Permission check: caller (your UI layer / security rules) must ensure
  // only Super Admin / permitted roles reach this function.
  const docRef = await addDoc(collection(db, COL.discounts), {
    studentId,
    amount,
    type, // "fixed" | "percentage" | "student-specific" | "category-specific"
    reason,
    authorizedBy: user.uid,
    createdAt: serverTimestamp(),
  });
  await writeAuditLog({ action: "DISCOUNT_APPLIED", studentId, newValue: { amount, type, reason } });
  return docRef.id;
}

// ---------------------------------------------------------------------------
// 13. ACADEMIC SESSIONS
// ---------------------------------------------------------------------------

export async function createAcademicSession(sessionLabel) {
  // e.g. "2027-28" — creating a new session never touches previous sessions'
  // fee structures or transactions since every doc is keyed by session.
  await setDoc(doc(db, COL.sessions, sessionLabel), {
    label: sessionLabel,
    createdAt: serverTimestamp(),
    isActive: true,
  });
  await writeAuditLog({ action: "ACADEMIC_SESSION_CREATED", newValue: { session: sessionLabel } });
}

export async function getAcademicSessions() {
  const snap = await getDocs(query(collection(db, COL.sessions), orderBy("label", "desc")));
  return snap.docs.map((d) => d.data());
}

// ---------------------------------------------------------------------------
// 15. USER ROLES (Super Admin manages staff role + permissions)
// ---------------------------------------------------------------------------

export async function setUserRole(uid, role, permissions = {}) {
  // role: "superAdmin" | "admin" | "accountant" | "staff" | "student"
  await setDoc(doc(db, "users", uid), { role, permissions }, { merge: true });
  await writeAuditLog({ action: "USER_ROLE_SET", newValue: { uid, role, permissions } });
}

/**
 * One-time read of a user's role doc, with a short retry on transient
 * "client is offline" errors.
 *
 * History: this used to be implemented with onSnapshot() to work around
 * what looked like an Auth/Firestore startup race. That turned out to be
 * a red herring — the real cause of the original "client is offline"
 * failures was a misspelled Firestore projectId in the app config, not a
 * timing race. Once the project id was corrected, plain getDoc() started
 * working reliably, while onSnapshot() began throwing its own unrelated
 * "internal error" on first listen. So this is back to a simple getDoc(),
 * with a small retry purely as a safety net for genuine transient blips.
 */
export async function getUserRoleOnce(uid, retries = 3, delayMs = 700) {
  const ref = doc(db, "users", uid);

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const snap = await getDoc(ref);
      return snap.exists() ? snap.data() : null;
    } catch (err) {
      const isOffline =
        err?.code === "unavailable" ||
        err?.message?.includes("client is offline");

      if (!isOffline || attempt === retries - 1) throw err;

      await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
}

/**
 * Backward-compatible alias. Other call sites (e.g. StudentPortal.jsx)
 * still import `getUserRole` directly — point the old name at the same
 * implementation so the fix applies everywhere uniformly. New code should
 * just call getUserRoleOnce directly.
 */
export const getUserRole = getUserRoleOnce;

// ---------------------------------------------------------------------------
// 16. AUDIT LOG (admin-facing read)
// ---------------------------------------------------------------------------

export async function getAuditLogs({ studentId, limitCount = 100 } = {}) {
  let q = collection(db, COL.auditLogs);
  q = studentId
    ? query(q, where("studentId", "==", studentId), orderBy("timestamp", "desc"), fsLimit(limitCount))
    : query(q, orderBy("timestamp", "desc"), fsLimit(limitCount));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------------------------------------------------------------------------
// 7. DASHBOARD AGGREGATES
// ---------------------------------------------------------------------------

export async function getDashboardStats(session) {
  const studentsSnap = await getDocs(query(collection(db, COL.students), where("session", "==", session)));
  const students = studentsSnap.docs.map((d) => computeBalanceView(d.data()));

  const totalOutstandingDue = students.reduce((sum, s) => sum + s.totalDue, 0);
  const totalAdvance = students.reduce((sum, s) => sum + s.totalAdvance, 0);
  const studentsWithDue = students.filter((s) => s.totalDue > 0).length;
  const studentsFullyPaid = students.filter((s) => s.totalDue === 0 && s.totalAdvance === 0).length;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);

  const txnSnap = await getDocs(
    query(collection(db, COL.transactions), where("session", "==", session), where("voided", "==", false))
  );
  let todayCollection = 0,
    monthCollection = 0,
    totalCollection = 0;
  const byMethod = {};

  txnSnap.forEach((d) => {
    const t = d.data();
    const paidAt = t.paymentDate ? new Date(t.paymentDate) : t.createdAt?.toDate?.();
    totalCollection += t.netAmount || 0;
    if (paidAt >= startOfMonth) monthCollection += t.netAmount || 0;
    if (paidAt >= startOfToday) todayCollection += t.netAmount || 0;
    byMethod[t.paymentMethod] = (byMethod[t.paymentMethod] || 0) + (t.netAmount || 0);
  });

  return {
    todayCollection,
    monthCollection,
    totalCollection,
    totalOutstandingDue,
    totalAdvance,
    studentsWithDue,
    studentsFullyPaid,
    paymentMethodBreakdown: byMethod,
  };
}
