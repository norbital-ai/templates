# Fleet Management (`norbital_fleet_management`)

![Fleet Management live map and active dispatch](docs/screenshots/application.webp)

Real-time **GPS transponder tracking, live fleet mapping, route dispatch, geofencing, and telemetry alerting** — with operational dispatch separated cleanly from isolated configuration.

## Core capabilities

1. **Live Fleet Map & GPS Transponder Stream (`vehicles` & `telemetry_pings`)**
   - Synchronize GPS fixes (`lat`, `lng`, `speed_kmh`, `heading_deg`, `altitude_m`, `ignition_on`, `odometer_km`, `fuel_pct`, `hdop`) through the `gps_transponder` integration (`telemetry_pings.syncs.transponder`, running every 5 minutes and woken immediately on verified HMAC-SHA256 webhook hints) or bulk CSV/XLSX GPS log uploads (`telemetry_pings.syncs.gps_csv`).
   - Every ping is stored in an append-only `telemetry_pings` stream and atomically refreshes its parent `vehicles` live snapshot (`last_location`, `current_speed_kmh`, `heading_deg`, `ignition_on`, `odometer_km`, `fuel_pct`, `last_ping_at`, live `status`) plus CEL-computed `is_overspeed`.
   - Inspect all vehicles on the native `<Map>` with speed badges, live status, and glowing trajectory lines to each active route destination.
2. **Route Dispatch, Waypoints & Live ETAs (`routes`)**
   - Plan and dispatch trips (`planned -> dispatched -> en_route -> arrived -> completed | cancelled`) with origin, destination, ordered `route_waypoints`, planned vs actual timestamps, Haversine road-distance estimation, and live `eta_minutes`.
   - Moving a route to `dispatched` or `en_route` automatically syncs the vehicle's live destination (and clears the old vehicle on reassignment); completing or cancelling clears it and returns the vehicle to `available`.
   - Recalculate ETAs on demand (`refresh_route_eta`) using live vehicle GPS speed or optional **Google Routes** traffic, automatically flagging `route_delay` alerts when projected arrival slips.
3. **Geofences & Operational Alerts (`geofences` & `fleet_alerts`)**
   - Define circular geofences (`depot`, `job_site`, `customer`, `corridor`, `restricted`) with configurable radius, optional zone speed limit override, and enter/exit triggers.
   - Overspeeding, geofence transitions, stale/offline transponders (>30 min via `check_fleet_health`), and route delays create `seq`-numbered `fleet_alerts` (`open -> acknowledged -> resolved`).

## Navigation & isolated configuration

Every model has one primary home across 2 apps:

- **Fleet Operations**: `Live Map` (real-time `<Map>` + active dispatch `<Table>` with live ETA/health actions), `Vehicles`, `Routes`, `Alerts`.
- **Configuration** (isolated): `Connections` (`GPS Transponder Gateway` & `Google Routes`), `Geofences` (table + map split), `Drivers`.

## Data model (6 models, 1 custom field, 2 syncs)

- `vehicles` — transponder-equipped fleet assets (`is_overspeed` CEL computed field, 5-tab Vehicle Hub).
  - `telemetry_pings` (`owned: true`) — append-only GPS transponder fixes (`transponder` webhook-woken/5-min HTTP sync + `gps_csv` CSV/XLSX file sync).
- `routes` — `seq`-numbered dispatched trips (`route_waypoints` custom field, `closed_locked`).
- `fleet_alerts` — `seq`-numbered exception ledger (`resolved_locked`).
- `geofences` — GPS boundary circles, zone speed overrides, and enter/exit triggers.
- `drivers` — commercial drivers and license compliance.

See [docs/README.md](docs/README.md) and [docs/source-reference.md](docs/source-reference.md) for workflows and exact source inventory.

## Development & verification

```bash
bolt build
bolt check
bolt test
```
