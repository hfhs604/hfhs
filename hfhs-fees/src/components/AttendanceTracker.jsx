import React, { useEffect, useState } from "react";
import { getAllStudents } from "../firebase/reportsService";
import { getAttendance, saveAttendance } from "../firebase/feeService";
import { auth } from "../firebase/config";
import "../styles/feeManagement.css";

const CLASS_OPTIONS = ["Pre-LKG", "NUR", "LKG", "UKG", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export default function AttendanceTracker({ session }) {
  const [className, setClassName] = useState("I");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [students, setStudents] = useState([]);
  const [attendance, setAttendance] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMsg("");
    
    (async () => {
      try {
        const list = await getAllStudents({ session, className });
        if (!active) return;
        setStudents(list);

        const existing = await getAttendance(session, className, date);
        if (!active) return;

        const initialRecords = {};
        list.forEach(s => {
          initialRecords[s.id] = existing?.records?.[s.id] || "Present";
        });
        setAttendance(initialRecords);
      } catch (e) {
        if (active) setMsg("Error loading attendance.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [session, className, date]);

  function toggleStatus(studentId, status) {
    setAttendance(prev => ({ ...prev, [studentId]: status }));
  }

  async function handleSave() {
    setSaving(true); setMsg("");
    try {
      await saveAttendance({
        session, className, date, records: attendance, userEmail: auth.currentUser?.email
      });
      setMsg("✅ Attendance saved successfully.");
      setTimeout(() => setMsg(""), 3000);
    } catch (e) {
      setMsg("❌ Failed to save attendance.");
    } finally {
      setSaving(false);
    }
  }

  const presentCount = Object.values(attendance).filter(s => s === "Present").length;
  const absentCount = Object.values(attendance).filter(s => s === "Absent").length;

  return (
    <div className="fm-card">
      <div className="fm-row-header">
        <h2>Attendance Tracker</h2>
      </div>

      <div className="fm-filter-row">
        <label className="fm-inline-label">
          Class
          <select value={className} onChange={(e) => setClassName(e.target.value)}>
            {CLASS_OPTIONS.map(c => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="fm-inline-label">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="fm-inline-label" style={{ marginLeft: "auto" }}>
          <span>Present: <strong style={{ color: "var(--success-green)" }}>{presentCount}</strong></span>
          <span>Absent: <strong style={{ color: "var(--danger-red)" }}>{absentCount}</strong></span>
        </div>
        <button className="fm-primary-btn" onClick={handleSave} disabled={saving || loading || students.length === 0}>
          {saving ? "Saving…" : "Save Attendance"}
        </button>
      </div>

      {msg && <p className="fm-success" style={{ marginBottom: 16 }}>{msg}</p>}

      {loading ? (
        <p className="fm-empty-state">Loading students…</p>
      ) : students.length === 0 ? (
        <p className="fm-empty-state">No students found in {className}.</p>
      ) : (
        <div className="fm-compact-grid-container">
          <div className="fm-compact-grid-header" style={{ gridTemplateColumns: "3fr 1fr 1fr 150px" }}>
            <div>Student Name</div>
            <div>Roll</div>
            <div>Adm#</div>
            <div className="fm-cell-right">Status</div>
          </div>
          {students.map(s => {
            const status = attendance[s.id] || "Present";
            return (
              <div key={s.id} className="fm-compact-grid-row" style={{ gridTemplateColumns: "3fr 1fr 1fr 150px" }}>
                <div className="fm-cell-truncate" style={{ fontWeight: 600 }}>{s.name}</div>
                <div className="fm-cell-truncate">{s.rollNumber ?? "—"}</div>
                <div className="fm-cell-truncate">{s.admissionNumber}</div>
                <div className="fm-compact-actions">
                  <button 
                    className={`fm-btn-sm ${status === "Present" ? "fm-primary-btn" : ""}`} 
                    onClick={() => toggleStatus(s.id, "Present")}
                  >Present</button>
                  <button 
                    className={`fm-btn-sm ${status === "Absent" ? "fm-btn-danger" : ""}`} 
                    onClick={() => toggleStatus(s.id, "Absent")}
                  >Absent</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
