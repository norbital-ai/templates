# Source Reference (`norbital-fleet-management`)

Exact, file-by-file inventory of the Fleet Management workspace verified against `src/`,
`migrations/`, `seed/`, and `tests/`. See [architecture.md](architecture.md) for diagrams of how
these components interact at runtime.

## Workspace Manifest, i18n & Agent Brief

| File                       | Purpose                                                                                                                                                                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/+workspace.ts`        | Workspace defaults: `tz: 'Asia/Singapore'`, `locale: 'en-SG'`, `languages: ['en', 'zh']`, `currency: 'SGD'`, theme (`palette: 'crisp'`, `accent: 'blue'`, `radius: 'default'`), apps `['operations', 'configuration']`, and rate limits (`fleet_read`: `act: '600/min'`, `read: '600/min'`, `agent: '100/h'`). |
| `src/i18n/+messages.ts`    | English (`en`) UI, app/page, model, field, enum, state, waypoint, integration, and CSV schema message catalog.                                                                                                                                                                                                 |
| `src/i18n/+zh.messages.ts` | Simplified Chinese (`zh`) counterpart covering every catalog key.                                                                                                                                                                                                                                              |
| `src/agent/+agent.md`      | Brief for the built-in **Fleet Operations Assistant** summarizing append-only telemetry rules, route destination sync, isolated configuration, and operational actions.                                                                                                                                        |
| `src/agent/AGENTS.md`      | Workspace-level contributor summary and validation gates (`bolt check`, `bolt build`, `bolt test`).                                                                                                                                                                                                            |

## Custom Fields (1)

### `route_waypoints` (`src/data/custom_field/route_waypoints/`)

| File                     | Purpose                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `+custom_field.ts`       | Ordered array (`many: true`) of waypoint objects: `name` (`text`), `lat` (`number`, `-90..90`), `lng` (`number`, `-180..180`), `eta?` (`time`), `arrived_at?` (`time`), `status?` (`pending \| arrived \| skipped`).      |
| `+renderer.svelte`       | Multi-mode custom field UI: interactive stop editor (add/remove, coordinate validation, `TimeInput` via `parsePlainTime`, `WaypointStatus`), dense summary (`{arrived}/{total} stops arrived`), and read-only stop table. |
| `waypoint-status.svelte` | Accessible `create_radio_group` selector for `pending` / `arrived` / `skipped` waypoint states.                                                                                                                           |

## Record Models (6) & Syncs (2)

### 1. `vehicles` (`src/data/model/vehicles/`)

- **`+model.ts`** (`icon: 'lucide:truck'`, `record_label`: `registration_no · vehicle_name`)
  - **Fields:** `registration_no` (`text`), `vehicle_name` (`text`), `vehicle_type` (`enum`: `van | lorry | tipper | crane_truck | trailer | pickup | tanker | car`, default `lorry`), `transponder_id` (`text`), `status` (`enum`: `available | en_route | idle | stopped | maintenance | offline`, default `available`), `driver_id?` (`ref -> drivers`, `on_delete: 'set_null'`, inverse `vehicles`), `last_location?` (`point`), `current_speed_kmh` (`decimal(1)`, default `0`), `speed_limit_kmh` (`decimal(1)`, default `70`), `heading_deg?` (`decimal(1)`), `ignition_on` (`bool`, default `false`), `odometer_km` (`decimal(1)`, default `0`), `fuel_pct?` (`decimal(1)`), `destination_label?` (`text`), `destination_location?` (`point`), `last_ping_at?` (`instant`), `notes?` (`markdown`), `is_overspeed` (CEL computed: `current_speed_kmh > speed_limit_kmh`).
  - **Constraints:** unique + `import_key` `registration_no`; unique `transponder_id`; checks `valid_speed` (`current_speed_kmh >= 0`, `speed_limit_kmh > 0`), `valid_odometer` (`odometer_km >= 0`), `valid_fuel` (`null` or `0..100`).
  - **Indexes:** `by_status` (`status`), `find` text search (`registration_no`, `vehicle_name`, `transponder_id`, `destination_label`).
  - **Outputs & verbs:** `default` (`fields: 'all'`, `driver_id: ['employee_code', 'full_name', 'phone']`); `create`, `update`, `delete`.
- **`+representation.svelte`**
  - Create mode: `RecordForm` with **Vehicle & Transponder**, **Live Telemetry Snapshot**, and collapsible **Notes** sections.
  - Show/edit mode: 5-tab `RecordShell` **Vehicle Hub** — **Record** form, **Live Position** (`<Map>` with destination trajectory overlay), **Telemetry Stream** (`telemetry_pings` table), **Routes** (with vehicle-scoped create `Sheet` prefilling `vehicle_id` and `driver_id`), and **Alerts** (with vehicle-scoped create `Sheet`).

### 2. `telemetry_pings` (`src/data/model/vehicles/telemetry_pings/`)

- **`+model.ts`** (`icon: 'lucide:radio'`, `record_label`: `transponder_id · speed_kmh km/h`, owned child of `vehicles`)
  - **Fields:** `vehicle_id` (`ref -> vehicles`, `owned: true`, inverse `telemetry_pings`), `route_id?` (`ref -> routes`, `on_delete: 'set_null'`, inverse `telemetry_pings`), `transponder_id` (`text`), `recorded_at` (`instant`), `location` (`point`), `speed_kmh` (`decimal(1)`, default `0`), `heading_deg?` (`decimal(1)`), `altitude_m?` (`decimal(1)`), `ignition_on` (`bool`, default `true`), `odometer_km?` (`decimal(1)`), `fuel_pct?` (`decimal(1)`), `hdop?` (`decimal(2)`), `source` (`enum`: `transponder_sync | csv_import | manual`, default `manual`), `external_ping_id?` (`text`).
  - **Constraints:** partial unique `external_ping_id` on `(vehicle_id, external_ping_id)` where `external_ping_id IS NOT NULL`; checks `non_negative_speed`, `valid_odometer`, `valid_fuel`; lock `posted_locked` (`recorded_at IS NOT NULL`).
  - **Indexes:** `by_vehicle_time` (`vehicle_id`, `recorded_at`), `find` text search (`transponder_id`, `external_ping_id`).
  - **Outputs & verbs:** `default` (`fields: 'all'`, `vehicle_id: ['registration_no', 'vehicle_name']`, `route_id: ['route_number', 'title']`); `create` only (append-only).
  - **`create.transform`:** Backfills missing `transponder_id` from parent vehicle and auto-links `route_id` to any active (`dispatched` / `en_route`) route on the vehicle (`as_of: 'act'`).
  - **`create.effect`:** Sorts batch chronologically, applies `isLatest` backfill guard, evaluates active geofences (tightest zone speed limit override + enter/exit transitions), checks exact `BigDecimal` overspeed (`>= 15 km/h` over = `critical`, else `warning`), updates vehicle live snapshot (preserving `maintenance`, monotonic odometer, and prior non-null heading/fuel), updates active route peak speed and ETA, and commits one idempotent `ctx.act` keyed by `ping-effect:<ordered-ids>`.
- **`+transponder.sync.ts`** (`sync('telemetry_pings', 'transponder')`)
  - `with: 'gps_transponder'`, `policies: ['fleet_automation']`, `every: '5min'`, inbound-only (`write` returns `null`).
  - Polls external HTTP `GET <poll_path>?since=<cursor>` _before_ querying DB; normalizes vendor payload via `normalizeTransponderPayload`; skips unknown transponders; sets `$id = external_ping_id ?? "${transponder_id}:${recorded_at}"`; advances cursor strictly to max matched `recorded_at`.
- **`+gps_csv.sync.ts`** (`sync('telemetry_pings', 'gps_csv')`)
  - `with: 'file'`, `parser: ['csv', 'xlsx']`.
  - Schema: `transponder_id?`, `registration_no?`, `recorded_at` (`instant`), `lat`, `lng`, `speed_kmh?`, `heading_deg?`, `ignition_on?`, `odometer_km?`, `fuel_pct?`, `external_ping_id?`.
  - Resolves vehicle case-insensitively by `transponder_id` or `registration_no` (unmatched rows emit `warn` finding and skip); enforces WGS84 coordinate, speed, odometer, and fuel bounds (`refuse` finding aborts import).

### 3. `routes` (`src/data/model/routes/`)

- **`+model.ts`** (`icon: 'lucide:route'`, `record_label`: `route_number · title`)
  - **Fields:** `route_number` (`seq`, `RTE-{yyyy}-{000}`), `title` (`text`), `status` (`state`, initial `planned`: `planned -> dispatched|en_route|cancelled`, `dispatched -> en_route|cancelled`, `en_route -> arrived|completed|cancelled`, `arrived -> completed`, terminal `completed`, `cancelled`), `origin_name`, `origin_location` (`point`), `destination_name`, `destination_location` (`point`), `waypoints?` (`custom: route_waypoints`), `planned_departure` (`instant`), `planned_arrival` (`instant`), `actual_departure?` (`instant`), `actual_arrival?` (`instant`), `planned_distance_km` (`decimal(2)`, default `0`), `actual_distance_km?` (`decimal(2)`), `eta_minutes?` (`int >= 0`), `max_speed_recorded_kmh?` (`decimal(1)`), `cargo_notes?` (`markdown`), `vehicle_id` (`ref -> vehicles`, `on_delete: 'restrict'`, inverse `routes`), `driver_id?` (`ref -> drivers`, `on_delete: 'set_null'`, inverse `routes`).
  - **Constraints:** `valid_window` (`planned_arrival >= planned_departure`); `closed_locked` (`status IN ['completed', 'cancelled']`, `except: ['cargo_notes']`).
  - **Indexes:** `by_vehicle_status` (`vehicle_id`, `status`), `by_status` (`status`, `planned_departure`), `find` text search (`route_number`, `title`, `origin_name`, `destination_name`, `cargo_notes`).
  - **Outputs & verbs:** `default` (`fields: 'all'`, `vehicle_id: ['registration_no', 'vehicle_name', 'status', 'current_speed_kmh', 'last_location']`, `driver_id: ['employee_code', 'full_name', 'phone']`); `create`, `update`, `delete`.
  - **Transforms:** `create` inherits `vehicle.driver_id` and computes `planned_distance_km` & initial `eta_minutes`; `update` recomputes geometry distance/ETA, stamps `actual_departure` / `actual_arrival`, zeroes ETA on arrival/completion, and atomically syncs/clears parent (and prior reassigned) vehicle destination & status via `with.vehicles.update`; `delete` clears vehicle destination & restores `available` (if not `maintenance`) when deleting `dispatched` / `en_route` / `arrived` routes.
- **`+representation.svelte`**
  - `RecordForm` with **Dispatch & Schedule**, **Origin, Destination & Waypoints**, and **Distance, ETA & Cargo** sections; hides `vehicle_id` when opened from a vehicle-scoped create sheet and marks computed/stamped fields read-only.

### 4. `fleet_alerts` (`src/data/model/fleet_alerts/`)

- **`+model.ts`** (`icon: 'lucide:siren'`, `record_label`: `alert_number · summary`)
  - **Fields:** `alert_number` (`seq`, `ALT-{yyyy}-{000}`), `alert_type` (`enum`: `overspeed | geofence_enter | geofence_exit | offline | route_delay`), `severity` (`enum`: `info | warning | critical`, default `warning`), `status` (`state`, initial `open`: `open -> acknowledged|resolved`, `acknowledged -> resolved|open`, `resolved -> []` with native `stamp: 'resolved_at'`), `recorded_at` (`instant`), `location?` (`point`), `measured_speed_kmh?` (`decimal(1)`), `limit_kmh?` (`decimal(1)`), `summary` (`text`), `resolution_notes?` (`markdown`), `resolved_at?` (`instant`), `vehicle_id` (`ref -> vehicles`, `on_delete: 'cascade'`, inverse `fleet_alerts`), `route_id?` (`ref -> routes`, `on_delete: 'set_null'`, inverse `fleet_alerts`), `geofence_id?` (`ref -> geofences`, `on_delete: 'set_null'`, inverse `fleet_alerts`).
  - **Constraints:** `resolved_locked` (`status = 'resolved'`, `except: ['resolution_notes']`).
  - **Indexes:** `by_status_severity` (`status`, `severity`, `recorded_at`), `by_vehicle` (`vehicle_id`, `status`), `find` text search (`alert_number`, `summary`, `resolution_notes`).
  - **Outputs & verbs:** `default` (`fields: 'all'`, joined summaries for `vehicle_id`, `route_id`, `geofence_id`); `create`, `update` (`status`, `severity`, `resolution_notes` only — no `delete` verb).
- **`+representation.svelte`**
  - `RecordForm` with **Alert Details** and **Resolution** sections; uses a custom `<Picker>` editor for `route_id` dynamically filtered to the selected `vehicle_id`.

### 5. `geofences` (`src/data/model/geofences/`)

- **`+model.ts`** (`icon: 'lucide:radar'`, `record_label`: `code · name`)
  - **Fields:** `code` (`text`), `name` (`text`), `zone_type` (`enum`: `depot | job_site | customer | corridor | restricted`, default `depot`), `center` (`point`), `radius_m` (`int >= 25`, default `250`), `speed_limit_kmh?` (`decimal(1)`), `alert_on_enter` (`bool`, default `false`), `alert_on_exit` (`bool`, default `false`), `active` (`bool`, default `true`), `notes?` (`markdown`).
  - **Constraints:** unique + `import_key` `code`; check `positive_speed_limit` (`null` or `> 0`).
  - **Indexes:** `by_active` (`active`, `zone_type`), `find` text search (`code`, `name`, `notes`).
  - **Outputs & verbs:** `default` (`fields: 'all'`); `create`, `update`, `delete`.
- **`+representation.svelte`**
  - `RecordForm` with **Geofence Boundary & Speed Rules** section.

### 6. `drivers` (`src/data/model/drivers/`)

- **`+model.ts`** (`icon: 'lucide:user-round'`, `record_label`: `employee_code · full_name`)
  - **Fields:** `employee_code` (`text`), `full_name` (`text`), `license_number?` (`text`), `license_class` (`enum`: `class_3 | class_4 | class_5 | hazmat | crane`, default `class_4`), `license_expiry?` (`date`), `phone?` (`text`, `format: 'phone'`), `email?` (`text`, `format: 'email'`), `status` (`enum`: `active | on_leave | suspended | inactive`, default `active`), `notes?` (`markdown`).
  - **Constraints:** unique + `import_key` `employee_code`.
  - **Indexes:** `by_status` (`status`), `find` text search (`employee_code`, `full_name`, `license_number`, `phone`, `email`).
  - **Outputs & verbs:** `default` (`fields: 'all'`); `create`, `update`, `delete`.
- **`+representation.svelte`**
  - `RecordForm` with **Driver Profile & License** section.

## Integrations (2)

| File                                              | Driver & Auth                                                                                                                                                                 | Allowlist, Webhook & Rate                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/integration/gps_transponder/+integration.ts` | `http`, Bearer `api_key`; config: `base_url` (default `https://telematics.example.com`), `poll_path` (default `/api/v1/positions`); credentials: `api_key`, `webhook_secret`. | `GET /**`; webhook `hmac-sha256` via `webhook_secret`; rate `20/s`; `test` performs `GET <poll_path>`. |
| `src/integration/google_routes/+integration.ts`   | `http`, header `X-Goog-Api-Key: api_key`, `base_url: 'https://routes.googleapis.com'`; credential: `api_key`.                                                                 | `POST /distanceMatrix/**`; rate `10/s`.                                                                |

