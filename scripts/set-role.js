// scripts/set-role.js
// Runs in GitHub Actions. Reads FIREBASE_SERVICE_ACCOUNT and SET_USER_EMAIL /
// SET_USER_ROLE env vars, then sets the custom claim on the user.

const admin = require("firebase-admin");

async function main() {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  const email = process.env.SET_USER_EMAIL;
  const role = process.env.SET_USER_ROLE;

  if (!saJson) throw new Error("FIREBASE_SERVICE_ACCOUNT secret is missing.");
  if (!email) throw new Error("SET_USER_EMAIL input is missing.");
  if (!role) throw new Error("SET_USER_ROLE input is missing.");

  const VALID_ROLES = ["superAdmin", "admin", "accountant", "staff", "student"];
  if (!VALID_ROLES.includes(role)) {
    throw new Error(`Invalid role "${role}". Valid: ${VALID_ROLES.join(", ")}`);
  }

  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(saJson)),
  });

  const user = await admin.auth().getUserByEmail(email);
  console.log(`Found user: ${user.uid} (${user.email})`);

  await admin.auth().setCustomUserClaims(user.uid, { role });
  console.log(`✅ Custom claim set: role=${role}`);

  await admin.firestore().collection("users").doc(user.uid).set(
    { role },
    { merge: true }
  );
  console.log(`✅ Firestore users/${user.uid}.role updated`);

  await admin.auth().revokeRefreshTokens(user.uid);
  console.log(`🔁 Refresh tokens revoked. User must log in again.`);
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
