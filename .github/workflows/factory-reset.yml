"""
factory_reset.py
----------------
Full reset of fee-system data + fresh import from CSV.

WIPES:
  students, monthlyBills, feeTransactions, receipts, discounts,
  paymentIdempotency, auditLogs, counters, feeStructures, academicSessions

PRESERVES:
  users collection (roles, permissions)
  Firebase Auth users
  Firebase Storage photos (delete manually if desired)

RECREATES:
  academicSessions/{SESSION} with isActive=true
  counters/receipts_<year> = 0
  counters/admissionNumber = 0
  students from CSV
  monthlyBills (first month) per student, with transport included

Transport column parsing:
  Y / YES / TRUE / 1   -> opted IN, billed at DEFAULT_TRANSPORT_AMOUNT
                          (env var, default 800; can be 800 or 1500)
  N / NO / FALSE / 0   -> opted OUT
  blank / NA / N/A     -> opted OUT
  800..1500 (numeric)  -> opted IN at that exact amount
  anything else        -> opted OUT + warning printed

Safety gates (all required for real run):
  DRY_RUN=false
  CONFIRM_RESET=YES
  CONFIRM_PHRASE="DELETE EVERYTHING"
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
TRANSPORT_MIN, TRANSPORT_MAX = 800, 1500

try:
    DEFAULT_TRANSPORT_AMOUNT = int(os.environ.get("DEFAULT_TRANSPORT_AMOUNT", "800"))
except ValueError:
    DEFAULT_TRANSPORT_AMOUNT = 800
if DEFAULT_TRANSPORT_AMOUNT < TRANSPORT_MIN or DEFAULT_TRANSPORT_AMOUNT > TRANSPORT_MAX:
    DEFAULT_TRANSPORT_AMOUNT = 800

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

def parse_transport(raw):
    """Returns (opted: bool, amount: int)."""
    if raw is None:
        return False, 0
    s = str(raw).strip()
    if s == "":
        return False, 0
    upper = s.upper()

    if upper in ("N", "NO", "FALSE", "0", "NA", "N/A", "NONE"):
        return False, 0
    if upper in ("Y", "YES", "TRUE", "1"):
        return True, DEFAULT_TRANSPORT_AMOUNT

    digits = re.sub(r"[^\d.]", "", s)
    if digits:
        try:
            amount = int(float(digits))
            if amount <= 0:
                return False, 0
            if amount < TRANSPORT_MIN:
                return True, DEFAULT_TRANSPORT_AMOUNT
            if amount > TRANSPORT_MAX:
                return True, TRANSPORT_MAX
            return True, amount
        except ValueError:
            pass

    print(f"⚠️  Unrecognised Transport value '{s}' — treating as opted OUT.")
    return False, 0

def count_all(coll):
    return len(list(db.collection(coll).stream()))

def delete_collection(coll, batch_size=400):
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
# 1. Read CSV
# ---------------------------------------------------------------------------
if not os.path.exists(CSV_PATH):
    print(f"❌ CSV not found: {CSV_PATH}")
    sys.exit(1)

REQUIRED = {"Class", "Name", "Adm No"}
rows = []
transport_summary = {"opted": 0, "not_opted": 0, "amount_800": 0, "amount_1500": 0, "other": 0}
missing_transport_col = False

with open(CSV_PATH, newline="", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    headers = set(reader.fieldnames or [])
    missing = REQUIRED - headers
    if missing:
        print(f"❌ CSV missing columns: {sorted(missing)}")
        print(f"   Found: {sorted(headers)}")
        sys.exit(1)

    transport_key = None
    for candidate in ("Transport", "transport", "Transport Fee", "Transport Amount"):
        if candidate in headers:
            transport_key = candidate
            break
    if transport_key is None:
        missing_transport_col = True

    for r in reader:
        if not clean_value(r.get("Name")):
            continue
        opted, tamount = (False, 0)
        if transport_key is not None:
            opted, tamount = parse_transport(r.get(transport_key))
        if opted:
            transport_summary["opted"] += 1
            if tamount == 800:    transport_summary["amount_800"] += 1
            elif tamount == 1500: transport_summary["amount_1500"] += 1
            else:                 transport_summary["other"] += 1
        else:
            transport_summary["not_opted"] += 1

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
            "transportOpted":  opted,
            "transportAmount": tamount,
            "totalAmountPaid": 0,
            "lastPaymentDate": None,
            "_rawAdm":         clean_value(r.get("Adm No")),
        })

print(f"📄 Read {len(rows)} valid students from {CSV_PATH}.")
if not rows:
    print("❌ No rows to import.")
    sys.exit(1)

if missing_transport_col:
    print("⚠️  No 'Transport' column found — all students will be opted OUT.")
else:
    print(
        f"🚌 Transport parsed: "
        f"{transport_summary['opted']} opted IN "
        f"({transport_summary['amount_800']} @ ₹800, "
        f"{transport_summary['amount_1500']} @ ₹1500, "
        f"{transport_summary['other']} other), "
        f"{transport_summary['not_opted']} opted OUT."
    )
    print(f"   Default for 'Y' = ₹{DEFAULT_TRANSPORT_AMOUNT}")

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
    "students", "monthlyBills", "feeTransactions", "receipts",
    "discounts", "paymentIdempotency", "auditLogs", "counters",
    "feeStructures", "academicSessions",
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
    print(f"     • {transport_summary['opted']} with transport, "
          f"{transport_summary['not_opted']} without.")
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
# 6. Recreate baseline config
# ---------------------------------------------------------------------------
year = SESSION.split("-")[0] if "-" in SESSION else str(datetime.now().year)

print("\n🔧 Recreating baseline config…")

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
# 8. First-month bills — transport included
# ---------------------------------------------------------------------------
if CREATE_FIRST_BILLS and imported > 0:
    print(f"\n🧾 Creating first-month bills for {FIRST_MONTH}…")
    bills = 0
    transport_billed_count = 0
    transport_billed_total = 0

    for snap in db.collection("students").where("session", "==", SESSION).stream():
        s = snap.to_dict()
        tuition = MONTHLY_TUITION.get(str(s.get("className", "")).upper(), 0)

        transport_opted = bool(s.get("transportOpted"))
        transport_amt = int(s.get("transportAmount") or 0)
        if transport_opted and TRANSPORT_MIN <= transport_amt <= TRANSPORT_MAX:
            transport_billed = transport_amt
            transport_billed_count += 1
            transport_billed_total += transport_amt
        else:
            transport_billed = 0

        total_due = tuition + transport_billed + DEVELOPMENT_FEE

        bill_id = f"{SESSION}_{FIRST_MONTH}_{snap.id}"
        db.collection("monthlyBills").document(bill_id).set({
            "session": SESSION,
            "month": FIRST_MONTH,
            "studentId": snap.id,
            "studentName": s.get("name"),
            "className": s.get("className"),
            "previousDue": 0,
            "tuitionBilled": tuition,
            "transportBilled": transport_billed,
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
    if transport_billed_count:
        print(
            f"   Transport billed on {transport_billed_count} students "
            f"(total ₹{transport_billed_total:,}/month)."
        )

# ---------------------------------------------------------------------------
# 9. Summary
# ---------------------------------------------------------------------------
print("\n" + "=" * 60)
print("✅ FACTORY RESET COMPLETE")
print("=" * 60)
print(f"  Session:            {SESSION}")
print(f"  Students imported:  {imported}")
print(f"  Transport (opted):  {transport_summary['opted']}")
if CREATE_FIRST_BILLS:
    print(f"  First-month bills:  {FIRST_MONTH}")
print(f"  Receipt counter:    HFHS-{year}-000001 (next)")
print(f"  Admission counter:  1 (next)")
print(f"  Audit log:          empty (fresh start)")
print(f"  Users:              preserved")
print("=" * 60)