## Apps & Pages (2 Apps, 7 Pages)

### `operations` (`src/app/operations/`)

| File                    | Description                                                                                                                                                                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `+app.ts`               | Declares **Fleet Operations** (`lucide:navigation`) with pages `live`, `vehicles`, `routes`, `alerts`.                                                                                                                                                                           |
| `+live.page.svelte`     | `Split` layout: `<Map of="vehicles" at="last_location" labels="hover">` with active-route destination trajectory overlays + `<Table of="fleet_alerts">` filtered to `open`/`acknowledged` with catalog-gated `Refresh live ETAs` and `Check transponder health` toolbar actions. |
| `+vehicles.page.svelte` | `<Table of="vehicles">` ordered by `registration_no` asc (10 columns); clicking a row opens the 5-tab Vehicle Hub.                                                                                                                                                               |
| `+routes.page.svelte`   | `Tabs` layout: **Day-to-Day Schedule** (`ctx.clock('day')`, prev/next/today controls, scheduled-day chips, 5 daily summary stats, clickable route cards, `Refresh live ETAs`, and prefilled create `Sheet`) + **All Routes** `<Table of="routes">`.                              |
| `+alerts.page.svelte`   | `<Table of="fleet_alerts">` ordered by `recorded_at` desc (9 columns).                                                                                                                                                                                                           |

