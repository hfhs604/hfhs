import React, { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./firebase/config";
import Login from "./Login";
import FeeManagementApp from "./components/FeeManagementApp";

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = "still checking"
  const [appKey, setAppKey] = useState(0); // bump to force FeeManagementApp to re-fetch role on new login

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAppKey((k) => k + 1);
    });
    return unsubscribe;
  }, []);

  if (user === undefined) {
    return <div className="fm-empty-state" style={{ padding: 60 }}>Loading…</div>;
  }

  if (!user) {
    return <Login />;
  }

  return <FeeManagementApp key={appKey} onLogout={() => signOut(auth)} />;
}
