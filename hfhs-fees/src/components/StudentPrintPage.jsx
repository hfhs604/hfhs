import React from "react";
import schoolLogo from "../assets/school-logo.jpg";
import "../styles/studentPrint.css";

const SCHOOL = {
  name: "HOLY FAITH HIGH SCHOOL",
  tagline: "Tarwara More, Siwan, Bihar – 841227",
  registrationNumber: "21812302021829794631",
  email: "holyfaithsiwan604@gmail.com",
  contact: "+91-9934723574",
};

function formatDate(v) {
  if (!v) return "—";
  try {
    const d = typeof v === "string" ? new Date(v) : v?.toDate?.();
    return d ? d.toLocaleDateString("en-GB") : "—";
  } catch {
    return "—";
  }
}

function docMark(student, key, label) {
  if (student[key]) return "✓";
  if ((student.documentsSubmitted || []).includes(label)) return "✓";
  return "—";
}

function AadhaarBox({ label, url }) {
  return (
    <div className="sp-doc-box">
      <p className="sp-doc-box-label">{label}</p>
      {url ? (
        <img src={url} alt={label} className="sp-doc-img" />
      ) : (
        <div className="sp-doc-img-placeholder">Not uploaded</div>
      )}
    </div>
  );
}

export default function StudentPrintPage({ student }) {
  if (!student) return null;

  return (
    <div className="sp-page">
      <header className="sp-header">
        <img src={schoolLogo} alt="" className="sp-logo" />
        <div className="sp-header-text">
          <h1>{SCHOOL.name}</h1>
          <p className="sp-subtitle">{SCHOOL.tagline}</p>
          <p className="sp-meta">
            Reg. No.: {SCHOOL.registrationNumber} &nbsp;|&nbsp;
            {SCHOOL.email} &nbsp;|&nbsp; {SCHOOL.contact}
          </p>
        </div>
        <img
          src={student.photoUrl || schoolLogo}
          alt=""
          className={`sp-photo ${student.photoUrl ? "" : "sp-photo-placeholder"}`}
        />
      </header>

      <div className="sp-title-bar">STUDENT INFORMATION</div>

      <section className="sp-section">
        <h2>Basic Details</h2>
        <table className="sp-table">
          <tbody>
            <tr>
              <th>Name</th><td>{student.name || "—"}</td>
              <th>Adm. No.</th><td>{student.admissionNumber || "—"}</td>
            </tr>
            <tr>
              <th>Class</th><td>{student.className || "—"}</td>
              <th>Section</th><td>{student.section || "—"}</td>
            </tr>
            <tr>
              <th>Roll No.</th><td>{student.rollNumber ?? "—"}</td>
              <th>Gender</th><td>{student.gender || "—"}</td>
            </tr>
            <tr>
              <th>Date of Birth</th><td>{formatDate(student.dateOfBirth)}</td>
              <th>Date of Admission</th><td>{formatDate(student.dateOfAdmission)}</td>
            </tr>
            <tr>
              <th>Blood Group</th><td>{student.bloodGroup || "—"}</td>
              <th>PEN No.</th><td>{student.penNumber || "—"}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="sp-section">
        <h2>Family Details</h2>
        <table className="sp-table">
          <tbody>
            <tr>
              <th>Father's Name</th><td>{student.fatherName || "—"}</td>
              <th>Mother's Name</th><td>{student.motherName || "—"}</td>
            </tr>
            <tr>
              <th>Father's Occupation</th><td>{student.fatherOccupation || "—"}</td>
              <th>Mother's Occupation</th><td>{student.motherOccupation || "—"}</td>
            </tr>
            <tr>
              <th>Father's Mobile</th><td>{student.fatherMobile || "—"}</td>
              <th>Mother's Mobile</th><td>{student.motherMobile || "—"}</td>
            </tr>
            <tr>
              <th>Guardian</th>
              <td colSpan={3}>{student.guardianName || "—"}</td>
            </tr>
            <tr>
              <th>Present Address</th>
              <td colSpan={3}>{student.addressPresent || "—"}</td>
            </tr>
            <tr>
              <th>Permanent Address</th>
              <td colSpan={3}>{student.addressPermanent || "—"}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="sp-section">
        <h2>Aadhaar &amp; Identity</h2>
        <table className="sp-table">
          <tbody>
            <tr>
              <th>Student's Aadhaar</th><td>{student.aadhaarStudent || "—"}</td>
              <th>Father's Aadhaar</th><td>{student.aadhaarFather || "—"}</td>
            </tr>
            <tr>
              <th>Mother's Aadhaar</th><td>{student.aadhaarMother || "—"}</td>
              <th>Nationality</th><td>{student.nationality || "—"}</td>
            </tr>
            <tr>
              <th>Category</th><td>{student.category || "—"}</td>
              <th>Religion</th><td>{student.religion || "—"}</td>
            </tr>
            <tr>
              <th>Last Institution</th>
              <td colSpan={3}>{student.lastInstitution || "—"}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="sp-section">
        <h2>Documents Submitted</h2>
        <table className="sp-table">
          <tbody>
            <tr>
              <th>Aadhaar — Student</th><td>{docMark(student, "docAadhaarStudent", "Aadhaar - Student")}</td>
              <th>Aadhaar — Father</th><td>{docMark(student, "docAadhaarFather", "Aadhaar - Father")}</td>
            </tr>
            <tr>
              <th>Aadhaar — Mother</th><td>{docMark(student, "docAadhaarMother", "Aadhaar - Mother")}</td>
              <th>Photo</th><td>{docMark(student, "docPhoto", "Photo")}</td>
            </tr>
            <tr>
              <th>Transfer Certificate</th><td>{docMark(student, "docTransferCertificate", "Transfer Certificate")}</td>
              <th>Birth Certificate</th><td>{docMark(student, "docBirthCertificate", "Birth Certificate")}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {(student.aadhaarStudentPhotoUrl ||
        student.aadhaarFatherPhotoUrl ||
        student.aadhaarMotherPhotoUrl) && (
        <section className="sp-section">
          <h2>Aadhaar Card Copies</h2>
          <div className="sp-docs-grid">
            <AadhaarBox label="Student" url={student.aadhaarStudentPhotoUrl} />
            <AadhaarBox label="Father"  url={student.aadhaarFatherPhotoUrl} />
            <AadhaarBox label="Mother"  url={student.aadhaarMotherPhotoUrl} />
          </div>
        </section>
      )}

      {student.remarks && (
        <section className="sp-section">
          <
