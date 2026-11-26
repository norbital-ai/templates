# Service Scheduling — Architecture & Inner Mechanisms

Deep technical reference for `templates/scheduling`, covering runtime topology, data ownership,
state machines, write-time assignment guards, the pure matching/scoring engine, portal intake,
route caching and local-search optimization, pre-shift and live GPS ETA monitoring, dual-channel
notice delivery, and access control.

All symbols, formulas, constraints, cron expressions, and policy scopes in this document are
derived directly from `src/`.

## Table of Contents

1. [System Topology & Runtime Architecture](#1-system-topology--runtime-architecture)
2. [Data Model & Ownership ER Diagram](#2-data-model--ownership-er-diagram)
3. [State Machines, Record Locks & Native Stamps](#3-state-machines-record-locks--native-stamps)
4. [Hard Eligibility Gate & Write-Time Guard](#4-hard-eligibility-gate--write-time-guard)
5. [Soft Scoring, Travel Estimation & Slot Generation Engine](#5-soft-scoring-travel-estimation--slot-generation-engine)
6. [Self-Service Booking Portal & Quote-to-Booking Pipeline](#6-self-service-booking-portal--quote-to-booking-pipeline)
7. [Route Caching, Unreachable Repair & Relocate Optimization](#7-route-caching-unreachable-repair--relocate-optimization)
8. [Pre-Shift Check-Ins, Live GPS ETAs & Dispatch Recovery](#8-pre-shift-check-ins-live-gps-etas--dispatch-recovery)
9. [Multi-Channel Notice Delivery & Revision-Conflict Recovery](#9-multi-channel-notice-delivery--revision-conflict-recovery)
10. [Access Control, Named Outputs & Rate Limits](#10-access-control-named-outputs--rate-limits)

---

## 1. System Topology & Runtime Architecture

The workspace declares four apps (`scheduling`, `configuration`, `provider`, `portal`), 13 models,
18 automations, one bidirectional mail sync (`customer_notices/+mail.sync.ts`), and one custom
HTTP integration (`google_routes`) alongside built-in `whatsapp`, `email`, and `ctx.geo.search`.

Pure scheduling logic in `src/lib/matching.ts` and `src/lib/slots.ts` is shared across both
browser pages (live slot previews in the desk booking composer and appointment recovery pane via
`src/lib/pool.svelte.ts`) and server-side automations/transforms. Client previews never trust
themselves to commit directly: every write re-evaluates live state server-side inside
`appointments` transforms or atomic automations.

```text
+--------------------------------------------------------------------------------------------+
|                                 CLIENT APPS (Svelte 5 Pages)                               |
+------------------------+-----------------------+---------------------+---------------------+
|  scheduling (6 pages)  | configuration (3 pgs) |  provider (1 page)  |  portal (2 pages)   |
|  - schedule (Board/Tbl)| - services            |  - today            |  - book (3-step)    |
|  - bookings (All/Reqs) | - settings (singleton)|  + +session.svelte  |  - appointments     |
|  - dispatch (Attn/Shft)| - connections         |    (GPS watch Fiber,|  (public visitor -> |
|  - live (Split Map/Tbl)|                       |     2m throttle)    |   PhoneVerify auth) |
|  - customers, providers|                       |                     |                     |
|  + 7 RecordHub views   |                       |                     |                     |
|  + Recovery.svelte     |                       |                     |                     |
|  + livePool() client   |                       |                     |                     |
+-----------+------------+-----------+-----------+----------+----------+----------+----------+
            |                        |                      |                     |
            +------------------------+----------+-----------+---------------------+
                                                |  ctx.query / ctx.act / ctx.run
                                                v
+--------------------------------------------------------------------------------------------+
|                         NORBITAL BOLT ENGINE & POLICY BOUNDARY                             |
|  Auth: Teams (operations, providers) | Phone Signup (customer) | Public (portal_visitor)   |
|  Rate limits (+workspace.ts) | Named Read Outputs | Optimistic Concurrency (revision)      |
+------------------------------------+------------------------------------+------------------+
                                     |                                    |
         +---------------------------v------------------+    +------------v-------------+
         |     WRITE TRANSFORMS, LOCKS & EFFECTS        |    |  18 AUTOMATIONS + 1 SYNC |
         |  - appointments: verifyAssignments (as_of)   |    |  Cron (4):               |
         |  - booking_requests: 15m quote validation    |--->|   publish_openings (15m) |
         |  - services/providers: normalizeSkill()      |    |   check_drives     (15m) |
         |  - providers: stamp last_location_at         |    |   shift_watch      (10m) |
         |  - customer_notices: email stamp + monotonic |    |   eta_watch         (5m) |
         |  - Native locks & no_overlap PG constraints  |    |  Scheduled (4) + Manual  |
         +---------------------------+------------------+    |  (10) + mail sync (1)    |
                                     |                       +------------+-------------+
                                     v                                    |
         +----------------------------------------------+                 |
         |        TENANT DATABASE (13 Models)           |                 |
         |  services/openings | customers/notices       |                 |
         |  bookings/appointments/booking_providers     |                 |
         |  providers/provider_time_off                 |                 |
         |  availability_requests | booking_requests    |                 |
         |  scheduling_settings   | drive_times         |                 |
         +----------------------------------------------+                 |
                                                                          v
         +------------------------------------------------------------------------------+
         |                         EXTERNAL INTEGRATIONS                                |
         |  [google_routes]  POST routes.googleapis.com/distanceMatrix/v2:computeRoute  |
         |  [whatsapp]       ctx.send() -> customer notices, alerts, shift prompts      |
         |  [email]          +mail.sync.ts -> outbound send + inbound delivery events   |
         |  [ctx.geo]        Address geocoding for portal intake & availability quotes  |
         +------------------------------------------------------------------------------+
```

---

## 2. Data Model & Ownership ER Diagram

Thirteen models span four ownership trees (`owned: true`, cascading deletes from owner to child)
plus four top-level operational models. Directory nesting under `src/data/model/` mirrors
ownership.

```text
+----------------------------------+             +----------------------------------+
|            services              |             |            customers             |
|----------------------------------|             |----------------------------------|
| PK id                            |             | PK id                            |
| UQ name (<=160)                  |             | UQ phone (format: phone)         |
|    category?, skill (normalized) |             |    name, email?, address         |
|    duration_minutes (15..720)    |             |    location? (point), notes?     |
|    price (money), active (true)  |             +-------+-----------------+--------+
+-------+------------------+-------+                     |                 |
        | 1 (owned)        | 1                           | 1 (owned)       | 1
        | cascade          |                             | cascade         |
        v *                |                             v *               |
+--------------------+     |                +-------------------------+    |
|     openings       |     |                |    customer_notices     |    |
|--------------------|     |                |   (+ +mail.sync.ts)     |    |
| UQ (service, day)  |     |                |-------------------------|    |
|    starts: text[]  |     |                | FK customer (owned)     |    |
+--------------------+     |                | FK appointment? (SETN)  |    |
                           |                |    subject, body        |    |
                           |                |    whatsapp?, to_address|    |
                           |                |    delivery (enum?),    |    |
                           |                |    sent/delivered/opened|    |
                           |                |    /replied/auto_replied|    |
                           |                +------------+------------+    |
                           |                             | (nullable FK)   |
                           |                             |                 |
                           v *                           |                 v *
                +----------------------------------------+------------------------+
                |                            bookings                             |
                |-----------------------------------------------------------------|
                | PK id | SEQ number ('BK-{yyyy}-{0000}')                         |
                | FK customer -> customers | FK service -> services               |
                |    address, location?, preference (any|preferred), repeat       |
                |    status (active -> cancelled) | LOCK cancelled (except appts) |
                |    notes? | COUNT appointment_count                             |
                +---------------------+------------------------+------------------+
                                      | 1 (owned)              | 1 (owned)
                                      | cascade                | cascade
                                      v *                      v *
             +--------------------------------+    +-------------------------------------+
             |       booking_providers        |    |            appointments             |
             |      (was: booking_helpers)    |    |            (was: visits)            |
             |--------------------------------|    |-------------------------------------|
             | UQ (booking, provider)         |    | SEQ number ('AP-{yyyy}-{00000}')    |
             | FK booking (owned)             |    | FK booking (owned)                  |
             | FK provider -> providers       |    | FK provider? (SET NULL)             |
             |    rank (int 1..5)             |    | FK unavailable_provider? (SET NULL) |
             +---------------+----------------+    | FK proposed_provider? (SET NULL)    |
                             | *                   |    slot (period<instant>)           |
                             |                     |    NO_OVERLAP(slot) PER provider    |
                             |                     |      WHERE status!='cancelled'      |
                             |                     |        AND provider IS NOT NULL     |
                             |                     |    address, location?, skill        |
                             |                     |    status (state) + started/comp_at |
                             |                     |    shift_check, shift_asked_at      |
                             |                     |    eta_minutes, eta_checked_at      |
                             |                     |    attention, proposed_slot?        |
                             |                     |    completion_notes?, late_cancel   |
                             |                     +------------------+------------------+
                             |                                        | * (nullable FKs)
                             +-------------------+--------------------+
                                                 | 1
                                                 v
+-------------------------------------------------------------------+
|                             providers                             |
|-------------------------------------------------------------------|
| PK id | UQ user? -> sys_user (SET NULL)                           |
|    name, phone, email?, skills (text[], normalized & deduped)     |
|    home_location? (point), work_days (sun..sat[])                 |
|    day_start, day_end  [CHECK: day_end > day_start]               |
|    status (active <-> inactive), inactive_since? (date)           |
|    last_location? (point), last_location_at? (instant, stamped)   |
+---------------------------------+---------------------------------+
                                  | 1 (owned, cascade)
                                  v *
                +-----------------------------------+
                |        provider_time_off          |
                |      (was: helper_time_off)       |
                |-----------------------------------|
                | FK provider (owned)               |
                |    period (period<date>)          |
                |    NO_OVERLAP(period) PER provider|
                |    reason (leave|sick|unavailable)|
                +-----------------------------------+

STANDALONE OPERATIONAL MODELS (Top-Level, Non-Owned):
+---------------------------------+   +-----------------------------------+
|     availability_requests       |   |         booking_requests          |
|---------------------------------|   |-----------------------------------|
| phone, address, location?       |   | SEQ number ('RQ-{yyyy}-{0000}')   |
| FK service -> services          |<--| FK availability? -> avail_reqs    |
| FK provider? -> providers       |   | FK service -> services (active=T) |
| preference, repeat, starts[]    |   | FK booking? -> bookings (SETN)    |
| estimated, checked_at?, problem?|   | name, phone, email?, address      |
| status: pending->ready|failed   |   | start, repeat, notes?, outcome?   |
| LOCK settled (ready, failed)    |   | status: received->booked|follow_up|
+---------------------------------+   |         follow_up->booked|closed  |
                                      | LOCK settled (booked, closed)     |
+---------------------------------+   +-----------------------------------+
|      scheduling_settings        |   +-----------------------------------+
|    (was: dispatch_settings)     |   |            drive_times            |
|---------------------------------|   |-----------------------------------|
| UQ name (default 'Scheduling')  |   | UQ leg ('lat,lng>lat,lng' ~1km)   |
| slot_interval_minutes (15..60)  |   |    minutes (int >= 0)             |
| buffer_minutes (0..120)         |   +-----------------------------------+
| booking_horizon_days (7..60)    |
| eta_limit_minutes (5..240)      |
| eta_check_lead_minutes (15..240)|
| shift_check_lead_minutes(30.720)|
| shift_reply_minutes (10..240)   |   [CHECK: shift_reply_minutes
| free_change_hours (0..168)      |           < shift_check_lead_minutes]
+---------------------------------+
```

---

## 3. State Machines, Record Locks & Native Stamps

Five models carry declarative `state` fields backed by database-enforced transitions, native
timestamp stamps, and row-level write locks. `appointments` additionally coordinates two
operational enums (`shift_check` and `attention`) that interact with state transitions and
provider reassignments.

```text
[1] appointments.status (native stamps + two locks)
=========================================================================================
                          +------------------+
                          |    scheduled     |  (initial)
                          +--------+---------+
                                   |
                +------------------+------------------+
                | (provider or ops)                   | (ops: cancel automation)
                v                                     v
    +------------------------+            +------------------------+
    |      in_progress       |            |       cancelled        |
    |  stamp: started_at     |            |  LOCK 'finished' (all) |
    |  LOCK 'under_way'      |            +------------------------+
    |  except: status,       |
    |   completion_notes,    |
    |   completed_at,        |
    |   attention            |
    +-----------+------------+
                | (provider or ops)
                v
    +------------------------+
    |       completed        |
    |  stamp: completed_at   |
    |  LOCK 'finished' (all) |
    +------------------------+

    appointments.shift_check (enum; reset to 'not_due' + clears shift_asked_at & ETA
                              automatically in update.transform whenever provider changes):
      not_due --(shift_watch asks)--> asked --(confirm_shift)--> confirmed
                                        |
                         +--------------+---------------+
                         | (reply window elapsed)       | (decline_shift /
                         v                              |  report_unavailable)
                    no_response                         v
                         |                          declined --(effect schedules
                         +-------------> shift_watch <---------- shift_watch immediately)

    appointments.attention (enum):
      none | unassigned | eta_risk | provider_inactive | awaiting_approval

[2] bookings.status                          [3] providers.status
========================================     ========================================
  +--------+  bookings_cancel  +-----------+   +--------+  providers_deactivate  +----------+
  | active | ----------------> | cancelled |   | active | ---------------------> | inactive |
  +--------+  LOCK 'cancelled' +-----------+   +--------+ <--------------------- +----------+
              (except: ['appointments'])                   (ops direct update)

[4] availability_requests.status             [5] booking_requests.status
========================================     ========================================
  +---------+     +--------+                   +----------+       +--------+
  | pending | --> | ready  | LOCK 'settled'    | received | ----> | booked | LOCK 'settled'
  +----+----+     +--------+                   +----+-----+       +--------+
       |                                            |                 ^
       v          +--------+                        v                 | (ops manual)
       +--------> | failed | LOCK 'settled'    +-----------+          |
                  +--------+                   | follow_up | ---------+
                                               +-----+-----+
                                                     | (ops manual)
                                                     v
                                               +-----------+
                                               |  closed   | LOCK 'settled'
                                               +-----------+
```

---

## 4. Hard Eligibility Gate & Write-Time Guard

Every write that assigns a provider or modifies a time slot — whether from the Schedule drag-and-
drop board, a direct `bookings.create`, `bookings_book`, `appointments_rebook`,
`appointments_accept_proposal`, or `check_drives` — passes through `verifyAssignments` inside
`src/data/model/bookings/appointments/+model.ts`. Because it queries with `as_of: 'act'`, multi-
row batch writes validate against each other atomically inside the same transaction.

```text
  appointments.create (provider != null)   OR   appointments.update (provider or slot changed)
                                    |
                                    v
              +--------------------------------------------+
              |  verifyAssignments(rows, ctx) [as_of:'act']|
              |  Window: [min(starts) - 2d, max(starts)+2d]|
              |  Loads: scheduling_settings, providers,    |
              |         non-cancelled appointments,        |
              |         provider_time_off, drive_times     |
              |  Overlays all in-flight rows onto `held`   |
              +---------------------+----------------------+
                                    |
                                    v  for each checked non-cancelled assigned row:
  +--------------------------------------------------------------------------------------+
  |                       refusal(provider, need, pool, ctx.tz)                          |
  +--------------------------------------------------------------------------------------+
  |  1. provider.status !== 'active'                --> REFUSE errors.provider.inactive  |
  |  2. normalizeSkill(skill) not in provider.skills--> REFUSE errors.provider.skill     |
  |  3. local weekday(slot.start) not in work_days  --> REFUSE errors.provider.day       |
  |  4. start < day_start OR end > day_end          --> REFUSE errors.provider.hours     |
  |  5. local date(slot.start) in provider_time_off --> REFUSE errors.provider.time_off  |
  |  6. For every other busy appointment `b` of same provider (b.id !== need.appointment)|
  |       order [first, second] by start time                                            |
  |       clearance = driveMinutes(first.loc, second.loc, drive) + buffer_minutes        |
  |       if need.start < b.end + clearance AND b.start < need.end + clearance           |
  |                                                 --> REFUSE errors.provider.booked    |
  +-----------------------------------------+--------------------------------------------+
                                            | all 6 checks pass (null)
                                            v
              +--------------------------------------------+
              |  DB Constraint: one_appointment_at_a_time  |
              |  no_overlap(slot) per provider             |
              |  WHERE status!='cancelled' AND provider!=N |
              +---------------------+----------------------+
                                    |
                                    v
              +--------------------------------------------+
              |  appointments.update.transform side-effect |
              |  If provider changed:                      |
              |    shift_check    = 'not_due'              |
              |    shift_asked_at = null                   |
              |    eta_minutes    = null                   |
              |    eta_checked_at = null                   |
              +---------------------+----------------------+
                                    |
                                    v (post-commit)
              +--------------------------------------------+
              |  appointments.create / update .effect      |
              |  - alertProviders() -> in-app + WhatsApp   |
              |  - provider/slot/status changed:           |
              |      schedule('publish_openings')          |
              |      schedule('check_drives')              |
              |  - shift_check newly set to 'declined':    |
              |      schedule('shift_watch')               |
              +--------------------------------------------+
```

Note on skill normalization (`src/lib/matching.ts`): `normalizeSkill(v)` executes
`v.trim().toLowerCase().replace(/\s+/g, '_')`. Both `services` (create/update) and `providers`
(create/update, deduplicated via `Set`) normalize tags on write, and `services` refuses empty
normalized tags (`errors.skill_required`).

---

## 5. Soft Scoring, Travel Estimation & Slot Generation Engine

All ranking, detour calculation, weekly load balancing, slot discovery, and recurring series
planning are pure functions in `src/lib/matching.ts`.

```text
+--------------------------------------------------------------------------------------------+
|  [A] DIRECTIONAL TRAVEL DURATION: driveMinutes(a, b, driveMap)                             |
+--------------------------------------------------------------------------------------------+
  a == null OR b == null  -------->  30 min (UNKNOWN_DRIVE_MINUTES)
  cellOf(p) = `${lat.toFixed(2)},${lng.toFixed(2)}`  (~1 km grid square)
  legOf(a, b) = cell(a) === cell(b) ? null : `${cell(a)}>${cell(b)}`
  Lookup:
    1) driveMap.get(legOf(a, b))   --> cached Google Routes minutes (directional)
    2) fallback Haversine distance --> ceil((haversine_km / 25 km/h) * 60)

+--------------------------------------------------------------------------------------------+
|  [B] CANDIDATE RANKING: rank(need, pool, zone, keep = null)                                |
+--------------------------------------------------------------------------------------------+
  Filter: refusal(p, need, pool, zone) === null
  For each eligible provider p:
    1) Marginal Route Detour (`detour`):
       Find nearest same-day `before` (end <= need.start) and `after` (start >= need.end)
       from = before ? before.location : p.home_location
       drive = after == null
                 ? driveMinutes(from, need.location)
                 : max(0, drive(from, need) + drive(need, after) - drive(from, after))

    2) Convex Weekly Load Penalty (`weeklyLoad` over local Mon..Sun):
       load.service  = sum of scheduled/in-progress service minutes for p that week
       load.travel   = sum of planned home->stop1->stop2... drive minutes that week
       load.minutes  = load.service + load.travel
       load.capacity = (active work_days not in provider_time_off) * (day_end - day_start)
       added         = duration_minutes(need) + drive
       balance       = 180 * ((load.minutes + added)^2 - load.minutes^2)
                       / max(1, load.capacity)^2                 [LOAD_BALANCE = 180]

    3) Composite Score (higher is better):
       score = -drive - balance + (p.id === keep ? 15 : 0)       [CONTINUITY = 15]

    4) Tie-Breaking Order (descending score, then):
       a. Ascending extra-skill scarcity:
            scarcity(p) = SUM over (s in p.skills, s != need.skill) of:
                            1 / count(active providers holding skill s)
            (prefers generalists / common skills; preserves rare specialists!)
       b. Alphabetical `p.name`
       c. Lexicographical `p.id`

    Display helper: `week_hours` rounded to 1 decimal via BigDecimal half-ceil.

+--------------------------------------------------------------------------------------------+
|  [C] EXACT SLOT GENERATION: openSlots(provider, need, days, pool, zone, now)               |
+--------------------------------------------------------------------------------------------+
  For each day in `days`:
    Candidate start minutes `m` inside [day_start, day_end - need.minutes]:
      (1) Regular grid:  day_start, day_start + step, ...  (step = slot_interval_minutes)
      (2) Gap edges around each busy appointment `b` of `provider` on that day (snapped 15m):
          - After `b.end`:    ceil((b.end   + drive(b, need) + buffer) / 15) * 15
          - Before `b.start`: floor((b.start - drive(need, b) - buffer - duration) / 15) * 15
    Keep sorted `m` where slot.start > now AND refusal(provider, slot) === null.

+--------------------------------------------------------------------------------------------+
|  [D] ATOMIC RECURRING PLANNING: planBooking(need, starts, pool, zone, preferred)           |
+--------------------------------------------------------------------------------------------+
  occurrences(start, repeat, count, zone):
    repeat = once -> 1 | weekly -> +7d | fortnightly -> +14d | monthly -> +1mo
    Preserves local wall-clock time across DST boundaries; default count = BOOKING_AHEAD (8).
  Loop i = 0 .. starts.length - 1:
    - Filter pool.providers to `preferred` (if non-empty) else all active providers
    - Rank with continuity bonus `keep` = previous occurrence's chosen provider
    - If `preferred` non-empty: pick first feasible provider in customer priority rank order
    - If NONE feasible --> return { appointments, missing: i }  (caller aborts: zero writes!)
    - Append provisional hold { planned: true, id: `planned-${i}`, ... } to `busy`
    - Set `keep = best.provider`
```

---

## 6. Self-Service Booking Portal & Quote-to-Booking Pipeline

The `portal` app separates anonymous public browsing from authenticated quote/booking
transactions so unauthenticated visitors can never enumerate provider schedules or customer data.

```text
  [Background: publish_openings]
  cron: '3,18,33,48 * * * *' (rest: 1d, max: 1) + effects on services, providers,
  provider_time_off, bookings, appointments, scheduling_settings
       |
       +--> Computes union of openSlots() per active service across booking_horizon_days
       |    with location = null (uses 30m UNKNOWN_DRIVE_MINUTES allowance)
       +--> Diffs & upserts/deletes `openings` rows (service, day, starts[])

  [Phase 1: Anonymous Browse]  (policy: portal_visitor)
  Visitor opens portal/+book
       |--> Reads services (output: portal) + openings (output: portal)
       |--> PhoneVerify OTP challenge (signup: via ['phone'], party: customers.phone)
       v
  [Phase 2: Verified Availability Quote]  (policy: customer, actor.phone bound)
  Customer submits service + address + location? + preference + provider? + repeat
       |--> availability_requests.create (verdict refuses if phone != actor.phone)
       |--> effect schedules `prepare_availability` (key: prepare-availability:<ids>)
       v
  [prepare_availability]  (policy: dispatch_automation)
       |--> Resolves coordinates: request.location ?? saved customer.location ?? ctx.geo.search
       |--> Loads pool across booking_horizon_days + BOOKING_AHEAD recurrence tail
       |--> Deduplicates up to 24 unique provider home & busy points
       |--> Calls learnLegs() -> google_routes (TRAFFIC_UNAWARE) to/from destination
       |    Persists new legs to `drive_times` (ignores ActConflict/ActRefused)
       |--> Sets estimated = true if location == null OR any leg uncached OR points > 24
       |--> Computes availableSlots() verifying full recurring horizon for every start
       +--> Updates availability_requests: status = 'ready' (starts[], checked_at) | 'failed'
       v
  [Phase 3: Quote-Bound Booking Submission]
  Customer picks start slot -> booking_requests.create
       |--> policy verdict: phone === actor.phone
       |--> model transform (as_of: 'act'):
       |      * start > ctx.now                             (else errors.start_in_past)
       |      * quote.status === 'ready'
       |      * quote.(phone, service, address, repeat) match request
       |      * start in quote.starts
       |      * now <= quote.checked_at + 15m (QUOTE_FRESH) (else errors.availability_changed)
       |--> effect schedules `portal_intake` (key: portal-intake:<ids>)
       v
  [portal_intake]  (policy: dispatch_automation)
       |--> Finds customer by phone OR creates customer (with ctx.geo.search point)
       |      (key: intake-customer:<reqId>)
       |--> Calls bookService(..., also: { id: bookingId, request: [status='booked'] })
       |
       +----[SUCCESS: all occurrences assigned]----+----[FAILURE: slot filled mid-checkout]----+
       |                                                                                       |
       v                                                                                       v
  +--------------------------------------------+  +--------------------------------------------+
  | Atomic ctx.act (key: book:request:<id>):   |  | Atomic ctx.act                             |
  |  - bookings.create (+ preferred_providers  |  |  (key: intake-followup:<id>:<rev>):        |
  |    + appointments -> alertProviders)       |  |  - booking_requests.update                 |
  |  - customer_notices.create (confirmation)  |  |    (status = 'follow_up', outcome = why)   |
  |  - booking_requests.update                 |  |  - customer_notices.create (reassurance)   |
  |    (status = 'booked', booking = id)       |  | + ctx.notify(policy: 'operations',         |
  | Portal Step 3: "Booking confirmed" + .ics  |  |   once: 'intake-<id>')                     |
  +--------------------------------------------+  | Portal Step 3: "Request received"          |
                                                  +--------------------------------------------+
```

---

## 7. Route Caching, Unreachable Repair & Relocate Optimization

`check_drives` runs every 15 minutes (`8,23,38,53 * * * *`, `rest: '1d'`, `concurrency: { max: 1 }`)
and on effects from `bookings.create`, `appointments.update` (`provider`, `slot`, `status`), and
`providers` (`create` or `home_location` update). It separates route-cache learning, infeasibility
repair, and soft optimization into strict phases.

```text
  Trigger: cron '8,23,38,53 * * * *' OR model effects (dedup key: 'check_drives')
                                         |
                                         v
  +-----------------------------------------------------------------------------------+
  | 1. LOAD POOL & CHRONOLOGICAL ROUTES                                               |
  |    loadPool(ctx, now, now + booking_horizon_days)                                 |
  |    routes(): group busy stops (end > now) by (provider, local day), sort by start |
  +--------------------------------------+--------------------------------------------+
                                         |
                                         v
  +-----------------------------------------------------------------------------------+
  | 2. CACHE MISSING GOOGLE ROUTES LEGS (capped at MAX_CALLS = 25 origin cells/sweep) |
  |    For each provider-day route: legsOf(day, home_location) = [home->s1, s1->s2..] |
  |    Collect uncached directed legs (`legOf(a,b)` not in drive_times) by origin cell|
  |    learnLegs() -> POST distanceMatrix/v2:computeRouteMatrix (TRAFFIC_UNAWARE)     |
  |    ctx.act({ 'drive_times.create': learned }) (catch ActConflict / ActRefused)    |
  +--------------------------------------+--------------------------------------------+
                                         |
                                         v
  +-----------------------------------------------------------------------------------+
  | 3. REACHABILITY AUDIT UNDER UPDATED TRAVEL TIMES                                  |
  |    Walk each provider-day route [first, ...rest]:                                 |
  |      reachable = b.start >= last.end + driveMinutes(last, b, drive) + buffer      |
  |      if (!reachable && b.start > now && !b.planned) -> add b.id to `late` map     |
  +-------------------------+--------------------------------------+------------------+
                            | late.size > 0                        | late.size === 0
                            v                                      v
  +---------------------------------------------+  +----------------------------------+
  | 4a. REPAIR UNREACHABLE STOPS (returns early)|  | 4b. RELOCATE LOCAL SEARCH        |
  |  Query `late` stops still scheduled with    |  |     optimise(ctx, pool)          |
  |  HELD_SHIFT (not_due | asked | confirmed).  |  |  Movable filter:                 |
  |  reassign(ctx, rows, awayProvider):         |  |   - status = 'scheduled'         |
  |   - rank() excluding `awayProvider`         |  |   - attention = 'none'           |
  |   - update provider (or null + 'unassigned')|  |   - shift_check in HELD_SHIFT    |
  |   - if preference='preferred' & reassigned: |  |   - booking.preference = 'any'   |
  |       queue customer_notices update         |  |   - start >= now+free_change_hrs |
  |   - if unassigned > 0:                      |  |     within booking_horizon_days  |
  |       ctx.notify(policy: 'operations')      |  |  improve(pool, movable, 20 swp): |
  |  (Optimization deferred to next sweep)      |  |   - Re-rank each stop keeping    |
  +---------------------------------------------+  |     CONTINUITY=15 hysteresis     |
                                                   |   - Move only if strictly better |
                                                   |   - Stop early on fixed point    |
                                                   |  Commit moves + notify ops with  |
                                                   |  before/after total drive mins   |
                                                   +----------------------------------+
```

Because `improve()` evaluates `rank(need, pool, zone, held.provider)`, an appointment only moves to
another provider when the combined reduction in detour and convex weekly load strictly overcomes
the `CONTINUITY = 15` equivalent-minute hysteresis bonus. Preferred-provider bookings
(`preference = 'preferred'`) and stops inside `free_change_hours` are never moved by `optimise()`.

---

## 8. Pre-Shift Check-Ins, Live GPS ETAs & Dispatch Recovery

Three coordinated loops protect day-of execution: pre-shift attendance verification, live GPS
position ingestion and ETA flagging, and dispatcher-approved recovery (including provider
deactivation).

### 8.1 Pre-Shift Check-Ins & Shift Recovery (`shift_watch`)

```text
  [shift_watch] cron '2,12,22,32,42,52 * * * *' (rest: 1d, max: 1)
                + scheduled immediately by appointments.update.effect on shift_check='declined'
       |
       +---> PHASE A: ASK PROVIDERS AHEAD OF FIRST DAILY APPOINTMENT
       |       Query: status='scheduled', provider!=null, shift_check='not_due',
       |              start in [now, now + shift_check_lead_minutes]
       |       Group by (provider, local day) -> pick EARLIEST appointment per pair
       |       ctx.act: shift_check = 'asked', shift_asked_at = now (key: shift-ask:...)
       |       Notify provider: in-app (once: ask-<id>) + WhatsApp message
       |
       +---> PHASE B: PROVIDER / DESK RESPONSE (separate manual automations)
       |       * appointments_confirm_shift (policy: provider_shift)
       |         -> ownAppointments(ctx.trigger) -> sameDay() -> shift_check = 'confirmed'
       |       * appointments_decline_shift (policy: provider_shift)
       |         -> ownAppointments(ctx.trigger) -> sameDay() -> shift_check = 'declined'
       |       * appointments_report_unavailable (policy: operations)
       |         -> sameDay() -> shift_check = 'declined'
       |       (Any transition to 'declined' triggers appointments.update.effect -> shift_watch)
       |
       +---> PHASE C: HANDLE SILENT TIMEOUTS & DECLINES
               Query 1 (lapsed=true):  shift_check='asked' AND
                                       shift_asked_at <= now - shift_reply_minutes
               Query 2 (lapsed=false): shift_check='declined'
               For each unique (provider, local day):
                 1) If no provider_time_off overlaps that date:
                      create provider_time_off { period: [d, d], reason: 'unavailable' }
                      (key: time-off:<provider>:<date>)
                 2) recommend(ctx, dayAppointments, away, lapsed):
                      Load pool (NOTE: poolRequest ALSO treats existing
                      attention='awaiting_approval' proposals as busy holds so one
                      replacement provider is never double-proposed across appointments!)
                      Sort day's appointments chronologically; for each:
                        - rank() excluding `away` + updating in-memory `busy`
                        - provider = null, unavailable_provider = away,
                          proposed_provider = best?, proposed_slot = slot?,
                          attention = best ? 'awaiting_approval' : 'unassigned',
                          shift_check = 'no_response' (if lapsed), clear eta fields
                      ctx.notify(policy: 'operations', once: recommend-...)
```

### 8.2 Live GPS Ingestion & Per-Appointment ETA Fan-Out

```text
  [Client: provider/+session.svelte]  (requires: ['location:background', 'notifications'])
    api = ctx.device?.geolocation?.api ?? navigator.geolocation
    watchPosition({ enableHighAccuracy: true }) ---> unbounded Effect Queue
    Re-arm guard: Schedule.spaced('5 seconds') + document 'visibilitychange' listener
       |
       +--> Updates reactive `providerLocation.here` immediately (gates My Day buttons)
       +--> Throttled every 2 min (`EVERY = Duration.minutes(2)`):
              ctx.act({ 'providers.update': [{ target, set: { last_location } }] })
              --> providers.update.transform stamps `last_location_at = ctx.now`
                                         |
                                         v
  [Server: eta_watch]  cron '*/5 * * * *' (rest: 1d, max: 1)
    Query: status='scheduled', provider!=null,
           slot.start in [now, now + eta_check_lead_minutes]
    Fan-out: Effect.forEach -> ctx.schedule('eta_check', { appointment }, { key: eta-<id> })
                                         |
                                         v (concurrency: { max: 4 })
  [Server: eta_check]
    1) Re-verify appointment is still scheduled, assigned, inside [now, now + lead)
    2) Check GPS freshness (FRESH_MINUTES = 15):
         last_location != null AND now <= last_location_at + 15m
    3) Compute ETA:
         - Stale / missing GPS  --> eta = null
         - Fresh GPS            --> eta = driveMinutes(last_location, appt.location) [Haversine]
                                    if eta > eta_limit_minutes / 2:
                                      call google_routes (TRAFFIC_AWARE) -> override eta if ok
    4) late = (eta === null) OR (eta > eta_limit_minutes)
    5) Preserve higher-priority attention flags:
         attention = (current in ['unassigned','provider_inactive','awaiting_approval'])
                       ? current
                       : (late ? 'eta_risk' : 'none')
    6) ctx.act({ eta_minutes: eta, eta_checked_at: now, attention }, key: eta-check:<id>:<rev>)
       (catches ActConflict cleanly if row changed concurrently)
    7) If written AND late -> ctx.notify(policy: 'operations', once: eta-<id>)
```

### 8.3 Dispatcher Recovery & Provider Deactivation

- **`Recovery.svelte` + `appointments_rebook` + `appointments_accept_proposal` (`src/lib/appointment-recovery.ts`):**
  - `planRebooking()` re-validates live availability and travel via `loadPool` + `rank`.
  - Free-change cutoff guard: if `targetStart !== a.slot.start` and `!recovery` and
    `a.slot.start < now + free_change_hours`, refuses with `errors.customer_change_window`.
  - `recovery` is true when `(a.unavailable_provider !== null && a.provider === null) || a.attention === 'provider_inactive' || a.provider === null`.
  - On commit, assigns `provider`, updates `slot`, resets `attention = 'none'`, clears
    `proposed_provider` and `proposed_slot`, and queues a customer notice (reassignment or
    reschedule wording).
- **`providers_deactivate` (`src/automation/+providers_deactivate.automation.ts`):**
  - Refuses if provider is already `inactive` (`errors.provider_already_inactive`).
  - Sets `status = 'inactive'`, `inactive_since = last_day`.
  - Queries all `scheduled` appointments starting strictly after `last_day` (`last_day + 1d` local
    midnight).
  - For each appointment, calls `proposal()` in `src/lib/matching.ts`: searches shift offsets
    `[0, -60, +60, -120, +120, +1440, +2880, +4320, +5760, +7200, +8640, +10080]` minutes (same
    time, +/-1h, +/-2h, then +1..+7 days), ranking feasible candidates first by Jaccard
    `skillSimilarity(departing.skills, candidate.skills)` and second by `rank()` score.
  - Clears `provider = null`, sets `proposed_provider`, `proposed_slot`, `shift_check = 'not_due'`,
    `attention = 'provider_inactive'`, and creates customer proposal notices for every matched
    appointment.

---

## 9. Multi-Channel Notice Delivery & Revision-Conflict Recovery

Every customer notice fans out to **WhatsApp** (`deliver_notices` automation) and **Email**
(`+mail.sync.ts` bidirectional sync) concurrently. Because both channels update the same
`customer_notices` row asynchronously, the workspace uses explicit revision-conflict recovery on
WhatsApp updates and monotonic state-rank guards on email delivery reports.

```text
                       customer_notices.create (subject, body, customer, appointment?)
                                                |
                                                v
                       +-------------------------------------------------+
                       |  create.transform (as_of: 'act')                |
                       |  Reads customers.email                          |
                       |  Sets to_address = email ?? null                |
                       |  Sets delivery   = email ? 'queued' : null      |
                       +-----------------------+-------------------------+
                                               |
                     +-------------------------+-------------------------+
                     | (create.effect)                                   | (email sync outbox)
                     v                                                   v
  +----------------------------------------+          +--------------------------------------+
  | CHANNEL 1: WhatsApp (`deliver_notices`)|          | CHANNEL 2: Email (`+mail.sync.ts`)   |
  | policy: dispatch_automation (max: 1)   |          | with: 'email', policy: notice_mail   |
  +----------------------------------------+          +--------------------------------------+
  | 1. Query rows where whatsapp IS NULL   |          | write({ op, row }, ctx):             |
  | 2. Resolve single active shared        |          |   If op==='create' && to_address!=N: |
  |    `whatsapp` account (owner IS NULL)  |          |     ctx.send({ to, subject, text,    |
  | 3. deliverNoticeRows():                |          |                thread: row.id })     |
  |    Send ONCE to <digits>@s.whatsapp.net|          |                                      |
  |    Map result -> 'queued' | 'failed:..'|          | read({ deliveries }):                |
  | 4. Write `whatsapp` with row.revision  |          |   Fold mailbox lifecycle events:     |
  |    IF ActConflict (mail sync bumped    |          |     sent, deferred, delivered,       |
  |    revision concurrently):             |          |     opened, replied (excerpt<=500),  |
  |      -> Reload fresh revisions         |          |     auto_replied, bounced, failed    |
  |      -> Retry ONLY status write        |          |   Guarded by monotonic `moves()` in  |
  |         (NEVER resends WhatsApp!)      |          |   BOTH sync.read & update.transform  |
  +----------------------------------------+          +--------------------------------------+

  MONOTONIC EMAIL DELIVERY RANK (`src/lib/notice-delivery.ts`):
    queued(0) --> sent(1) --> deferred(2) --> delivered(3) --> opened(4) --> replied(5)
                                                                                 ^
    bounced(6) / failed(6)  [terminal against earlier statuses] -----------------+
                                                               (replied ALWAYS lands)
    moves(current, next) = current === null || next === 'replied' || RANK[next] > RANK[current]
```

Provider alerts (`alertProviders` in `src/lib/dispatch.ts`) follow a separate path triggered from
`appointments.create.effect` and `appointments.update.effect` (whenever `provider` or `slot`
changes on an upcoming scheduled appointment): they send per-appointment in-app notifications
(`once: assigned-<id>-<provider>-<start>`) and group multiple stops per provider into one summary
WhatsApp message.

---

## 10. Access Control, Named Outputs & Rate Limits

Access is enforced declaratively via two seeded teams (`sys_team` rows, `seed/public/sys_team.json`),
phone-challenge customer self-signup (`src/+workspace.ts`), one public app audience, and seven
policies (`src/access_control/policy/`). Policies never reshape rows ad hoc; narrower audiences
receive explicitly declared named outputs on each model.

```text
+-------------------+--------------------+------------------------+--------------------------+
| Principal / Actor | Policy             | Apps & Manual Autos    | Rate Limits (+workspace) |
+-------------------+--------------------+------------------------+--------------------------+
| Team: operations  | operations         | Apps: scheduling,      | read:  600/min           |
|                   |                    |   configuration,       | act:   600/min           |
|                   |                    |   provider             | agent: 100/h             |
|                   |                    | Autos: 10 manual autos |                          |
+-------------------+--------------------+------------------------+--------------------------+
| Team: providers   | provider           | Apps: provider         | read:  600/min           |
|                   |                    | Autos: confirm_shift,  | act:   120/min           |
|                   |                    |   decline_shift        | agent: 50/h              |
+-------------------+--------------------+------------------------+--------------------------+
| Self-signup       | customer           | Apps: portal           | read:  300/min           |
| (phone OTP ->     |                    | Autos: none            | act:   30/h              |
|  customers.phone) |                    |                        |                          |
+-------------------+--------------------+------------------------+--------------------------+
| Anonymous visitor | portal_visitor     | Apps: portal (public)  | read:  120/min           |
|                   |                    | Autos: none            | act:   (none)            |
+-------------------+--------------------+------------------------+--------------------------+
| System automation | dispatch_automation| 8 scheduled/cron autos | read:  600/min           |
|                   |                    |                        | act:   600/min           |
+-------------------+--------------------+------------------------+--------------------------+
| System automation | provider_shift     | confirm_shift,         | read:  600/min           |
| (starter-checked) |                    |   decline_shift        | act:   120/min           |
+-------------------+--------------------+------------------------+--------------------------+
| System sync       | notice_mail        | customer_notices mail  | (sync internal)          |
+-------------------+--------------------+------------------------+--------------------------+

DATA ISOLATION & VERDICT ENFORCEMENT MATRIX:
+-----------------------+---------------+--------------------+------------------+------------+
| Model                 | operations    | provider           | customer         | visitor    |
+-----------------------+---------------+--------------------+------------------+------------+
| services              | default (CRUD)| provider (R)       | customer (R,act) | portal (R) |
| openings              | default (R)   | -                  | portal (R)       | portal (R) |
| scheduling_settings   | default (CRU) | -                  | -                | -          |
| drive_times           | default (R)   | -                  | -                | -          |
| customers             | default (CRUD)| provider (R,own*)  | customer (R,self)| -          |
| customer_notices      | default (CR)  | -                  | customer (R,self)| -          |
| providers             | default+prov  | provider (R,self;  | customer (R,act) | -          |
|                       | (CRU,moves)   | U:last_location**) |                  |            |
| provider_time_off     | default (CRUD)| default (R,own)    | -                | -          |
| bookings              | default (CRU) | provider (R,own*)  | customer (R,self)| -          |
| booking_providers     | default (R)   | -                  | -                | -          |
| appointments          | default+prov  | provider (R,own;   | customer (R,self)| -          |
|                       | (RU,all moves)| U:status/shift/    |                  |            |
|                       |               | notes***)          |                  |            |
| availability_requests | -             | -                  | customer (CR****)| -          |
| booking_requests      | default (RU)  | -                  | customer (CR****)| -          |
| sys_user / sys_integ  | default (R)   | -                  | -                | -          |
+-----------------------+---------------+--------------------+------------------+------------+
  *    own*: relation filter { appointments: { some: { provider.user == actor.id } } }.
  **   providers.update verdict (errors.own_position): requires before.user === actor.id.
  ***  appointments.update moves: scheduled->in_progress, in_progress->completed; verdict
       (errors.own_appointments) verifies before.provider.user === actor.id. Shift automations
       (provider_shift) enforce starter ownership via ownAppointments(ctx.trigger).
  **** availability_requests / booking_requests create verdicts (errors.other_number):
       require after.phone === actor.phone; reads filter { phone: { eq: actor.phone } }.
```

Notice also that `operations` does **not** hold direct `create` permission on `appointments` or
`delete` permission on `bookings`/`appointments`/`providers`: new appointments are created through
`bookings.create` (or `bookings_book`), cancellations move states to `cancelled`, and provider
retirement flows through `providers_deactivate` (setting `inactive` and preserving historical
integrity).
