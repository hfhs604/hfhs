import React, { useEffect, useState } from "react";
import { createStudent, searchStudents } from "../firebase/feeService";
import { getAllStudents } from "../firebase/reportsService";
import "../styles/feeManagement.css";

const FEE_CATEGORIES = ["Regular", "RTE/Concession", "Staff Ward", "Sibling Discount", "Scholarship"];

export default function StudentDirectory({ session, onSelectStudent }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const emptyForm = {
    admissionNumber: "", name: "", className: "", section: "",
    fatherName: "", motherName: "", guardianName: "", mobileNumber: "",
    feeCategory: "Regular", totalAnnualFee: "",
  };
  const [form, setForm] = useState(emptyForm);

  async function loadStudents() {
    setLoading(true);
    const list = await getAllStudents({ session });
    setStudents(list);
    setLoading(false);
  }

  useEffect(() => { loadStudents(); }, [session]);

  async function handleSearch(e) {
    e.preventDefault();
    if (!searchTerm.trim()) return loadStudents();
    setLoading(true);
    setStudents(await searchStudents(searchTerm.trim()));
    setLoading(false);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await createStudent({ ...form, totalAnnualFee: Number(form.totalAnnualFee), session });
      setForm(emptyForm);
      setShowForm(false);
      await loadStudents();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fm-card">
      <div className="fm-row-header">
        <h2>Students</h2>
        <button className="fm-primary-btn" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "+ Add Student"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="fm-payment-form" style={{ marginBottom: 20 }}>
          <label>Admission Number
            <input required value={form.admissionNumber} onChange={(e) => setForm({ ...form, admissionNumber: e.target.value })} />
          </label>
          <label>Student Name
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>Class
            <input required value={form.className} onChange={(e) => setForm({ ...form, className: e.target.value })} />
          </label>
          <label>Section
            <input required value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} />
          </label>
          <label>Father's Name
            <input value={form.fatherName} onChange={(e) => setForm({ ...form, fatherName: e.target.value })} />
          </label>
          <label>Mother's Name
            <input value={form.motherName} onChange={(e) => setForm({ ...form, motherName: e.target.value })} />
          </label>
          <label>Guardian Name
            <input value={form.guardianName} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} />
          </label>
          <label>Mobile Number
            <input required value={form.mobileNumber} onChange={(e) => setForm({ ...form, mobileNumber: e.target.value })} />
          </label>
          <label>Fee Category
            <select value={form.feeCategory} onChange={(e) => setForm({ ...form, feeCategory: e.target.value })}>
              {FEE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label>Total Annual Fee (₹)
            <input required type="number" min="0" value={form.totalAnnualFee}
              onChange={(e) => setForm({ ...form, totalAnnualFee: e.target.value })} />
          </label>
          <button type="submit" disabled={saving} className="fm-primary-btn fm-full-width">
            {saving ? "Saving…" : "Create Student Fee Profile"}
          </button>
        </form>
      )}

      <form onSubmit={handleSearch} className="fm-search-row">
        <input placeholder="Search name / admission no. / mobile" value={searchTerm}
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
            <tr><th>Name</th><th>Adm#</th><th>Class</th><th>Guardian</th><th>Mobile</th><th>Status</th></tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id} onClick={() => onSelectStudent?.(s.id)} style={onSelectStudent ? { cursor: "pointer" } : undefined}>
                <td>{s.name}</td><td>{s.admissionNumber}</td><td>{s.className}-{s.section}</td>
                <td>{s.guardianName || s.fatherName}</td><td>{s.mobileNumber}</td>
                <td><span className={`fm-badge fm-badge-${s.accountStatus.toLowerCase()}`}>{s.accountStatus}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
