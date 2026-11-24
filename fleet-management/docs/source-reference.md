# Source Reference (`norbital_fleet_management`)

Exact file map of the Fleet Management template.

## Workspace manifest & i18n

- `src/+workspace.ts` — timezone (`Asia/Singapore`), locale (`en-SG`), languages (`en`, `zh`), currency (`SGD`), theme, apps (`operations`, `configuration`), and runtime rate limits
- `src/i18n/+messages.ts`, `src/i18n/+zh.messages.ts` — complete English and Simplified Chinese UI, model, field, enum, and integration catalogs

## Custom fields (1)

- `src/data/custom_field/route_waypoints/` — ordered GPS stops (`name`, `lat`, `lng`, `eta`, `arrived_at`, `status`) with interactive edit/show/compact renderer (`routes.waypoints`)

## Record models (6) & syncs (2)

- `src/data/model/vehicles/` — fleet vehicle registry with live GPS snapshot, `is_overspeed` CEL computed field, and `RecordShell`-tabbed Vehicle Hub
  - `vehicles/telemetry_pings/` (`owned: true`) — append-only GPS transponder stream (`posted_locked`) with chronological atomic vehicle/route/alert propagation
    - `+transponder.sync.ts` — webhook-woken & 5-minute GPS transponder HTTP sync (polls source before DB; cursor tracks latest `recorded_at`)
    - `+gps_csv.sync.ts` — CSV/XLSX bulk GPS telemetry import
- `src/data/model/routes/` — `seq`-numbered routes (`planned -> dispatched -> en_route -> arrived -> completed | cancelled`, `closed_locked`) with Haversine distance/ETA and vehicle destination sync
- `src/data/model/fleet_alerts/` — `seq`-numbered exception ledger (`overspeed`, `geofence_enter`, `geofence_exit`, `offline`, `route_delay`, `resolved_locked` with native `stamp: 'resolved_at'`)
- `src/data/model/geofences/` — circular GPS zones with radius, optional zone speed limit override, and enter/exit triggers
- `src/data/model/drivers/` — driver profiles, license class/expiry, and contact details

## Integrations (2)

- `src/integration/gps_transponder/+integration.ts` — HTTP telematics gateway with HMAC-SHA256 webhook wake verification and polling endpoint
- `src/integration/google_routes/+integration.ts` — optional Google Routes API connection for live traffic-aware ETAs

## Apps (2)

- `src/app/operations/` — `live`, `vehicles`, `routes`, `alerts`
- `src/app/configuration/` — `connections`, `geofences`, `drivers`

## Automations (2)

- `src/automation/+refresh_route_eta.automation.ts` — page RPC (`mode: 'call'`) recalculating live ETAs and flagging delayed routes
- `src/automation/+check_fleet_health.automation.ts` — scheduled (15 min) stale-heartbeat detector marking vehicles offline and notifying dispatchers

## Shared libraries

- `src/lib/geo.ts` — pure WGS84 Haversine distance, geofence containment, route distance, ETA estimation, vehicle status derivation, Effect `BigDecimal` & `DateTime` validation, and GPS payload normalization
- `src/lib/record-form.svelte` — shared `RecordShell` + `Form` layout helper

## Access control

- `src/access_control/team/+team.ts` — 3 teams (`fleet_administrators`, `fleet_dispatchers`, `fleet_viewers`)
- `src/access_control/policy/` — 4 policies (`fleet_read`, `fleet_operations`, `fleet_configuration`, `fleet_automation`)

## Seed & Tests

- `seed/+seeder.ts` — links the private demo seed bank (`fleet-management` tree)
- `tests/test-runtime.ts` — scoped `TestWorkspace` acquisition and `id_of` record helpers
- `tests/fleet-telemetry-and-routes.test.ts` — pure geo/payload tests, telemetry propagation & null-ping uniqueness, route destination/reassignment & locks, alert lifecycle, transponder/CSV syncs, live ETA (with Google Routes) & offline health notifications, and non-admin policy RBAC
