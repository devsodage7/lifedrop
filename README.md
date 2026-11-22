# LifeDrop+

**Blood donor search and request app — donor profiles, shared requests and reported blood bank stock in one place.**

Runs in a mobile browser and can be installed to the home screen. The app shell can open offline, but donor and stock data require a network connection.

> **Important:** LifeDrop is not an emergency service or a medical decision tool.
> Contact the hospital or blood bank directly. Stock listings may contain starter
> data, and must be confirmed with the bank. A blood group match or a 90-day
> interval is not medical clearance; the hospital decides suitability and
> performs the necessary tests.

> **Security review needed:** The live database's permissions and policies
> have not been independently verified. Review them before relying on the
> service. Do not re-run `supabase/schema.sql` on an existing project: it drops
> tables.

**Live:** https://lifedrop-app.devsodage-7.workers.dev

---

## Features

| Feature | Details |
|---|---|
| **Donor search** | Blood group, city, eligibility and verified filters, with sorting |
| **Compatibility** | Blood group compatibility matrix with a quick picker |
| **90-day reminder** | Calculates a 90-day interval from the reported last donation date; not an eligibility check |
| **Requests** | Shared listings with hospital, units and urgency; no automatic donor notifications |
| **Blood bank stock** | Reported group-wise counts and update times; source and availability must be confirmed |
| **Donor registration** | Name, phone, blood group, age, weight, city and last donation date |
| **My profile** | Signed-in donors can view, update or delete their own profile |
| **Contact reveal** | Public view shows only the last four digits; signed-in users can request the full number (logged and rate limited) |
| **Admin console** | Verify donors, update stock, load or remove demo data |
| **PWA** | Home screen install on Android and iPhone, offline shell and network status |

The patient name, contact number and notes are visible in the shared request
feed. Avoid posting unnecessary medical details.

---

## Technology

- **Frontend:** plain HTML, CSS and JavaScript — no build step, no framework
- **Backend:** Supabase — Postgres, Auth, Row Level Security and RPC functions
- **Hosting:** Cloudflare Workers (static assets)
- **Auth:** email and password via Supabase, email confirmation disabled

```
lifedrop/
├─ index.html
├─ css/app.css
├─ js/
│  ├─ config.js     ← Supabase URL and anon key
│  ├─ cloud.js      ← REST/RPC store (auth, donors, SOS, stock)
│  ├─ auth.js       ← sign in / sign up modal
│  └─ app.js        ← UI logic
├─ icons/icon.svg
├─ manifest.webmanifest
├─ sw.js
├─ _headers
├─ wrangler.jsonc
├─ serve.py
└─ supabase/
   ├─ schema.sql       ← full database (tables, RLS, RPC, seed data)
   └─ fix-grants.sql   ← table-level grants and insert guard
```

---

## Privacy model

1. No client can `SELECT` from the `donors` table directly — neither anonymous nor authenticated users.
2. Public search reads the `donors_public` view, which exposes only the last four digits of the phone number (`phone_hint`).
3. The full number is available only through the `donor_contact(p_id)` RPC, and only to a **signed-in** user.
4. Every reveal is written to `contact_events` and limited to **25 reveals per hour**.
5. A user cannot mark their own record as `verified` — insert and update triggers enforce this.
6. Admin access requires `profiles.role = 'admin'`.

Cloud donor, request and stock snapshots are kept in memory rather than newly
written to the local app data cache. Existing browser data is not deleted.
Authentication still uses browser storage. The SQL starter rows are examples,
not verified blood-bank inventory.

---

## Setup (new Supabase project)

1. Create a project in Supabase, open the **SQL Editor** and run the full `supabase/schema.sql`.
2. Run `supabase/fix-grants.sql` as well.
3. In **Authentication → Providers → Email**, disable **Confirm email** (or set `mailer_autoconfirm: true` through the Management API).
4. Add the project URL and anon key to `js/config.js`:

```js
cloud: {
  enabled: true,
  url: 'https://<ref>.supabase.co',
  anonKey: '<anon key>',
}
```

> Never place the `service_role` key in the frontend.

---

## Creating an admin

1. Sign up in the app with the admin email address (a profile is created automatically).
2. In the Supabase SQL Editor:

```sql
update profiles set role = 'admin' where email = 'you@example.com';
```

3. Reload the app — the Admin console appears.

---

## Local development

```bash
python serve.py        # http://localhost:5174
```

Run the small cloud mapping tests with `node --test tests/cloud.test.cjs`.
The tests use synthetic data and do not connect to Supabase.

## Deployment (Cloudflare Workers)

```bash
wrangler deploy
```

Live URL: https://lifedrop-app.devsodage-7.workers.dev

> Bump the `CACHE` version in `sw.js` whenever app files change, so clients do not keep serving the old cache.

---

## Database tables

| Table | Purpose |
|---|---|
| `profiles` | One row per authenticated user, with role (donor or admin) |
| `donors` | Full donor records, with the phone number kept private |
| `donors_public` (view) | Phone-free projection used by public search |
| `sos_requests` | Emergency blood requests |
| `hospitals` | Blood banks |
| `inventory` | Units per bank and blood group |
| `contact_events` | Audit trail of number reveals, used for rate limiting |

---

## Status

- ✅ Cloud backend connected (auth, donors, SOS, stock, audit)
- ⬜ Production RLS, masking and rate limiting require independent verification
- ✅ Live on Cloudflare Workers
- ✅ PWA manifest and offline shell; current data needs a connection
- ⬜ Custom domain (add routes in `wrangler.jsonc` if required)

---

Built by [Devraj Arun Sodage](https://github.com/devsodage7).
