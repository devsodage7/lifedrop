# LifeDrop upgrade plan

## Scope

LifeDrop is a mobile-friendly donor search and shared request app. A patient
or attendant searches for possible donors; a donor can register; an admin can
edit stock. This first slice makes the existing workflow more truthful and safe
before adding new backend features.

| Area | Decision and reason |
| --- | --- |
| UI | Show network state, a refresh action, stock timestamps and medical warnings close to the relevant controls. |
| Frontend | Keep vanilla JavaScript and the existing event delegation; distinguish missing, sample and reported stock. |
| Backend | Read the existing inventory `updated_at` field; no schema change or live database write is needed for this slice. |
| Design | Keep the existing red and neutral design; use a clear warning instead of claiming a stock level is clinically adequate. |
| Workflow | User contacts the hospital, checks a potential match, confirms stock by phone, and treats a posted SOS as a shared listing rather than a guaranteed alert. |
| Technology | Retain Supabase REST and the static PWA; no new package or framework. |
| Automation | Run small JavaScript checks and locally mocked browser scenarios. Bump the service-worker cache for the changed files. |
| Safety | Do not present sample stock as live; do not call sample people; explain that matching and the 90-day calculation are not medical clearance. Do not modify production data. |
| Quality | Test empty cloud data, unavailable network, stale data, missing stock rows, demo data and normal reported stock. Check mobile layout and keyboard controls. |
| Uniqueness | 1. A visible refresh state warns when the network is unavailable. 2. Each stock entry shows its own update time rather than a misleading network average. 3. Sample entries cannot be contacted as real donors. These reduce confusion during an urgent search. |

## Behaviour contract

- With cloud enabled, startup does not use locally generated sample stock as
  a fallback. Empty server results remain empty.
- A successful pull replaces the complete visible snapshot. A failed pull
  keeps any current-session data but labels it potentially outdated.
- Missing inventory rows are unknown, not zero. A timestamp is not proof that
  a blood bank verified the number; the user must call to confirm.
- Cloud data is not newly persisted in the application's local data cache.
  Existing browser data is not deleted or migrated.
- Local-only mode is explicitly labelled as a demo and does not claim to
  broadcast requests to a real network.
- A match is only an ABO/Rh red-cell search aid. The hospital determines donor
  eligibility and appropriate crossmatching.

## Deferred

Real-time subscriptions, donor consent before contact, independently verified
bank ownership and component-specific stock need further design. A production
security review is urgent. Database changes require separate approval. This app
is not a medical device or a substitute for emergency services.
