"""
factory_reset.py
----------------
Deletes ALL fee-system data and re-imports students from a CSV.
Designed for a "start fresh" reset before going live.

Preserved (never touched):
  - users           (login accounts + roles)
  - Firebase Auth   (auth users)
  - storage/        (uploaded photos — delete manually if desired)

Deleted:
  - students, monthlyBills, feeTransactions, receipts, discounts,
    paymentIdempotency, auditLogs, counters, feeStructures, academicSessions

Recreated:
  - academicSessions: one doc with { label: SESSION, isActive: true }
  - counters: { receipts_<year>: 0, admissionNumber: 0 }
  - students: imported from CSV
  - monthlyBills: one first-month bill per imported student (optional)

Safety gates:
  1. DRY_RUN=true (default)  — preview, no writes.
  2. CONFIRM_RESET=YES       — required to actually delete.
  3. CONFIRM_PHRASE must equal "DELETE EVERYTHING" — second gate.

Environment:
  FIREBASE_SERVICE_ACCOUNT   (required) service account JSON
  CSV_PATH                   (default: students.csv)
  SESSION                    (default: 2026-27)
  FIRST_MONTH                (default: 2026-04)
  CREATE_FIRST_BILLS         (default: true)
  DRY_RUN                    (default: true)
  CONFIRM_RESET              (default: NO)
  CONFIRM_PHRASE             (default: "")
"""

import csv, os, re, sys, json, uuid
from datetime import datetime
import firebase_admin
from firebase_admin import credentials, firestore

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SA_JSON            = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
CSV_PATH           = os.environ.get("CSV_PATH", "students.csv")
SESSION            = os.environ.get("SESSION", "2026-27")
FIRST_MONTH        = os.environ.get("FIRST_MONTH", "2026-04")
CREATE_FIRST_BILLS = os.environ.get("CREATE_FIRST_BILLS", "true").lower() == "true"
DRY_RUN            = os.environ.get("DRY_RUN", "true").lower() == "true"
CONFIRM_RESET      = os.environ.get("CONFIRM_RESET", "NO").upper() == "YES"
CONFIRM_PHRASE     = os.environ.get("CONFIRM_PHRASE", "")

DEVELOPMENT_FEE = 3150
MONTHLY_TUITION = {
    "PRE-LKG": 800, "LKG": 800, "NUR": 800,
    "UKG": 900, "I": 900,
    "II": 1000, "III": 1000,
    "IV": 1100, "V": 1100,
    "VI": 1200, "VII": 1200,
    "VIII": 1300, "IX": 1400, "X": 1500,
}

if not SA_JSON:
    print("❌ FIREBASE_SERVICE_ACCOUNT is required.")
    sys.exit(1)

firebase_admin.initialize_app(credentials.Certificate(json.loads(SA_JSON)))
db = firestore.client()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def clean_value(raw):
    return str(raw).strip() if raw is not None else ""

def clean_class(raw):
    if not raw:
        return ""
    return re.sub(r"\s*-\s*A\s*$", "", str(raw).strip(), flags=re.IGNORECASE)

