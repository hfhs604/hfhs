import React, { useEffect, useState } from "react";
import {
  createStudent, searchStudents, peekNextAdmissionNumber, reserveAdmissionNumber,
  updateStudentProfile, deleteStudentCompletely, updateStudentFull,
} from "../firebase/feeService";
import { getAllStudents } from "../firebase/reportsService";
import { uploadStudentImage } from "../firebase/photoService";
import StudentPrintPage from "./StudentPrintPage";
import BlankAdmissionForm from "./BlankAdmissionForm";
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
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [sameAsPresent, setSameAsPresent] = useState(false);
  const [printStudent, setPrintStudent] = useState(null);
  const [showBlankForm, setShowBlankForm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(null);
  const [deleteMsg, setDeleteMsg] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [cameraSlot, setCameraSlot] = useState(null);

  const [editStudent, setEditStudent] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editSameAsPresent, setEditSameAsPresent] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);
  const [editCameraSlot, setEditCameraSlot] = useState(null);

  const [images, setImages] = useState({ photo: { file: null, preview: null }, "aadhaar-student": { file: null, preview: null }, "aadhaar-father": { file: null, preview: null }, "aadhaar-mother": { file: null, preview: null } });
  const [editImages, setEditImages] = useState({ photo: { file: null, preview: null }, "aadhaar-student": { file: null, preview: null }, "aadhaar-father": { file: null, preview: null }, "aadhaar-mother": { file: null, preview: null } });

  const canEdit = EDIT_ROLES.includes(role);
  const canDelete = DELETE_ROLES.includes(role);

  async function loadStudents() {
    setLoading(true);
    try { setStudents(await getAllStudents({ session })); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }

  useEffect(() => { loadStudents(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [session]);

  useEffect(() => {
    if (!showForm) return;
    (async () => {
      try { const next = await peekNextAdmissionNumber(); setForm((f) => f.admissionNumber ? f : { ...f, admissionNumber: String(next) }); } catch (e) {}
    })();
  }, [showForm]);

  useEffect(() => { if (sameAsPresent) setForm((f) => ({ ...f, addressPermanent: f.addressPresent })); }, [sameAsPresent, form.addressPresent]);
  useEffect(() => { if (editSameAsPresent) setEditForm((f) => ({ ...f, addressPermanent: f.addressPresent })); }, [editSameAsPresent, editForm.addressPresent]);

  async function handleSearch(e) {
    e.preventDefault();
    if (!searchTerm.trim()) return loadStudents();
    setLoading(true);
    try { setStudents(await searchStudents(searchTerm.trim())); } finally { setLoading(false); }
  }

  function update(field, value) { setForm((f) => ({ ...f, [field]: value })); }
  function updateEdit(field, value) { setEditForm((f) => ({ ...f, [field]: value })); }

  function setImageForSlot(slot, file, mode = "add") {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (mode === "edit") setEditImages((prev) => ({ ...prev, [slot]: { file, preview: ev.target.result } }));
      else setImages((prev) => ({ ...prev, [slot]: { file, preview: ev.target.result } }));
    };
    reader.readAsDataURL(file);
  }

  function resetForm() {
    setForm(emptyForm); setSameAsPresent(false);
    setImages({ photo: { file: null, preview: null }, "aadhaar-student": { file: null, preview: null }, "aadhaar-father": { file: null, preview: null }, "aadhaar-mother": { file: null, preview: null } });
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
      setSuccess(msg); closeEdit(); await loadStudents(); setTimeout(() => setSuccess(""), 8000);
    } catch (err) { setEditError(err.message || "Could not update student."); } finally { setEditSaving(false); }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.className || !form.admissionNumber.trim()) { setError("Please fill Name, Class, and Admission Number."); return; }
    if (form.transportOpted) {
      const amt = Number(form.transportAmount);
      if (amt < 800 || amt > 1500) { setError("Transport fee must be between ₹800 and ₹1500."); return; }
    }
    setShowConfirm(true);
  }

  async function confirmCreate() {
    setShowConfirm(false); setSaving(true); setError(null); setSuccess("");
    try {
      let admissionNumber = form.admissionNumber.trim();
      const suggested = await peekNextAdmissionNumber();
      if (!admissionNumber || admissionNumber === String(suggested)) admissionNumber = await reserveAdmissionNumber();
      const guardianName = form.guardianName.trim() || form.fatherName.trim();
      
      const documentsSubmitted = [];
      if (form.docAadhaarStudent) documentsSubmitted.push("Aadhaar - Student");
      if (form.docAadhaarFather) documentsSubmitted.push("Aadhaar - Father");
      if (form.docAadhaarMother) documentsSubmitted.push("Aadhaar - Mother");
      if (form.docPhoto) documentsSubmitted.push("Photo");
      if (form.docTransferCertificate) documentsSubmitted.push("Transfer Certificate");
      if (form.docBirthCertificate) documentsSubmitted.push("Birth Certificate");

      const studentId = await createStudent({
        admissionNumber, rollNumber: form.rollNumber ? Number(form.rollNumber) : null, name: form.name.trim(), className: form.className, section: form.section.trim(),
        dateOfAdmission: form.dateOfAdmission || null, dateOfBirth: form.dateOfBirth || null, gender: form.gender || null, bloodGroup: form.bloodGroup.trim() || null, penNumber: form.penNumber.trim() || null,
        fatherName: form.fatherName.trim(), motherName: form.motherName.trim(), guardianName,
        fatherOccupation: form.fatherOccupation.trim() || null, motherOccupation: form.motherOccupation.trim() || null,
        fatherMobile: form.fatherMobile.trim() || null, motherMobile: form.motherMobile.trim() || null, mobileNumber: form.mobileNumber.trim() || form.fatherMobile.trim() || "",
        addressPresent: form.addressPresent.trim() || null, addressPermanent: form.addressPermanent.trim() || null,
        aadhaarStudent: form.aadhaarStudent.trim() || null, aadhaarFather: form.aadhaarFather.trim() || null, aadhaarMother: form.aadhaarMother.trim() || null,
        nationality: form.nationality.trim() || "Indian", category: form.category || null, religion: form.religion.trim() || null, lastInstitution: form.lastInstitution.trim() || null,
        docAadhaarStudent: form.docAadhaarStudent, docAadhaarFather: form.docAadhaarFather, docAadhaarMother: form.docAadhaarMother, docPhoto: form.docPhoto, docTransferCertificate: form.docTransferCertificate, docBirthCertificate: form.docBirthCertificate,
        documentsSubmitted, photoUrl: null, aadhaarStudentPhotoUrl: null, aadhaarFatherPhotoUrl: null, aadhaarMotherPhotoUrl: null,
        remarks: form.remarks.trim() || null, session, transportOpted: form.transportOpted || false, transportAmount: form.transportOpted ? Number(form.transportAmount) : 0,
      });

      const uploadErrors = [];
      for (const { slot, field, label } of IMAGE_SLOTS) {
        const f = images[slot]?.file;
        if (!f) continue;
        try { const url = await uploadStudentImage(studentId, slot, f); await updateStudentProfile(studentId, { [field]: url }); } catch (err) { uploadErrors.push(`${label}: ${err.message}`); }
      }

      let msg = `Student "${form.name}" added.`; if (uploadErrors.length) msg += ` Some images failed.`;
      setSuccess(msg); resetForm(); setShowForm(false); await loadStudents(); setTimeout(() => setSuccess(""), 8000);
    } catch (err) { setError(err.message || "Could not create student."); } finally { setSaving(false); }
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
      await loadStudents(); setTimeout(() => setDeleteMsg(""), 8000);
    } catch (err) { setDeleteMsg(`❌ ${err.message}`); setTimeout(() => setDeleteMsg(""), 8000); } finally { setDeleteBusy(null); }
  }

  function renderFormFields(f, setF, sameAs, setSameAs, imagesObj, setCamera) {
    return (
      <>
        <div className="fm-form-section" style={{ borderTop: "none", marginTop: 0, paddingTop: 0 }}>
          <h3>Basic Details</h3>
          <div className="fm-form-grid">
            <label>Admission Number *<input required value={f.admissionNumber} onChange={(e) => setF("admissionNumber", e.target.value)} /></label>
            <label>Roll No<input type="number" min="0" value={f.rollNumber} onChange={(e) => setF("rollNumber", e.target.value)} /></label>
            <label>Student Name *<input required value={f.name} onChange={(e) => setF("name", e.target.value)} /></label>
            <label>Class *<select required value={f.className} onChange={(e) => setF("className", e.target.value)}><option value="">Select class…</option>{CLASS_OPTIONS.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label>Section<input value={f.section} onChange={(e) => setF("section", e.target.value)} /></label>
            <label>Date of Admission<input type="date" value={f.dateOfAdmission} onChange={(e) => setF("dateOfAdmission", e.target.value)} /></label>
            <label>Date of Birth<input type="date" value={f.dateOfBirth} onChange={(e) => setF("dateOfBirth", e.target.value)} /></label>
            <label>Gender<select value={f.gender} onChange={(e) => setF("gender", e.target.value)}><option value="">—</option><option>Male</option><option>Female</option><option>Other</option></select></label>
            <label>Blood Group<input value={f.bloodGroup} onChange={(e) => setF("bloodGroup", e.target.value)} /></label>
            <label>PEN No<input value={f.penNumber} onChange={(e) => setF("penNumber", e.target.value)} /></label>
          </div>
        </div>

        <div className="fm-form-section">
          <h3>Transport</h3>
          <div className="fm-form-grid">
            <label className="fm-checkbox-row" style={{ marginTop: 8 }}>
              <input type="checkbox" checked={f.transportOpted || false} onChange={(e) => { setF("transportOpted", e.target.checked); if (e.target.checked && !f.transportAmount) setF("transportAmount", 800); else if (!e.target.checked) setF("transportAmount", 0); }} />
              Student uses School Transport
            </label>
            {f.transportOpted && <label>Transport Amount (₹) *<input type="number" required min="800" max="1500" step="50" value={f.transportAmount || 800} onChange={(e) => setF("transportAmount", e.target.value)} /></label>}
          </div>
        </div>

        <div className="fm-form-section">
          <h3>Family Details</h3>
          <div className="fm-form-grid">
            <label>Father's Name<input value={f.fatherName} onChange={(e) => setF("fatherName", e.target.value)} /></label>
            <label>Mother's Name<input value={f.motherName} onChange={(e) => setF("motherName", e.target.value)} /></label>
            <label>Guardian Name<input value={f.guardianName} onChange={(e) => setF("guardianName", e.target.value)} /></label>
            <label>Father's Occupation<input value={f.fatherOccupation} onChange={(e) => setF("fatherOccupation", e.target.value)} /></label>
            <label>Mother's Occupation<input value={f.motherOccupation} onChange={(e) => setF("motherOccupation", e.target.value)} /></label>
            <label>Father's Mobile<input value={f.fatherMobile} onChange={(e) => setF("fatherMobile", e.target.value)} /></label>
            <label>Mother's Mobile<input value={f.motherMobile} onChange={(e) => setF("motherMobile", e.target.value)} /></label>
            <label>Primary Mobile<input value={f.mobileNumber} onChange={(e) => setF("mobileNumber", e.target.value)} /></label>
            <label className="fm-full-width">Present Address<textarea value={f.addressPresent} onChange={(e) => setF("addressPresent", e.target.value)} /></label>
            <div className="fm-full-width" style={{ marginTop: -6 }}><label className="fm-checkbox-row" style={{ marginBottom: 6 }}><input type="checkbox" checked={sameAs} onChange={(e) => { setSameAs(e.target.checked); if (!e.target.checked) setF("addressPermanent", ""); }} />Permanent address is the same as Present address</label></div>
            <label className="fm-full-width">Permanent Address<textarea value={f.addressPermanent} onChange={(e) => setF("addressPermanent", e.target.value)} disabled={sameAs} style={sameAs ? { background: "#f5f7fa", cursor: "not-allowed" } : undefined} /></label>
          </div>
        </div>

        <div className="fm-form-section">
          <h3>Aadhaar &amp; Identity</h3>
          <div className="fm-form-grid">
            <label>Student's Aadhaar<input value={f.aadhaarStudent} maxLength={12} onChange={(e) => setF("aadhaarStudent", e.target.value.replace(/\D/g, ""))} /></label>
            <label>Father's Aadhaar<input value={f.aadhaarFather} maxLength={12} onChange={(e) => setF("aadhaarFather", e.target.value.replace(/\D/g, ""))} /></label>
            <label>Mother's Aadhaar<input value={f.aadhaarMother} maxLength={12} onChange={(e) => setF("aadhaarMother", e.target.value.replace(/\D/g, ""))} /></label>
            <label>Nationality<input value={f.nationality} onChange={(e) => setF("nationality", e.target.value)} /></label>
            <label>Category<select value={f.category} onChange={(e) => setF("category", e.target.value)}><option value="">—</option><option>General</option><option>OBC</option><option>SC</option><option>ST</option><option>EWS</option><option>Other</option></select></label>
            <label>Religion<input value={f.religion} onChange={(e) => setF("religion", e.target.value)} /></label>
            <label className="fm-full-width">Last Institution Attended<input value={f.lastInstitution} onChange={(e) => setF("lastInstitution", e.target.value)} /></label>
          </div>
        </div>

        <div className="fm-form-section">
          <h3>Photos &amp; Aadhaar Scans</h3>
          <div className="fm-upload-grid">
            {IMAGE_SLOTS.map(({ slot, label }) => (
              <div key={slot} className="fm-upload-cell">
                <button type="button" className="fm-file-label" onClick={() => setCamera(slot)}>📷 {label}</button>
                {imagesObj[slot]?.preview && <img src={imagesObj[slot].preview} alt={label} className="fm-file-preview" />}
              </div>
            ))}
          </div>
        </div>

        <div className="fm-form-section">
          <h3>Documents Submitted</h3>
          <div className="fm-doc-checkbox-grid">
            <label className="fm-checkbox-row"><input type="checkbox" checked={f.docAadhaarStudent} onChange={(e) => setF("docAadhaarStudent", e.target.checked)} /> Aadhaar — Student</label>
            <label className="fm-checkbox-row"><input type="checkbox" checked={f.docAadhaarFather} onChange={(e) => setF("docAadhaarFather", e.target.checked)} /> Aadhaar — Father</label>
            <label className="fm-checkbox-row"><input type="checkbox" checked={f.docAadhaarMother} onChange={(e) => setF("docAadhaarMother", e.target.checked)} /> Aadhaar — Mother</label>
            <label className="fm-checkbox-row"><input type="checkbox" checked={f.docPhoto} onChange={(e) => setF("docPhoto", e.target.checked)} /> Photo</label>
            <label className="fm-checkbox-row"><input type="checkbox" checked={f.docTransferCertificate} onChange={(e) => setF("docTransferCertificate", e.target.checked)} /> Transfer Certificate</label>
            <label className="fm-checkbox-row"><input type="checkbox" checked={f.docBirthCertificate} onChange={(e) => setF("docBirthCertificate", e.target.checked)} /> Birth Certificate</label>
          </div>
        </div>

        <div className="fm-form-section">
          <h3>Additional Notes</h3>
          <div className="fm-form-grid">
            <label className="fm-full-width">Remarks<textarea value={f.remarks} onChange={(e) => setF("remarks", e.target.value)} /></label>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="fm-card">
      <div className="fm-row-header">
        <h2>Students</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="fm-secondary-btn" onClick={() => setShowBlankForm(true)}>📄 Print Blank Form</button>
          <button className="fm-primary-btn" onClick={() => { setShowForm((s) => !s); setError(null); setSuccess(""); }}>{showForm ? "Cancel" : "+ Add Student"}</button>
        </div>
      </div>

      {success && <p className="fm-success">{success} ✓</p>}
      {error && <p className="fm-error">{error}</p>}
      {deleteMsg && <p style={{ margin: "8px 0", fontWeight: 500, color: deleteMsg.startsWith("❌") ? "#c62828" : "#1a3d6d" }}>{deleteMsg}</p>}

      {cameraSlot && <CameraCapture label={IMAGE_SLOTS.find((s) => s.slot === cameraSlot)?.label || "Photo"} onCapture={(file) => setImageForSlot(cameraSlot, file, "add")} onClose={() => setCameraSlot(null)} />}
      {editCameraSlot && <CameraCapture label={IMAGE_SLOTS.find((s) => s.slot === editCameraSlot)?.label || "Photo"} onCapture={(file) => setImageForSlot(editCameraSlot, file, "edit")} onClose={() => setEditCameraSlot(null)} />}

      {showForm && (
        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #e5e7eb" }}>
            <h3 style={{ margin: 0, color: "#1a3d6d" }}>Add New Student</h3>
          </div>
          {renderFormFields(form, update, sameAsPresent, setSameAsPresent, images, setCameraSlot)}
          <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
            <button type="submit" disabled={saving} className="fm-primary-btn">{saving ? "Saving…" : "Create Student"}</button>
            <button type="button" className="fm-secondary-btn" onClick={() => { resetForm(); setShowForm(false); }}>Cancel</button>
          </div>
        </form>
      )}

      {editStudent && (
        <div className="fm-modal-overlay" style={{ zIndex: 9100 }}>
          <div className="fm-modal fm-modal-wide">
            <div className="fm-modal-header"><h3>Edit Student — {editStudent.name}</h3><button type="button" className="fm-modal-close" onClick={closeEdit} aria-label="Close">×</button></div>
            {editError && <p className="fm-error">{editError}</p>}
            <form onSubmit={saveEdit}>
              {renderFormFields(editForm, updateEdit, editSameAsPresent, setEditSameAsPresent, editImages, setEditCameraSlot)}
              <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
                <button type="submit" disabled={editSaving} className="fm-primary-btn">{editSaving ? "Saving…" : "Save Changes"}</button>
                <button type="button" className="fm-secondary-btn" onClick={closeEdit}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showConfirm && (
        <div className="fm-modal-overlay">
          <div className="fm-modal">
            <h3>Create this student?</h3>
            <table style={{ width: "100%", marginBottom: 16, fontSize: 14 }}>
              <tbody>
                <tr><td><strong>Name</strong></td><td>{form.name || "—"}</td></tr>
                <tr><td><strong>Admission No.</strong></td><td>{form.admissionNumber || "—"}</td></tr>
                <tr><td><strong>Class</strong></td><td>{form.className || "—"}</td></tr>
              </tbody>
            </table>
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button type="button" className="fm-secondary-btn" onClick={() => setShowConfirm(false)}>Cancel</button>
              <button type="button" className="fm-primary-btn" onClick={confirmCreate}>Yes, Create Student</button>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSearch} className="fm-search-row" style={{ marginTop: 24 }}>
        <input placeholder="Search by name, admission no, or mobile..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        <button type="submit">Search</button>
      </form>

      {loading ? (
        <p className="fm-empty-state">Loading…</p>
      ) : students.length === 0 ? (
        <p className="fm-empty-state">No students found.</p>
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

      <PrintManager active={!!showBlankForm} onClose={() => setShowBlankForm(false)} type="admission">
        {showBlankForm && <BlankAdmissionForm suggestedAdmissionNumber={form.admissionNumber} />}
      </PrintManager>
    </div>
  );
}
