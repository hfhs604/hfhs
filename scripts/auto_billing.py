import os, json, sys
from datetime import datetime
from firebase_admin import credentials, firestore, initialize_app

# --- Setup Firebase ---
sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
if not sa_json:
    print("❌ FIREBASE_SERVICE_ACCOUNT secret is missing.")
    sys.exit(1)

try:
    cred = credentials.Certificate(json.loads(sa_json))
    initialize_app(cred)
    db = firestore.client()
except Exception as e:
    print(f"❌ Failed to initialize Firebase: {e}")
    sys.exit(1)

# --- Setup Month Logic ---
# When this runs on Oct 31st at 11:55 PM, it generates the November bill.
now = datetime.now()
if now.month == 12:
    next_month = 1
    next_year = now.year + 1
else:
    next_month = now.month + 1
    next_year = now.year

target_month = f"{next_year}-{str(next_month).zfill(2)}"
print(f"🚀 Starting automated billing for: {target_month}")

# --- Get Active Session ---
sessions = db.collection("academicSessions").where("isActive", "==", True).get()
if not sessions:
    print("❌ No active session found. Aborting.")
    sys.exit(1)
active_session = sessions[0].to_dict()["label"]
print(f"📅 Active Session: {active_session}")

# --- Fetch Students ---
students = db.collection("students").where("session", "==", active_session).get()

MONTHLY_TUITION = {
    "PRE-LKG": 800, "LKG": 800, "NUR": 800, "UKG": 900, "I": 900,
    "II": 1000, "III": 1000, "IV": 1100, "V": 1100, "VI": 1200, "VII": 1200,
    "VIII": 1300, "IX": 1400, "X": 1500,
}

count = 0

for student_doc in students:
    s = student_doc.to_dict()
    student_id = student_doc.id
    
    # Calculate previous month
    prev_m = next_month - 1
    prev_y = next_year
    if prev_m == 0:
        prev_m = 12
        prev_y = next_year - 1
    prev_month_str = f"{prev_y}-{str(prev_m).zfill(2)}"
    
    # 1. Get Previous Bill and Calculate TRUE Balance
    prev_bill_ref = db.collection("monthlyBills").document(f"{active_session}_{prev_month_str}_{student_id}")
    prev_bill_snap = prev_bill_ref.get()
    
    previous_due = 0
    if prev_bill_snap.exists:
        prev_data = prev_bill_snap.to_dict()
        total_due = prev_data.get("totalDue", 0)
        
        # Fetch all transactions for this specific student for the previous month
        # to calculate exactly how much was actually paid.
        txns = db.collection("feeTransactions") \
            .where("studentId", "==", student_id) \
            .where("session", "==", active_session) \
            .where("month", "==", prev_month_str) \
            .get()
            
        total_cash_paid = 0
        total_discount = 0
        
        for txn in txns:
            t_data = txn.to_dict()
            # Only count if not voided (just in case)
            if not t_data.get("voided", False):
                total_cash_paid += t_data.get("netAmount", 0)
                total_discount += t_data.get("discount", 0)
                
        # True Balance = Total Bill - Cash - Discount
        true_balance = total_due - total_cash_paid - total_discount
        previous_due = max(true_balance, 0) # Floor at 0

    # 2. Calculate New Fees
    tuition = MONTHLY_TUITION.get(s.get("className", "").upper(), 0)
    transport = s.get("transportAmount", 0) if s.get("transportOpted") else 0
    
    # Development fee is only for April (First month)
    dev_fee = 0 
    
    total_due = previous_due + tuition + transport + dev_fee
    
    # 3. Create the New Bill
    new_bill_ref = db.collection("monthlyBills").document(f"{active_session}_{target_month}_{student_id}")
    
    if not new_bill_ref.get().exists:
        new_bill_ref.set({
            "session": active_session,
            "month": target_month,
            "studentId": student_id,
            "studentName": s.get("name"),
            "className": s.get("className"),
            "previousDue": previous_due,
            "tuitionBilled": tuition,
            "transportBilled": transport,
            "devFeeBilled": dev_fee,
            "booksBilled": 0,
            "previousYearBilled": 0,
            "kitFeeBilled": 0,
            "totalDue": total_due,
            "totalPaid": 0,
            "carriedForward": total_due,
            "status": "DUE" if total_due > 0 else "PAID",
            "createdAt": firestore.SERVER_TIMESTAMP
        })
        count += 1

print(f"✅ Successfully generated {count} bills for {target_month}.")
