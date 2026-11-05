# On-Demand Services source

This is the coding-agent map for this workspace. Norbius reads [`+agent.md`](./+agent.md); this file says where the source lives and what an edit must not break.

## Model ownership

`src/data/model/` mirrors ownership. A child model sits inside its owner's folder; only the leaf folder names the model.

```text
customers/
  bookings/
    booking_helpers/
    visits/
      customer_notices/
      helper_warnings/
dispatch_settings/
drive_times/
helpers/
  helper_time_off/
services/
  availability_requests/
  booking_requests/
  openings/
```

Keep a new model in the branch of the record that owns it. Moving a model folder does not rename it: its leaf folder name is the model name.

## Surfaces

- Apps: `helper`, `portal`, `scheduler/configurations`, `scheduler/customers`, `scheduler/helpers`, `scheduler/schedule`
- Kiosks: none
- Automations: `bookings_book`, `bookings_cancel`, `check_drives`, `deliver_notices`, `eta_check`, `eta_watch`, `helpers_offboard`, `portal_intake`, `prepare_availability`, `publish_openings`, `shift_watch`, `visits_accept_proposal`, `visits_cancel`, `visits_confirm_shift`, `visits_decline_shift`, `visits_reassign`, `visits_rebook`, `visits_recommend`, `visits_report_unavailable`, `visits_reschedule`, `warning_letter`
- Policies: `customer`, `dispatch_automation`, `helper`, `helper_shift`, `operations`, `portal_visitor`
- Custom fields: none
- Integrations: `google_routes`

## Gates

`bolt check` proves discovery, schema history, rules and types. `bolt test` runs the workspace tests. `bolt build` writes `.norbital/` and the release artifact; run it only when a schema or release change is intended. Migrations under `migrations/` are generated: commit SQL, `snapshot.json`, `migrations.lock.json` and `physical.json` together.

## Invariants

- A helper must have the service skill, be free for the visit and its drive, not be on time off, and never hold overlapping visits.
- Every booking resolves to visits; every visit is held by at most one helper.
- Shift confirmation, late cancellation, ETA and replacement rules are automations, not chat policy.

## Read next

- [`+agent.md`](./+agent.md) — the workspace brief Norbius loads.
- `README.md` and `docs/` — operator walkthrough and design detail.