### `configuration` (`src/app/configuration/`)

| File                     | Description                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `+app.ts`                | Declares **Configuration** (`lucide:sliders-horizontal`) with pages `geofences`, `drivers`. Workspace integrations (`gps_transponder`, `google_routes`) live in Settings → Integrations → Connections. |
| `+geofences.page.svelte` | `Split` layout pairing `<Table of="geofences">` with `<Map of="geofences" at="center" labels="always">`.                                                                                               |
| `+drivers.page.svelte`   | `<Table of="drivers">` ordered by `employee_code` asc (7 columns).                                                                                                                                     |

## Automations (2)

| File                                               | Trigger / Mode                                      | Policies & Concurrency                            | Behavior                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/automation/+refresh_route_eta.automation.ts`  | `mode: 'call'` (page RPC / manual)                  | `['fleet_automation']`                            | Queries active `dispatched`/`en_route` routes, tries workspace `google_routes` `computeRouteMatrix` (`TRAFFIC_AWARE`) with fallback to `estimateEtaMinutes`, updates changed `eta_minutes`, and opens deduplicated `route_delay` alerts when projected arrival slips `>= 15 min` (`>= 45 min` = `critical`, else `warning`).                  |
| `src/automation/+check_fleet_health.automation.ts` | `cron: '*/15 * * * *'`, `rest: '24h'` (also manual) | `['fleet_automation']`, `concurrency: { max: 1 }` | Queries `en_route`/`idle` vehicles with non-null `last_ping_at`; marks those stale `>= 30 min` as `offline` (`current_speed_kmh: '0.0'`), creates deduplicated `offline` alerts (`>= 90 min` = `critical`, else `warning`), and sends `ctx.notify` to `fleet_dispatchers` and `fleet_administrators` with per-day per-vehicle-set `once` key. |

## Shared Libraries (2)

| File             | Exports & Purpose                                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/geo.ts` | `PlainTimeSchema`, `parsePlainTime`, `toDecimal`, `formatBigDecimal`, `formatDecimal`, `parseInstant`, `haversineKm`, `haversineMeters`, `isInsideGeofence`, `computeRouteDistanceKm`, `estimateEtaMinutes`, `deriveVehicleStatus`, `normalizeTransponderPayload`. |

