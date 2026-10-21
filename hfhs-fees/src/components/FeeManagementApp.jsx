import React, { useEffect, useState } from "react";
import { auth } from "../firebase/config";
import {
  getUserRoleOnce,
  getAcademicSessions,
  createAcademicSession,
} from "../firebase/feeService";

import FeeDashboard from "./FeeDashboard";
import StudentDirectory from "./StudentDirectory";
import FeeStructureConfig from "./FeeStructureConfig";
import FeeCollection from "./FeeCollection";
import BatchFeeCollection from "./BatchFeeCollection";
import PaymentHistory from "./PaymentHistory";
import DueManagement from "./DueManagement";
import DiscountManager from "./DiscountManager";
import Reports from "./Reports";
import AuditLogViewer from "./AuditLogViewer";
import Settings from "./Settings";
import StudentPortal from "./StudentPortal";
import ReceiptPrintSheet from "./ReceiptPrintSheet";
import RelatedStudentsLookup from "./RelatedStudentsLookup";
import AdvancesList from "./AdvancesList";
import AttendanceTracker from "./AttendanceTracker";
import ExamManager from "./ExamManager";
import schoolLogo from "../assets/school-logo.jpg";
import "../styles/feeManagement.css";

const NAV_SECTIONS = [
  { key: "dashboard", label: "Dashboard", roles: ["superAdmin", "admin", "accountant"] },
  { key: "students", label: "Students", roles: ["superAdmin", "admin", "accountant"] },
  { key: "collect", label: "Fee Collection", roles: ["superAdmin", "admin", "accountant"] },
  { key: "dues", label: "Dues & Advances", roles: ["superAdmin", "admin", "accountant"] },
  { key: "attendance", label: "Attendance", roles: ["superAdmin", "admin", "staff", "accountant"] },
  { key: "exams", label: "Exams & Marks", roles: ["superAdmin", "admin", "staff"] },
  { key: "reports", label: "Reports", roles: ["superAdmin", "admin", "accountant"] },
  { key: "settings", label: "Settings", roles: ["superAdmin"] },
];

async function withFirestoreRetry(fn, retries = 3, delayMs = 700) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isOffline =
        err?.code === "unavailable" ||
        err?.message?.includes("client is offline");
      if (!isOffline || attempt === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
}

