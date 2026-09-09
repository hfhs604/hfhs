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
import PaymentHistory from "./PaymentHistory";
import DueManagement from "./DueManagement";
import DiscountManager from "./DiscountManager";
import Reports from "./Reports";
import AuditLogViewer from "./AuditLogViewer";
import StudentPortal from "./StudentPortal";
import ReceiptPrintSheet from "./ReceiptPrintSheet";
import schoolLogo from "../assets/school-logo.jpg";
import "../styles/feeManagement.css";

const NAV_SECTIONS = [
  {
    key: "dashboard",
    label: "Dashboard",
    roles: ["superAdmin", "admin", "accountant"],
  },
  {
    key: "students",
    label: "Students",
    roles: ["superAdmin", "admin"],
  },
  {
    key: "structure",
    label: "Fee Structure",
    roles: ["superAdmin", "admin"],
  },
  {
    key: "collect",
    label: "Collect Fee",
    roles: ["superAdmin", "admin", "accountant"],
  },
  {
    key: "transactions",
    label: "Transactions",
    roles: ["superAdmin", "admin", "accountant"],
  },
  {
    key: "due",
    label: "Due Fees",
    roles: ["superAdmin", "admin", "accountant"],
  },
  {
    key: "advances",
    label: "Advances",
    roles: ["superAdmin", "admin"],
  },
  {
    key: "discounts",
    label: "Discounts",
    roles: ["superAdmin", "admin"],
  },
  {
    key: "reports",
    label: "Reports",
    roles: ["superAdmin", "admin", "accountant"],
  },
  {
    key: "settings",
    label: "Settings",
    roles: ["superAdmin"],
  },
];

