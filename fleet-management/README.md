# Fleet Management

![Fleet Management application](docs/screenshots/application.webp)

A real-time **GPS transponder tracking, live fleet mapping, route dispatch, geofencing and telemetry
alerting** workspace — keeping daily dispatch operations cleanly separated from telematics configuration.

## Key capabilities

- **Live fleet map & GPS transponder stream:** Ingest GPS fixes (`lat`, `lng`, `speed_kmh`, `heading_deg`,
  `altitude_m`, `ignition_on`, `odometer_km`, `fuel_pct`, `hdop`) via the `gps_transponder` integration
  (5-minute poll woken immediately by HMAC-SHA256 webhooks) or bulk CSV/XLSX log uploads. Every ping lands
  in append-only `telemetry_pings` and atomically refreshes the parent vehicle's live snapshot and CEL
  `is_overspeed` flag.
- **Route dispatch, waypoints & live ETAs:** Plan and track trips (`planned → dispatched → en_route →
arrived → completed | cancelled`) with ordered `route_waypoints`, Haversine road-distance estimates,
  automatic vehicle destination sync, and on-demand traffic ETA refreshes via optional **Google Routes**.
- **Circular geofences & operational alerting:** Define `depot`, `job_site`, `customer`, `corridor` and
  `restricted` geofences with optional zone speed-limit overrides and enter/exit triggers. Overspeeding,
  geofence crossings, stale/offline transponders (> 30 min) and route delays automatically open
  `seq`-numbered `fleet_alerts` (`open → acknowledged → resolved`).

## Apps and roles

| App                  | Pages                              | Audience / role                                               |
| -------------------- | ---------------------------------- | ------------------------------------------------------------- |
| **Fleet Operations** | Live Map, Vehicles, Routes, Alerts | `Dispatchers`, `Fleet Managers`, `Drivers` (own routes/reads) |
| **Configuration**    | Connections, Geofences, Drivers    | `Fleet Managers` (isolated telematics & master configuration) |

## Data model

6 models and 1 custom field (`route_waypoints`):

- `vehicles` — transponder-equipped fleet assets (`is_overspeed` CEL computed field, 5-tab Vehicle Hub).
  - `telemetry_pings` (`owned: true`) — append-only GPS transponder stream (`transponder` HTTP/webhook
    sync and `gps_csv` file sync).
- `routes` — `seq`-numbered dispatched trips with ordered `route_waypoints` and `closed_locked` seal.
- `fleet_alerts` — `seq`-numbered exception ledger (`resolved_locked`).
- `geofences` — GPS boundary circles, zone speed overrides and enter/exit alert triggers.
- `drivers` — commercial drivers and license compliance.

## Automations and integrations

| Automation / integration | Trigger / type             | Purpose                                                                                   |
| ------------------------ | -------------------------- | ----------------------------------------------------------------------------------------- |
| `refresh_route_eta`      | Manual (Live Map / route)  | Recomputes live route ETAs from GPS speed or Google Routes and flags `route_delay` alerts |
| `check_fleet_health`     | Every 15 min; manual run   | Detects stale/offline GPS transponders (> 30 min) and opens `transponder_offline` alerts  |
| `gps_transponder`        | Webhook-woken / 5-min sync | Pulls live GPS fixes from a transponder gateway (HMAC-SHA256 verified webhook hint)       |
| `google_routes`          | Optional HTTP integration  | Supplies live traffic ETA calculations for active routes                                  |

## Getting started

```bash
bun install --frozen-lockfile
bunx bolt check
bun run test
bunx bolt build
```

A fresh workspace starts empty; add drivers, geofences and your `gps_transponder` / `google_routes`
connections under **Configuration**, or upload GPS logs via CSV/XLSX on a vehicle.

- [Workflow guide](docs/README.md)
- [Source reference](docs/source-reference.md)