## Access Control (3 Seeded Teams, 4 Policies)

| File                                                       | Definition                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seed/public/sys_team.json`                                | Starting `sys_team` rows: `fleet_administrators` (`fleet_read`, `fleet_operations`, `fleet_configuration`), `fleet_dispatchers` (`fleet_read`, `fleet_operations`), `fleet_viewers` (`fleet_read`); no parents.                                     |
| `src/access_control/policy/+fleet_read.policy.ts`          | App `operations`; read `default` output on all 6 domain models.                                                                                                                                                                                     |
| `src/access_control/policy/+fleet_operations.policy.ts`    | CRUD on `vehicles`, `routes` (`moves: 'all'`); create on `telemetry_pings`; create + update (`moves: 'all'`) on `fleet_alerts`; capabilities: `automations: ['refresh_route_eta', 'check_fleet_health']`, `syncs: ['telemetry_pings.transponder']`. |
| `src/access_control/policy/+fleet_configuration.policy.ts` | App `configuration`; CRUD on `geofences`, `drivers`, `sys_integration`.                                                                                                                                                                             |
| `src/access_control/policy/+fleet_automation.policy.ts`    | System policy for syncs & automations: read/update `vehicles`, read/create `telemetry_pings`, read/update (`moves: 'all'`) `routes`, read/create/update (`moves: 'all'`) `fleet_alerts`, read `geofences` and `sys_integration`.                    |

## Migrations, Seeding & Tests

| File                                                                                    | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrations/0001_initial.sql`, `snapshot.json`, `migrations.lock.json`, `physical.json` | Initial compiled database migration (tables, constraints, partial unique index, search functions, `store_json_valid`, `store_row_rules`, `store_statement_rules`) and lock metadata.                                                                                                                                                                                                                                                                                                                       |
| `seed/+seeder.ts`                                                                       | Binds the optional external demo fixture tree (`fleet-management`) for `bolt seed`.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `tests/test-runtime.ts`                                                                 | Scoped `TestWorkspace` acquisition helper plus branded `fixtureId`, `recordOf`, and `rowsOf` utilities.                                                                                                                                                                                                                                                                                                                                                                                                    |
| `tests/fleet-telemetry-and-routes.test.ts`                                              | Verifies pure geo/timestamp/payload normalization, chronological telemetry batches, partial unique `external_ping_id`, exact `BigDecimal` overspeed thresholds, odometer monotonicity, historical backfill guards, alert/route locks & exceptions, route destination/reassignment/delete sync, transponder sync cursor discipline, CSV refusal/admit paths, Google Routes traffic ETA with delay deduplication, multi-vehicle offline notifications (`once` key isolation), and non-admin RBAC boundaries. |