/**
 * Retries a Firestore read a few times with a short backoff when it fails
 * with a transient "client is offline" error. This happens most often on
 * a fresh page load, right as the Firestore SDK is still finishing its
 * connection/transport setup — the read itself is fine, it just needs to
 * be tried again a moment later instead of surfacing as a hard failure.
 */
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

  const startYear =
    now.getMonth() < 3
      ? now.getFullYear() - 1
      : now.getFullYear();

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
  const [error, setError] = useState(null);

  const [newSessionLabel, setNewSessionLabel] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function initializeApp() {
      try {
        setLoading(true);
        setError(null);

        const user = auth.currentUser;

        console.log("Fee Management initialization started");
        console.log("Firebase user:", user?.email);
        console.log("Firebase UID:", user?.uid);
        console.log(
          "Firebase project:",
          auth.app.options.projectId
        );

        if (!user) {
          if (!cancelled) {
            setLoading(false);
          }
          return;
        }

        // --------------------------------------------------
        // 1. Load user role
        // --------------------------------------------------

        console.log("Loading user role...");

        const userDoc = await getUserRoleOnce(user.uid);

        console.log("User role document:", userDoc);

        const resolvedRole = userDoc?.role || "student";

        if (cancelled) return;

        setRole(resolvedRole);
        setPermissions(userDoc?.permissions || {});

        // --------------------------------------------------
        // 2. Load academic sessions
        // --------------------------------------------------

        console.log("Loading academic sessions...");

        let sessionList = await withFirestoreRetry(() =>
          getAcademicSessions()
        );

        console.log("Academic sessions:", sessionList);

        // --------------------------------------------------
        // 3. Create first academic session if required
        // --------------------------------------------------

        if (
          sessionList.length === 0 &&
          resolvedRole === "superAdmin"
        ) {
          const firstSession = defaultSessionLabel();

          console.log(
            "No academic session found. Creating:",
            firstSession
          );

          await createAcademicSession(firstSession);

          sessionList = await withFirestoreRetry(() =>
            getAcademicSessions()
          );

          console.log(
            "Academic sessions after creation:",
            sessionList
          );
        }

        if (cancelled) return;

        setSessions(sessionList);

        const activeSession =
          sessionList.find((s) => s.isActive)?.label ||
          sessionList[0]?.label ||
          null;

        setSession(activeSession);

        console.log(
          "Active academic session:",
          activeSession
        );

        setLoading(false);
      } catch (err) {
        console.error(
          "Fee Management initialization failed:",
          err
        );

        if (cancelled) return;

        setError(err);
        setLoading(false);
      }
    }

    initializeApp();

    return () => {
      cancelled = true;
    };
  }, []);

  // --------------------------------------------------
  // ERROR SCREEN
  // --------------------------------------------------

  if (error) {
    return (
      <div
        className="fm-empty-state"
        style={{
          padding: 40,
          maxWidth: 800,
          margin: "40px auto",
        }}
      >
        <div className="fm-card">
          <h2>Unable to load Fee Management</h2>

          <p>
            The application could not connect to the Firebase
            database.
          </p>

          <div
            style={{
              background: "#f5f5f5",
              borderRadius: 8,
              padding: 16,
              marginTop: 20,
              overflowX: "auto",
            }}
          >
            <strong>Error:</strong>

            <pre
              style={{
                whiteSpace: "pre-wrap",
                marginTop: 10,
              }}
            >
              {error?.message || String(error)}
            </pre>
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 20,
              flexWrap: "wrap",
            }}
          >
            <button
              className="fm-primary-btn"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>

            {onLogout && (
              <button
                className="fm-nav-btn"
                onClick={onLogout}
              >
                Log Out
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------
  // LOADING
  // --------------------------------------------------

  if (loading) {
    return (
      <div
        className="fm-empty-state"
        style={{ padding: 60 }}
      >
        Loading Fee Management…
      </div>
    );
  }

  // --------------------------------------------------
  // STUDENT PORTAL
  // --------------------------------------------------

  if (role === "student") {
    return (
      <div className="fm-app">
        <div className="fm-app-header">
          <h1 className="fm-app-title">
            Holy Faith High School — Fee Portal
          </h1>

          {onLogout && (
            <button
              className="fm-nav-btn"
              onClick={onLogout}
            >
              Log Out
            </button>
          )}
        </div>

        <StudentPortal />
      </div>
    );
  }

  // --------------------------------------------------
  // ADMIN NAVIGATION
  // --------------------------------------------------

  const visibleTabs = NAV_SECTIONS.filter((s) =>
    s.roles.includes(role)
  );

  async function handleCreateSession() {
    try {
      const label = newSessionLabel.trim();

      if (!label) return;

      await createAcademicSession(label);

      const updatedSessions =
        await getAcademicSessions();

      setSessions(updatedSessions);
      setNewSessionLabel("");
    } catch (err) {
      console.error(
        "Failed to create academic session:",
        err
      );

      alert(
        `Unable to create academic session.\n\n${
          err?.message || err
        }`
      );
    }
  }

  // --------------------------------------------------
  // MAIN APPLICATION
  // --------------------------------------------------

  return (
    <div className="fm-app">
      <div className="fm-app-header">
        <div className="fm-app-brand">
          <img
            src={schoolLogo}
            alt="Holy Faith High School"
            className="fm-app-logo"
          />

          <h1 className="fm-app-title">
            Fee Management
          </h1>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <label className="fm-session-select">
            Session

            <select
              value={session || ""}
              onChange={(e) =>
                setSession(e.target.value)
              }
            >
              {sessions.map((s) => (
                <option
                  key={s.label}
                  value={s.label}
                >
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          {onLogout && (
            <button
              className="fm-nav-btn"
              onClick={onLogout}
            >
              Log Out
            </button>
          )}
        </div>
      </div>

      <nav className="fm-nav">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            className={`fm-nav-btn ${
              activeTab === t.key
                ? "fm-nav-btn-active"
                : ""
            }`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="fm-main">
        {activeTab === "dashboard" && (
          <FeeDashboard session={session} />
        )}

        {activeTab === "students" && (
          <StudentDirectory
            session={session}
            onSelectStudent={(id) => {
              setSelectedStudentId(id);
              setActiveTab("transactions");
            }}
          />
        )}

        {activeTab === "structure" && (
          <FeeStructureConfig session={session} />
        )}

        {activeTab === "collect" && (
          <FeeCollection
            session={session}
            onReceiptGenerated={(
              receipt,
              duplicateBlocked
            ) => {
              setLastReceipt(receipt);

              if (duplicateBlocked) {
                console.warn(
                  "Duplicate payment submission blocked; original receipt reused."
                );
              }
            }}
          />
        )}

        {activeTab === "collect" &&
          lastReceipt && (
            <div style={{ marginTop: 20 }}>
              <h3 style={{ padding: "0 8px" }}>
                Payment recorded successfully ✓ —
                Receipt No.:{" "}
                {lastReceipt.receiptNumber}
              </h3>

              <ReceiptPrintSheet
                receipts={[lastReceipt]}
              />
            </div>
          )}

        {activeTab === "transactions" && (
          <div className="fm-card">
            <h2>Transactions</h2>

            <p className="fm-hint">
              Select a student from Students or Collect
              Fee to view their full
              transaction/payment history.
            </p>

            {selectedStudentId && (
              <PaymentHistory
                studentId={selectedStudentId}
              />
            )}
          </div>
        )}

        {activeTab === "due" && (
          <DueManagement session={session} />
        )}

        {activeTab === "advances" && (
          <div className="fm-card">
            <h2>Advances</h2>

            <p className="fm-hint">
              Students carrying an advance balance
              are flagged 🟢 across the Students, Due
              Fees, and Reports screens. Advance
              auto-applies the next time a fee is
              generated for that student.
            </p>
          </div>
        )}

        {activeTab === "discounts" && (
          <DiscountManager
            canManageDiscounts={
              role === "superAdmin" ||
              !!permissions.manageDiscounts
            }
          />
        )}

        {activeTab === "reports" && (
          <Reports session={session} />
        )}

        {activeTab === "settings" && (
          <div className="fm-card">
            <h2>
              Settings — Academic Sessions
            </h2>

            <div className="fm-search-row">
              <input
                placeholder="e.g. 2027-28"
                value={newSessionLabel}
                onChange={(e) =>
                  setNewSessionLabel(
                    e.target.value
                  )
                }
              />

              <button
                className="fm-primary-btn"
                onClick={handleCreateSession}
              >
                Create Session
              </button>
            </div>

            <ul className="fm-result-list">
              {sessions.map((s) => (
                <li key={s.label}>
                  {s.label}{" "}
                  {s.isActive
                    ? "(active)"
                    : ""}
                </li>
              ))}
            </ul>

            <hr />

            <AuditLogViewer />
          </div>
        )}
      </main>
    </div>
  );
}
