import React, { useState } from "react";
import { findStudentsByParentName } from "../firebase/reportsService";
import "../styles/feeManagement.css";

export default function RelatedStudentsLookup({
  session,
  onSelectStudent,
  onBatchCollect,
}) {
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
      <h2>Find Related Students</h2>
      <p className="fm-hint">
        Enter a student's name, a parent's name, or part of either. The search
        finds every student in this session whose name, father, mother, or
        guardian matches — and then groups them by shared parent so siblings
        appear together.
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
          <button type="button" onClick={reset} className="fm-secondary-btn">
            Clear
          </button>
        )}
      </form>

      {error && <p className="fm-error">{error}</p>}

      {result && (
        <>
          {result.direct.length === 0 ? (
            <p className="fm-empty-state">
              No students matched "{term}" in session {session}.
            </p>
          ) : (
            <>
              <h3 style={{ marginTop: 18 }}>
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
                      <th>Guardian</th>
                      <th>Mobile</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.direct.map((s) => (
                      <tr key={s.id}>
                        <td>{s.name || "—"}</td>
                        <td>{s.admissionNumber || "—"}</td>
                        <td>
                          {s.className || "—"}
                          {s.section ? `-${s.section}` : ""}
                        </td>
                        <td>{s.fatherName || "—"}</td>
                        <td>{s.motherName || "—"}</td>
                        <td>{s.guardianName || "—"}</td>
                        <td>{s.mobileNumber || s.fatherMobile || "—"}</td>
                        <td>
                          {onSelectStudent && (
                            <button
                              type="button"
                              className="fm-link-btn"
                              onClick={() => onSelectStudent(s.id)}
                            >
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
              <h3 style={{ marginTop: 24 }}>
                Grouped by shared parent ({result.groups.length}{" "}
                {result.groups.length === 1 ? "family" : "families"})
              </h3>

              {result.groups.map((g) => (
                <div
                  key={`${g.relation}-${g.parentKey}`}
                  className="fm-card"
                  style={{ marginTop: 12, background: "#f9fafb" }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                      marginBottom: 8,
                    }}
                  >
                    <strong style={{ color: "#1a3d6d" }}>
                      {g.parentName}
                    </strong>
                    <span className="fm-subtle">
                      {g.relation} · {g.students.length}{" "}
                      {g.students.length === 1 ? "student" : "students"}
                    </span>
                    {onBatchCollect && g.students.length > 1 && (
                      <button
                        type="button"
                        className="fm-primary-btn"
                        onClick={() =>
                          onBatchCollect(g.students.map((s) => s.id))
                        }
                      >
                        💰 Collect fees for all {g.students.length}
                      </button>
                    )}
                  </div>

                  <div className="fm-table-scroll">
                    <table className="fm-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Adm#</th>
                          <th>Class</th>
                          <th>Roll</th>
                          <th>Mobile</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.students.map((s) => (
                          <tr key={s.id}>
                            <td>{s.name || "—"}</td>
                            <td>{s.admissionNumber || "—"}</td>
                            <td>
                              {s.className || "—"}
                              {s.section ? `-${s.section}` : ""}
                            </td>
                            <td>{s.rollNumber ?? "—"}</td>
                            <td>{s.mobileNumber || s.fatherMobile || "—"}</td>
                            <td>
                              {onSelectStudent && (
                                <button
                                  type="button"
                                  className="fm-link-btn"
                                  onClick={() => onSelectStudent(s.id)}
                                >
                                  View
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
