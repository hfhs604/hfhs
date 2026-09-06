import React, { useEffect, useState } from "react";
import { auth } from "../firebase/config";
import { getUserRole, getAcademicSessions, createAcademicSession } from "../firebase/feeService";

import FeeDashboard from "./FeeDashboard";
import StudentDirectory from "./StudentDirectory";
import FeeStructureConfig from "./FeeStructureConfig";
import FeeCollection from "./FeeCollection";
import PaymentHistory from "./PaymentHistory";
import DueManagement from "./DueManagement";
import DiscountManager from "./DiscountManager";
import Reports from "./Reports";
import AuditLogViewer from "./AuditLogViewer";
import StudentPortal from "./StudentPortal";
import ReceiptPrintSheet from "./ReceiptPrintSheet";
import schoolLogo from "../assets/school-logo.jpg";
import "../styles/feeManagement.css";

/**
 * Mount this at whatever route your existing site uses for the admin panel,
 * e.g. <Route path="/admin/fees/*" element={<FeeManagementApp />} />.
 * It does not touch any of your existing routes/components.
 */
const NAV_SECTIONS = [
  { key: "dashboard", label: "Dashboard", roles: ["superAdmin", "admin", "accountant"] },
  { key: "students", label: "Students", roles: ["superAdmin", "admin"] },
  { key: "structure", label: "Fee Structure", roles: ["superAdmin", "admin"] },
  { key: "collect", label: "Collect Fee", roles: ["superAdmin", "admin", "accountant"] },
  { key: "transactions", label: "Transactions", roles: ["superAdmin", "admin", "accountant"] },
  { key: "due", label: "Due Fees", roles: ["superAdmin", "admin", "accountant"] },
  { key: "advances", label: "Advances", roles: ["superAdmin", "admin"] },
  { key: "discounts", label: "Discounts", roles: ["superAdmin", "admin"] },
  { key: "reports", label: "Reports", roles: ["superAdmin", "admin", "accountant"] },
  { key: "settings", label: "Settings", roles: ["superAdmin"] },
];

function defaultSessionLabel() {
  const now = new Date();
  // April-start Indian academic year convention: Jan-Mar counts as the tail
  // of the previous year's session.
  const startYear = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export default function FeeManagementApp({ onLogout }) {
  const [role, setRole] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [session, setSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [lastReceipt, setLastReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newSessionLabel, setNewSessionLabel] = useState("");

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) { setLoading(false); return; }
      const userDoc = await getUserRole(user.uid);
      const resolvedRole = userDoc?.role || "student";
      setRole(resolvedRole);
      setPermissions(userDoc?.permissions || {});

      // Brand-new Firebase project: no academicSessions doc exists yet.
      // Only a Super Admin is allowed to create one (matches firestore.rules),
      // which is fine since the very first login is always the Super Admin
      // account created during setup (see README step 2).
      let sessionList = await getAcademicSessions();
      if (sessionList.length === 0 && resolvedRole === "superAdmin") {
        await createAcademicSession(defaultSessionLabel());
        sessionList = await getAcademicSessions();
      }
      setSessions(sessionList);
      setSession(sessionList.find((s) => s.isActive)?.label || sessionList[0]?.label);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="fm-empty-state">Loading Fee Management…</div>;

  // Student/parent accounts only ever see their own portal — never the
  // admin nav, regardless of what tab state might otherwise be set to.
  if (role === "student") {
    return (
      <div className="fm-app">
        <div className="fm-app-header">
          <h1 className="fm-app-title">Holy Faith High School — Fee Portal</h1>
          {onLogout && <button className="fm-nav-btn" onClick={onLogout}>Log Out</button>}
        </div>
        <StudentPortal />
      </div>
    );
  }

  const visibleTabs = NAV_SECTIONS.filter((s) => s.roles.includes(role));

  async function handleCreateSession() {
    if (!newSessionLabel.trim()) return;
    await createAcademicSession(newSessionLabel.trim());
    setSessions(await getAcademicSessions());
    setNewSessionLabel("");
  }

  return (
    <div className="fm-app">
      <div className="fm-app-header">
        <div className="fm-app-brand">
          <img src={schoolLogo} alt="Holy Faith High School" className="fm-app-logo" />
          <h1 className="fm-app-title">Fee Management</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <label className="fm-session-select">
            Session
            <select value={session} onChange={(e) => setSession(e.target.value)}>
              {sessions.map((s) => <option key={s.label} value={s.label}>{s.label}</option>)}
            </select>
          </label>
          {onLogout && <button className="fm-nav-btn" onClick={onLogout}>Log Out</button>}
        </div>
      </div>

      <nav className="fm-nav">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            className={`fm-nav-btn ${activeTab === t.key ? "fm-nav-btn-active" : ""}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="fm-main">
        {activeTab === "dashboard" && <FeeDashboard session={session} />}

        {activeTab === "students" && (
          <StudentDirectory
            session={session}
            onSelectStudent={(id) => { setSelectedStudentId(id); setActiveTab("transactions"); }}
          />
        )}

        {activeTab === "structure" && <FeeStructureConfig session={session} />}

        {activeTab === "collect" && (
          <FeeCollection
            session={session}
            onReceiptGenerated={(receipt, duplicateBlocked) => {
              setLastReceipt(receipt);
              if (duplicateBlocked) {
                // Same click fired twice — surfaced so staff know why only
                // one receipt exists, not silently swallowed.
                console.warn("Duplicate payment submission blocked; original receipt reused.");
              }
            }}
          />
        )}

        {activeTab === "collect" && lastReceipt && (
          <div style={{ marginTop: 20 }}>
            <h3 style={{ padding: "0 8px" }}>Payment recorded successfully ✓ — Receipt No.: {lastReceipt.receiptNumber}</h3>
            <ReceiptPrintSheet receipts={[lastReceipt]} />
          </div>
        )}

        {activeTab === "transactions" && (
          <div className="fm-card">
            <h2>Transactions</h2>
            <p className="fm-hint">Select a student from Students or Collect Fee to view their full transaction/payment history.</p>
            {selectedStudentId && <PaymentHistory studentId={selectedStudentId} />}
          </div>
        )}

        {activeTab === "due" && <DueManagement session={session} />}

        {activeTab === "advances" && (
          <div className="fm-card">
            <h2>Advances</h2>
            <p className="fm-hint">
              Students carrying an advance balance are flagged 🟢 across the Students, Due Fees, and Reports
              screens. Advance auto-applies the next time a fee is generated for that student
              (see <code>applyAdvanceToNewFee</code> in feeService.js), with a full audit trail of the adjustment.
            </p>
          </div>
        )}

        {activeTab === "discounts" && <DiscountManager canManageDiscounts={role === "superAdmin" || !!permissions.manageDiscounts} />}

        {activeTab === "reports" && <Reports session={session} />}

        {activeTab === "settings" && (
          <div className="fm-card">
            <h2>Settings — Academic Sessions</h2>
            <div className="fm-search-row">
              <input placeholder="e.g. 2027-28" value={newSessionLabel} onChange={(e) => setNewSessionLabel(e.target.value)} />
              <button className="fm-primary-btn" onClick={handleCreateSession}>Create Session</button>
            </div>
            <ul className="fm-result-list">
              {sessions.map((s) => <li key={s.label}>{s.label} {s.isActive ? "(active)" : ""}</li>)}
            </ul>
            <hr />
            <AuditLogViewer />
          </div>
        )}
      </main>
    </div>
  );
}
