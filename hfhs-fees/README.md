# Holy Faith High School — Fee Management (standalone, GitHub Pages)

This is a self-contained React + Firebase app — no existing website required.
Push it to GitHub, flip on Pages, and it deploys itself on every push.

It needs one thing you have to set up yourself: a free Firebase project,
because a fee-management system needs a real database and real login
accounts, and GitHub Pages only serves static files. Firebase's free
"Spark" tier is enough for a single school.

## 1. Create your Firebase project (~5 minutes)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** → name it (e.g. `hfhs-fees`) → finish the wizard.
2. **Build → Firestore Database → Create database** → start in **production mode** → pick a region close to you.
3. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**
4. **Project settings (gear icon) → General → Your apps → Web (`</>`)** → register an app (nickname anything, no need for Firebase Hosting here) → copy the `firebaseConfig` values shown. You'll need these in step 3 below.
5. **Firestore Database → Rules** → replace the contents with this repo's `firestore.rules` file → **Publish**.

## 2. Create your first login (Super Admin)

1. **Authentication → Users → Add user** → enter an email and password for yourself.
2. Copy the **User UID** shown for that user.
3. **Firestore Database → Start collection** → collection ID `users` → document ID = the UID you copied → add one field: `role` (string) = `superAdmin` → Save.

That account can now log in and, from **Settings**, manage academic sessions; use **Authentication → Add user** again for every other staff member, then edit their `users/{uid}` doc the same way (`role`: `admin` | `accountant` | `staff`, plus `permissions.manageDiscounts: true` if they should manage discounts). For a student/parent account, set `role: "student"` and `linkedStudentId: "<their students/{id} doc id>"`.

## 3. Push this project to GitHub

```bash
git init
git add .
git commit -m "Fee management app"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## 4. Add your Firebase config as repository secrets

In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**, and add each of these (values from step 1.4):

| Secret name | Value |
|---|---|
| `VITE_FIREBASE_API_KEY` | `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | `projectId` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `storageBucket` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `VITE_FIREBASE_APP_ID` | `appId` |

(These aren't secret-secret — Firebase web keys are safe to expose in a browser bundle by design — but repository secrets are the clean place to keep them out of your source files.)

## 5. Turn on GitHub Pages

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

That's it — the included workflow (`.github/workflows/deploy.yml`) builds and deploys automatically on every push to `main`. Watch it run under the **Actions** tab; when it's green, your site is live at:

```
https://<your-username>.github.io/<your-repo>/
```

To deploy again later, just `git push` — no manual steps.

## 6. Log in

Open the live URL and sign in with the Super Admin email/password from step 2. You'll land on the full admin dashboard; student/parent accounts land on their own portal instead (see `src/App.jsx` / `src/components/FeeManagementApp.jsx`).

## Local development

```bash
npm install
cp .env.example .env   # fill in the same Firebase values as above
npm run dev
```

## Project structure

```
src/
  main.jsx, App.jsx, Login.jsx   — app shell: auth gate + login screen
  firebase/
    config.js                    — Firebase init (reads env vars)
    feeService.js                — all reads/writes: students, payments, receipts, discounts, audit log
    reportsService.js            — report queries + CSV export
  components/                    — one file per screen (see table below)
  styles/                        — feeManagement.css (app UI), receipt.css (print layout)
  assets/school-logo.jpg
firestore.rules                  — security rules matching the role model below
.github/workflows/deploy.yml     — build + deploy to GitHub Pages on push
```

| Component | Covers |
|---|---|
| `FeeManagementApp.jsx` | Top-level shell: role-based nav, session switcher, routes student/parent accounts to `StudentPortal` |
| `FeeDashboard.jsx` + `DashboardCharts.jsx` | Summary cards + monthly trend, class-wise paid-vs-due, payment-method pie |
| `StudentDirectory.jsx` | Create Student → Assign Fee Structure entry point; search/browse |
| `FeeStructureConfig.jsx` | Per-class, per-session fee category configuration + late fee rule |
| `FeeCollection.jsx` | Search → summary → payment form, duplicate-submit safe |
| `PaymentHistory.jsx` | Per-student ledger with view/print/download per receipt |
| `DueManagement.jsx` | Sortable/filterable due list |
| `DiscountManager.jsx` | Apply discounts/concessions, gated by `manageDiscounts` |
| `Reports.jsx` | 10 report types, date/class/method filters, Print + CSV export |
| `AuditLogViewer.jsx` | Read-only financial audit trail |
| `StudentPortal.jsx` | Student/parent self-service: own profile, own history, own receipts only |
| `ReceiptCard.jsx` / `ReceiptPrintSheet.jsx` | 4-per-A4 receipt printing |

## Data model (Firestore collections)

- `students` — profile + running totals. **Due and Advance are never stored** — they're derived from `totalAnnualFee - totalAmountPaid` by `computeBalanceView()`, so they can never drift out of sync.
- `feeStructures` — one doc per `{session}_{className}`, independent per session.
- `feeTransactions` — append-only ledger. Corrections create a new entry plus a `voided` flag on the original; nothing is hard-deleted.
- `receipts` — one per successful payment, numbered `HFHS-<year>-<seq>` atomically via a `counters` doc.
- `paymentIdempotency` — one doc per client-generated submission key, so a double-clicked "Pay" can't create two receipts.
- `discounts`, `academicSessions`, `auditLogs`, `users` — as named.

## Receipts — 4-per-A4 printing

`ReceiptPrintSheet.jsx` lays out 1–4 receipts per A4 page with blank filler slots so the grid and cut-guides stay aligned, and paginates for more than 4. `receipt.css` holds the `@page`/`@media print` rules. For PDF export, click Print and choose "Save as PDF" in the browser dialog — that reuses the exact same layout CSS.

## Still needs your input

- **Full-text fuzzy search**: `searchStudents` does prefix matching on indexed fields; wire in Algolia/Typesense for "sounds like" matching across thousands of students.
- **Staff/parent account creation UI**: currently done manually via steps 1–2 above (`setUserRole()` exists in `feeService.js` if you want to build a screen around it later).
- **Class-wise chart in Reports.jsx** renders as a table — `DashboardCharts.jsx`'s `ClassWiseChart` can be reused there if you want the same chart in both places.
- **Security rules**: `firestore.rules` matches the app's role model as a starting point — review it against your own requirements before going live with real payment data.
