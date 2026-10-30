import { db } from "../firebase/config";
import { collection, getDocs, query, where, Timestamp } from "firebase/firestore";

const COL = {
  students: "students",
  transactions: "feeTransactions",
  monthlyBills: "monthlyBills",
};

// 1. Student Lists (For Due Management & Batch Collection)
export async function getAllStudentsWithBills({ session, className, month } = {}) {
  const targetMonth = month || new Date().toISOString().slice(0, 7);
  let students = [], bills = [], txns = [];

  try {
    let sClauses = [];
    if (session) sClauses.push(where("session", "==", session));
    if (className) sClauses.push(where("className", "==", className));
    const sSnap = await getDocs(query(collection(db, COL.students), ...sClauses));
    students = sSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {}

  try {
    let bClauses = [where("month", "==", targetMonth)];
    if (session) bClauses.push(where("session", "==", session));
    const bSnap = await getDocs(query(collection(db, COL.monthlyBills), ...bClauses));
    bills = bSnap.docs.map((d) => d.data());
  } catch (err) {}

  try {
    const tSnap = await getDocs(query(collection(db, COL.transactions), where("session", "==", session), where("voided", "==", false)));
    txns = tSnap.docs.map((d) => d.data());
  } catch (err) {}

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
    
    // Using the bill's total due and subtracting the true historical payments
    const totalFee = bill?.totalDue || 0;
    const totalPaid = txn.paid;
    const totalDiscount = txn.discount;
    
    const actualDue = Math.max(totalFee - totalPaid - totalDiscount, 0);

    let accountStatus = "PAID";
    if (actualDue > 0) accountStatus = "DUE";
    else if (totalPaid > 0 && actualDue === 0) accountStatus = "PAID";
    else accountStatus = "DUE"; // If no bill/payment, they are due.

    return { ...s, month: targetMonth, totalDue: actualDue, totalPaid, totalFee, accountStatus };
  });
}

export async function getAllStudents(opts = {}) {
  return getAllStudentsWithBills(opts);
}

// ... keep the rest of your reportsService.js exactly the same (Transaction History, Dashboard Charts, CSV, etc.) ...
