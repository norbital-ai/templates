import { DateTime, Duration, Option } from 'effect';
import { automation } from '@norbital-ai/bolt';

const OFFLINE_THRESHOLD = Duration.minutes(30);

export default automation({
	description:
		'Monitors active fleet vehicles for stale GPS transponder heartbeats (>30 min without a ping), marks them offline, creates deduplicated fleet alerts, and notifies dispatchers.',
	on: [{ cron: '*/15 * * * *', rest: '24h' }],
	input: {},
	output: {
		kind: 'object',
		fields: {
			checked_vehicles: { kind: 'int' },
			marked_offline: { kind: 'int' },
			alerts_created: { kind: 'int' }
		}
	},
	policies: ['fleet_automation'],
	concurrency: { max: 1 },
	run: function* (_input, ctx) {
		const loaded = yield* ctx.query({
			vehicles: {
				where: { status: { in: ['en_route', 'idle'] }, last_ping_at: { is_null: false } },
				fields: [
					'revision',
					'registration_no',
					'transponder_id',
					'status',
					'last_location',
					'last_ping_at'
				],
				limit: 500
			},
			fleet_alerts: {
				where: { alert_type: { eq: 'offline' }, status: { in: ['open', 'acknowledged'] } },
				fields: ['vehicle_id'],
				limit: 500
			}
		});

		const nowDt = DateTime.makeUnsafe(ctx.now);
		const alreadyAlerted = new Set(loaded.fleet_alerts.rows.map((a) => a.vehicle_id));
		const vehicleUpdates = [];
		const newAlerts = [];

		for (const vehicle of loaded.vehicles.rows) {
			if (vehicle.last_ping_at === null) continue;
			const pingOpt = DateTime.make(vehicle.last_ping_at);
			if (Option.isNone(pingOpt)) continue;
			const age = DateTime.distance(pingOpt.value, nowDt);
			if (Duration.isLessThan(age, OFFLINE_THRESHOLD)) continue;

			const staleMinutes = Math.round(Duration.toMillis(age) / 60_000);
			vehicleUpdates.push({
				target: { id: vehicle.id, revision: vehicle.revision },
				set: { status: 'offline' as const, current_speed_kmh: '0.0' }
			});

			if (!alreadyAlerted.has(vehicle.id)) {
				newAlerts.push({
					vehicle_id: vehicle.id,
					alert_type: 'offline' as const,
					severity: staleMinutes >= 90 ? ('critical' as const) : ('warning' as const),
					recorded_at: ctx.now,
					...(vehicle.last_location !== null ? { location: vehicle.last_location } : {}),
					summary: `${vehicle.registration_no} (${vehicle.transponder_id}) lost GPS signal for ${staleMinutes} min.`
				});
			}
		}

		if (vehicleUpdates.length > 0 || newAlerts.length > 0) {
			yield* ctx.act({
				...(vehicleUpdates.length > 0 ? { 'vehicles.update': vehicleUpdates } : {}),
				...(newAlerts.length > 0 ? { 'fleet_alerts.create': newAlerts } : {})
			});
		}

		if (newAlerts.length > 0) {
			const vehicleKey = newAlerts
				.map((a) => a.vehicle_id)
				.sort()
				.join(',');
			yield* ctx.notify({
				title: `Fleet health: ${newAlerts.length} vehicle transponder(s) offline`,
				description: newAlerts
					.slice(0, 3)
					.map((a) => a.summary)
					.join(' · '),
				to: [{ team: 'fleet_dispatchers' }, { team: 'fleet_administrators' }],
				once: `fleet-offline:${ctx.today}:${vehicleKey}`
			});
		}

		return {
			checked_vehicles: loaded.vehicles.rows.length,
			marked_offline: vehicleUpdates.length,
			alerts_created: newAlerts.length
		};
	}
});
