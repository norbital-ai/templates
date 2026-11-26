# Architecture & Inner Mechanisms (`norbital_fleet_management`)

This document explains the internal runtime topology, data ownership model, state machines,
real-time GPS telemetry propagation pipeline, route dispatch side-effects, geospatial calculation
formulas, proactive monitoring automations, and access-control boundaries of the Fleet Management
workspace. Every symbol, constraint, threshold, and formula below is verified directly against
`src/`.

## Table of Contents

1. [System Topology & Runtime Architecture](#1-system-topology--runtime-architecture)
2. [Data Model & Ownership ER Diagram](#2-data-model--ownership-er-diagram)
3. [State Machines, Locks & Write-Time Invariants](#3-state-machines-locks--write-time-invariants)
4. [Real-Time Telemetry Ingestion & Atomic Propagation Pipeline](#4-real-time-telemetry-ingestion--atomic-propagation-pipeline)
5. [Route Dispatch Lifecycle, Vehicle Destination Sync & Geospatial Engine](#5-route-dispatch-lifecycle-vehicle-destination-sync--geospatial-engine)
6. [Proactive Monitoring Automations](#6-proactive-monitoring-automations)
7. [Access Control, Authority Matrix & Rate Limits](#7-access-control-authority-matrix--rate-limits)

---

## 1. System Topology & Runtime Architecture

The workspace separates operational dispatch (`operations`) from master/telematics configuration
(`configuration`) across two Bolt apps, backed by six record models, one custom field, two HTTP
integrations, two syncs on `telemetry_pings`, two automations, and a pure-functional geospatial
library (`src/lib/geo.ts`).

```text
+----------------------------------------------------------------------------------------------+
|                                    EXTERNAL SYSTEMS & INPUTS                                 |
|                                                                                              |
|  +---------------------------+   +---------------------------+   +------------------------+  |
|  | GPS Transponder Gateway   |   | Google Routes API (opt.)  |   | Bulk GPS Log Uploads   |  |
|  | - HMAC-SHA256 webhooks    |   | - POST /distanceMatrix/   |   | - CSV / XLSX files     |  |
|  | - GET <poll_path>?since=  |   |   v2:computeRouteMatrix   |   |   via UI / file sync   |  |
|  +-------------+-------------+   +-------------+-------------+   +-----------+------------+  |
+----------------|-------------------------------|-----------------------------|---------------+
                 | webhook wake / HTTP GET       | HTTP POST (X-Goog-Api-Key)  | upload
                 v                               ^                             v
+------------------------------------------------|---------------------------------------------+
|                              BOLT HOST RUNTIME & INTEGRATION LAYER                           |
|                                                                                              |
|  +----------------------------------+    +------------------------------------------------+  |
|  | Integrations (sealed creds)      |    | Schedulers & Trigger Dispatch                  |  |
|  | - gps_transponder (20/s, Bearer, |    | - Sync poll timer: every '5min' + webhook wake |  |
|  |   HMAC-SHA256 webhook verify)    |    | - Cron: */15 * * * * (rest: '24h', max: 1)     |  |
|  | - google_routes (10/s, API Key)  |    | - Page RPC calls (mode: 'call')                |  |
|  +-----------------+----------------+    +------------------------+-----------------------+  |
+--------------------|----------------------------------------------|--------------------------+
                     v                                              v
+----------------------------------------------------------------------------------------------+
|                             WORKSPACE SERVER LAYER (src/)                                    |
|                                                                                              |
|  +----------------------------+   +-------------------------------------------------------+  |
|  | Telemetry Syncs            |   | Automations (run as system w/ policy fleet_automation)|  |
|  | - transponder (HTTP/hook)  |   | - refresh_route_eta  (mode: 'call', Google + fallback)|  |
|  | - gps_csv (CSV / XLSX)     |   | - check_fleet_health (15m cron + manual, ctx.notify)  |  |
|  +-------------+--------------+   +---------------------------+---------------------------+  |
|                |                                              |                              |
|                v                                              v                              |
|  +----------------------------------------------------------------------------------------+  |
|  | Record Models & In-Transaction / Post-Commit Engine                                    |  |
|  |   vehicles  <--(owned)--  telemetry_pings  (create.transform + create.effect)          |  |
|  |   routes    (create/update/delete.transform + atomic `with.vehicles.update`)           |  |
|  |   fleet_alerts (seq ALT-yyyy-000, native stamp resolved_at)  |  geofences  |  drivers  |  |
|  +-------------------------------------------+--------------------------------------------+  |
|                                              |                                               |
|  +-------------------------------------------v--------------------------------------------+  |
|  | Pure Domain Library: src/lib/geo.ts                                                    |  |
|  | Haversine (WGS84), geofence check, 1.22x road distance/ETA, BigDecimal, parseInstant   |  |
|  +-------------------------------------------+--------------------------------------------+  |
|                                              |                                               |
|  +-------------------------------------------v--------------------------------------------+  |
|  | Tenant Relational Store (PGlite local/test, PostgreSQL prod)                           |  |
|  | Native triggers: store_row_rules (states/stamps/revisions), store_statement_rules      |  |
|  | (locks + exceptions), store_json_valid (custom/point shapes), bolt_search_* indexes    |  |
|  +----------------------------------------------------------------------------------------+  |
+----------------------------------------------^-----------------------------------------------+
                                               | PageBolt queries, ctx.act, ctx.run
+----------------------------------------------|-----------------------------------------------+
|                               WORKSPACE UI & AGENT LAYER                                     |
|                                                                                              |
|  +-------------------------------------------+  +-----------------------------------------+  |
|  | App: operations (Fleet Operations)        |  | App: configuration (Configuration)      |  |
|  | - live     : Split(Map + Live Alerts)     |  | - connections : IntegrationSetup cards  |  |
|  | - vehicles : Table -> 5-tab Vehicle Hub   |  | - geofences   : Split(Table + Zone Map) |  |
|  | - routes   : Tabs(Daily Schedule | All)   |  | - drivers     : Driver Directory Table  |  |
|  | - alerts   : Exception Register Table     |  +-----------------------------------------+  |
|  +-------------------------------------------+                                               |
|  | Custom Field Renderer: route_waypoints (+renderer.svelte, waypoint-status.svelte)      |  |
|  | Workspace Assistant  : src/agent/+agent.md (Fleet Operations Assistant)                |  |
|  +----------------------------------------------------------------------------------------+  |
+----------------------------------------------------------------------------------------------+
```

### Key Architectural Properties

- **Idle-friendly external polling:** `telemetry_pings.syncs.transponder` performs its HTTP `GET`
  against the external gateway _before_ opening any workspace database query. When no new pings
  return, it exits immediately without waking an idle tenant database.
- **Atomic cross-model coupling:** Route dispatch/reassignment/completion updates the assigned
  `vehicles` record inside the same write transaction via `transform` `with: { vehicles: { update } }`,
  while telemetry ping bursts reconcile vehicles, active routes, and alerts in one idempotent
  post-commit `ctx.act` keyed by `ping-effect:<ordered-ping-ids>`.
- **Database-enforced invariants:** State transitions, terminal record locks (`posted_locked`,
  `closed_locked`, `resolved_locked`), lock exceptions (`cargo_notes`, `resolution_notes`), native
  `resolved_at` timestamp stamping, partial uniqueness on `external_ping_id`, and numeric check
  constraints execute directly inside PostgreSQL / PGlite triggers and constraints generated from
  the model declarations.

---

## 2. Data Model & Ownership ER Diagram

The workspace defines 6 models (`vehicles`, `telemetry_pings`, `routes`, `fleet_alerts`,
`geofences`, `drivers`) and 1 custom field (`route_waypoints`).

```text
+------------------------------------+            +------------------------------------------+
| drivers                            |            | geofences                                |
+------------------------------------+            +------------------------------------------+
| PK  id                             |            | PK  id                                   |
| UK* employee_code   (import_key)   |            | UK* code              (import_key)       |
|     full_name                      |            |     name                                 |
|     license_number?                |            |     zone_type (depot|job_site|customer|  |
|     license_class (class_3..crane) |            |                corridor|restricted)      |
|     license_expiry? (date)         |            |     center            (point)            |
|     phone? / email?                |            |     radius_m          (int >= 25, 250)   |
|     status (active|on_leave|       |            |     speed_limit_kmh?  (dec(1) > 0)       |
|             suspended|inactive)    |            |     alert_on_enter    (bool, false)      |
|     notes?          (markdown)     |            |     alert_on_exit     (bool, false)      |
+--------+-------------------------+-+            |     active            (bool, true)       |
         | 1                       | 1            |     notes?            (markdown)         |
         | driver_id?              |              +--------------------+---------------------+
         | on_delete:set_null      | driver_id?                        | 1
         | 0..*                    | on_delete:set_null                | geofence_id?
         v                         | 0..*                              | on_delete:set_null
+-------------------------------+  |                                   | 0..*
| vehicles                      |  |                                   |
+-------------------------------+  |                                   |
| PK  id                        |  |                                   |
| UK* registration_no (imp_key) |  |                                   |
| UK  transponder_id            |  |                                   |
|     vehicle_name              |  |                                   |
|     vehicle_type (van..car)   |  |                                   |
|     status (available,        |  |                                   |
|       en_route, idle, stopped,|  |                                   |
|       maintenance, offline)   |  |                                   |
|     last_location?  (point)   |  |                                   |
|     current_speed_kmh (>=0)   |  |                                   |
|     speed_limit_kmh   (>0)    |  |                                   |
|     heading_deg?              |  |                                   |
|     ignition_on     (bool)    |  |                                   |
|     odometer_km     (>=0)     |  |                                   |
|     fuel_pct?       (0..100)  |  |                                   |
|     destination_label?        |  |                                   |
|     destination_location?     |  |                                   |
|     last_ping_at?   (instant) |  |                                   |
| CEL is_overspeed =            |  |                                   |
|       current > speed_limit   |  |                                   |
|     notes?                    |  |                                   |
+--+------------+-----------+---+  |                                   |
   | 1          | 1         | 1    |                                   |
   | owned:true | restrict  | cascade                                  |
   | (cascade)  |           |      |                                   |
   | 0..*       | 0..*      | 0..* |                                   |
   |            |           +------|--------------------+              |
   |            v                  v                    v              v
   |   +---------------------------------------+      +--------------------------------------+
   |   | routes                                |      | fleet_alerts                         |
   |   +---------------------------------------+      +--------------------------------------+
   |   | PK  id                                |      | PK  id                               |
   |   | SEQ route_number    (RTE-{yyyy}-{000})|      | SEQ alert_number  (ALT-{yyyy}-{000}) |
   |   |     title                             |      | FK  vehicle_id    (cascade)          |
   |   | ST  status (planned->dispatched->     |      | FK? route_id      (set_null)         |
   |   |       en_route->arrived->completed|   |<-----+ FK? geofence_id   (set_null)         |
   |   |       cancelled)                      | 1 0..*|    alert_type (overspeed|offline|   |
   |   |     origin_name / origin_location     |      |       geofence_enter|geofence_exit|  |
   |   |     destination_name / _location      |      |       route_delay)                   |
   |   | CF  waypoints?    (route_waypoints[]) |      |     severity (info|warning|critical) |
   |   |     planned_departure / _arrival      |      | ST  status (open<->ack->resolved)    |
   |   |     actual_departure? / _arrival?     |      |     recorded_at   (instant)          |
   |   |     planned_distance_km / actual_km?  |      |     location?     (point)            |
   |   |     eta_minutes? / max_speed_rec?     |      |     measured_speed_kmh? / limit_kmh? |
   |   |     cargo_notes?                      |      |     summary                          |
   |   | CHK planned_arrival >= _departure     |      |     resolution_notes?                |
   |   | LCK closed_locked (except cargo_notes)|      |     resolved_at?  (native stamp)     |
   |   +-------------------+-------------------+      | LCK resolved_locked (except res.note)|
   |                       | 1                        +--------------------------------------+
   |                       | route_id? (on_delete: set_null)
   v 0..*                  v 0..*
+----------------------------------------------------------------------------------------------+
| telemetry_pings  (owned child of vehicles; append-only; create-only API)                     |
+----------------------------------------------------------------------------------------------+
| PK  id  |  FK vehicle_id (owned:true)  |  FK? route_id (set_null)  |  transponder_id         |
| recorded_at (instant) | location (point) | speed_kmh (>=0) | heading_deg? | altitude_m?      |
| ignition_on (bool) | odometer_km? (>=0) | fuel_pct? (0..100) | hdop? (scale 2)               |
| source (transponder_sync|csv_import|manual) | external_ping_id?                              |
| PUK (vehicle_id, external_ping_id) WHERE external_ping_id IS NOT NULL                        |
| LCK posted_locked: recorded_at IS NOT NULL (no updates or deletes once committed)            |
+----------------------------------------------------------------------------------------------+

Legend:
  PK  = primary key (UUID)      UK* = unique + import_key    PUK = partial unique index
  FK  = required ref            FK? = optional ref           SEQ = auto-sequence
  ST  = state machine field     CEL = computed expression    CF  = custom field
  CHK = SQL check constraint    LCK = DB statement lock
```

### Custom Field: `route_waypoints`

Declared in `src/data/custom_field/route_waypoints/+custom_field.ts` and stored on `routes.waypoints`:

| Property     | Type / Bounds                                     | Notes                                                         |
| ------------ | ------------------------------------------------- | ------------------------------------------------------------- |
| `name`       | `text`                                            | Stop label                                                    |
| `lat`        | `number`, `min: -90`, `max: 90`                   | Enforced at DB JSON-validation boundary (`store_json_valid`)  |
| `lng`        | `number`, `min: -180`, `max: 180`                 | Enforced at DB JSON-validation boundary                       |
| `eta`        | `time`, optional                                  | Parsed via `PlainTimeSchema` (`HH:MM[:SS]`) in edit UI        |
| `arrived_at` | `time`, optional                                  | Parsed via `PlainTimeSchema` (`HH:MM[:SS]`) in edit UI        |
| `status`     | `enum`: `pending \| arrived \| skipped`, optional | Rendered as accessible radio group (`waypoint-status.svelte`) |

The renderer (`+renderer.svelte`) supports three modes:

- **Edit mode:** Add/remove stop cards with coordinate range clamping, `TimeInput` editors, and `WaypointStatus` radio buttons (defaults new stops to `{ name: '', lat: 1.3521, lng: 103.8198, status: 'pending' }`).
- **Dense show mode (`dense === true`):** Compact count badge (`{arrived}/{total} stops arrived`).
- **Full show mode:** Tabular stop list with stop index, name, 4-decimal coordinates, ETA, arrival time, and status badge.

---

## 3. State Machines, Locks & Write-Time Invariants

Four models enforce distinct lifecycle and immutability rules at the database trigger layer
(`store_row_rules` and `store_statement_rules` in `migrations/0001_initial.sql`).

```text
(A) routes.status  (initial: planned)
=====================================

  +-----------+  dispatch   +--------------+  depart    +------------+  reach    +-----------+
  |  planned  |------------>|  dispatched  |----------->|  en_route  |---------->|  arrived  |
  +-----+-----+             +------+-------+            +-----+------+           +-----+-----+
        |   \                      |                          |    \                   |
        |    \----- depart --------|------------------------->|     \                  |
        |                          |                          |      \-- complete -+   |
        | cancel                   | cancel                   | cancel             |   | finish
        v                          v                          v                    v   v
  +--------------------------------------+              +------------------------------------+
  |              cancelled               |              |             completed              |
  +--------------------------------------+              +------------------------------------+
  | LOCK: closed_locked                  |              | LOCK: closed_locked                |
  | - Blocks delete & all field edits    |              | - Blocks delete & all field edits  |
  | - Exception: `cargo_notes` editable  |              | - Exception: `cargo_notes` editable|
  | - Clears vehicle destination & sets  |              | - Stamps `actual_arrival`, ETA = 0 |
  |   vehicle status = available*        |              | - Clears vehicle destination &     |
  +--------------------------------------+              |   sets vehicle status = available* |
                                                        +------------------------------------+
  Side-effects on transitions:
  - * -> en_route           : stamps actual_departure = ctx.now (if null); sets vehicle
                              destination + status = en_route*
  - * -> dispatched         : writes vehicle destination_label + destination_location
  - * -> arrived            : stamps actual_arrival = ctx.now (if null); sets eta_minutes = 0
  - delete(dispatched |     : clears vehicle destination + sets vehicle status = available*
    en_route | arrived)
  (* never overwrites vehicle.status when vehicle.status === 'maintenance')


(B) fleet_alerts.status  (initial: open; create + update only, no delete verb)
==============================================================================

  +--------+   acknowledge    +----------------+
  |  open  |----------------->|  acknowledged  |
  |        |<-----------------|                |
  +---+----+      reopen      +-------+--------+
      |                               |
      +----------- resolve -----------+
                      |
                      v
  +--------------------------------------------+
  |                  resolved                  |
  +--------------------------------------------+
  | NATIVE STAMP: resolved_at = write timestamp|
  | LOCK: resolved_locked                      |
  | - Blocks updates to status, severity, etc. |
  | - Exception: `resolution_notes` editable   |
  +--------------------------------------------+


(C) vehicles.status  (enum field, default: available)
=====================================================

  +---------------+        route -> en_route OR ping speed > 3 km/h        +------------+
  |   available   |------------------------------------------------------->|  en_route  |
  +-------^-------+                                                        +---+----+---+
          |                                                                    |    |
          | route completed/cancelled/deleted                     ping <= 3    |    | >30m no
          | (or prior vehicle on reassignment)                   + ign_on=true |    | ping
          |                                                                    v    |
  +-------+-------+     ping speed <= 3 & ignition_on = false              +--------+---+
  |    stopped    |<------------------------------------------------------>|    idle    |
  +---------------+                                                        +------+-----+
                                                                                  | >30m no
  +---------------+     check_fleet_health (cron 15m / manual):                   | ping
  |  maintenance  |     en_route or idle with (now - last_ping_at) >= 30m         v
  +---------------+     sets status = offline, current_speed_kmh = '0.0'   +------------+
  | Immune to     |                                                        |  offline   |
  | telemetry &   |     next incoming telemetry ping (isLatest = true)     +------+-----+
  | route status  |     re-derives en_route / idle / stopped automatically        |
  | overwrites    |<--------------------------------------------------------------+
  +---------------+


(D) telemetry_pings immutability  (create-only verb)
====================================================

  INSERT --[store_row_rules]--> COMMITTED ROW
                                     |
          +--------------------------+--------------------------+
          | UPDATE or DELETE (direct)                           | Parent vehicle DELETE
          v                                                     v
     REFUSED by `posted_locked`                            CASCADE DELETE
     (`recorded_at IS NOT NULL`)                           (`vehicle_id` owned: true)
```

---

## 4. Real-Time Telemetry Ingestion & Atomic Propagation Pipeline

Telemetry flows in through three paths (`transponder` HTTP/webhook sync, `gps_csv` file sync, or
manual `telemetry_pings.create`) and converges on one transform (`create.transform`) and one
idempotent post-commit propagation effect (`create.effect`).

```text
 INGRESS 1: Live Gateway                INGRESS 2: Bulk File                INGRESS 3: Direct
 -----------------------                --------------------                -----------------
 GPS Gateway webhook (HMAC-SHA256)      Dispatcher uploads CSV / XLSX       Manual API / UI act
   | wakes sync immediately             to telemetry_pings.$import.gps_csv  telemetry_pings.act
   | (fallback poll: every '5min')        |                                   |
   v                                      v                                   |
 +---------------------------------+    +---------------------------------+   |
 | +transponder.sync.ts            |    | +gps_csv.sync.ts                |   |
 | 1. GET <poll_path>?since=cursor |    | 1. Query vehicles (limit 1000)  |   |
 |    BEFORE querying DB!          |    | 2. Match transponder_id OR      |   |
 | 2. normalizeTransponderPayload  |    |    registration_no (uppercase)  |   |
 |    - aliases: imei/device_id/   |    |    - unmatched -> finding: warn |   |
 |      lat/latitude/lng/lon/etc.  |    | 3. Validate row bounds:         |   |
 |    - strict zoned parseInstant  |    |    - lat [-90..90], lng [-180..]|   |
 |    - reject bad coords/dates    |    |    - speed >= 0, odo >= 0,      |   |
 | 3. If 0 pings: return cursor    |    |      fuel [0..100]              |   |
 |    unchanged (DB stays asleep)  |    |    - violation -> finding:refuse|   |
 | 4. Query matching vehicles      |    |      (aborts entire import run) |   |
 | 5. Advance cursor strictly to   |    | 4. Normalize heading mod 360,   |   |
 |    max matched ping recorded_at |    |    ignition = field ?? speed>1  |   |
 | 6. $id = ext_id ?? xpdr:time    |    |    source = 'csv_import'        |   |
 +----------------+----------------+    +----------------+----------------+   |
                  |                                      |                    |
                  +-------------------+------------------+--------------------+
                                      |
                                      v
 +--------------------------------------------------------------------------------------------+
 | telemetry_pings.create.transform  (runs pre-commit with as_of: 'act')                      |
 | - Fetches parent vehicles' transponder_id & active routes (status IN dispatched, en_route) |
 | - Backfills missing transponder_id from vehicle.transponder_id                             |
 | - Auto-links route_id to the vehicle's active route if set.route_id was omitted            |
 +------------------------------------+-------------------------------------------------------+
                                      | DB constraints: non_negative_speed, valid_odometer,
                                      | valid_fuel, partial unique (vehicle_id, ext_ping_id)
                                      v
 +--------------------------------------------------------------------------------------------+
 | telemetry_pings.create.effect  (post-commit; batch-safe & out-of-order resilient)          |
 |                                                                                            |
 | 1. Query affected vehicles, ALL active geofences (limit 500), and active routes (lim 200)  |
 | 2. Sort batch chronologically: (DateTime.toEpochMillis(recorded_at) ASC, batch index ASC)  |
 | 3. For each ping in chronological order:                                                   |
 |    +------------------------------------------------------------------------------------+  |
 |    | isLatest = (recorded_at >= priorUpdate.recordedAt ?? vehicle.last_ping_at)         |  |
 |    |                                                                                    |  |
 |    | (a) Geofence Scan (all active zones; Haversine <= radius_m):                       |  |
 |    |     - If inside & zone.speed_limit_kmh < effectiveLimit -> lower effectiveLimit    |  |
 |    |     - If isLatest ONLY (prevents spurious historical backfill transitions):        |  |
 |    |         nowInside && !wasInside && alert_on_enter -> geofence_enter                |  |
 |    |           (severity: restricted ? 'critical' : 'info')                             |  |
 |    |        !nowInside &&  wasInside && alert_on_exit  -> geofence_exit                 |  |
 |    |           (severity: depot      ? 'warning'  : 'info')                             |  |
 |    |                                                                                    |  |
 |    | (b) Exact BigDecimal Overspeed Check (evaluated for every ping):                   |  |
 |    |     - speedDec > effectiveLimit:                                                   |  |
 |    |         excess = BigDecimal.subtract(speedDec, effectiveLimit)                     |  |
 |    |         severity = (excess >= 15) ? 'critical' : 'warning'                         |  |
 |    |         links geofence_id if a zone override lowered effectiveLimit                |  |
 |    |                                                                                    |  |
 |    | (c) Vehicle Live Snapshot (if isLatest ONLY):                                      |  |
 |    |     - Advance latestLocationByVehicle for subsequent pings in the same batch       |  |
 |    |     - status = deriveVehicleStatus(vehicle.status, speedDec, ignitionOn)           |  |
 |    |     - Monotonic odometer: accept after.odometer_km ONLY if >= currentOdo           |  |
 |    |     - Null-preserving heading_deg & fuel_pct (keep prior non-null if ping omits)   |  |
 |    |                                                                                    |  |
 |    | (d) Active Route Metrics (if activeRoute && (isLatest || after.route_id==active)): |  |
 |    |     - Monotonic max_speed_recorded_kmh = max(prevPeak, speedDec)                   |  |
 |    |     - eta_minutes = estimateEtaMinutes(...) (only updated when isLatest)           |  |
 |    +------------------------------------------------------------------------------------+  |
 | 4. Commit ONE atomic idempotent act with key `ping-effect:<ordered-ping-ids>`:             |
 |      ctx.act({ 'vehicles.update', 'routes.update', 'fleet_alerts.create' })                |
 +--------------------------------------------------------------------------------------------+
```

### Boundary & Consistency Invariants

- **Vendor payload normalization (`normalizeTransponderPayload`):** Accepts a single object, a raw
  array, or an envelope keyed by `pings`, `positions`, `telemetry`, `items`, `data`, or `records`.
  Recognizes common hardware aliases (`transponder_id`/`device_id`/`imei`/`unit_id`/`tracker_id`,
  nested `location`/`position`/`coords`, `lat`/`latitude`, `lng`/`lon`/`longitude`,
  `recorded_at`/`timestamp`/`fix_time`/`gps_time`/`at`, `speed_kmh`/`speed`/`velocity_kmh`,
  `heading_deg`/`heading`/`course`/`bearing`, `altitude_m`/`altitude`/`alt`,
  `odometer_km`/`odometer`, `fuel_pct`/`fuel_level`/`fuel`, `hdop`/`accuracy_hdop`,
  `ignition_on`/`ignition`/`acc`, `external_ping_id`/`ping_id`/`event_id`/`id`).
- **Strict timestamp validation (`parseInstant`):** Requires an explicit ISO-8601 timezone designator
  (`Z` or `±HH:MM`) and verifies round-trip UTC calendar parts to reject impossible rollover dates
  such as `2026-02-30T00:00:00Z`. Explicit malformed timestamps drop the entry; omitted timestamps
  fall back to `ctx.now`.
- **Exact overspeed arithmetic:** Uses `Effect.BigDecimal` subtraction (`35.3 - 20.3 = 15.0`,
  classifying `>= 15` as `critical`) rather than IEEE-754 floating-point math where
  `35.3 - 20.3 === 14.999999999999996` would misclassify the boundary as `warning`.
- **Partial unique deduplication:** `telemetry_pings` allows multiple manual pings with
  `external_ping_id = NULL` on the same vehicle, while rejecting duplicate non-null
  `(vehicle_id, external_ping_id)` pairs with `ActRefused`.

---

## 5. Route Dispatch Lifecycle, Vehicle Destination Sync & Geospatial Engine

### Route Write Transforms & Cross-Model Vehicle Coupling

Every route mutation runs an inline `transform` (`src/data/model/routes/+model.ts`) that keeps
computed metrics and parent vehicle destination/status state synchronized atomically:

```text
+----------------------------------------------------------------------------------------------+
|                             ROUTES TRANSFORM & VEHICLE SYNC                                  |
+----------------------------------------------------------------------------------------------+
|                                                                                              |
|  routes.create.transform                                                                     |
|  -----------------------                                                                     |
|  1. Query assigned vehicle (`driver_id`, `last_location`, `current_speed_kmh`, as_of:'act')  |
|  2. Inherit `driver_id` from `vehicle.driver_id` when omitted                                |
|  3. Compute `planned_distance_km = computeRouteDistanceKm(origin, dest, waypoints)`          |
|  4. Compute `eta_minutes` (if omitted) from `vehicle.last_location ?? origin` -> `dest`      |
|                                                                                              |
|  routes.update.transform                                                                     |
|  -----------------------                                                                     |
|  1. Query both `before.vehicle_id` and `after.vehicle_id` (as_of: 'act')                     |
|  2. If geometry changed (`origin_location` | `destination_location` | `waypoints`):          |
|       - Recompute `planned_distance_km`                                                      |
|       - Recompute `eta_minutes` (unless `eta_minutes` was explicitly provided in the write)  |
|  3. Lifecycle timestamping:                                                                  |
|       - status -> 'en_route' & actual_departure == null  ==> actual_departure = ctx.now      |
|       - status -> 'arrived' | 'completed'                ==> eta_minutes = 0;                |
|         (& actual_arrival == null)                           actual_arrival = ctx.now        |
|  4. Atomic `with: { vehicles: { update } }` synchronization:                                 |
|       - Reassignment (before.vehicle_id != after.vehicle_id && before was active):           |
|           prior vehicle --> destination = null, status = 'available' (unless maintenance)    |
|       - Active route (`dispatched` | `en_route`) with status/vehicle/destination change:     |
|           target vehicle --> destination_label = destination_name,                           |
|                              destination_location = destination_location,                    |
|                              status = 'en_route' (when route='en_route' & not maintenance)   |
|       - Closing transition (`completed` | `cancelled`):                                      |
|           target vehicle --> destination = null, status = 'available' (unless maintenance)   |
|                                                                                              |
|  routes.delete.transform                                                                     |
|  -----------------------                                                                     |
|  - If deleted route status IN ('dispatched', 'en_route', 'arrived'):                         |
|      atomic `with.vehicles.update` --> destination = null, status = 'available' (if != maint)|
+----------------------------------------------------------------------------------------------+
```

### Geospatial & Precision Formulas (`src/lib/geo.ts`)

```text
+----------------------------------------------------------------------------------------------+
|                              CORE FORMULAS (src/lib/geo.ts)                                  |
+----------------------------------------------------------------------------------------------+
|                                                                                              |
| 1. Great-Circle Distance (WGS84 mean radius R = 6371.0088 km):                               |
|      h = sin^2(dLat/2) + cos(lat1) * cos(lat2) * sin^2(dLng/2)                               |
|      haversineKm(a, b)     = 2 * R * asin(min(1, sqrt(h)))                                   |
|      haversineMeters(a, b) = haversineKm(a, b) * 1000                                        |
|                                                                                              |
| 2. Circular Geofence Containment:                                                            |
|      isInsideGeofence(point, center, radius_m)  <==>  haversineMeters(point, center) <= r    |
|                                                                                              |
| 3. Planned Polyline Road Distance (km, scale 2, half-even BigDecimal):                       |
|      points = [origin, ...valid(waypoints), destination]                                     |
|      planned_distance_km = round_half_even( sum(haversineKm(p[i-1], p[i])) * 1.22 , 2 )      |
|                                                                                              |
| 4. GPS-Based ETA Estimation (whole minutes):                                                 |
|      straightKm = haversineKm(current, destination)                                          |
|      if straightKm < 0.08 km (80 m)  -->  return 0                                           |
|      roadKm         = straightKm * 1.22                                                      |
|      effectiveSpeed = (rawSpeed >= 15) ? min(95, rawSpeed) : max(20, fallback = 42)          |
|      eta_minutes    = max(1, ceil((roadKm / effectiveSpeed) * 60))                           |
|                                                                                              |
| 5. Live Vehicle Status Derivation (exact BigDecimal threshold = 3 km/h):                     |
|      currentStatus == 'maintenance'  -->  'maintenance'                                      |
|      speedKmh > 3                    -->  'en_route'                                         |
|      ignitionOn == true              -->  'idle'                                             |
|      otherwise                       -->  'stopped'                                          |
+----------------------------------------------------------------------------------------------+
```

---

## 6. Proactive Monitoring Automations

Both automations run under the reserved system identity with `policies: ['fleet_automation']`.

### (A) `refresh_route_eta` (`mode: 'call'`, on-demand RPC)

Triggered from **Live Map** and **Dispatch & Routes** toolbars (or via assistant/API) by users holding `fleet_operations`:

```text
  Caller (fleet_operations) invokes ctx.run('refresh_route_eta', {})
     |
     v
  Query in parallel:
   - routes       WHERE status IN ('dispatched', 'en_route') (join vehicle last_location, speed)
   - fleet_alerts WHERE alert_type = 'route_delay' AND status IN ('open', 'acknowledged')
   - sys_integration WHERE integration = 'google_routes' AND active = true AND owner IS NULL
     |
     | (if 0 active routes --> return { updated_routes: 0, delay_alerts_created: 0, ... })
     v
  For each active route:
   +----------------------------------------------------------------------------------------+
   | origin = vehicle.last_location ?? route.origin_location                                |
   |                                                                                        |
   |  Is google_routes active?                                                              |
   |    +-- YES --> POST /distanceMatrix/v2:computeRouteMatrix                              |
   |    |           (travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE')               |
   |    |           - condition == 'ROUTE_EXISTS' -> ceil(durationSeconds / 60), min 1      |
   |    |           - HTTP error / catch          -> returns null (silent fallback)         |
   |    +-- NO / null --> estimateEtaMinutes(origin, destination_location, current_speed)   |
   |                                                                                        |
   |  If nextEta != route.eta_minutes --> stage routes.update { eta_minutes: nextEta }      |
   |                                                                                        |
   |  Delay check:                                                                          |
   |    projected = now + nextEta minutes                                                   |
   |    if projected > planned_arrival:                                                     |
   |      delayMinutes = round((projected - planned_arrival) / 60_000)                      |
   |      if delayMinutes >= 15 AND route.id NOT IN open/acknowledged route_delay alerts:   |
   |        severity = (delayMinutes >= 45) ? 'critical' : 'warning'                        |
   |        stage fleet_alerts.create (alert_type: 'route_delay')                           |
   +----------------------------------------------------------------------------------------+
     |
     v
  Single ctx.act({ 'routes.update', 'fleet_alerts.create' })
  Return { updated_routes, delay_alerts_created, used_google_routes }
```

### (B) `check_fleet_health` (`cron: '*/15 * * * *'`, `rest: '24h'`, `concurrency: { max: 1 }`)

Runs automatically every 15 minutes (with 24-hour rest when idle) and can also be triggered manually from **Live Map**:

```text
  Cron (*/15 * * * *) OR Manual trigger (fleet_operations)
     |  concurrency: { max: 1 }
     v
  Query in parallel:
   - vehicles     WHERE status IN ('en_route', 'idle') AND last_ping_at IS NOT NULL (lim 500)
   - fleet_alerts WHERE alert_type = 'offline' AND status IN ('open', 'acknowledged') (lim 500)
     |
     v
  For each candidate vehicle:
   +----------------------------------------------------------------------------------------+
   | age = DateTime.distance(vehicle.last_ping_at, ctx.now)                                 |
   | If age < 30 minutes --> skip                                                           |
   |                                                                                        |
   | staleMinutes = round(age / 60_000)                                                     |
   | Stage vehicles.update { status: 'offline', current_speed_kmh: '0.0' }                  |
   |                                                                                        |
   | If vehicle.id NOT IN existing open/acknowledged offline alerts:                        |
   |   severity = (staleMinutes >= 90) ? 'critical' : 'warning'                             |
   |   Stage fleet_alerts.create (alert_type: 'offline', location: vehicle.last_location)   |
   +----------------------------------------------------------------------------------------+
     |
     v
  Single ctx.act({ 'vehicles.update', 'fleet_alerts.create' })
     |
     +-- If newAlerts.length > 0:
     |     ctx.notify({
     |       title: "Fleet health: <N> vehicle transponder(s) offline",
     |       description: first 3 alert summaries joined with middle-dot separator,
     |       to: [{ policy: 'fleet_operations' }],
     |       once: "fleet-offline:<ctx.today>:<sorted-vehicle-ids>"
     |     })
     |     (per-day, per-vehicle-set `once` key prevents colliding alerts when distinct
     |      vehicles drop offline at different times on the same day)
     v
  Return { checked_vehicles, marked_offline, alerts_created }
```

---

## 7. Access Control, Authority Matrix & Rate Limits

Policies in `src/access_control/policy/*.policy.ts` and the seeded `sys_team` rows
(`seed/public/sys_team.json`, edited by an administrator afterwards) implement strict separation
between operations and configuration; none of the three teams has a parent.

```text
  TEAMS / ACTORS              POLICIES                 CAPABILITIES & SCOPE
  ==============              ========                 ====================

  fleet_administrators --+--> fleet_configuration ---> App:  configuration
  (Fleet Administrators) |                             CRUD: geofences, drivers,
                         |                                   sys_integration
                         |
                         +-+> fleet_operations ------> CRUD: vehicles, routes (*all moves)
                         | |                           C:    telemetry_pings
  fleet_dispatchers -----+-+                           C/U*: fleet_alerts (*all moves)
  (Fleet Dispatchers)    | |                           Auto: refresh_route_eta,
                         | |                                 check_fleet_health
                         | |                           Sync: telemetry_pings.transponder
                         | |
                         +-+-+> fleet_read ----------> App:  operations
  fleet_viewers ---------+-+-+  (Limits in +workspace: Read: all 6 domain models
  (Fleet Viewers)                act 600/m, read 600/m,
                                 agent 100/h)

  System identity ----------> fleet_automation ------> Read: vehicles, telemetry_pings,
  (syncs & automations)                                      routes, fleet_alerts,
                                                             geofences, sys_integration
                                                       U:    vehicles
                                                       C:    telemetry_pings
                                                       U*:   routes (*all moves)
                                                       C/U*: fleet_alerts (*all moves)
```

### Complete Permission Matrix

| Resource / Action             | `fleet_read` (`fleet_viewers`) | `fleet_operations` (+read = `fleet_dispatchers`) | `fleet_configuration` (+ops+read = `fleet_administrators`) | `fleet_automation` (system)                      |
| ----------------------------- | ------------------------------ | ------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------ |
| App: `operations`             | Access                         | Access (via `fleet_read`)                        | Access (via `fleet_read`)                                  | —                                                |
| App: `configuration`          | —                              | —                                                | Access                                                     | —                                                |
| `vehicles`                    | Read                           | Read, Create, Update, Delete                     | Read, Create, Update, Delete                               | Read, Update                                     |
| `telemetry_pings`             | Read                           | Read, Create (incl. `gps_csv` import)            | Read, Create                                               | Read, Create                                     |
| `routes`                      | Read                           | Read, Create, Update (all moves), Delete         | Read, Create, Update (all moves), Delete                   | Read, Update (all moves)                         |
| `fleet_alerts`                | Read                           | Read, Create, Update (all moves)                 | Read, Create, Update (all moves)                           | Read, Create, Update (all moves)                 |
| `geofences`                   | Read                           | Read                                             | Read, Create, Update, Delete                               | Read                                             |
| `drivers`                     | Read                           | Read                                             | Read, Create, Update, Delete                               | —                                                |
| `sys_integration`             | —                              | —                                                | Read, Create, Update, Delete                               | Read                                             |
| `refresh_route_eta`           | —                              | Manual invoke                                    | Manual invoke                                              | Executes under `fleet_automation`                |
| `check_fleet_health`          | —                              | Manual invoke                                    | Manual invoke                                              | Cron + executes under `fleet_automation`         |
| `telemetry_pings.transponder` | —                              | Manual sync trigger                              | Manual sync trigger                                        | Poll/webhook + executes under `fleet_automation` |

### UI Capability Gating

Pages adapt automatically from `ctx.catalog` so unauthorized controls are never rendered even
before server-side policy checks run:

- **Live Map (`+live.page.svelte`):** Shows `Refresh live ETAs` only when `ctx.catalog?.routes?.update` exists and `Check transponder health` only when `ctx.catalog?.vehicles?.update` exists.
- **Dispatch & Routes (`+routes.page.svelte`):** Shows `New dispatch` only when `ctx.catalog?.routes?.create` exists and `Refresh live ETAs` only when `ctx.catalog?.routes?.update` exists.
- **Vehicle Hub (`vehicles/+representation.svelte`):** Enables scoped `Routes` / `Alerts` creation sheets only when `ctx.catalog?.routes?.create` / `ctx.catalog?.fleet_alerts?.create` are present.
- **Connections (`+connections.page.svelte`):** Queries `sys_integration` only when `ctx.catalog?.sys_integration` exists and renders `Add` connection buttons only when `ctx.catalog?.sys_integration?.create` exists.
