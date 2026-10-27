// Inside feeService.js, update the collectPayment function:

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
      discount: disc, lateFee: late, 
      netAmount: amt, // Strictly cash
      previousDue: bill.previousDue || 0, // Save exact state
      totalDue: bill.totalDue || 0,       // Save exact state
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
  
  // Save the EXACT snapshot into the receipt
  const receiptData = {
    receiptNumber, studentId, studentName: student.name, admissionNumber: student.admissionNumber,
    className: student.className, guardianName: student.guardianName || student.fatherName,
    session, month, feeType, amountReceived: amt, discount: disc,
    lateFee: late, 
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
