# HMS / LIMS Monthly Recharge Application

Multi-client, role-based HMS/LIMS platform with a monthly subscription/recharge
model, built per `HMS_LIMS_Monthly_Recharge_Application_Requirements.pdf`.

Stack: **Node.js + Express + PostgreSQL (Sequelize)** backend, **React + Vite**
frontend, **Razorpay** for the monthly payment/recharge flow (runs in a
built-in MOCK mode when no Razorpay keys are configured, so the full flow can
be exercised without live credentials).

## 1. Prerequisites

- Node.js 18+
- A PostgreSQL server (local install, Docker, or a hosted instance)

## 2. Backend setup (`Mid-APP/server`)

```
cd Mid-APP/server
npm install
copy .env.example .env      # then edit DB_* and JWT_SECRET
npm run seed                 # creates roles, Chief Admin, a demo client + users
npm run dev                  # starts the API on http://localhost:4000
```

`npm run seed` prints the Chief Admin credentials and creates a demo client
`DEMO001` with one user per role, all using password `Demo@123`:

| Username        | Role           |
|-----------------|----------------|
| admin           | ADMIN          |
| frontoffice     | FRONT_OFFICE   |
| labuser         | LAB_USER       |
| manager         | MANAGER        |
| mastermanager   | MASTER_MANAGER |

## 3. Frontend setup (`Mid-APP/client`)

```
cd Mid-APP/client
npm install
npm run dev                  # starts the app on http://localhost:5173
```

The Vite dev server proxies `/api` to `http://localhost:4000`.

## 4. Trying it out

1. Log in as Chief Admin (top toggle on the login page) to create clients and
   users, or log in directly with the demo client `DEMO001`.
2. As `mastermanager`, add tests/parameters and set client-wise prices (or
   upload an Excel sheet with `TEST_CODE, TEST_NAME, PRICE` columns).
3. Because the demo client's subscription starts `PENDING`, any client-user
   login immediately shows the **Payment Pending** popup. Click **Pay Now** —
   in MOCK mode (no Razorpay keys) a **Simulate Payment Success** button
   completes the flow instantly and unlocks the app; with real keys it opens
   the Razorpay checkout.
4. As `frontoffice`: register a patient, generate a bill against configured
   tests (this creates a barcoded sample per test).
5. As `labuser`: collect the sample, enter results, verify, then release.
6. As `manager`: view collection summary, outstanding amounts, lab summary,
   test-wise revenue and day/month-wise transactions.

## 5. Notes on the payment/subscription business rule

- `client.paymentStatus` is the source of truth checked by
  `requireActiveSubscription` middleware on every protected client-user route
  — enforced server-side, not just hidden in the UI.
- Razorpay's **webhook** (`POST /api/payments/webhook`) is the authoritative
  confirmation path; the frontend `verify` callback is a fast-path UX
  convenience but both update the same records idempotently.
- A daily job (`expireOverdueSubscriptions`, also run once at boot) flips
  `PENDING` subscriptions past their due date to `EXPIRED`.
