import { sync } from '@norbital-ai/bolt';
import { formatDecimal } from '../../../../lib/geo.js';

/**
 * Imports bulk GPS transponder logs (CSV / XLSX) into append-only `telemetry_pings`,
 * resolving each row to its vehicle by `transponder_id` or `registration_no`.
 */
export default sync('telemetry_pings', 'gps_csv', {
	with: 'file',
	parser: ['csv', 'xlsx'],
	schema: {
		transponder_id: { kind: 'text', optional: true },
		registration_no: { kind: 'text', optional: true },
		recorded_at: { kind: 'instant' },
		lat: { kind: 'number' },
		lng: { kind: 'number' },
		speed_kmh: { kind: 'number', optional: true },
		heading_deg: { kind: 'number', optional: true },
		ignition_on: { kind: 'bool', optional: true },
		odometer_km: { kind: 'number', optional: true },
		fuel_pct: { kind: 'number', optional: true },
		external_ping_id: { kind: 'text', optional: true }
	},
	read: function* ({ records }, ctx) {
		const { vehicles } = yield* ctx.query({
			vehicles: { fields: ['registration_no', 'transponder_id'], limit: 1000 }
		});
		const byTransponder = new Map(vehicles.rows.map((v) => [v.transponder_id.toUpperCase(), v]));
		const byReg = new Map(vehicles.rows.map((v) => [v.registration_no.toUpperCase(), v]));

		const findings: Array<{
			readonly at: number;
			readonly field?: string;
			readonly message: string;
			readonly severity: 'warn' | 'refuse';
		}> = [];
		const rows = [];

		for (const rec of records) {
			const vehicle =
				(rec.transponder_id
					? byTransponder.get(rec.transponder_id.trim().toUpperCase())
					: undefined) ??
				(rec.registration_no ? byReg.get(rec.registration_no.trim().toUpperCase()) : undefined);
			if (!vehicle) {
				findings.push({
					at: rec.$at,
					field: 'transponder_id',
					message: `Unknown vehicle or transponder (${rec.transponder_id ?? rec.registration_no ?? 'blank'}).`,
					severity: 'warn'
				});
				continue;
			}
			if (rec.lat < -90 || rec.lat > 90 || rec.lng < -180 || rec.lng > 180) {
				findings.push({
					at: rec.$at,
					field: rec.lat < -90 || rec.lat > 90 ? 'lat' : 'lng',
					message: 'Coordinates out of WGS84 range.',
					severity: 'refuse'
				});
				continue;
			}
			if (rec.speed_kmh != null && rec.speed_kmh < 0) {
				findings.push({
					at: rec.$at,
					field: 'speed_kmh',
					message: 'Speed cannot be negative.',
					severity: 'refuse'
				});
				continue;
			}
			if (rec.odometer_km != null && rec.odometer_km < 0) {
				findings.push({
					at: rec.$at,
					field: 'odometer_km',
					message: 'Odometer reading cannot be negative.',
					severity: 'refuse'
				});
				continue;
			}
			if (rec.fuel_pct != null && (rec.fuel_pct < 0 || rec.fuel_pct > 100)) {
				findings.push({
					at: rec.$at,
					field: 'fuel_pct',
					message: 'Fuel percentage must be between 0 and 100.',
					severity: 'refuse'
				});
				continue;
			}
			const speed = rec.speed_kmh ?? 0;
			const heading = rec.heading_deg != null ? ((rec.heading_deg % 360) + 360) % 360 : null;
			rows.push({
				vehicle_id: vehicle.id,
				transponder_id: vehicle.transponder_id,
				recorded_at: rec.recorded_at,
				location: { lat: rec.lat, lng: rec.lng },
				speed_kmh: formatDecimal(speed, 1),
				...(heading !== null ? { heading_deg: formatDecimal(heading, 1) } : {}),
				ignition_on: rec.ignition_on ?? speed > 1,
				...(rec.odometer_km != null ? { odometer_km: formatDecimal(rec.odometer_km, 1) } : {}),
				...(rec.fuel_pct != null ? { fuel_pct: formatDecimal(rec.fuel_pct, 1) } : {}),
				source: 'csv_import' as const,
				...(rec.external_ping_id ? { external_ping_id: rec.external_ping_id } : {})
			});
		}

		return { rows, findings };
	}
});
