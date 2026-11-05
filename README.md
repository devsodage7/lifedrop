# LifeDrop+

**रक्तदाता शोधणारं app — शोध, SOS, blood bank stock, एकाच ठिकाणी.**
फोनवर चालतं, होम स्क्रीनवर इन्स्टॉल होतं, इंटरनेट नसेल तरी शेल उघडतं. Play Store लागत नाही.

🌐 **Live:** https://lifedrop-app.devsodage-7.workers.dev

---

## काय करता येतं

| गोष्ट | तपशील |
|---|---|
| **Donor search** | Blood group + city + eligibility + verified filter, sorting |
| **Compatibility** | कोणाला कोणाचं रक्त चालतं — matrix + quick picker |
| **90-day cooldown** | शेवटच्या donation पासून 90 दिवस — ready / cooldown badge |
| **SOS requests** | Patient, hospital, units, urgency — live feed, resolve/delete |
| **Blood bank stock** | 4 रुग्णालयांचा group-wise stock, admin मात्र बदलू शकतो |
| **Register donor** | नाव, फोन, group, वय, वजन, शहर, शेवटची donation |
| **My profile** | Sign in केलेला donor स्वतःचा profile पाहू/बदलू/delete करू शकतो |
| **Reveal number** | Public ला फक्त शेवटचे ४ अंक; sign in केल्यावर खरा नंबर (logged + rate-limited) |
| **Admin console** | Verify donors, stock update, demo data load/remove |
| **PWA** | Android/iPhone होम स्क्रीन, offline shell |

---

## Technology

- **Frontend:** plain HTML + CSS + JS (no build step, no framework)
- **Backend:** Supabase — Postgres + Auth + Row Level Security + RPC
- **Hosting:** Cloudflare Workers (static assets)
- **Auth:** email + password (Supabase), email confirmation बंद

```
lifedrop/
├─ index.html
├─ css/app.css
├─ js/
│  ├─ config.js     ← Supabase URL + anon key
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
   ├─ schema.sql       ← पूर्ण DB (tables, RLS, RPC, seed)
   └─ fix-grants.sql   ← table-level grants + insert guard
```

---

## Privacy model (महत्त्वाचं)

1. `donors` table वर **कोणालाही direct SELECT नाही** — anon किंवा authenticated दोघांनाही.
2. Public search `donors_public` **view** वाचतो — त्यात फोनचे फक्त शेवटचे ४ अंक (`phone_hint`).
3. खरा नंबर फक्त `donor_contact(p_id)` RPC मधून — फक्त **signed-in** user ला.
4. प्रत्येक reveal `contact_events` मध्ये नोंदतो + **25 reveals/hour** limit.
5. User स्वतःला `verified` करू शकत नाही — insert/update trigger हे force करतो.
6. Admin फक्त `profiles.role = 'admin'` असलेला user.

---

## Setup (नवीन Supabase project)

1. Supabase मध्ये project बनवा → **SQL Editor** → `supabase/schema.sql` पूर्ण paste → Run.
2. `supabase/fix-grants.sql` पण Run करा.
3. **Authentication → Providers → Email** मध्ये *Confirm email* **बंद** करा (किंवा Management API ने `mailer_autoconfirm: true`).
4. Project URL + anon key `js/config.js` मध्ये टाका:

```js
cloud: {
  enabled: true,
  url: 'https://<ref>.supabase.co',
  anonKey: '<anon key>',
}
```

> `service_role` key कधीही frontend मध्ये टाकू नका.

---

## Admin कसा बनवायचा

1. App मध्ये आधी त्या email ने **sign up** करा (profile आपोआप तयार होतो).
2. Supabase → SQL Editor:

```sql
update profiles set role = 'admin' where email = 'you@example.com';
```

3. App reload करा → Admin console उघडेल.

---

## Local run

```powershell
cd C:\Users\devra\Desktop\dev\lifedrop
python serve.py        # http://localhost:5174
```

## Deploy (Cloudflare Workers)

```powershell
cd C:\Users\devra\Desktop\dev\lifedrop
node C:\Users\devra\AppData\Local\Programs\node\node_modules\wrangler\bin\wrangler.js deploy
```

Live URL: `https://lifedrop-app.devsodage-7.workers.dev`

> `sw.js` मध्ये `CACHE` version वाढवा जेव्हा app files बदलता, म्हणजे जुनं cache अडकणार नाही.

---

## Database tables

| Table | काम |
|---|---|
| `profiles` | प्रत्येक auth user + role (donor/admin) |
| `donors` | खरा donor data (phone private) |
| `donors_public` (view) | public search साठी phone-free projection |
| `sos_requests` | emergency requests |
| `hospitals` | blood banks |
| `inventory` | bank × group units |
| `contact_events` | कोणी कोणाचा नंबर पाहिला (audit + rate limit) |

---

## Status

- ✅ Cloud backend जोडलेला (auth, donors, SOS, stock, audit)
- ✅ RLS + masking + rate limit verified
- ✅ Live on Cloudflare Workers
- ✅ PWA manifest + offline shell
- ⬜ Custom domain (हवं असल्यास `wrangler.jsonc` मध्ये routes जोडा)

---

Crafted by **Devraj** · LifeDrop+ 2026
