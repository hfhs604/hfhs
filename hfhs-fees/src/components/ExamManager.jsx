import React, { useEffect, useState } from "react";
import { getAllStudents } from "../firebase/reportsService";
import { getExams, createExam, getExamMarks, saveStudentMarks } from "../firebase/feeService";
import "../styles/feeManagement.css";

const CLASS_OPTIONS = ["Pre-LKG", "NUR", "LKG", "UKG", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export default function ExamManager({ session }) {
  const [exams, setExams] = useState([]);
  const [selectedExam, setSelectedExam] = useState(null);
  const [students, setStudents] = useState([]);
  const [marks, setMarks] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [showCreate, setShowCreate] = useState(false);
  const [newExamName, setNewExamName] = useState("");
  const [newExamClass, setNewExamClass] = useState("I");

  useEffect(() => {
    loadExams();
  }, [session]);

  async function loadExams() {
    setLoading(true);
    const list = await getExams(session);
    setExams(list);
    if (list.length > 0 && !selectedExam) selectExam(list[0]);
    else setLoading(false);
  }

  async function selectExam(exam) {
    setSelectedExam(exam);
    setLoading(true);
    try {
      const list = await getAllStudents({ session, className: exam.className });
      setStudents(list);
      const fetchedMarks = await getExamMarks(exam.id);
      setMarks(fetchedMarks);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateExam(e) {
    e.preventDefault();
    if (!newExamName) return;
    await createExam({ session, name: newExamName, className: newExamClass });
    setNewExamName("");
    setShowCreate(false);
    await loadExams();
  }

  function handleMarkChange(studentId, subject, value) {
    setMarks(prev => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || {}),
        [subject]: value
      }
    }));
  }

  async function saveMarksForStudent(studentId) {
    setSaving(studentId);
    try {
      await saveStudentMarks({
        examId: selectedExam.id, studentId, session, marks: marks[studentId] || {}
      });
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="fm-card">
      <div className="fm-row-header">
        <h2>Exams & Marks</h2>
        <button className="fm-primary-btn" onClick={() => setShowCreate(!showCreate)}>+ Create Exam</button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreateExam} className="fm-payment-form" style={{ marginBottom: 24, padding: 16, background: "#f8fafc", borderRadius: 8 }}>
          <label>Exam Name (e.g. Half Yearly)<input required value={newExamName} onChange={e => setNewExamName(e.target.value)} /></label>
          <label>Class<select value={newExamClass} onChange={e => setNewExamClass(e.target.value)}>{CLASS_OPTIONS.map(c => <option key={c}>{c}</option>)}</select></label>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button type="submit" className="fm-primary-btn">Create</button>
          </div>
        </form>
      )}

      <div className="fm-filter-row">
        <label className="fm-inline-label">
          Select Exam
          <select value={selectedExam?.id || ""} onChange={e => selectExam(exams.find(x => x.id === e.target.value))}>
            {exams.map(ex => <option key={ex.id} value={ex.id}>{ex.name} - Class {ex.className}</option>)}
          </select>
        </label>
      </div>

      {selectedExam && (
        <>
          <h3 style={{ marginTop: 24, marginBottom: 12 }}>Enter Marks for {selectedExam.name} (Class {selectedExam.className})</h3>
          <p className="fm-hint">Enter marks out of 100. The system will automatically calculate the percentage.</p>
          
          {loading ? <p>Loading students…</p> : (
            <div className="fm-table-scroll">
              <table className="fm-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    {selectedExam.subjects.map(sub => <th key={sub}>{sub}</th>)}
                    <th>Total / %</th>
                    <th>Save</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map(s => {
                    const studentMarks = marks[s.id] || {};
                    const total = Object.values(studentMarks).reduce((a, b) => a + (Number(b) || 0), 0);
                    const maxTotal = selectedExam.subjects.length * 100;
                    const percentage = maxTotal > 0 ? ((total / maxTotal) * 100).toFixed(1) : "0.0";

                    return (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 600 }}>{s.name}</td>
                        {selectedExam.subjects.map(sub => (
                          <td key={sub}>
                            <input 
                              type="number" min="0" max="100" 
                              value={studentMarks[sub] || ""} 
                              onChange={e => handleMarkChange(s.id, sub, e.target.value)}
                              style={{ width: 60, padding: 6, border: "1px solid #cbd5e1", borderRadius: 4 }}
                            />
                          </td>
                        ))}
                        <td style={{ fontWeight: 700 }}>{total} ({percentage}%)</td>
                        <td>
                          <button 
                            className="fm-btn-sm" 
                            onClick={() => saveMarksForStudent(s.id)}
                            disabled={saving === s.id}
                          >
                            {saving === s.id ? "…" : "Save"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
