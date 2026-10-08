import React, { useEffect, useState } from "react";
import {
  createStudent,
  searchStudents,
  peekNextAdmissionNumber,
  reserveAdmissionNumber,
  updateStudentProfile,
  deleteStudentCompletely,
} from "../firebase/feeService";
import { getAllStudents } from "../firebase/reportsService";
import { uploadStudentImage } from "../firebase/photoService";
import StudentPrintPage from "./StudentPrintPage";
import "../styles/feeManagement.css";

const CLASS_OPTIONS = [
  "Pre-LKG", "NUR", "LKG", "UKG",
  "I", "II", "III", "IV", "V",
  "VI", "VII", "VIII", "IX", "X",
];

const emptyForm = {
  admissionNumber: "", rollNumber: "", name: "", className: "", section: "",
  dateOfAdmission: "", dateOfBirth: "", gender: "", bloodGroup: "", penNumber: "",
  fatherName: "", motherName: "", guardianName: "",
  fatherOccupation: "", motherOccupation: "",
  fatherMobile: "", motherMobile: "", mobileNumber: "",
  addressPresent: "", addressPermanent: "",
  aadhaarStudent: "", aadhaarFather: "", aadhaarMother: "",
  nationality: "Indian", category: "", religion: "", lastInstitution: "",
  docAadhaarStudent: false, docAadhaarFather: false, docAadhaarMother: false,
  docPhoto: false, docTransferCertificate: false, docBirthCertificate: false,
  remarks: "",
};

const IMAGE_SLOTS = [
  { slot: "photo",           field: "photoUrl",                label: "Student Photo" },
  { slot: "aadhaar-student", field: "aadhaarStudentPhotoUrl",  label: "Aadhaar — Student" },
  { slot: "aadhaar-father",  field: "aadhaarFatherPhotoUrl",   label: "Aadhaar — Father" },
  { slot: "aadhaar-mother",  field: "aadhaarMotherPhotoUrl",   label: "Aadhaar — Mother" },
];

