import { DateTime, Option } from 'effect';
import { sync } from '@norbital-ai/bolt';
import { normalizeTransponderPayload } from '../../../../lib/geo.js';

/**
 * Synchronizes GPS transponder positions from connected telematics gateways into `telemetry_pings`.
 * Polls the external gateway BEFORE touching the workspace database so quiet sources keep idle
 * databases asleep, and advances its cursor to the latest received ping timestamp (never wall clock).
 */
export default sync('telemetry_pings', 'transponder', {
	with: 'gps_transponder',
	policies: ['fleet_automation'],
	every: '5min',
	read: function* ({ cursor }, ctx) {
		const pollPath = ctx.configuration.poll_path || '/api/v1/positions';
		const payload = yield* ctx.request({
			method: 'GET',
			path: pollPath,
			query: cursor ? { since: String(cursor) } : {},
			output: { kind: 'json' }
		});

		const pings = normalizeTransponderPayload(payload, ctx.now);
		if (pings.length === 0) {
			return { rows: [], cursor: cursor ?? null };
		}

		const transponderIds = [...new Set(pings.map((p) => p.transponder_id))];
		const { vehicles } = yield* ctx.query({
			vehicles: {
				where: { transponder_id: { in: transponderIds } },
				fields: ['transponder_id'],
				limit: transponderIds.length + 10
			}
		});
		const vehicleByTransponder = new Map(vehicles.rows.map((v) => [v.transponder_id, v.id]));
		const rows = [];
		let maxInstant: DateTime.Utc | null =
			typeof cursor === 'string' ? Option.getOrNull(DateTime.make(cursor)) : null;

		for (const ping of pings) {
			const vehicleId = vehicleByTransponder.get(ping.transponder_id);
			if (vehicleId === undefined) continue;
			const pingDt = Option.getOrNull(DateTime.make(ping.recorded_at));
			if (pingDt !== null && (maxInstant === null || DateTime.isGreaterThan(pingDt, maxInstant))) {
				maxInstant = pingDt;
			}
			const idKey = ping.external_ping_id ?? `${ping.transponder_id}:${ping.recorded_at}`;
			rows.push({
				$id: idKey,
				$version: ping.recorded_at,
				vehicle_id: vehicleId,
				transponder_id: ping.transponder_id,
				recorded_at: ping.recorded_at,
				location: ping.location,
				speed_kmh: ping.speed_kmh,
				...(ping.heading_deg !== null ? { heading_deg: ping.heading_deg } : {}),
				...(ping.altitude_m !== null ? { altitude_m: ping.altitude_m } : {}),
				ignition_on: ping.ignition_on,
				...(ping.odometer_km !== null ? { odometer_km: ping.odometer_km } : {}),
				...(ping.fuel_pct !== null ? { fuel_pct: ping.fuel_pct } : {}),
				...(ping.hdop !== null ? { hdop: ping.hdop } : {}),
				source: 'transponder_sync' as const,
				...(ping.external_ping_id !== null ? { external_ping_id: ping.external_ping_id } : {})
			});
		}

		const nextCursor = maxInstant !== null ? DateTime.formatIso(maxInstant) : (cursor ?? null);
		return { rows, cursor: nextCursor };
	},
	write: function* () {
		// Telemetry pings are inbound observations; local CSV imports and manual fixes stay local.
		return null;
	}
});
