import React, { useState } from "react";
import { searchStudents, updateStudentProfile, deleteStudentCompletely, updateStudentFull } from "../firebase/feeService";
import { uploadStudentImage } from "../firebase/photoService";
import StudentPrintPage from "./StudentPrintPage";
import CameraCapture from "./CameraCapture";
import PrintManager from "./PrintManager";
import "../styles/feeManagement.css";

const CLASS_OPTIONS = ["Pre-LKG", "NUR", "LKG", "UKG", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

const emptyForm = {
  admissionNumber: "", rollNumber: "", name: "", className: "", section: "",
  dateOfAdmission: "", dateOfBirth: "", gender: "", bloodGroup: "", penNumber: "",
  fatherName: "", motherName: "", guardianName: "", fatherOccupation: "", motherOccupation: "",
  fatherMobile: "", motherMobile: "", mobileNumber: "", addressPresent: "", addressPermanent: "",
  aadhaarStudent: "", aadhaarFather: "", aadhaarMother: "", nationality: "Indian", category: "", religion: "", lastInstitution: "",
  docAadhaarStudent: false, docAadhaarFather: false, docAadhaarMother: false, docPhoto: false, docTransferCertificate: false, docBirthCertificate: false,
  remarks: "", transportOpted: false, transportAmount: 0,
};

const IMAGE_SLOTS = [
  { slot: "photo", field: "photoUrl", label: "Student Photo", camera: true },
  { slot: "aadhaar-student", field: "aadhaarStudentPhotoUrl", label: "Aadhaar — Student", camera: true },
  { slot: "aadhaar-father", field: "aadhaarFatherPhotoUrl", label: "Aadhaar — Father", camera: true },
  { slot: "aadhaar-mother", field: "aadhaarMotherPhotoUrl", label: "Aadhaar — Mother", camera: true },
];

const EDIT_ROLES = ["superAdmin", "admin", "accountant"];
const DELETE_ROLES = ["superAdmin"];

export default function StudentDirectory({ session, onSelectStudent, role }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  
  const [printStudent, setPrintStudent] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(null);
  const [deleteMsg, setDeleteMsg] = useState("");

  const [editStudent, setEditStudent] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editSameAsPresent, setEditSameAsPresent] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);
  const [editCameraSlot, setEditCameraSlot] = useState(null);
  const [editImages, setEditImages] = useState({ photo: { file: null, preview: null }, "aadhaar-student": { file: null, preview: null }, "aadhaar-father": { file: null, preview: null }, "aadhaar-mother": { file: null, preview: null } });

  const canEdit = EDIT_ROLES.includes(role);
  const canDelete = DELETE_ROLES.includes(role);

  async function handleSearch(e) {
    e.preventDefault();
    const term = searchTerm.trim();
    if (!term) {
      setStudents([]);
      return;
    }
    
    if (!/^\d+$/.test(term) && term.length < 3) {
      setError("Please enter at least 3 characters for a name, or a valid Admission No.");
      return;
    }

    setLoading(true);
    setError(null);
    try { 
      const found = await searchStudents(term); 
      setStudents(found);
    } catch (err) {
      setError(err.message || "Search failed.");
    } finally { 
      setLoading(false); 
    }
  }

  function updateEdit(field, value) { setEditForm((f) => ({ ...f, [field]: value })); }

  function setImageForSlot(slot, file, mode = "edit") {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setEditImages((prev) => ({ ...prev, [slot]: { file, preview: ev.target.result } }));
    };
    reader.readAsDataURL(file);
  }

  function openEdit(student) {
    if (!canEdit) return;
    setEditStudent(student); setEditError(null);
    const populated = {};
    Object.keys(emptyForm).forEach((k) => {
      const v = student[k];
      if (k.startsWith("doc") && typeof v === "boolean") populated[k] = v;
      else if (Array.isArray(v)) populated[k] = v;
      else populated[k] = v ?? "";
    });
    populated.transportOpted = student.transportOpted || false;
    populated.transportAmount = student.transportAmount || 0;

    if (Array.isArray(student.documentsSubmitted)) {
      populated.docAadhaarStudent = student.documentsSubmitted.includes("Aadhaar - Student");
      populated.docAadhaarFather = student.documentsSubmitted.includes("Aadhaar - Father");
      populated.docAadhaarMother = student.documentsSubmitted.includes("Aadhaar - Mother");
      populated.docPhoto = student.documentsSubmitted.includes("Photo");
      populated.docTransferCertificate = student.documentsSubmitted.includes("Transfer Certificate");
      populated.docBirthCertificate = student.documentsSubmitted.includes("Birth Certificate");
    }
    setEditForm(populated);
    setEditSameAsPresent(!!student.addressPresent && student.addressPresent === student.addressPermanent);
    setEditImages({ photo: { file: null, preview: student.photoUrl || null }, "aadhaar-student": { file: null, preview: student.aadhaarStudentPhotoUrl || null }, "aadhaar-father": { file: null, preview: student.aadhaarFatherPhotoUrl || null }, "aadhaar-mother": { file: null, preview: student.aadhaarMotherPhotoUrl || null } });
  }

  function closeEdit() {
    setEditStudent(null); setEditForm(emptyForm); setEditSameAsPresent(false);
    setEditImages({ photo: { file: null, preview: null }, "aadhaar-student": { file: null, preview: null }, "aadhaar-father": { file: null, preview: null }, "aadhaar-mother": { file: null, preview: null } });
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (editForm.transportOpted) {
      const amt = Number(editForm.transportAmount);
      if (amt < 800 || amt > 1500) { setEditError("Transport fee must be between ₹800 and ₹1500."); return; }
    }
    setEditSaving(true); setEditError(null);
    try {
      const documentsSubmitted = [];
      if (editForm.docAadhaarStudent) documentsSubmitted.push("Aadhaar - Student");
      if (editForm.docAadhaarFather) documentsSubmitted.push("Aadhaar - Father");
      if (editForm.docAadhaarMother) documentsSubmitted.push("Aadhaar - Mother");
      if (editForm.docPhoto) documentsSubmitted.push("Photo");
      if (editForm.docTransferCertificate) documentsSubmitted.push("Transfer Certificate");
      if (editForm.docBirthCertificate) documentsSubmitted.push("Birth Certificate");

      const updates = {
        admissionNumber: editForm.admissionNumber.trim(), rollNumber: editForm.rollNumber ? Number(editForm.rollNumber) : null,
        name: editForm.name.trim(), className: editForm.className, section: editForm.section.trim(),
        dateOfAdmission: editForm.dateOfAdmission || null, dateOfBirth: editForm.dateOfBirth || null,
        gender: editForm.gender || null, bloodGroup: editForm.bloodGroup.trim() || null, penNumber: editForm.penNumber.trim() || null,
        fatherName: editForm.fatherName.trim(), motherName: editForm.motherName.trim(), guardianName: editForm.guardianName.trim() || editForm.fatherName.trim(),
        fatherOccupation: editForm.fatherOccupation.trim() || null, motherOccupation: editForm.motherOccupation.trim() || null,
        fatherMobile: editForm.fatherMobile.trim() || null, motherMobile: editForm.motherMobile.trim() || null, mobileNumber: editForm.mobileNumber.trim() || editForm.fatherMobile.trim() || "",
        addressPresent: editForm.addressPresent.trim() || null, addressPermanent: editForm.addressPermanent.trim() || null,
        aadhaarStudent: editForm.aadhaarStudent.trim() || null, aadhaarFather: editForm.aadhaarFather.trim() || null, aadhaarMother: editForm.aadhaarMother.trim() || null,
        nationality: editForm.nationality.trim() || "Indian", category: editForm.category || null, religion: editForm.religion.trim() || null, lastInstitution: editForm.lastInstitution.trim() || null,
        docAadhaarStudent: editForm.docAadhaarStudent, docAadhaarFather: editForm.docAadhaarFather, docAadhaarMother: editForm.docAadhaarMother, docPhoto: editForm.docPhoto, docTransferCertificate: editForm.docTransferCertificate, docBirthCertificate: editForm.docBirthCertificate,
        documentsSubmitted, remarks: editForm.remarks.trim() || null, transportOpted: editForm.transportOpted || false, transportAmount: editForm.transportOpted ? Number(editForm.transportAmount) : 0,
      };

      const uploadErrors = [];
      for (const { slot, field, label } of IMAGE_SLOTS) {
        const f = editImages[slot]?.file;
        if (!f) continue;
        try { const url = await uploadStudentImage(editStudent.id, slot, f); updates[field] = url; } catch (err) { uploadErrors.push(`${label}: ${err.message}`); }
      }
      await updateStudentFull(editStudent.id, updates);
      let msg = `Student "${updates.name}" updated.`; if (uploadErrors.length) msg += ` Some images failed.`;
      setSuccess(msg); closeEdit(); 
      
      if (searchTerm.trim()) {
        const found = await searchStudents(searchTerm.trim());
        setStudents(found);
      }
      setTimeout(() => setSuccess(""), 8000);
    } catch (err) { setEditError(err.message || "Could not update student."); } finally { setEditSaving(false); }
  }

  async function handleDelete(student) {
    const expected = student.name.trim();
    const typed = window.prompt(`Delete "${student.name}"?\n\nThis will PERMANENTLY erase all bills, transactions, and receipts.\n\nTo confirm, type the student's name exactly:\n${expected}`);
    if (typed === null) return;
    if (typed.trim() !== expected) { setDeleteMsg("Name didn't match."); setTimeout(() => setDeleteMsg(""), 4000); return; }
    
    setDeleteBusy(student.id); setDeleteMsg("");
    try {
      const summary = await deleteStudentCompletely(student.id, student.name);
      setDeleteMsg(`Deleted "${student.name}". Bills: ${summary.billsDeleted}, Txns: ${summary.transactionsDeleted}.`);
      setStudents(students.filter(s => s.id !== student.id)); 
      setTimeout(() => setDeleteMsg(""), 8000);
    } catch (err) { setDeleteMsg(`❌ ${err.message}`); setTimeout(() => setDeleteMsg(""), 8000); } finally { setDeleteBusy(null); }
  }

  return (
    <div className="fm-card">
      <div className="fm-row-header">
        <h2>Student Directory</h2>
        <span className="fm-subtle">Search to find students. To add a new student, use the Admissions tab.</span>
      </div>

      {success && <p className="fm-success">{success} ✓</p>}
      {error && <p className="fm-error">{error}</p>}
      {deleteMsg && <p style={{ margin: "8px 0", fontWeight: 500, color: deleteMsg.startsWith("❌") ? "#c62828" : "#1a3d6d" }}>{deleteMsg}</p>}

      {editCameraSlot && <CameraCapture label={IMAGE_SLOTS.find((s) => s.slot === editCameraSlot)?.label || "Photo"} onCapture={(file) => setImageForSlot(editCameraSlot, file, "edit")} onClose={() => setEditCameraSlot(null)} />}

      {editStudent && (
        <div className="fm-modal-overlay" style={{ zIndex: 9100 }}>
          <div className="fm-modal fm-modal-wide">
            <div className="fm-modal-header"><h3>Edit Student — {editStudent.name}</h3><button type="button" className="fm-modal-close" onClick={closeEdit} aria-label="Close">×</button></div>
            {editError && <p className="fm-error">{editError}</p>}
            <form onSubmit={saveEdit}>
              {/* Form fields for editing (same as before) */}
              <div className="fm-form-section" style={{ borderTop: "none", marginTop: 0, paddingTop: 0 }}>
                <h3>Basic Details</h3>
                <div className="fm-form-grid">
                  <label>Admission Number *<input required value={editForm.admissionNumber} onChange={(e) => updateEdit("admissionNumber", e.target.value)} /></label>
                  <label>Roll No<input type="number" min="0" value={editForm.rollNumber} onChange={(e) => updateEdit("rollNumber", e.target.value)} /></label>
                  <label>Student Name *<input required value={editForm.name} onChange={(e) => updateEdit("name", e.target.value)} /></label>
                  <label>Class *<select required value={editForm.className} onChange={(e) => updateEdit("className", e.target.value)}><option value="">Select class…</option>{CLASS_OPTIONS.map((c) => <option key={c}>{c}</option>)}</select></label>
                  <label>Section<input value={editForm.section} onChange={(e) => updateEdit("section", e.target.value)} /></label>
                  <label>Date of Admission<input type="date" value={editForm.dateOfAdmission} onChange={(e) => updateEdit("dateOfAdmission", e.target.value)} /></label>
                  <label>Date of Birth<input type="date" value={editForm.dateOfBirth} onChange={(e) => updateEdit("dateOfBirth", e.target.value)} /></label>
                  <label>Gender<select value={editForm.gender} onChange={(e) => updateEdit("gender", e.target.value)}><option value="">—</option><option>Male</option><option>Female</option><option>Other</option></select></label>
                  <label>Blood Group<input value={editForm.bloodGroup} onChange={(e) => updateEdit("bloodGroup", e.target.value)} /></label>
                  <label>PEN No<input value={editForm.penNumber} onChange={(e) => updateEdit("penNumber", e.target.value)} /></label>
                </div>
              </div>

              <div className="fm-form-section">
                <h3>Transport</h3>
                <div className="fm-form-grid">
                  <label className="fm-checkbox-row" style={{ marginTop: 8 }}>
                    <input type="checkbox" checked={editForm.transportOpted || false} onChange={(e) => { updateEdit("transportOpted", e.target.checked); if (e.target.checked && !editForm.transportAmount) updateEdit("transportAmount", 800); else if (!e.target.checked) updateEdit("transportAmount", 0); }} />
                    Student uses School Transport
                  </label>
                  {editForm.transportOpted && <label>Transport Amount (₹) *<input type="number" required min="800" max="1500" step="50" value={editForm.transportAmount || 800} onChange={(e) => updateEdit("transportAmount", e.target.value)} /></label>}
                </div>
              </div>

              <div className="fm-form-section">
                <h3>Family Details</h3>
                <div className="fm-form-grid">
                  <label>Father's Name<input value={editForm.fatherName} onChange={(e) => updateEdit("fatherName", e.target.value)} /></label>
                  <label>Mother's Name<input value={editForm.motherName} onChange={(e) => updateEdit("motherName", e.target.value)} /></label>
                  <label>Guardian Name<input value={editForm.guardianName} onChange={(e) => updateEdit("guardianName", e.target.value)} /></label>
                  <label>Father's Occupation<input value={editForm.fatherOccupation} onChange={(e) => updateEdit("fatherOccupation", e.target.value)} /></label>
                  <label>Mother's Occupation<input value={editForm.motherOccupation} onChange={(e) => updateEdit("motherOccupation", e.target.value)} /></label>
                  <label>Father's Mobile<input value={editForm.fatherMobile} onChange={(e) => updateEdit("fatherMobile", e.target.value)} /></label>
                  <label>Mother's Mobile<input value={editForm.motherMobile} onChange={(e) => updateEdit("motherMobile", e.target.value)} /></label>
                  <label>Primary Mobile<input value={editForm.mobileNumber} onChange={(e) => updateEdit("mobileNumber", e.target.value)} /></label>
                  <label className="fm-full-width">Present Address<textarea value={editForm.addressPresent} onChange={(e) => updateEdit("addressPresent", e.target.value)} /></label>
                  <div className="fm-full-width" style={{ marginTop: -6 }}><label className="fm-checkbox-row" style={{ marginBottom: 6 }}><input type="checkbox" checked={editSameAsPresent} onChange={(e) => { setEditSameAsPresent(e.target.checked); if (!e.target.checked) updateEdit("addressPermanent", ""); }} />Permanent address is the same as Present address</label></div>
                  <label className="fm-full-width">Permanent Address<textarea value={editForm.addressPermanent} onChange={(e) => updateEdit("addressPermanent", e.target.value)} disabled={editSameAsPresent} style={editSameAsPresent ? { background: "#f5f7fa", cursor: "not-allowed" } : undefined} /></label>
                </div>
              </div>

              <div className="fm-form-section">
                <h3>Aadhaar &amp; Identity</h3>
                <div className="fm-form-grid">
                  <label>Student's Aadhaar<input value={editForm.aadhaarStudent} maxLength={12} onChange={(e) => updateEdit("aadhaarStudent", e.target.value.replace(/\D/g, ""))} /></label>
                  <label>Father's Aadhaar<input value={editForm.aadhaarFather} maxLength={12} onChange={(e) => updateEdit("aadhaarFather", e.target.value.replace(/\D/g, ""))} /></label>
                  <label>Mother's Aadhaar<input value={editForm.aadhaarMother} maxLength={12} onChange={(e) => updateEdit("aadhaarMother", e.target.value.replace(/\D/g, ""))} /></label>
                  <label>Nationality<input value={editForm.nationality} onChange={(e) => updateEdit("nationality", e.target.value)} /></label>
                  <label>Category<select value={editForm.category} onChange={(e) => updateEdit("category", e.target.value)}><option value="">—</option><option>General</option><option>OBC</option><option>SC</option><option>ST</option><option>EWS</option><option>Other</option></select></label>
                  <label>Religion<input value={editForm.religion} onChange={(e) => updateEdit("religion", e.target.value)} /></label>
                  <label className="fm-full-width">Last Institution Attended<input value={editForm.lastInstitution} onChange={(e) => updateEdit("lastInstitution", e.target.value)} /></label>
                </div>
              </div>

              <div className="fm-form-section">
                <h3>Photos &amp; Aadhaar Scans</h3>
                <div className="fm-upload-grid">
                  {IMAGE_SLOTS.map(({ slot, label }) => (
                    <div key={slot} className="fm-upload-cell">
                      <button type="button" className="fm-file-label" onClick={() => setEditCameraSlot(slot)}>📷 {label}</button>
                      {editImages[slot]?.preview && <img src={editImages[slot].preview} alt={label} className="fm-file-preview" />}
                    </div>
                  ))}
                </div>
              </div>

              <div className="fm-form-section">
                <h3>Documents Submitted</h3>
                <div className="fm-doc-checkbox-grid">
                  <label className="fm-checkbox-row"><input type="checkbox" checked={editForm.docAadhaarStudent} onChange={(e) => updateEdit("docAadhaarStudent", e.target.checked)} /> Aadhaar — Student</label>
                  <label className="fm-checkbox-row"><input type="checkbox" checked={editForm.docAadhaarFather} onChange={(e) => updateEdit("docAadhaarFather", e.target.checked)} /> Aadhaar — Father</label>
                  <label className="fm-checkbox-row"><input type="checkbox" checked={editForm.docAadhaarMother} onChange={(e) => updateEdit("docAadhaarMother", e.target.checked)} /> Aadhaar — Mother</label>
                  <label className="fm-checkbox-row"><input type="checkbox" checked={editForm.docPhoto} onChange={(e) => updateEdit("docPhoto", e.target.checked)} /> Photo</label>
                  <label className="fm-checkbox-row"><input type="checkbox" checked={editForm.docTransferCertificate} onChange={(e) => updateEdit("docTransferCertificate", e.target.checked)} /> Transfer Certificate</label>
                  <label className="fm-checkbox-row"><input type="checkbox" checked={editForm.docBirthCertificate} onChange={(e) => updateEdit("docBirthCertificate", e.target.checked)} /> Birth Certificate</label>
                </div>
              </div>

              <div className="fm-form-section">
                <h3>Additional Notes</h3>
                <div className="fm-form-grid">
                  <label className="fm-full-width">Remarks<textarea value={editForm.remarks} onChange={(e) => updateEdit("remarks", e.target.value)} /></label>
                </div>
              </div>

              <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
                <button type="submit" disabled={editSaving} className="fm-primary-btn">{editSaving ? "Saving…" : "Save Changes"}</button>
                <button type="button" className="fm-secondary-btn" onClick={closeEdit}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <form onSubmit={handleSearch} className="fm-search-row" style={{ marginTop: 24 }}>
        <input placeholder="Search by name (min 3 chars), parent name, mobile, or Admission No." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        <button type="submit">Search</button>
        {students.length > 0 && <button type="button" className="fm-secondary-btn" onClick={() => { setSearchTerm(""); setStudents([]); }}>Clear</button>}
      </form>

      {loading ? (
        <p className="fm-empty-state">Searching…</p>
      ) : students.length === 0 ? (
        <p className="fm-empty-state" style={{ padding: 40, background: "#f8fafc", borderRadius: 8 }}>
          Enter a search term above to find students.
        </p>
      ) : (
        <div className="fm-compact-grid-container">
          <div className="fm-compact-grid-header">
            <div>Name</div>
            <div>Adm#</div>
            <div>Roll</div>
            <div>Class</div>
            <div>Father</div>
            <div>Mother</div>
            <div>Mobile</div>
            <div>Status</div>
            <div className="fm-cell-right">Actions</div>
          </div>
          
          {students.map((s) => (
            <div key={s.id} className="fm-compact-grid-row" onClick={() => onSelectStudent?.(s.id)}>
              <div className="fm-cell-truncate" style={{ fontWeight: 600, color: "var(--primary-blue)" }}>
                {s.transportOpted && <span title="Uses Transport" style={{ marginRight: 6 }}>🚌</span>}
                {s.name}
              </div>
              <div className="fm-cell-truncate">{s.admissionNumber}</div>
              <div className="fm-cell-truncate">{s.rollNumber ?? "—"}</div>
              <div className="fm-cell-truncate">{s.className}{s.section ? `-${s.section}` : ""}</div>
              <div className="fm-cell-truncate">{s.fatherName || "—"}</div>
              <div className="fm-cell-truncate">{s.motherName || "—"}</div>
              <div className="fm-cell-truncate">{s.mobileNumber || s.fatherMobile || "—"}</div>
              <div>
                <span className={`fm-badge fm-badge-${(s.accountStatus || "PAID").toLowerCase()}`}>
                  {s.accountStatus || "PAID"}
                </span>
              </div>
              <div className="fm-compact-actions" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="fm-btn-icon" onClick={() => setPrintStudent(s)} title="Print">🖨</button>
                {canEdit && <button type="button" className="fm-btn-icon" onClick={() => openEdit(s)} title="Edit">✏</button>}
                {canDelete && <button type="button" className="fm-btn-icon danger" onClick={() => handleDelete(s)} disabled={deleteBusy === s.id} title="Delete">{deleteBusy === s.id ? "…" : "🗑"}</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      <PrintManager active={!!printStudent} onClose={() => setPrintStudent(null)} type="student">
        {printStudent && <StudentPrintPage student={printStudent} />}
      </PrintManager>
    </div>
  );
}
