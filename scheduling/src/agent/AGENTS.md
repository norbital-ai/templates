# Service Scheduling source

Coding-agent map for this workspace. Norbius loads [`+agent.md`](./+agent.md); this file documents
where source lives and which invariants edits must preserve.

## Model ownership

`src/data/model/` mirrors ownership (`owned: true`). Owned child models live inside their owner's
folder; the leaf folder names the model.

```text
availability_requests/
booking_requests/
bookings/
  appointments/
  booking_providers/
customers/
  customer_notices/
drive_times/
providers/
  provider_time_off/
scheduling_settings/
services/
  openings/
```

## Surfaces

- Apps: `scheduling`, `configuration`, `provider`, `portal`
- Kiosks: none
- Automations: `appointments_accept_proposal`, `appointments_cancel`, `appointments_confirm_shift`,
  `appointments_decline_shift`, `appointments_rebook`, `appointments_recommend`,
  `appointments_report_unavailable`, `bookings_book`, `bookings_cancel`, `check_drives`,
  `deliver_notices`, `eta_check`, `eta_watch`, `portal_intake`, `prepare_availability`,
  `providers_deactivate`, `publish_openings`, `shift_watch`
- Policies: `customer`, `dispatch_automation`, `notice_mail`, `operations`, `portal_visitor`,
  `provider`, `provider_shift`
- Custom fields: none
- Integrations: `google_routes` (plus built-in `whatsapp` and `email`)

## Gates

Run `bolt check` to verify discovery, schema history, rules, and types; `bolt test` for the
workspace test suite; `bolt build` when changing schema or producing a release artifact. Commit
generated SQL files, `snapshot.json`, `migrations.lock.json`, and `physical.json` together.

## Invariants

- Every assigned provider must be active, hold the appointment's normalized skill tag, work that
  weekday and local hours, not be on time off, and satisfy driving + turnaround buffers (enforced
  on both `appointments.create` and `appointments.update`).
- No provider may hold overlapping non-cancelled appointments (enforced natively via `no_overlap`
  and in `appointments` write transforms).
- Booking creation, cancellation, recovery, shift confirmation, and live ETA checks execute via
  declared automations and callbacks — never chat prose.

## Read next

- [`+agent.md`](./+agent.md) — workspace assistant brief.
- `README.md` and `docs/` — product overview, architecture, and source reference.
