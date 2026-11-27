# Fleet Management Workspace (`norbital-fleet-management`)

- **Apps**: `operations` (`live`, `vehicles`, `routes`, `alerts`), `configuration` (`geofences`, `drivers`). Integrations (`gps_transponder`, `google_routes`) live in Settings → Integrations → Connections.
- **Models**: `vehicles`, `telemetry_pings` (`owned: true` under `vehicles`, append-only, `transponder` & `gps_csv` syncs), `routes`, `fleet_alerts`, `geofences`, `drivers`.
- **Custom fields**: `route_waypoints`.
- **Integrations**: `gps_transponder` (HMAC-SHA256 webhook wake + HTTP polling), `google_routes` (optional traffic ETA).
- **Automations**: `refresh_route_eta` (`mode: 'call'`), `check_fleet_health`.
- **Seeded teams (`sys_team` rows) & policies**: `fleet_administrators`, `fleet_dispatchers`, `fleet_viewers` across `fleet_read`, `fleet_operations`, `fleet_configuration`, `fleet_automation`.

## Gates

Run `bolt check`, `bolt build`, and `bolt test` after source or schema changes. Commit generated `migrations/` SQL, `snapshot.json`, `migrations.lock.json`, and `physical.json` together. Never commit `.norbital/`.
