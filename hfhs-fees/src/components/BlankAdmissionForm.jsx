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

const cell = (label, span = 1, height = 30) =>
  `<tr><th>${label}</th><td colspan="${span}" style="height:${height}px"></td></tr>`;

const twoCell = (l1, l2, h = 30) =>
  `<tr><th>${l1}</th><td style="height:${h}px"></td><th>${l2}</th><td style="height:${h}px"></td></tr>`;

export default function BlankAdmissionForm({ suggestedAdmissionNumber }) {
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
        <div className="sp-photo sp-photo-box-blank">
          <span>Paste<br/>Photo</span>
        </div>
      </header>

      <div className="sp-title-bar">ADMISSION FORM</div>

      <p className="fm-form-section-hint" style={{ marginBottom: 16 }}>
        <strong>Admission No.:</strong> {suggestedAdmissionNumber || "__________"}
        &nbsp;&nbsp;&nbsp;
        <strong>Date:</strong> ____ / ____ / ________
      </p>

      <section className="sp-section">
        <h2>Basic Details</h2>
        <table className="sp-table">
          <tbody>
            <tr>
              <th>Student Name</th><td style={{ height: 30 }}></td>
              <th>Date of Birth</th><td style={{ height: 30 }}></td>
            </tr>
            <tr>
              <th>Class Applied For</th><td style={{ height: 30 }}></td>
              <th>Gender</th><td style={{ height: 30 }}></td>
            </tr>
            <tr>
              <th>Blood Group</th><td style={{ height: 30 }}></td>
              <th>PEN No. (if any)</th><td style={{ height: 30 }}></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="sp-section">
        <h2>Family Details</h2>
        <table className="sp-table">
          <tbody>
            <tr>
              <th>Father's Name</th><td style={{ height: 30 }}></td>
              <th>Mother's Name</th><td style={{ height: 30 }}></td>
            </tr>
            <tr>
              <th>Father's Occupation</th><td style={{ height: 30 }}></td>
              <th>Mother's Occupation</th><td style={{ height: 30 }}></td>
            </tr>
            <tr>
              <th>Father's Mobile</th><td style={{ height: 30 }}></td>
              <th>Mother's Mobile</th><td style={{ height: 30 }}></td>
            </tr>
            <tr>
              <th>Guardian (if different)</th>
              <td colSpan={3} style={{ height: 30 }}></td>
            </tr>
            <tr>
              <th>Present Address</th>
              <td colSpan={3} style={{ height: 50 }}></td>
            </tr>
            <tr>
              <th>Permanent Address</th>
              <td colSpan={3} style={{ height: 50 }}></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="sp-section">
        <h2>Aadhaar &amp; Identity</h2>
        <table className="sp-table">
          <tbody>
            <tr>
              <th>Student's Aadhaar</th><td style={{ height: 30 }}></td>
              <th>Father's Aadhaar</th><td style={{ height: 30 }}></td>
            </tr>
            <tr>
              <th>Mother's Aadhaar</th><td style={{ height: 30 }}></td>
              <th>Nationality</th><td style={{ height: 30 }}></td>
            </tr>
            <tr>
              <th>Category</th><td style={{ height: 30 }}></td>
              <th>Religion</th><td style={{ height: 30 }}></td>
            </tr>
            <tr>
              <th>Last Institution Attended</th>
              <td colSpan={3} style={{ height: 30 }}></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="sp-section">
        <h2>Documents Submitted</h2>
        <div style={{ fontSize: 11, marginTop: 6 }}>
          <div style={{ display: "flex", gap: 20, marginBottom: 6 }}>
            <span>☐ Aadhaar — Student</span>
            <span>☐ Aadhaar — Father</span>
          </div>
          <div style={{ display: "flex", gap: 20, marginBottom: 6 }}>
            <span>☐ Aadhaar — Mother</span>
            <span>☐ Photo</span>
          </div>
          <div style={{ display: "flex", gap: 20 }}>
            <span>☐ Transfer Certificate</span>
            <span>☐ Birth Certificate</span>
          </div>
        </div>
      </section>

      <section className="sp-section">
        <h2>Additional Notes</h2>
        <div style={{ border: "1px solid #cbd5e1", height: 80, borderRadius: 4 }}></div>
      </section>

      <footer className="sp-footer">
        <div className="sp-signature">
          <div className="sp-sign-line"></div>
          <p>Parent / Guardian Signature</p>
        </div>
        <div className="sp-signature">
          <div className="sp-sign-line"></div>
          <p>Principal / Authorised Signature</p>
        </div>
      </footer>

      <p className="sp-footer-note">This is a blank admission form.</p>
    </div>
  );
}
