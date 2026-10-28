import React, { useEffect, useState } from "react";
import {
  createStudent, peekNextAdmissionNumber, reserveAdmissionNumber,
  updateStudentProfile,
} from "../firebase/feeService";
import { uploadStudentImage } from "../firebase/photoService";
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

export default function Admissions({ session, role }) {
  const [showForm, setShowForm] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [sameAsPresent, setSameAsPresent] = useState(false);
  const [showBlankForm, setShowBlankForm] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [cameraSlot, setCameraSlot] = useState(null);
  const [images, setImages] = useState({ photo: { file: null, preview: null }, "aadhaar-student": { file: null, preview: null }, "aadhaar-father": { file: null, preview: null }, "aadhaar-mother": { file: null, preview: null } });

  useEffect(() => {
    (async () => {
      try { const next = await peekNextAdmissionNumber(); setForm((f) => f.admissionNumber ? f : { ...f, admissionNumber: String(next) }); } catch (e) {}
    })();
  }, []);

  useEffect(() => { if (sameAsPresent) setForm((f) => ({ ...f, addressPermanent: f.addressPresent })); }, [sameAsPresent, form.addressPresent]);

  function update(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  function setImageForSlot(slot, file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImages((prev) => ({ ...prev, [slot]: { file, preview: ev.target.result } }));
    };
    reader.readAsDataURL(file);
  }

  function resetForm() {
    setForm(emptyForm); setSameAsPresent(false);
    setImages({ photo: { file: null, preview: null }, "aadhaar-student": { file: null, preview: null }, "aadhaar-father": { file: null, preview: null }, "aadhaar-mother": { file: null, preview: null } });
    peekNextAdmissionNumber().then(next => setForm(f => ({ ...f, admissionNumber: String(next) })));
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

      let msg = `Student "${form.name}" admitted successfully.`; if (uploadErrors.length) msg += ` Some images failed.`;
      setSuccess(msg); resetForm(); 
      setTimeout(() => setSuccess(""), 8000);
    } catch (err) { setError(err.message || "Could not create student."); } finally { setSaving(false); }
  }

  return (
    <div className="fm-card">
      <div className="fm-row-header">
        <h2>Admissions</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="fm-secondary-btn" onClick={() => setShowBlankForm(true)}>📄 Print Blank Form</button>
        </div>
      </div>

      {success && <p className="fm-success">{success} ✓</p>}
      {error && <p className="fm-error">{error}</p>}

      {cameraSlot && <CameraCapture label={IMAGE_SLOTS.find((s) => s.slot === cameraSlot)?.label || "Photo"} onCapture={(file) => setImageForSlot(cameraSlot, file, "add")} onClose={() => setCameraSlot(null)} />}

      {showConfirm && (
        <div className="fm-modal-overlay">
          <div className="fm-modal">
            <h3>Admit this student?</h3>
            <table style={{ width: "100%", marginBottom: 16, fontSize: 14 }}>
              <tbody>
                <tr><td><strong>Name</strong></td><td>{form.name || "—"}</td></tr>
                <tr><td><strong>Admission No.</strong></td><td>{form.admissionNumber || "—"}</td></tr>
                <tr><td><strong>Class</strong></td><td>{form.className || "—"}</td></tr>
              </tbody>
            </table>
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button type="button" className="fm-secondary-btn" onClick={() => setShowConfirm(false)}>Cancel</button>
              <button type="button" className="fm-primary-btn" onClick={confirmCreate}>Yes, Admit Student</button>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="fm-form-section" style={{ borderTop: "none", marginTop: 0, paddingTop: 0 }}>
          <h3>Basic Details</h3>
          <div className="fm-form-grid">
            <label>Admission Number *<input required value={form.admissionNumber} onChange={(e) => update("admissionNumber", e.target.value)} /></label>
            <label>Roll No<input type="number" min="0" value={form.rollNumber} onChange={(e) => update("rollNumber", e.target.value)} /></label>
            <label>Student Name *<input required value={form.name} onChange={(e) => update("name", e.target.value)} /></label>
            <label>Class *<select required value={form.className} onChange={(e) => update("className", e.target.value)}><option value="">Select class…</option>{CLASS_OPTIONS.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label>Section<input value={form.section} onChange={(e) => update("section", e.target.value)} /></label>
            <label>Date of Admission<input type="date" value={form.dateOfAdmission} onChange={(e) => update("dateOfAdmission", e.target.value)} /></label>
            <label>Date of Birth<input type="date" value={form.dateOfBirth} onChange={(e) => update("dateOfBirth", e.target.value)} /></label>
            <label>Gender<select value={form.gender} onChange={(e) => update("gender", e.target.value)}><option value="">—</option><option>Male</option><option>Female</option><option>Other</option></select></label>
            <label>Blood Group<input value={form.bloodGroup} onChange={(e) => update("bloodGroup", e.target.value)} /></label>
            <label>PEN No<input value={form.penNumber} onChange={(e) => update("penNumber", e.target.value)} /></label>
          </div>
        </div>

        <div className="fm-form-section">
          <h3>Transport</h3>
          <div className="fm-form-grid">
            <label className="fm-checkbox-row" style={{ marginTop: 8 }}>
              <input type="checkbox" checked={form.transportOpted || false} onChange={(e) => { update("transportOpted", e.target.checked); if (e.target.checked && !form.transportAmount) update("transportAmount", 800); else if (!e.target.checked) update("transportAmount", 0); }} />
              Student uses School Transport
            </label>
            {form.transportOpted && <label>Transport Amount (₹) *<input type="number" required min="800" max="1500" step="50" value={form.transportAmount || 800} onChange={(e) => update("transportAmount", e.target.value)} /></label>}
          </div>
        </div>

        <div className="fm-form-section">
          <h3>Family Details</h3>
          <div className="fm-form-grid">
            <label>Father's Name<input value={form.fatherName} onChange={(e) => update("fatherName", e.target.value)} /></label>
            <label>Mother's Name<input value={form.motherName} onChange={(e) => update("motherName", e.target.value)} /></label>
            <label>Guardian Name<input value={form.guardianName} onChange={(e) => update("guardianName", e.target.value)} /></label>
            <label>Father's Occupation<input value={form.fatherOccupation} onChange={(e) => update("fatherOccupation", e.target.value)} /></label>
            <label>Mother's Occupation<input value={form.motherOccupation} onChange={(e) => update("motherOccupation", e.target.value)} /></label>
            <label>Father's Mobile<input value={form.fatherMobile} onChange={(e) => update("fatherMobile", e.target.value)} /></label>
            <label>Mother's Mobile<input value={form.motherMobile} onChange={(e) => update("motherMobile", e.target.value)} /></label>
            <label>Primary Mobile<input value={form.mobileNumber} onChange={(e) => update("mobileNumber", e.target.value)} /></label>
            <label className="fm-full-width">Present Address<textarea value={form.addressPresent} onChange={(e) => update("addressPresent", e.target.value)} /></label>
            <div className="fm-full-width" style={{ marginTop: -6 }}><label className="fm-checkbox-row" style={{ marginBottom: 6 }}><input type="checkbox" checked={sameAsPresent} onChange={(e) => { setSameAsPresent(e.target.checked); if (!e.target.checked) update("addressPermanent", ""); }} />Permanent address is the same as Present address</label></div>
            <label className="fm-full-width">Permanent Address<textarea value={form.addressPermanent} onChange={(e) => update("addressPermanent", e.target.value)} disabled={sameAsPresent} style={sameAsPresent ? { background: "#f5f7fa", cursor: "not-allowed" } : undefined} /></label>
          </div>
        </div>

        <div className="fm-form-section">
          <h3>Aadhaar &amp; Identity</h3>
          <div className="fm-form-grid">
            <label>Student's Aadhaar<input value={form.aadhaarStudent} maxLength={12} onChange={(e) => update("aadhaarStudent", e.target.value.replace(/\D/g, ""))} /></label>
            <label>Father's Aadhaar<input value={form.aadhaarFather} maxLength={12} onChange={(e) => update("aadhaarFather", e.target.value.replace(/\D/g, ""))} /></label>
            <label>Mother's Aadhaar<input value={form.aadhaarMother} maxLength={12} onChange={(e) => update("aadhaarMother", e.target.value.replace(/\D/g, ""))} /></label>
            <label>Nationality<input value={form.nationality} onChange={(e) => update("nationality", e.target.value)} /></label>
            <label>Category<select value={form.category} onChange={(e) => update("category", e.target.value)}><option value="">—</option><option>General</option><option>OBC</option><option>SC</option><option>ST</option><option>EWS</option><option>Other</option></select></label>
            <label>Religion<input value={form.religion} onChange={(e) => update("religion", e.target.value)} /></label>
            <label className="fm-full-width">Last Institution Attended<input value={form.lastInstitution} onChange={(e) => update("lastInstitution", e.target.value)} /></label>
          </div>
        </div>

        <div className="fm-form-section">
          <h3>Photos &amp; Aadhaar Scans</h3>
          <div className="fm-upload-grid">
            {IMAGE_SLOTS.map(({ slot, label }) => (
              <div key={slot} className="fm-upload-cell">
                <button type="button" className="fm-file-label" onClick={() => setCameraSlot(slot)}>📷 {label}</button>
                {images[slot]?.preview && <img src={images[slot].preview} alt={label} className="fm-file-preview" />}
              </div>
            ))}
          </div>
        </div>

        <div className="fm-form-section">
          <h3>Documents Submitted</h3>
          <div className="fm-doc-checkbox-grid">
            <label className="fm-checkbox-row"><input type="checkbox" checked={form.docAadhaarStudent} onChange={(e) => update("docAadhaarStudent", e.target.checked)} /> Aadhaar — Student</label>
            <label className="fm-checkbox-row"><input type="checkbox" checked={form.docAadhaarFather} onChange={(e) => update("docAadhaarFather", e.target.checked)} /> Aadhaar — Father</label>
            <label className="fm-checkbox-row"><input type="checkbox" checked={form.docAadhaarMother} onChange={(e) => update("docAadhaarMother", e.target.checked)} /> Aadhaar — Mother</label>
            <label className="fm-checkbox-row"><input type="checkbox" checked={form.docPhoto} onChange={(e) => update("docPhoto", e.target.checked)} /> Photo</label>
            <label className="fm-checkbox-row"><input type="checkbox" checked={form.docTransferCertificate} onChange={(e) => update("docTransferCertificate", e.target.checked)} /> Transfer Certificate</label>
            <label className="fm-checkbox-row"><input type="checkbox" checked={form.docBirthCertificate} onChange={(e) => update("docBirthCertificate", e.target.checked)} /> Birth Certificate</label>
          </div>
        </div>

        <div className="fm-form-section">
          <h3>Additional Notes</h3>
          <div className="fm-form-grid">
            <label className="fm-full-width">Remarks<textarea value={form.remarks} onChange={(e) => update("remarks", e.target.value)} /></label>
          </div>
        </div>

        <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
          <button type="submit" disabled={saving} className="fm-primary-btn">{saving ? "Processing…" : "Complete Admission"}</button>
          <button type="button" className="fm-secondary-btn" onClick={resetForm}>Clear Form</button>
        </div>
      </form>

      <PrintManager active={!!showBlankForm} onClose={() => setShowBlankForm(false)} type="admission">
        {showBlankForm && <BlankAdmissionForm suggestedAdmissionNumber={form.admissionNumber} />}
      </PrintManager>
    </div>
  );
}
