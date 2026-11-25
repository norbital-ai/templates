# Service Scheduling — source reference

Authoritative inventory of models, policies, apps, automations, and integrations in
`templates/on-demand-services`.

## Models (13)

| Model                   | Path                                                   | Purpose                                                                                                                             |
| ----------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `services`              | `src/data/model/services/+model.ts`                    | Bookable services: name, optional category, normalized runtime skill tag, duration, price, active flag                              |
| `openings`              | `src/data/model/services/openings/+model.ts`           | Published open start instants per active service per day for unauthenticated portal browsing                                        |
| `availability_requests` | `src/data/model/availability_requests/+model.ts`       | Customer-scoped availability quotes accounting for destination coordinates, recurrence, and preferred provider                      |
| `booking_requests`      | `src/data/model/booking_requests/+model.ts`            | Verified portal booking submissions validated against quote freshness (`15m`) before intake                                         |
| `customers`             | `src/data/model/customers/+model.ts`                   | Customer profiles keyed by unique phone number with default service address and coordinates                                         |
| `customer_notices`      | `src/data/model/customers/customer_notices/+model.ts`  | Owned outbound WhatsApp and synced email (`+mail.sync.ts`) notifications with mailbox delivery lifecycle tracking                   |
| `bookings`              | `src/data/model/bookings/+model.ts`                    | One-off or recurring service orders owning `booking_providers` and `appointments`                                                   |
| `booking_providers`     | `src/data/model/bookings/booking_providers/+model.ts`  | Ranked preferred providers (1–5) attached to a booking                                                                              |
| `appointments`          | `src/data/model/bookings/appointments/+model.ts`       | Scheduled service occurrences with native `started_at`/`completed_at` state stamps, `no_overlap` guard, shift check, and ETA fields |
| `providers`             | `src/data/model/providers/+model.ts`                   | Service providers with normalized skills, working weekdays/hours, base point, `sys_user` link, and live GPS location                |
| `provider_time_off`     | `src/data/model/providers/provider_time_off/+model.ts` | Non-overlapping date ranges when a provider cannot be scheduled                                                                     |
| `scheduling_settings`   | `src/data/model/scheduling_settings/+model.ts`         | Singleton configuration for slot interval, turnaround buffer, booking horizon, ETA/shift timings, and free-change window            |
| `drive_times`           | `src/data/model/drive_times/+model.ts`                 | Cached Google Routes drive minutes between ~1 km grid cells (`legOf`)                                                               |

## Apps (4)

| App             | Path                            | Pages                                                                                    |
| --------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| `scheduling`    | `src/app/scheduling/+app.ts`    | `schedule`, `bookings`, `dispatch`, `live`, `customers`, `providers`                     |
| `configuration` | `src/app/configuration/+app.ts` | `services`, `settings`, `connections`                                                    |
| `provider`      | `src/app/provider/+app.ts`      | `today` (plus `+session.svelte` background GPS tracker)                                  |
| `portal`        | `src/app/portal/+app.ts`        | `book`, `appointments` (public `portal_visitor` audience; phone signup binds `customer`) |

## Teams & policies

| Team            | Policies                                               | Access scope                                                                                                                   |
| --------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `operations`    | `operations`                                           | Full operational read/write across `scheduling`, `configuration`, and `provider` apps plus desk and shift automations          |
| `providers`     | `provider`                                             | Scoped to own provider record (`last_location`), own appointments (`scheduled->in_progress->completed`), and shift automations |
| _(self-signup)_ | `customer`                                             | Scoped to `portal` app and the signed-in customer's own records (`actor.party` / `actor.phone`)                                |
| _(public)_      | `portal_visitor`                                       | Anonymous read of active `services` (`portal` output) and published `openings`                                                 |
| _(system)_      | `dispatch_automation`, `provider_shift`, `notice_mail` | Automation and email sync authority                                                                                            |

## Automations (18)

| Automation                        | Policy                | Trigger / role                                                                                                        |
| --------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `bookings_book`                   | `operations`          | Manual booking creation with full recurring horizon validation                                                        |
| `bookings_cancel`                 | `operations`          | Cancels a booking and all upcoming scheduled appointments with late flags                                             |
| `providers_deactivate`            | `operations`          | Marks provider inactive after `last_day` and proposes skill-closest replacements                                      |
| `appointments_rebook`             | `operations`          | Reassigns and/or reschedules an appointment, enforcing free-change window outside recovery                            |
| `appointments_recommend`          | `operations`          | Computes ranked replacement provider proposal for dispatcher approval                                                 |
| `appointments_accept_proposal`    | `operations`          | Commits an approved replacement after rechecking live availability and travel                                         |
| `appointments_report_unavailable` | `operations`          | Marks assigned provider's day declined so `shift_watch` prepares replacements                                         |
| `appointments_cancel`             | `operations`          | Cancels scheduled appointments and flags cancellations inside `free_change_hours`                                     |
| `appointments_confirm_shift`      | `provider_shift`      | Provider confirms their own day's appointments (`ctx.trigger` ownership checked)                                      |
| `appointments_decline_shift`      | `provider_shift`      | Provider reports unavailability for their own day (`ctx.trigger` ownership checked)                                   |
| `publish_openings`                | `dispatch_automation` | Cron `3,18,33,48 * * * *` (`rest: '1d'`) + model effects; refreshes public `openings`                                 |
| `prepare_availability`            | `dispatch_automation` | Scheduled by `availability_requests` create; computes address- & recurrence-specific starts                           |
| `portal_intake`                   | `dispatch_automation` | Scheduled by `booking_requests` create; auto-books or routes to `follow_up`                                           |
| `check_drives`                    | `dispatch_automation` | Cron `8,23,38,53 * * * *` (`rest: '1d'`) + model effects; caches routes, reassigns unreachable stops, runs `optimise` |
| `shift_watch`                     | `dispatch_automation` | Cron `2,12,22,32,42,52 * * * *` (`rest: '1d'`) + decline effect; prompts providers and triggers recovery              |
| `eta_watch`                       | `dispatch_automation` | Cron `*/5 * * * *` (`rest: '1d'`); fans out per-appointment `eta_check` runs                                          |
| `eta_check`                       | `dispatch_automation` | Checks one appointment's live GPS ETA and flags `eta_risk`                                                            |
| `deliver_notices`                 | `dispatch_automation` | Scheduled by `customer_notices` create; sends WhatsApp notice and records queue admission                             |

## Integrations

- `google_routes` (`src/integration/google_routes/+integration.ts`): HTTP integration (`routes.googleapis.com`, `X-Goog-Api-Key`).
- Built-in `whatsapp` and `email` connections managed via **Configuration → Connections**.
