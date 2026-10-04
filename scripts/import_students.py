import csv, re, uuid, os, json, sys
from datetime import datetime
import firebase_admin
from firebase_admin import credentials, firestore

# --- Init from GitHub secret ---
sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
if not sa_json:
    print("❌ FIREBASE_SERVICE_ACCOUNT secret is missing.")
    sys.exit(1)
cred = credentials.Certificate(json.loads(sa_json))
firebase_admin.initialize_app(cred)
db = firestore.client()

# --- Config (from workflow inputs / defaults) ---
SESSION = os.environ.get("SESSION", "2026-27")
FIRST_MONTH = os.environ.get("FIRST_MONTH", "2026-04")
DEVELOPMENT_FEE = 3150
CSV_PATH = "students.csv"
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

# --- Monthly tuition schedule ---
MONTHLY_TUITION = {
    "PRE-LKG": 800, "LKG": 800, "NUR": 800,
    "UKG": 900, "I": 900,
    "II": 1000, "III": 1000,
    "IV": 1100, "V": 1100,
    "VI": 1200, "VII": 1200,
    "VIII": 1300, "IX": 1400, "X": 1500,
}

def clean_class(raw):
    """'LKG - A' -> 'LKG', 'UKG - A' -> 'UKG', 'IX' -> 'IX'."""
    if not raw:
        return ""
    return re.sub(r"\s*-\s*A\s*$", "", raw.strip(), flags=re.IGNORECASE)

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

def clean_value(raw):
    return str(raw).strip() if raw is not None else ""

# --- Read CSV ---
rows = []
with open(CSV_PATH, newline="", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        if not clean_value(r.get("Name")):
            continue
        cls = clean_class(r.get("Class", ""))
        rows.append({
            "className":        cls,
            "rollNumber":       int(r["Roll No"]) if clean_value(r.get("Roll No")).isdigit() else None,
            "name":             " ".join(clean_value(r.get("Name")).split()),
            "fatherName":       " ".join(clean_value(r.get("Father's Name")).split()),
            "motherName":       " ".join(clean_value(r.get("Mother's Name")).split()),
            "guardianName":     " ".join(clean_value(r.get("Father's Name")).split()),
            "dateOfBirth":      normalize_date(r.get("Date of Birth")),
            "dateOfAdmission":  normalize_date(r.get("Date of Admission")),
            "admissionNumber":  clean_value(r.get("Adm No")),
            "penNumber":        clean_pen(r.get("Pen No")),
            "session":          SESSION,
            "section":          "",
            "mobileNumber":     "",
            "transportOpted":   False,
            "transportAmount":  0,
            "totalAmountPaid":  0,
            "lastPaymentDate":  None,
        })

print(f"📄 Read {len(rows)} valid rows from CSV.")

# --- Deduplicate document IDs ---
seen = {}
for row in rows:
    base = row["admissionNumber"] or f"NOADM-{uuid.uuid4().hex[:8]}"
    if base in seen:
        seen[base] += 1
        row["_docId"] = f"{base}-{seen[base]}"
    else:
        seen[base] = 1
        row["_docId"] = base

# --- Preview ---
print("\n📋 Preview (first 10):")
for r in rows[:10]:
    print(f"  {r['_docId']:>10s}  {r['className']:8s}  {r['name']}")
dupes = [k for k, v in seen.items() if v > 1]
if dupes:
    print(f"\n⚠️  Duplicate Adm Nos auto-suffixed: {dupes}")

if DRY_RUN:
    print("\n🧪 DRY RUN — nothing written. Re-run with dry_run=false to import.")
    sys.exit(0)

# --- Upload ---
print(f"\n⬆️  Uploading to Firestore ({SESSION}, first month {FIRST_MONTH})...")
count = 0
for row in rows:
    doc_id = row.pop("_docId")
    db.collection("students").document(doc_id).set(row)

    tuition = MONTHLY_TUITION.get(row["className"].upper(), 0)
    total_due = tuition + DEVELOPMENT_FEE
    db.collection("monthlyBills").document(f"{SESSION}_{FIRST_MONTH}_{doc_id}").set({
        "session": SESSION, "month": FIRST_MONTH, "studentId": doc_id,
        "studentName": row["name"], "className": row["className"],
        "previousDue": 0, "tuitionBilled": tuition, "transportBilled": 0,
        "devFeeBilled": DEVELOPMENT_FEE, "booksBilled": 0,
        "previousYearBilled": 0, "kitFeeBilled": 0,
        "totalDue": total_due, "totalPaid": 0, "carriedForward": total_due,
        "status": "DUE",
    })
    count += 1
    if count % 25 == 0:
        print(f"  ...{count}/{len(rows)} uploaded")

print(f"\n✅ Done. Imported {count} students and created {count} first-month bills.")