function defaultSessionLabel() {
  const now = new Date();
  const startYear = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export default function FeeManagementApp({ onLogout }) {
  const [role, setRole] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [session, setSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [activeTab, setActiveTab] = useState("dashboard");
  
  const [collectTab, setCollectTab] = useState("single");
  const [duesTab, setDuesTab] = useState("due");
  const [settingsTab, setSettingsTab] = useState("sessions");

  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [lastReceipt, setLastReceipt] = useState(null);
  const [batchPreselected, setBatchPreselected] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newSessionLabel, setNewSessionLabel] = useState("");
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function initializeApp() {
      try {
        setLoading(true);
        setError(null);
        const user = auth.currentUser;
        if (!user) {
          if (!cancelled) setLoading(false);
          return;
        }

        const userDoc = await getUserRoleOnce(user.uid);
        const resolvedRole = userDoc?.role || "student";
        if (cancelled) return;

        setRole(resolvedRole);
        setPermissions(userDoc?.permissions || {});

        let sessionList = await withFirestoreRetry(() => getAcademicSessions());
        if (sessionList.length === 0 && resolvedRole === "superAdmin") {
          const firstSession = defaultSessionLabel();
          await createAcademicSession(firstSession);
          sessionList = await withFirestoreRetry(() => getAcademicSessions());
        }

        if (cancelled) return;

        setSessions(sessionList);
        const activeSession = sessionList.find((s) => s.isActive)?.label || sessionList[0]?.label || null;
        setSession(activeSession);
        setLoading(false);
      } catch (err) {
        console.error("Fee Management initialization failed:", err);
        if (cancelled) return;
        setError(err);
        setLoading(false);
      }
    }
    initializeApp();
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div style={{ padding: 40, maxWidth: 800, margin: "40px auto" }}>
        <div className="fm-card">
          <h2>Unable to load Fee Management</h2>
          <p>The application could not connect to the Firebase database.</p>
          <pre style={{ background: "#f5f5f5", padding: 16, borderRadius: 8, overflowX: "auto" }}>
            {error?.message || String(error)}
          </pre>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button className="fm-primary-btn" onClick={() => window.location.reload()}>Retry</button>
            {onLogout && <button className="fm-secondary-btn" onClick={onLogout}>Log Out</button>}
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: 60, textAlign: "center", color: "#64748b" }}>Loading Fee Management…</div>;
  }

  if (role === "student") {
    return (
      <div className="fm-app">
        <div className="fm-main-wrapper" style={{ padding: 24, overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
            <h1 style={{ fontSize: "1.5em", color: "#1e293b" }}>Holy Faith High School — Fee Portal</h1>
            {onLogout && <button className="fm-secondary-btn" onClick={onLogout}>Log Out</button>}
          </div>
          
          <div className="fm-content-inner">
            <StudentPortal />
          </div>
          
          <footer className="fm-footer" style={{ background: "transparent", borderTop: "none", marginTop: 40 }}>
            All rights reserved © Holy Faith High School
          </footer>
        </div>
      </div>
    );
  }

  const visibleTabs = NAV_SECTIONS.filter((s) => s.roles.includes(role));
  const currentMonth = new Date().toISOString().slice(0, 7);

  async function handleCreateSession() {
    try {
      const label = newSessionLabel.trim();
      if (!label) return;
      await createAcademicSession(label);
      const updatedSessions = await getAcademicSessions();
      setSessions(updatedSessions);
      setNewSessionLabel("");
    } catch (err) {
      alert(`Unable to create academic session.\n\n${err?.message || err}`);
    }
  }

  return (
    <div className="fm-app">
      
      <aside className={`fm-sidebar ${isSidebarOpen ? "" : "closed"}`}>
        <div className="fm-sidebar-header">
          <img src={schoolLogo} alt="Logo" className="fm-sidebar-logo" />
          <h1 className="fm-sidebar-title">Fee Management</h1>
        </div>

        <nav className="fm-sidebar-nav">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              className={`fm-nav-btn ${activeTab === t.key ? "fm-nav-btn-active" : ""}`}
              onClick={() => {
                setActiveTab(t.key);
                if (t.key !== "collect") setSelectedStudentId(null);
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="fm-sidebar-footer">
          <div className="fm-sidebar-session">
            <span>Session</span>
            <select value={session || ""} onChange={(e) => setSession(e.target.value)}>
              {sessions.map((s) => (
                <option key={s.label} value={s.label}>{s.label}</option>
              ))}
            </select>
          </div>
          {onLogout && (
            <button className="fm-logout-btn" onClick={onLogout}>
              Log Out
            </button>
          )}
        </div>
      </aside>

      <div className="fm-main-wrapper">
        <header className="fm-top-header">
          <button 
            className="fm-sidebar-toggle" 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            title={isSidebarOpen ? "Close Sidebar" : "Open Sidebar"}
          >
            ☰
          </button>
          <h2 style={{ margin: 0, fontSize: "1.1em", color: "#1e293b", fontWeight: 600 }}>
            {visibleTabs.find(t => t.key === activeTab)?.label || "Dashboard"}
          </h2>
        </header>

        <main className="fm-main">
          <div className="fm-content-inner">
            
            {activeTab === "dashboard" && <FeeDashboard session={session} />}

            {activeTab === "students" && (
              <StudentDirectory
                session={session}
                role={role}
                onSelectStudent={(id) => {
                  setSelectedStudentId(id);
                  setCollectTab("single");
                  setActiveTab("collect");
                }}
              />
            )}

            {activeTab === "collect" && (
              <div>
                <div className="fm-subtabs">
                  <button 
                    className={`fm-subtab-btn ${collectTab === "single" ? "active" : ""}`}
                    onClick={() => setCollectTab("single")}
                  >
                    Single Student
                  </button>
                  <button 
                    className={`fm-subtab-btn ${collectTab === "batch" ? "active" : ""}`}
                    onClick={() => setCollectTab("batch")}
                  >
                    Batch Collection (Siblings)
                  </button>
                </div>

                {collectTab === "single" && (
                  <FeeCollection
                    session={session}
                    month={currentMonth}
                    role={role}
                    initialStudentId={selectedStudentId}
                    onReceiptGenerated={(receipt) => setLastReceipt(receipt)}
                  />
                )}
                {collectTab === "batch" && (
                  <BatchFeeCollection
                    session={session}
                    month={currentMonth}
                    preselectedIds={batchPreselected}
                    onDone={() => setBatchPreselected([])}
                  />
                )}

                {collectTab === "single" && lastReceipt && (
                  <div style={{ marginTop: 20 }}>
                    <h3 style={{ padding: "0 8px", color: "#166534" }}>
                      Payment recorded successfully — Receipt No.: {lastReceipt.receiptNumber}
                    </h3>
                    <ReceiptPrintSheet receipts={[lastReceipt]} />
                  </div>
                )}
              </div>
            )}

            {activeTab === "dues" && (
              <div>
                <div className="fm-subtabs">
                  <button 
                    className={`fm-subtab-btn ${duesTab === "due" ? "active" : ""}`}
                    onClick={() => setDuesTab("due")}
                  >
                    Outstanding Dues
                  </button>
                  <button 
                    className={`fm-subtab-btn ${duesTab === "advance" ? "active" : ""}`}
                    onClick={() => setDuesTab("advance")}
                  >
                    Advances (Credit)
                  </button>
                </div>

                {duesTab === "due" && <DueManagement session={session} />}
                {duesTab === "advance" && <AdvancesList session={session} />}
              </div>
            )}

            {activeTab === "attendance" && <AttendanceTracker session={session} />}
            {activeTab === "exams" && <ExamManager session={session} />}

            {activeTab === "reports" && (
              <div>
                <Reports session={session} />
              </div>
            )}

            {activeTab === "settings" && (
              <div>
                <div className="fm-subtabs">
                  <button 
                    className={`fm-subtab-btn ${settingsTab === "sessions" ? "active" : ""}`}
                    onClick={() => setSettingsTab("sessions")}
                  >
                    Sessions & Audit
                  </button>
                  <button 
                    className={`fm-subtab-btn ${settingsTab === "structure" ? "active" : ""}`}
                    onClick={() => setSettingsTab("structure")}
                  >
                    Fee Structure
                  </button>
                </div>

                {settingsTab === "sessions" && (
                  <div>
                    <Settings session={session} />

                    <div className="fm-card" style={{ marginTop: 20 }}>
                      <h2>Academic Sessions</h2>
                      <div className="fm-search-row">
                        <input
                          placeholder="e.g. 2027-28"
                          value={newSessionLabel}
                          onChange={(e) => setNewSessionLabel(e.target.value)}
                        />
                        <button className="fm-primary-btn" onClick={handleCreateSession}>
                          Create Session
                        </button>
                      </div>
                      <ul className="fm-result-list" style={{ paddingLeft: 0, listStyle: "none" }}>
                        {sessions.map((s) => (
                          <li key={s.label} style={{ padding: "8px 0", borderBottom: "1px solid #eee" }}>
                            {s.label} {s.isActive ? <span style={{color: "#16a34a", fontWeight: 600}}>(active)</span> : ""}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div style={{ marginTop: 20 }}>
                      <AuditLogViewer />
                    </div>
                  </div>
                )}
                {settingsTab === "structure" && <FeeStructureConfig session={session} />}
              </div>
            )}

          </div>
          
          <footer className="fm-footer">
            All rights reserved © Holy Faith High School
          </footer>
        </main>
      </div>
    </div>
  );
}