export default function StudentDirectory({ session, onSelectStudent }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [sameAsPresent, setSameAsPresent] = useState(false);
  const [printStudent, setPrintStudent] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(null);
  const [deleteMsg, setDeleteMsg] = useState("");

  const [images, setImages] = useState({
    photo: { file: null, preview: null },
    "aadhaar-student": { file: null, preview: null },
    "aadhaar-father": { file: null, preview: null },
    "aadhaar-mother": { file: null, preview: null },
  });

  async function loadStudents() {
    setLoading(true);
    try {
      const list = await getAllStudents({ session });
      setStudents(list);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    if (!showForm) return;
    (async () => {
      try {
        const next = await peekNextAdmissionNumber();
        setForm((f) =>
          f.admissionNumber ? f : { ...f, admissionNumber: String(next) }
        );
      } catch (e) {
        console.warn("Could not peek next admission number:", e.message);
      }
    })();
  }, [showForm]);

  useEffect(() => {
    if (!sameAsPresent) return;
    setForm((f) => ({ ...f, addressPermanent: f.addressPresent }));
  }, [sameAsPresent, form.addressPresent]);

  async function handleSearch(e) {
    e.preventDefault();
    if (!searchTerm.trim()) return loadStudents();
    setLoading(true);
    try {
      setStudents(await searchStudents(searchTerm.trim()));
    } finally {
      setLoading(false);
    }
  }

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleImage(slot, file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) =>
      setImages((prev) => ({
        ...prev,
        [slot]: { file, preview: ev.target.result },
      }));
    reader.readAsDataURL(file);
  }

  function resetForm() {
    setForm(emptyForm);
    setSameAsPresent(false);
    setImages({
      photo: { file: null, preview: null },
      "aadhaar-student": { file: null, preview: null },
      "aadhaar-father": { file: null, preview: null },
      "aadhaar-mother": { file: null, preview: null },
    });
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess("");
    try {
      let admissionNumber = form.admissionNumber.trim();
      const suggested = await peekNextAdmissionNumber();
      if (!admissionNumber || admissionNumber === String(suggested)) {
        admissionNumber = await reserveAdmissionNumber();
      }

      const guardianName =
        form.guardianName.trim() || form.fatherName.trim();

      const documentsSubmitted = [];
      if (form.docAadhaarStudent) documentsSubmitted.push("Aadhaar - Student");
      if (form.docAadhaarFather) documentsSubmitted.push("Aadhaar - Father");
      if (form.docAadhaarMother) documentsSubmitted.push("Aadhaar - Mother");
      if (form.docPhoto) documentsSubmitted.push("Photo");
      if (form.docTransferCertificate) documentsSubmitted.push("Transfer Certificate");
      if (form.docBirthCertificate) documentsSubmitted.push("Birth Certificate");

      const studentId = await createStudent({
        admissionNumber,
        rollNumber: form.rollNumber ? Number(form.rollNumber) : null,
        name: form.name.trim(),
        className: form.className,
        section: form.section.trim(),
        dateOfAdmission: form.dateOfAdmission || null,
        dateOfBirth: form.dateOfBirth || null,
        gender: form.gender || null,
        bloodGroup: form.bloodGroup.trim() || null,
        penNumber: form.penNumber.trim() || null,
        fatherName: form.fatherName.trim(),
        motherName: form.motherName.trim(),
        guardianName,
        fatherOccupation: form.fatherOccupation.trim() || null,
        motherOccupation: form.motherOccupation.trim() || null,
        fatherMobile: form.fatherMobile.trim() || null,
        motherMobile: form.motherMobile.trim() || null,
        mobileNumber: form.mobileNumber.trim() || form.fatherMobile.trim() || "",
        addressPresent: form.addressPresent.trim() || null,
        addressPermanent: form.addressPermanent.trim() || null,
        aadhaarStudent: form.aadhaarStudent.trim() || null,
        aadhaarFather: form.aadhaarFather.trim() || null,
        aadhaarMother: form.aadhaarMother.trim() || null,
        nationality: form.nationality.trim() || "Indian",
        category: form.category || null,
        religion: form.religion.trim() || null,
        lastInstitution: form.lastInstitution.trim() || null,
        docAadhaarStudent: form.docAadhaarStudent,
        docAadhaarFather: form.docAadhaarFather,
        docAadhaarMother: form.docAadhaarMother,
        docPhoto: form.docPhoto,
        docTransferCertificate: form.docTransferCertificate,
        docBirthCertificate: form.docBirthCertificate,
        documentsSubmitted,
        photoUrl: null,
        aadhaarStudentPhotoUrl: null,
        aadhaarFatherPhotoUrl: null,
        aadhaarMotherPhotoUrl: null,
        remarks: form.remarks.trim() || null,
        session,
        transportOpted: false,
        transportAmount: 0,
      });

      const uploadErrors = [];
      for (const { slot, field, label } of IMAGE_SLOTS) {
        const f = images[slot]?.file;
        if (!f) continue;
        try {
          const url = await uploadStudentImage(studentId, slot, f);
          await updateStudentProfile(studentId, { [field]: url });
        } catch (uploadErr) {
          console.warn(`${label} upload failed:`, uploadErr.message);
          uploadErrors.push(`${label}: ${uploadErr.message}`);
        }
      }

      let msg = `Student "${form.name}" added with Admission No. ${admissionNumber}.`;
      if (uploadErrors.length) {
        msg += ` Some images failed: ${uploadErrors.join("; ")}`;
      }
      setSuccess(msg);
      resetForm();
      setShowForm(false);
      await loadStudents();
      setTimeout(() => setSuccess(""), 8000);
    } catch (err) {
      setError(err.message || "Could not create student.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(student) {
    const expected = student.name.trim();
    const typed = window.prompt(
      `Delete "${student.name}" (Adm# ${student.admissionNumber})?\n\n` +
        `This will PERMANENTLY erase:\n` +
        `  • The student document\n` +
        `  • All monthly bills (Apr–Oct)\n` +
        `  • All payment transactions and receipts\n` +
        `  • Any discounts applied\n\n` +
        `An audit entry will be kept.\n\n` +
        `To confirm, type the student's name exactly:\n${expected}`
    );

    if (typed === null) return;
    if (typed.trim() !== expected) {
      setDeleteMsg("Name didn't match. Nothing was deleted.");
      setTimeout(() => setDeleteMsg(""), 4000);
      return;
    }

    setDeleteBusy(student.id);
    setDeleteMsg("");
    try {
      const summary = await deleteStudentCompletely(student.id, student.name);
      setDeleteMsg(
        `Deleted "${student.name}". Bills: ${summary.billsDeleted}, ` +
          `Transactions: ${summary.transactionsDeleted}, ` +
          `Receipts: ${summary.receiptsDeleted}.`
      );
      await loadStudents();
      setTimeout(() => setDeleteMsg(""), 8000);
    } catch (err) {
      setDeleteMsg(`❌ ${err.message}`);
      setTimeout(() => setDeleteMsg(""), 8000);
    } finally {
      setDeleteBusy(null);
    }
  }

  return (
    <div className="fm-card">
      <div className="fm-row-header">
        <h2>Students</h2>
        <button
          className="fm-primary-btn"
          onClick={() => {
            setShowForm((s) => !s);
            setError(null);
            setSuccess("");
          }}
        >
          {showForm ? "Cancel" : "+ Add Student"}
        </button>
      </div>

      {success && <p className="fm-success">{success} ✓</p>}
      {error && <p className="fm-error">{error}</p>}
      {deleteMsg && (
        <p
          style={{
            margin: "8px 0",
            fontWeight: 500,
            color: deleteMsg.startsWith("❌") ? "#c62828" : "#1a3d6d",
          }}
        >
          {deleteMsg}
        </p>
      )}

      {printStudent && (
        <StudentPrintPage
          student={printStudent}
          onClose={() => setPrintStudent(null)}
        />
      )}

      {showForm && (
        <form onSubmit={handleCreate}>
          <div className="fm-form-section" style={{ borderTop: "none", marginTop: 0, paddingTop: 0 }}>
            <h3>Basic Details</h3>
            <p className="fm-form-section-hint">
              Admission number is auto-suggested; you can override it.
            </p>
            <div className="fm-form-grid">
              <label>
                Admission Number *
                <input required value={form.admissionNumber}
                  onChange={(e) => update("admissionNumber", e.target.value)} />
              </label>
              <label>
                Roll No
                <input type="number" min="0" value={form.rollNumber}
                  onChange={(e) => update("rollNumber", e.target.value)} />
              </label>
              <label>
                Student Name *
                <input required value={form.name}
                  onChange={(e) => update("name", e.target.value)} />
              </label>
              <label>
                Class *
                <select required value={form.className}
                  onChange={(e) => update("className", e.target.value)}>
                  <option value="">Select class…</option>
                  {CLASS_OPTIONS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label>
                Section
                <input value={form.section}
                  onChange={(e) => update("section", e.target.value)} />
              </label>
              <label>
                Date of Admission
                <input type="date" value={form.dateOfAdmission}
                  onChange={(e) => update("dateOfAdmission", e.target.value)} />
              </label>
              <label>
                Date of Birth
                <input type="date" value={form.dateOfBirth}
                  onChange={(e) => update("dateOfBirth", e.target.value)} />
              </label>
              <label>
                Gender
                <select value={form.gender}
                  onChange={(e) => update("gender", e.target.value)}>
                  <option value="">—</option>
                  <option>Male</option>
                  <option>Female</option>
                  <option>Other</option>
                </select>
              </label>
              <label>
                Blood Group
                <input value={form.bloodGroup}
                  onChange={(e) => update("bloodGroup", e.target.value)} />
              </label>
              <label>
                PEN No
                <input value={form.penNumber}
                  onChange={(e) => update("penNumber", e.target.value)} />
              </label>
            </div>
          </div>

          <div className="fm-form-section">
            <h3>Family Details</h3>
            <div className="fm-form-grid">
              <label>Father's Name
                <input value={form.fatherName}
                  onChange={(e) => update("fatherName", e.target.value)} /></label>
              <label>Mother's Name
                <input value={form.motherName}
                  onChange={(e) => update("motherName", e.target.value)} /></label>
              <label>Guardian Name
                <input value={form.guardianName}
                  onChange={(e) => update("guardianName", e.target.value)} /></label>
              <label>Father's Occupation
                <input value={form.fatherOccupation}
                  onChange={(e) => update("fatherOccupation", e.target.value)} /></label>
              <label>Mother's Occupation
                <input value={form.motherOccupation}
                  onChange={(e) => update("motherOccupation", e.target.value)} /></label>
              <label>Father's Mobile
                <input value={form.fatherMobile}
                  onChange={(e) => update("fatherMobile", e.target.value)} /></label>
              <label>Mother's Mobile
                <input value={form.motherMobile}
                  onChange={(e) => update("motherMobile", e.target.value)} /></label>
              <label>Primary Mobile
                <input value={form.mobileNumber}
                  onChange={(e) => update("mobileNumber", e.target.value)} /></label>

              <label className="fm-full-width">
                Present Address
                <textarea value={form.addressPresent}
                  onChange={(e) => update("addressPresent", e.target.value)} />
              </label>

              <div className="fm-full-width" style={{ marginTop: -6 }}>
                <label className="fm-checkbox-row" style={{ marginBottom: 6 }}>
                  <input type="checkbox" checked={sameAsPresent}
                    onChange={(e) => {
                      setSameAsPresent(e.target.checked);
                      if (!e.target.checked) update("addressPermanent", "");
                    }} />
                  Permanent address is the same as Present address
                </label>
              </div>

              <label className="fm-full-width">
                Permanent Address
                <textarea value={form.addressPermanent}
                  onChange={(e) => update("addressPermanent", e.target.value)}
                  disabled={sameAsPresent}
                  style={sameAsPresent ? { background: "#f5f7fa", cursor: "not-allowed" } : undefined} />
              </label>
            </div>
          </div>

          <div className="fm-form-section">
            <h3>Aadhaar &amp; Identity</h3>
            <div className="fm-form-grid">
              <label>Student's Aadhaar
                <input value={form.aadhaarStudent} maxLength={12}
                  onChange={(e) => update("aadhaarStudent", e.target.value.replace(/\D/g, ""))} /></label>
              <label>Father's Aadhaar
                <input value={form.aadhaarFather} maxLength={12}
                  onChange={(e) => update("aadhaarFather", e.target.value.replace(/\D/g, ""))} /></label>
              <label>Mother's Aadhaar
                <input value={form.aadhaarMother} maxLength={12}
                  onChange={(e) => update("aadhaarMother", e.target.value.replace(/\D/g, ""))} /></label>
              <label>Nationality
                <input value={form.nationality}
                  onChange={(e) => update("nationality", e.target.value)} /></label>
              <label>Category
                <select value={form.category}
                  onChange={(e) => update("category", e.target.value)}>
                  <option value="">—</option>
                  <option>General</option>
                  <option>OBC</option>
                  <option>SC</option>
                  <option>ST</option>
                  <option>EWS</option>
                  <option>Other</option>
                </select></label>
              <label>Religion
                <input value={form.religion}
                  onChange={(e) => update("religion", e.target.value)} /></label>
              <label className="fm-full-width">Last Institution Attended
                <input value={form.lastInstitution}
                  onChange={(e) => update("lastInstitution", e.target.value)} /></label>
            </div>
          </div>

          <div className="fm-form-section">
            <h3>Photos &amp; Aadhaar Scans</h3>
            <p className="fm-form-section-hint">
              All uploads are optional. Recommended: JPG/PNG under 5 MB.
            </p>
            <div className="fm-upload-grid">
              {IMAGE_SLOTS.map(({ slot, label }) => (
                <div key={slot} className="fm-upload-cell">
                  <label className="fm-file-label">
                    📷 {label}
                    <input type="file" accept="image/*"
                      onChange={(e) => handleImage(slot, e.target.files?.[0])} />
                  </label>
                  {images[slot]?.preview && (
                    <img src={images[slot].preview} alt={label} className="fm-file-preview" />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="fm-form-section">
            <h3>Documents Submitted</h3>
            <div className="fm-doc-checkbox-grid">
              <label className="fm-checkbox-row">
                <input type="checkbox" checked={form.docAadhaarStudent}
                  onChange={(e) => update("docAadhaarStudent", e.target.checked)} />
                Aadhaar — Student
              </label>
              <label className="fm-checkbox-row">
                <input type="checkbox" checked={form.docAadhaarFather}
                  onChange={(e) => update("docAadhaarFather", e.target.checked)} />
                Aadhaar — Father
              </label>
              <label className="fm-checkbox-row">
                <input type="checkbox" checked={form.docAadhaarMother}
                  onChange={(e) => update("docAadhaarMother", e.target.checked)} />
                Aadhaar — Mother
              </label>
              <label className="fm-checkbox-row">
                <input type="checkbox" checked={form.docPhoto}
                  onChange={(e) => update("docPhoto", e.target.checked)} />
                Photo
              </label>
              <label className="fm-checkbox-row">
                <input type="checkbox" checked={form.docTransferCertificate}
                  onChange={(e) => update("docTransferCertificate", e.target.checked)} />
                Transfer Certificate
              </label>
              <label className="fm-checkbox-row">
                <input type="checkbox" checked={form.docBirthCertificate}
                  onChange={(e) => update("docBirthCertificate", e.target.checked)} />
                Birth Certificate
              </label>
            </div>
          </div>

          <div className="fm-form-section">
            <h3>Additional Notes</h3>
            <div className="fm-form-grid">
              <label className="fm-full-width">Remarks
                <textarea value={form.remarks}
                  onChange={(e) => update("remarks", e.target.value)} /></label>
            </div>
          </div>

          <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
            <button type="submit" disabled={saving} className="fm-primary-btn">
              {saving ? "Saving…" : "Create Student"}
            </button>
            <button type="button" className="fm-secondary-btn"
              onClick={() => { resetForm(); setShowForm(false); }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <form onSubmit={handleSearch} className="fm-search-row" style={{ marginTop: 24 }}>
        <input placeholder="Search by name or admission no."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)} />
        <button type="submit">Search</button>
      </form>

      {loading ? (
        <p className="fm-empty-state">Loading…</p>
      ) : students.length === 0 ? (
        <p className="fm-empty-state">No students found.</p>
      ) : (
        <table className="fm-table">
          <thead>
            <tr>
              <th></th>
              <th>Name</th>
              <th>Adm#</th>
              <th>Roll</th>
              <th>Class</th>
              <th>Guardian</th>
              <th>Mobile</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.photoUrl ? (
                    <img src={s.photoUrl} alt="" width="32" height="32"
                      style={{ borderRadius: "50%", objectFit: "cover" }} />
                  ) : (
                    <div style={{
                      width: 32, height: 32, borderRadius: "50%",
                      background: "#e5e7eb", display: "inline-block"
                    }} />
                  )}
                </td>
                <td onClick={() => onSelectStudent?.(s.id)}
                  style={onSelectStudent ? { cursor: "pointer" } : undefined}>
                  {s.name}
                </td>
                <td>{s.admissionNumber}</td>
                <td>{s.rollNumber ?? "—"}</td>
                <td>{s.className}{s.section ? `-${s.section}` : ""}</td>
                <td>{s.guardianName || s.fatherName || "—"}</td>
                <td>{s.mobileNumber || s.fatherMobile || "—"}</td>
                <td>
                  <span className={`fm-badge fm-badge-${(s.accountStatus || "PAID").toLowerCase()}`}>
                    {s.accountStatus || "PAID"}
                  </span>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button type="button" className="fm-link-btn"
                    onClick={() => setPrintStudent(s)}
                    style={{ marginRight: 10 }}>
                    Print
                  </button>
                  <button type="button" className="fm-link-btn fm-danger-link"
                    onClick={() => handleDelete(s)}
                    disabled={deleteBusy === s.id}
                    style={{ color: "#c62828", textDecorationColor: "#c62828" }}>
                    {deleteBusy === s.id ? "Deleting…" : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
