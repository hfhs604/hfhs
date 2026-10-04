import React, { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./firebase/config";
import Login from "./Login";
import FeeManagementApp from "./components/FeeManagementApp";

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
      setReady(true);
    });
    return () => unsubscribe();
  }, []);

  async function handleLogout() {
    await signOut(auth);
    // onAuthStateChanged will fire with user=null
  }

  if (!ready) {
    return (
      <div className="fm-empty-state" style={{ padding: 60 }}>
        Loading…
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return <FeeManagementApp onLogout={handleLogout} />;
}
