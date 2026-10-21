import React, { useState } from "react";
import { findStudentsByParentName } from "../firebase/reportsService";
import "../styles/feeManagement.css";

export default function RelatedStudentsLookup({ session, onSelectStudent, onBatchCollect }) {
  const [term, setTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function handleSearch(e) {
    e.preventDefault();
    const q = term.trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await findStudentsByParentName({ session, searchTerm: q });
      setResult(r);
    } catch (err) {
      console.error("findStudentsByParentName failed:", err);
      setError(err.message || "Search failed.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setTerm("");
    setResult(null);
    setError(null);
  }

  return (
    <div className="fm-card">
      <h2>Find Related Students (Siblings)</h2>
      <p className="fm-hint">
        Enter a student's name or a parent's name. The search groups siblings together by shared parent.
      </p>

      <form onSubmit={handleSearch} className="fm-search-row">
        <input
          type="text"
          placeholder="e.g. RANJAN, ANAND MISHRA, PRIYANKA"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={loading || !term.trim()}>
          {loading ? "Searching…" : "Search"}
        </button>
        {result && (
          <button type="button" onClick={reset} className="fm-secondary-btn">Clear</button>
        )}
      </form>

      {error && <p className="fm-error">{error}</p>}

      {result && (
        <>
          {result.direct.length === 0 ? (
            <p className="fm-empty-state">No students matched "{term}".</p>
          ) : (
            <>
              <h3 style={{ marginTop: 24, fontSize: "1em", color: "#64748b" }}>
                Direct matches ({result.direct.length})
              </h3>
              <div className="fm-table-scroll">
                <table className="fm-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Adm#</th>
                      <th>Class</th>
                      <th>Father</th>
                      <th>Mother</th>
                      <th>Mobile</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.direct.map((s) => (
                      <tr key={s.id}>
                        <td className="wrap-text" style={{ fontWeight: 600 }}>{s.name || "—"}</td>
                        <td>{s.admissionNumber || "—"}</td>
                        <td>{s.className || "—"}{s.section ? `-${s.section}` : ""}</td>
                        <td className="wrap-text">{s.fatherName || "—"}</td>
                        <td className="wrap-text">{s.motherName || "—"}</td>
                        <td>{s.mobileNumber || s.fatherMobile || "—"}</td>
                        <td>
                          {onSelectStudent && (
                            <button type="button" className="fm-btn-sm" onClick={() => onSelectStudent(s.id)}>
                              View
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {result.groups.length > 0 && (
            <>
              <h3 style={{ marginTop: 32, fontSize: "1em", color: "#64748b" }}>
                Grouped by family ({result.groups.length})
              </h3>

              {result.groups.map((g) => (
                <div key={`${g.relation}-${g.parentKey}`} style={{ marginTop: 16, border: "1px solid #e2e8f0", borderRadius: 8 }}>
                  <div style={{ padding: "12px 16px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong style={{ color: "#1e293b" }}>{g.parentName}</strong>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <span className="fm-subtle">{g.relation} · {g.students.length} students</span>
                      {onBatchCollect && g.students.length > 1 && (
                        <button type="button" className="fm-primary-btn" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => onBatchCollect(g.students.map((s) => s.id))}>
                          💰 Collect fees for all {g.students.length}
                        </button>
                      )}
                    </div>
                  </div>
                  <table className="fm-table" style={{ margin: 0 }}>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Adm#</th>
                        <th>Class</th>
                        <th>Roll</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.students.map((s) => (
                        <tr key={s.id}>
                          <td className="wrap-text" style={{ fontWeight: 600 }}>{s.name || "—"}</td>
                          <td>{s.admissionNumber || "—"}</td>
                          <td>{s.className || "—"}{s.section ? `-${s.section}` : ""}</td>
                          <td>{s.rollNumber ?? "—"}</td>
                          <td>
                            {onSelectStudent && (
                              <button type="button" className="fm-btn-sm" onClick={() => onSelectStudent(s.id)}>
                                View
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
