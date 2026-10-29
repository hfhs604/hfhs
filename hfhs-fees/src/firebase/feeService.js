export async function getPaymentHistory(studentId) {
  try {
    const txnSnap = await getDocs(query(collection(db, COL.transactions), where("studentId", "==", studentId)));
    const transactions = txnSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(t => !t.voided);

    const billSnap = await getDocs(query(collection(db, COL.monthlyBills), where("studentId", "==", studentId)));
    const bills = billSnap.docs.map((d) => d.data());

    const timeline = [];

    // 1. Add all bill charges to the timeline
    bills.forEach(bill => {
      const newCharges = Math.max((bill.totalDue || 0) - (bill.previousDue || 0), 0);
      const [year, monthStr] = bill.month.split("-");
      
      const billDate = new Date(parseInt(year), parseInt(monthStr) - 1, 1, 0, 0, 0); 
      
      timeline.push({
        type: 'CHARGE',
        date: billDate,
        amount: newCharges,
      });
    });

    // 2. Add all transactions to the timeline
    transactions.forEach(txn => {
      let txnDate;
      if (txn.paymentDate?.toDate) txnDate = txn.paymentDate.toDate();
      else if (txn.paymentDate?.seconds) txnDate = new Date(txn.paymentDate.seconds * 1000);
      else txnDate = new Date(txn.paymentDate || txn.createdAt?.toDate?.() || Date.now());
      
      if (txnDate.getHours() === 0 && txnDate.getMinutes() === 0) {
         txnDate.setHours(12); 
      }

      timeline.push({
        type: 'PAYMENT',
        date: txnDate,
        txnData: txn
      });
    });

    // 3. Sort chronologically
    timeline.sort((a, b) => {
      const timeDiff = a.date.getTime() - b.date.getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.type === 'CHARGE' ? -1 : 1;
    });

    let runningBalance = 0;
    const ledger = [];

    // 4. Process timeline to calculate accurate running balances
    timeline.forEach(event => {
      if (event.type === 'CHARGE') {
        runningBalance += event.amount;
      } else if (event.type === 'PAYMENT') {
        const txn = event.txnData;
        const amt = Number(txn.amountReceived || txn.netAmount || 0);
        const disc = Number(txn.discount || 0);
        const addOn = Number(txn.addOnAmount || 0);

        // If it's a charge transaction (Books, Kit, etc.), add it to the running balance
        if (txn.componentType && txn.componentType !== 'monthly' && txn.componentType !== 'refund') {
           runningBalance += addOn;
        }

        const billSnapshot = runningBalance;

        // Apply payment and discount
        if (txn.componentType === 'refund') {
            runningBalance -= amt; 
        } else {
            runningBalance -= (amt + disc);
        }

        // Force minimum balance to 0 for the display table to match reality
        const finalBalance = Math.max(runningBalance, 0);

        ledger.push({
          id: txn.id,
          paymentDate: event.date,
          receiptNumber: txn.receiptNumber || "N/A",
          totalDue: billSnapshot, 
          amountReceived: amt,
          discount: disc,
          remainingDue: finalBalance, 
          paymentMethod: txn.paymentMethod || "Cash",
          componentType: txn.componentType || "monthly",
          editedAt: txn.editedAt || null,
          receiptRef: txn.receiptRef
        });
      }
    });

    return ledger.reverse(); 
  } catch (err) {
    console.error("Error fetching history:", err);
    return [];
  }
}
