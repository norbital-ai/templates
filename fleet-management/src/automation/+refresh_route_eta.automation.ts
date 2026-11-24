import { DateTime, Duration, Effect, Option } from 'effect';
import { automation, instance_id } from '@norbital-ai/bolt';
import { estimateEtaMinutes, type GeoPoint } from '../lib/geo.js';

const DELAY_THRESHOLD_MINUTES = 15;

export default automation({
	description:
		'Recalculates live ETAs for all dispatched and en-route vehicles using current GPS coordinates and speed (or Google Routes traffic when connected), raising route_delay alerts when projected arrival slips.',
	mode: 'call',
	input: {},
	output: {
		kind: 'object',
		fields: {
			updated_routes: { kind: 'int' },
			delay_alerts_created: { kind: 'int' },
			used_google_routes: { kind: 'bool' }
		}
	},
	policies: ['fleet_automation'],
	run: function* (_input, ctx) {
		const loaded = yield* ctx.query({
			routes: {
				where: { status: { in: ['dispatched', 'en_route'] } },
				fields: [
					'revision',
					'route_number',
					'title',
					'vehicle_id',
					'origin_location',
					'destination_name',
					'destination_location',
					'planned_arrival',
					'eta_minutes'
				],
				vehicle_id: { fields: ['registration_no', 'last_location', 'current_speed_kmh'] },
				limit: 500
			},
			fleet_alerts: {
				where: { alert_type: { eq: 'route_delay' }, status: { in: ['open', 'acknowledged'] } },
				fields: ['route_id'],
				limit: 500
			},
			sys_integration: {
				where: {
					integration: { eq: 'google_routes' },
					active: { eq: true },
					owner: { is_null: true }
				},
				fields: ['integration'],
				limit: 1
			}
		});

		const routes = loaded.routes.rows;
		if (routes.length === 0) {
			return { updated_routes: 0, delay_alerts_created: 0, used_google_routes: false };
		}

		const googleConn = loaded.sys_integration.rows[0];
		const googleAccount = googleConn ? instance_id('google_routes', googleConn) : null;
		const existingDelayRouteIds = new Set(
			loaded.fleet_alerts.rows.flatMap((a) => (a.route_id ? [a.route_id] : []))
		);

		const nowDt = DateTime.makeUnsafe(ctx.now);
		let usedGoogle = false;
		const routeUpdates = [];
		const delayAlerts = [];

		const queryGoogleEta = Effect.fnUntraced(function* (origin: GeoPoint, dest: GeoPoint) {
			if (googleAccount === null) return null;
			const answer = yield* ctx
				.request(googleAccount, {
					method: 'POST',
					path: '/distanceMatrix/v2:computeRouteMatrix',
					query: { fields: 'originIndex,destinationIndex,duration,condition' },
					body: {
						origins: [
							{
								waypoint: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } }
							}
						],
						destinations: [
							{ waypoint: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } } }
						],
						travelMode: 'DRIVE',
						routingPreference: 'TRAFFIC_AWARE'
					},
					output: {
						kind: 'object',
						many: true,
						fields: {
							originIndex: { kind: 'int', optional: true },
							destinationIndex: { kind: 'int', optional: true },
							duration: { kind: 'text', optional: true },
							condition: { kind: 'text', optional: true }
						}
					}
				})
				.pipe(Effect.catch(() => Effect.succeed(null)));
			const first = answer?.[0];
			if (first?.condition === 'ROUTE_EXISTS' && first.duration != null) {
				const seconds = parseFloat(first.duration);
				if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds / 60));
			}
			return null;
		});

		for (const route of routes) {
			const vehicle = route.vehicle_id;
			const origin = vehicle?.last_location ?? route.origin_location;
			const googleEta = yield* queryGoogleEta(origin, route.destination_location);
			if (googleEta !== null) usedGoogle = true;
			const nextEta =
				googleEta ??
				estimateEtaMinutes(origin, route.destination_location, vehicle?.current_speed_kmh);

			if (nextEta !== route.eta_minutes) {
				routeUpdates.push({
					target: { id: route.id, revision: route.revision },
					set: { eta_minutes: nextEta }
				});
			}

			const plannedOpt = DateTime.make(route.planned_arrival);
			if (Option.isNone(plannedOpt)) continue;
			const projectedDt = DateTime.addDuration(nowDt, Duration.minutes(nextEta));
			if (DateTime.isLessThanOrEqualTo(projectedDt, plannedOpt.value)) continue;
			const delayMinutes = Math.round(
				Duration.toMillis(DateTime.distance(plannedOpt.value, projectedDt)) / 60_000
			);
			if (
				vehicle &&
				delayMinutes >= DELAY_THRESHOLD_MINUTES &&
				!existingDelayRouteIds.has(route.id)
			) {
				delayAlerts.push({
					vehicle_id: vehicle.id,
					route_id: route.id,
					alert_type: 'route_delay' as const,
					severity: delayMinutes >= 45 ? ('critical' as const) : ('warning' as const),
					recorded_at: ctx.now,
					location: origin,
					summary: `${vehicle.registration_no} on ${route.route_number} (${route.destination_name}) projected ${delayMinutes} min late (ETA ${nextEta} min).`
				});
			}
		}

		if (routeUpdates.length > 0 || delayAlerts.length > 0) {
			yield* ctx.act({
				...(routeUpdates.length > 0 ? { 'routes.update': routeUpdates } : {}),
				...(delayAlerts.length > 0 ? { 'fleet_alerts.create': delayAlerts } : {})
			});
		}

		return {
			updated_routes: routeUpdates.length,
			delay_alerts_created: delayAlerts.length,
			used_google_routes: usedGoogle
		};
	}
});
