# Fleet Management — Workflows & Architecture

![Fleet Management live map and alerts](screenshots/application.webp)

## Operational workflows

### 1. Real-time GPS ingestion (`telemetry_pings` & `gps_transponder`)

- Connect a GPS telematics gateway under **Configuration → Connections** and paste the generated webhook endpoint URL into your transponder provider (Teltonika, Geotab, Samsara, Traccar, Wialon, or custom gateway).
- Verified HMAC-SHA256 webhook deliveries act as immediate wake hints for `telemetry_pings.syncs.transponder`, which polls the gateway (`every: '5min'` backstop), leaves idle databases asleep when no fixes arrive, normalizes positions via `src/lib/geo.ts`, advances its cursor to the latest received `recorded_at`, and commits rows into `telemetry_pings`. Bulk historical logs can also be imported via `telemetry_pings.syncs.gps_csv`.
- On every committed ping batch, `telemetry_pings.create.effect` orders fixes chronologically per vehicle and commits one idempotent update across:
  - One latest-snapshot update to each affected `vehicles` record (`last_location`, `current_speed_kmh`, `heading_deg`, `ignition_on`, `odometer_km`, `fuel_pct`, `last_ping_at`, derived `status`).
  - Live `max_speed_recorded_kmh` and `eta_minutes` updates to any active `routes` record for that vehicle.
  - `fleet_alerts.create` rows whenever vehicle or active geofence speed limits are exceeded (`overspeed`) or an alerted geofence boundary is crossed (`geofence_enter` / `geofence_exit`).

### 2. Live Fleet Map, Live Alerts & Day-to-Day Schedule (`Live Map`, `Vehicles`, `Routes`)

- **Live Map** pairs the native `<Map>` (all vehicles with GPS fixes, hover tooltips that dismiss on pointer leave, click-to-expand detail cards, live status/speed badges, and active route trajectory overlays) with the **Live Alerts** exception panel and one-click toolbar actions (`Refresh live ETAs`, `Check transponder health`).
- **Routes** provides a **Day-to-Day Schedule** view alongside the full route ledger so dispatchers can step through daily planned and active dispatches cleanly.
- Opening any vehicle opens a 5-tab **Vehicle Hub** (`Record`, `Live Position`, `Telemetry Stream`, `Routes`, `Alerts`) hosted natively by `RecordShell` with scoped creation sheets for child routes and alerts.
- Dispatching a route (`dispatched` / `en_route`) automatically writes `destination_label` and `destination_location` onto the assigned vehicle (and clears the previous vehicle on reassignment); completing or cancelling clears them and sets the vehicle back to `available`.

### 3. Proactive ETA & Health Monitoring

- `refresh_route_eta` (`mode: 'call'`) recalculates live ETAs across all `dispatched` and `en_route` routes using current GPS coordinates and speed (or `google_routes` traffic when connected) and logs deduplicated `route_delay` alerts when projected arrival slips past `planned_arrival` by 15+ minutes.
- `check_fleet_health` (cron `*/15 * * * *`, `rest: '24h'`) marks `en_route` / `idle` vehicles with no GPS fix for >30 minutes as `offline`, logs deduplicated `offline` alerts, and notifies `fleet_dispatchers` and `fleet_administrators`.

## Access control

Source teams under `src/access_control/team/+team.ts`:

- `fleet_administrators` — `fleet_read`, `fleet_operations`, `fleet_configuration`
- `fleet_dispatchers` — `fleet_read`, `fleet_operations`
- `fleet_viewers` — `fleet_read`

See [source-reference.md](source-reference.md) for the exact file-by-file inventory.