def normalize_date(raw):
    if not raw or str(raw).strip().upper() in ("NA", "N/A", ""):
        return None
    raw = str(raw).strip()
    for fmt in ("%d.%m.%Y", "%d-%m-%Y", "%d/%m/%Y",
                "%Y/%m/%d", "%Y-%m-%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None

def clean_pen(raw):
    if not raw or str(raw).strip().upper() in ("NA", "N/A", ""):
        return None
    return str(raw).strip()

def sanitize_doc_id(raw):
    if not raw:
        return None
    s = re.sub(r"[\/\\.\*\[\]:;]", "-", str(raw).strip())
    s = re.sub(r"-+", "-", s).strip("-")
    return s[:1500] if s else None

def count_all(coll):
    return len(list(db.collection(coll).stream()))

def delete_collection(coll, batch_size=400):
    """Delete every doc in a collection. Returns number deleted."""
    total = 0
    while True:
        docs = list(db.collection(coll).limit(batch_size).stream())
        if not docs:
            break
        batch = db.batch()
        for d in docs:
            batch.delete(d.reference)
        batch.commit()
        total += len(docs)
        print(f"    ...{total} deleted from {coll}")
    return total

# ---------------------------------------------------------------------------
# 1. Read new CSV
# ---------------------------------------------------------------------------
if not os.path.exists(CSV_PATH):
    print(f"❌ CSV not found: {CSV_PATH}")
    sys.exit(1)

REQUIRED = {"Class", "Name", "Adm No"}
rows = []
with open(CSV_PATH, newline="", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    headers = set(reader.fieldnames or [])
    missing = REQUIRED - headers
    if missing:
        print(f"❌ CSV missing columns: {sorted(missing)}")
        print(f"   Found: {sorted(headers)}")
        sys.exit(1)

    for r in reader:
        if not clean_value(r.get("Name")):
            continue
        rows.append({
            "className":       clean_class(r.get("Class", "")),
            "rollNumber":      int(r["Roll No"]) if clean_value(r.get("Roll No")).isdigit() else None,
            "name":            " ".join(clean_value(r.get("Name")).split()),
            "fatherName":      " ".join(clean_value(r.get("Father's Name")).split()),
            "motherName":      " ".join(clean_value(r.get("Mother's Name")).split()),
            "guardianName":    " ".join(clean_value(r.get("Father's Name")).split()),
            "dateOfBirth":     normalize_date(r.get("Date of Birth")),
            "dateOfAdmission": normalize_date(r.get("Date of Admission")),
            "admissionNumber": clean_value(r.get("Adm No")),
            "penNumber":       clean_pen(r.get("Pen No")),
            "session":         SESSION,
            "section":         "",
            "mobileNumber":    "",
            "transportOpted":  False,
            "transportAmount": 0,
            "totalAmountPaid": 0,
            "lastPaymentDate": None,
            "_rawAdm":         clean_value(r.get("Adm No")),
        })

print(f"📄 Read {len(rows)} valid students from {CSV_PATH}.")
if not rows:
    print("❌ No rows to import.")
    sys.exit(1)

# Deduplicate doc IDs
seen = {}
for row in rows:
    base = sanitize_doc_id(row["_rawAdm"]) or f"NOADM-{uuid.uuid4().hex[:8]}"
    if base in seen:
        seen[base] += 1
        row["_docId"] = f"{base}-{seen[base]}"
    else:
        seen[base] = 1
        row["_docId"] = base

raw_counts = {}
for row in rows:
    raw_counts[row["_rawAdm"]] = raw_counts.get(row["_rawAdm"], 0) + 1
dupes = {k: v for k, v in raw_counts.items() if v > 1}
if dupes:
    print(f"⚠️  Duplicate admission numbers (auto-suffixed): {dupes}")

# ---------------------------------------------------------------------------
# 2. Report current state
# ---------------------------------------------------------------------------
COLLECTIONS_TO_WIPE = [
    "students",
    "monthlyBills",
    "feeTransactions",
    "receipts",
    "discounts",
    "paymentIdempotency",
    "auditLogs",
    "counters",
    "feeStructures",
    "academicSessions",
]

print("\n📊 Current database contents:")
current_counts = {}
for coll in COLLECTIONS_TO_WIPE:
    n = count_all(coll)
    current_counts[coll] = n
    print(f"  {coll:<22} {n}")

print("\n🛡  Preserved: users collection + Firebase Auth accounts.")

# ---------------------------------------------------------------------------
# 3. Dry run
# ---------------------------------------------------------------------------
if DRY_RUN:
    print("\n🧪 DRY RUN — no changes will be made.")
    print(f"   Would wipe {sum(current_counts.values())} docs across "
          f"{len(COLLECTIONS_TO_WIPE)} collections.")
    print(f"   Would import {len(rows)} students into session '{SESSION}'.")
    if CREATE_FIRST_BILLS:
        print(f"   Would create {len(rows)} first-month bills for {FIRST_MONTH}.")
    print("\n   To actually run:")
    print("       DRY_RUN=false")
    print("       CONFIRM_RESET=YES")
    print('       CONFIRM_PHRASE="DELETE EVERYTHING"')
    sys.exit(0)

# ---------------------------------------------------------------------------
# 4. Double confirmation
# ---------------------------------------------------------------------------
if not CONFIRM_RESET:
    print("\n🛑 Refusing to run. Set CONFIRM_RESET=YES.")
    sys.exit(2)

if CONFIRM_PHRASE != "DELETE EVERYTHING":
    print(
        "\n🛑 Refusing to run.\n"
        '   You must set CONFIRM_PHRASE="DELETE EVERYTHING" exactly.'
    )
    sys.exit(2)

# ---------------------------------------------------------------------------
# 5. Wipe
# ---------------------------------------------------------------------------
print("\n🗑  Wiping all fee-system data…")
total_wiped = 0
for coll in COLLECTIONS_TO_WIPE:
    n = delete_collection(coll)
    total_wiped += n
    print(f"  ✅ {coll}: {n} deleted")

print(f"\n✅ Wiped {total_wiped} documents total.")

# ---------------------------------------------------------------------------
# 6. Recreate baseline configuration
# ---------------------------------------------------------------------------
year = SESSION.split("-")[0] if "-" in SESSION else str(datetime.now().year)

print(f"\n🔧 Recreating baseline config…")

db.collection("academicSessions").document(SESSION).set({
    "label": SESSION,
    "isActive": True,
    "createdAt": firestore.SERVER_TIMESTAMP,
})
print(f"  ✅ academicSessions/{SESSION}")

db.collection("counters").document(f"receipts_{year}").set({"value": 0})
print(f"  ✅ counters/receipts_{year} = 0")

db.collection("counters").document("admissionNumber").set({"value": 0})
print(f"  ✅ counters/admissionNumber = 0")

# ---------------------------------------------------------------------------
# 7. Import students
# ---------------------------------------------------------------------------
print(f"\n⬆️  Importing {len(rows)} students…")
imported = 0
errors = 0
for row in rows:
    doc_id = row.pop("_docId")
    row.pop("_rawAdm", None)
    try:
        db.collection("students").document(doc_id).set(row)
        imported += 1
        if imported % 25 == 0:
            print(f"  ...{imported}/{len(rows)} imported")
    except Exception as e:
        errors += 1
        print(f"  ❌ Failed on {doc_id}: {e}")

print(f"✅ Imported {imported} students" + (f" ({errors} errors)." if errors else "."))

# ---------------------------------------------------------------------------
# 8. First-month bills
# ---------------------------------------------------------------------------
if CREATE_FIRST_BILLS and imported > 0:
    print(f"\n🧾 Creating first-month bills for {FIRST_MONTH}…")
    bills = 0
    for row in rows:
        doc_id = sanitize_doc_id(row["admissionNumber"]) or row["name"]
        # Rebuild ID the same way as the import above, in case of dupes.
        # (We popped _docId above, so recompute deterministically.)
        # Simpler: iterate students we just wrote.
        pass

    # Iterate what's actually in the DB for this session to avoid ID guessing.
    for snap in db.collection("students").where("session", "==", SESSION).stream():
        s = snap.to_dict()
        tuition = MONTHLY_TUITION.get(str(s.get("className", "")).upper(), 0)
        total_due = tuition + DEVELOPMENT_FEE
        bill_id = f"{SESSION}_{FIRST_MONTH}_{snap.id}"
        db.collection("monthlyBills").document(bill_id).set({
            "session": SESSION,
            "month": FIRST_MONTH,
            "studentId": snap.id,
            "studentName": s.get("name"),
            "className": s.get("className"),
            "previousDue": 0,
            "tuitionBilled": tuition,
            "transportBilled": 0,
            "devFeeBilled": DEVELOPMENT_FEE,
            "booksBilled": 0,
            "previousYearBilled": 0,
            "kitFeeBilled": 0,
            "totalDue": total_due,
            "totalPaid": 0,
            "carriedForward": total_due,
            "status": "DUE",
        })
        bills += 1
        if bills % 25 == 0:
            print(f"  ...{bills} bills created")

    print(f"✅ Created {bills} bills for {FIRST_MONTH}.")

# ---------------------------------------------------------------------------
# 9. Summary
# ---------------------------------------------------------------------------
print("\n" + "=" * 60)
print("✅ FACTORY RESET COMPLETE")
print("=" * 60)
print(f"  Session:           {SESSION}")
print(f"  Students imported: {imported}")
if CREATE_FIRST_BILLS:
    print(f"  First-month bills: {FIRST_MONTH}")
print(f"  Receipt counter:   HFHS-{year}-000001 (next)")
print(f"  Admission counter: 1 (next)")
print(f"  Audit log:         empty (fresh start)")
print(f"  Users:             preserved")
print("=" * 60)
