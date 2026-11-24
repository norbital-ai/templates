import { BigDecimal, DateTime, Option } from 'effect';
import { model } from '@norbital-ai/bolt';
import {
	deriveVehicleStatus,
	estimateEtaMinutes,
	formatBigDecimal,
	isInsideGeofence,
	toDecimal
} from '../../../../lib/geo.js';

const ZERO_DEC = BigDecimal.fromBigInt(0n);
const DEFAULT_LIMIT_KMH = BigDecimal.fromBigInt(70n);
const CRITICAL_OVERSPEED_KMH = BigDecimal.fromBigInt(15n);

const createColumns = [
	'vehicle_id',
	'route_id',
	'transponder_id',
	'recorded_at',
	'location',
	'speed_kmh',
	'heading_deg',
	'altitude_m',
	'ignition_on',
	'odometer_km',
	'fuel_pct',
	'hdop',
	'source',
	'external_ping_id'
] as const;

const instantMs = (iso: string): number =>
	Option.match(DateTime.make(iso), {
		onNone: () => 0,
		onSome: (dt) => DateTime.toEpochMillis(dt)
	});

const isNewerOrEqual = (candidate: string, baseline: string | null | undefined): boolean => {
	if (baseline == null) return true;
	const a = DateTime.make(candidate);
	const b = DateTime.make(baseline);
	if (Option.isSome(a) && Option.isSome(b)) {
		return DateTime.isGreaterThanOrEqualTo(a.value, b.value);
	}
	return candidate >= baseline;
};

export default model('telemetry_pings', {
	description:
		'Append-only GPS transponder telemetry stream. Every committed ping batch refreshes parent vehicle snapshots, updates active route metrics, and raises overspeed or geofence transition alerts.',
	icon: 'lucide:radio',
	record_label: "record.transponder_id + ' · ' + record.speed_kmh + ' km/h'",
	fields: {
		transponder_id: { kind: 'text' },
		recorded_at: { kind: 'instant' },
		location: { kind: 'point' },
		speed_kmh: { kind: 'decimal', scale: 1, default: 0 },
		heading_deg: { kind: 'decimal', scale: 1, optional: true },
		altitude_m: { kind: 'decimal', scale: 1, optional: true },
		ignition_on: { kind: 'bool', default: true },
		odometer_km: { kind: 'decimal', scale: 1, optional: true },
		fuel_pct: { kind: 'decimal', scale: 1, optional: true },
		hdop: { kind: 'decimal', scale: 2, optional: true },
		source: {
			kind: 'enum',
			values: ['transponder_sync', 'csv_import', 'manual'],
			default: 'manual'
		},
		external_ping_id: { kind: 'text', optional: true },
		vehicle_id: { kind: 'ref', to: 'vehicles', inverse: 'telemetry_pings', owned: true },
		route_id: {
			kind: 'ref',
			to: 'routes',
			inverse: 'telemetry_pings',
			optional: true,
			on_delete: 'set_null'
		}
	},
	constraints: {
		external_ping_id: {
			unique: ['vehicle_id', 'external_ping_id'],
			where: { external_ping_id: { is_null: false } }
		},
		non_negative_speed: { check: { speed_kmh: { gte: 0 } } },
		valid_odometer: {
			check: {
				or: [{ odometer_km: { is_null: true } }, { odometer_km: { gte: 0 } }]
			}
		},
		valid_fuel: {
			check: {
				or: [{ fuel_pct: { is_null: true } }, { fuel_pct: { gte: 0, lte: 100 } }]
			}
		},
		/** Telemetry log is strictly append-only once committed. */
		posted_locked: { locked: { recorded_at: { is_null: false } } }
	},
	indexes: {
		by_vehicle_time: { on: ['vehicle_id', 'recorded_at'] },
		find: { text: ['transponder_id', 'external_ping_id'] }
	},
	outputs: {
		default: {
			fields: 'all',
			vehicle_id: { fields: ['registration_no', 'vehicle_name'] },
			route_id: { fields: ['route_number', 'title'] }
		}
	},
	create: {
		fields: [...createColumns],
		transform: function* (changes, ctx) {
			const vehicleIds = [...new Set(changes.map((c) => c.after.vehicle_id))];
			const loaded = yield* ctx.query({
				vehicles: {
					where: { id: { in: vehicleIds } },
					fields: ['transponder_id'],
					limit: vehicleIds.length + 10,
					as_of: 'act'
				},
				routes: {
					where: {
						vehicle_id: { in: vehicleIds },
						status: { in: ['dispatched', 'en_route'] }
					},
					fields: ['vehicle_id'],
					limit: 200,
					as_of: 'act'
				}
			});

			const vehicleById = new Map(loaded.vehicles.rows.map((v) => [v.id, v]));
			const routeByVehicle = new Map<
				(typeof vehicleIds)[number],
				(typeof loaded.routes.rows)[number]['id']
			>();
			for (const route of loaded.routes.rows) {
				if (!routeByVehicle.has(route.vehicle_id)) routeByVehicle.set(route.vehicle_id, route.id);
			}

			return changes.map(({ set, after }) => {
				const vehicle = vehicleById.get(after.vehicle_id);
				const activeRouteId = routeByVehicle.get(after.vehicle_id) ?? null;
				return {
					...set,
					...(vehicle !== undefined && !after.transponder_id
						? { transponder_id: vehicle.transponder_id }
						: {}),
					...(activeRouteId !== null && set.route_id === undefined
						? { route_id: activeRouteId }
						: {})
				};
			});
		},
		effect: function* (changes, ctx) {
			if (ctx.event.kind !== 'write' || changes.length === 0) return;

			const vehicleIds = [...new Set(changes.map((c) => c.after.vehicle_id))];
			const loaded = yield* ctx.query({
				vehicles: {
					where: { id: { in: vehicleIds } },
					fields: [
						'revision',
						'registration_no',
						'transponder_id',
						'status',
						'last_location',
						'last_ping_at',
						'speed_limit_kmh',
						'odometer_km',
						'fuel_pct'
					],
					limit: vehicleIds.length + 10
				},
				geofences: {
					where: { active: { eq: true } },
					fields: [
						'code',
						'name',
						'zone_type',
						'center',
						'radius_m',
						'speed_limit_kmh',
						'alert_on_enter',
						'alert_on_exit'
					],
					limit: 500
				},
				routes: {
					where: {
						vehicle_id: { in: vehicleIds },
						status: { in: ['dispatched', 'en_route'] }
					},
					fields: [
						'revision',
						'vehicle_id',
						'destination_location',
						'max_speed_recorded_kmh',
						'eta_minutes'
					],
					limit: 200
				}
			});

			const vehicleById = new Map(loaded.vehicles.rows.map((v) => [v.id, v]));
			const routeByVehicle = new Map<
				(typeof vehicleIds)[number],
				(typeof loaded.routes.rows)[number]
			>();
			for (const route of loaded.routes.rows) {
				if (!routeByVehicle.has(route.vehicle_id)) routeByVehicle.set(route.vehicle_id, route);
			}

			// Evaluate pings chronologically per vehicle so geofence transitions & snapshots stay accurate on out-of-order batches.
			const ordered = [...changes]
				.map((change, index) => ({
					after: change.after,
					index,
					ts: instantMs(change.after.recorded_at)
				}))
				.sort((a, b) => a.ts - b.ts || a.index - b.index);

			const latestLocationByVehicle = new Map<
				(typeof vehicleIds)[number],
				{ readonly lat: number; readonly lng: number } | null
			>();
			const vehicleUpdates = new Map<
				(typeof vehicleIds)[number],
				{
					readonly target: {
						readonly id: (typeof vehicleIds)[number];
						readonly revision: number;
					};
					readonly recordedAt: string;
					readonly set: {
						readonly last_location: { readonly lat: number; readonly lng: number };
						readonly current_speed_kmh: string;
						readonly heading_deg?: string;
						readonly ignition_on: boolean;
						readonly odometer_km?: string;
						readonly fuel_pct?: string;
						readonly last_ping_at: string;
						readonly status:
							'available' | 'en_route' | 'idle' | 'stopped' | 'maintenance' | 'offline';
					};
				}
			>();
			const routeUpdates = new Map<
				(typeof loaded.routes.rows)[number]['id'],
				{
					readonly target: {
						readonly id: (typeof loaded.routes.rows)[number]['id'];
						readonly revision: number;
					};
					readonly set: {
						readonly max_speed_recorded_kmh?: string;
						readonly eta_minutes?: number;
					};
				}
			>();

			const alertsToCreate: Array<{
				readonly vehicle_id: (typeof vehicleIds)[number];
				readonly route_id?: (typeof loaded.routes.rows)[number]['id'] | null;
				readonly geofence_id?: (typeof loaded.geofences.rows)[number]['id'] | null;
				readonly alert_type:
					'overspeed' | 'geofence_enter' | 'geofence_exit' | 'offline' | 'route_delay';
				readonly severity: 'info' | 'warning' | 'critical';
				readonly recorded_at: string;
				readonly location: { readonly lat: number; readonly lng: number };
				readonly measured_speed_kmh?: string | null;
				readonly limit_kmh?: string | null;
				readonly summary: string;
			}> = [];

			for (const { after } of ordered) {
				const vehicle = vehicleById.get(after.vehicle_id);
				if (vehicle === undefined) continue;

				const priorUpdate = vehicleUpdates.get(vehicle.id);
				const priorAt = priorUpdate?.recordedAt ?? vehicle.last_ping_at;
				const isLatest = isNewerOrEqual(after.recorded_at, priorAt);

				const activeRoute = routeByVehicle.get(vehicle.id);
				const resolvedRouteId = after.route_id ?? activeRoute?.id ?? null;
				const speedDec = toDecimal(after.speed_kmh, ZERO_DEC);
				const speedStr = formatBigDecimal(speedDec, 1);
				const vehicleLimit = toDecimal(vehicle.speed_limit_kmh, DEFAULT_LIMIT_KMH);
				const prevLoc = latestLocationByVehicle.has(vehicle.id)
					? (latestLocationByVehicle.get(vehicle.id) ?? null)
					: vehicle.last_location;

				let effectiveLimit = vehicleLimit;
				let limitingZone: (typeof loaded.geofences.rows)[number] | null = null;
				for (const zone of loaded.geofences.rows) {
					const nowInside = isInsideGeofence(after.location, zone.center, zone.radius_m);

					if (nowInside && zone.speed_limit_kmh != null) {
						const zoneLimit = toDecimal(zone.speed_limit_kmh, effectiveLimit);
						if (BigDecimal.isLessThan(zoneLimit, effectiveLimit)) {
							effectiveLimit = zoneLimit;
							limitingZone = zone;
						}
					}

					// Only evaluate enter/exit transitions against the latest known location (avoid spurious alerts on historical backfills).
					if (!isLatest) continue;
					const wasInside =
						prevLoc !== null ? isInsideGeofence(prevLoc, zone.center, zone.radius_m) : false;

					if (nowInside && !wasInside && zone.alert_on_enter) {
						alertsToCreate.push({
							vehicle_id: vehicle.id,
							route_id: resolvedRouteId,
							geofence_id: zone.id,
							alert_type: 'geofence_enter',
							severity: zone.zone_type === 'restricted' ? 'critical' : 'info',
							recorded_at: after.recorded_at,
							location: after.location,
							measured_speed_kmh: speedStr,
							summary: `${vehicle.registration_no} entered ${zone.name} (${zone.code}).`
						});
					} else if (!nowInside && wasInside && zone.alert_on_exit) {
						alertsToCreate.push({
							vehicle_id: vehicle.id,
							route_id: resolvedRouteId,
							geofence_id: zone.id,
							alert_type: 'geofence_exit',
							severity: zone.zone_type === 'depot' ? 'warning' : 'info',
							recorded_at: after.recorded_at,
							location: after.location,
							measured_speed_kmh: speedStr,
							summary: `${vehicle.registration_no} exited ${zone.name} (${zone.code}).`
						});
					}
				}

				if (BigDecimal.isGreaterThan(speedDec, effectiveLimit)) {
					const excess = BigDecimal.subtract(speedDec, effectiveLimit);
					const limitStr = formatBigDecimal(effectiveLimit, 1);
					alertsToCreate.push({
						vehicle_id: vehicle.id,
						route_id: resolvedRouteId,
						...(limitingZone ? { geofence_id: limitingZone.id } : {}),
						alert_type: 'overspeed',
						severity: BigDecimal.isGreaterThanOrEqualTo(excess, CRITICAL_OVERSPEED_KMH)
							? 'critical'
							: 'warning',
						recorded_at: after.recorded_at,
						location: after.location,
						measured_speed_kmh: speedStr,
						limit_kmh: limitStr,
						summary: limitingZone
							? `${vehicle.registration_no} recorded ${speedStr} km/h inside ${limitingZone.name} (limit ${limitStr} km/h).`
							: `${vehicle.registration_no} recorded ${speedStr} km/h (limit ${limitStr} km/h).`
					});
				}

				if (isLatest) {
					latestLocationByVehicle.set(vehicle.id, after.location);
					const ignitionOn = after.ignition_on ?? true;
					const nextStatus = deriveVehicleStatus(vehicle.status, speedDec, ignitionOn);
					const currentOdo = toDecimal(
						priorUpdate?.set.odometer_km ?? vehicle.odometer_km,
						ZERO_DEC
					);
					const nextOdo =
						after.odometer_km != null &&
						BigDecimal.isGreaterThanOrEqualTo(toDecimal(after.odometer_km, ZERO_DEC), currentOdo)
							? after.odometer_km
							: priorUpdate?.set.odometer_km;
					const nextHeading =
						after.heading_deg != null ? after.heading_deg : priorUpdate?.set.heading_deg;
					const nextFuel = after.fuel_pct != null ? after.fuel_pct : priorUpdate?.set.fuel_pct;
					vehicleUpdates.set(vehicle.id, {
						target: { id: vehicle.id, revision: vehicle.revision },
						recordedAt: after.recorded_at,
						set: {
							last_location: after.location,
							current_speed_kmh: speedStr,
							...(nextHeading !== undefined ? { heading_deg: nextHeading } : {}),
							ignition_on: ignitionOn,
							...(nextOdo !== undefined ? { odometer_km: nextOdo } : {}),
							...(nextFuel !== undefined ? { fuel_pct: nextFuel } : {}),
							last_ping_at: after.recorded_at,
							status: nextStatus
						}
					});
				}

				if (activeRoute !== undefined && (isLatest || after.route_id === activeRoute.id)) {
					const prevRouteUpdate = routeUpdates.get(activeRoute.id);
					const prevPeak = toDecimal(
						prevRouteUpdate?.set.max_speed_recorded_kmh ?? activeRoute.max_speed_recorded_kmh,
						ZERO_DEC
					);
					const nextPeak = BigDecimal.isGreaterThan(speedDec, prevPeak)
						? speedStr
						: prevRouteUpdate?.set.max_speed_recorded_kmh;
					const nextEta = isLatest
						? estimateEtaMinutes(after.location, activeRoute.destination_location, speedStr)
						: prevRouteUpdate?.set.eta_minutes;
					if (nextPeak !== undefined || nextEta !== undefined) {
						routeUpdates.set(activeRoute.id, {
							target: { id: activeRoute.id, revision: activeRoute.revision },
							set: {
								...(nextPeak !== undefined ? { max_speed_recorded_kmh: nextPeak } : {}),
								...(nextEta !== undefined ? { eta_minutes: nextEta } : {})
							}
						});
					}
				}
			}

			const vehicleUpdateList = [...vehicleUpdates.values()].map(({ target, set }) => ({
				target,
				set
			}));
			const routeUpdateList = [...routeUpdates.values()];

			if (
				vehicleUpdateList.length === 0 &&
				routeUpdateList.length === 0 &&
				alertsToCreate.length === 0
			) {
				return;
			}

			const batchKey = ordered.map((item) => item.after.id).join(',');
			yield* ctx.act(
				{
					...(vehicleUpdateList.length > 0 ? { 'vehicles.update': vehicleUpdateList } : {}),
					...(routeUpdateList.length > 0 ? { 'routes.update': routeUpdateList } : {}),
					...(alertsToCreate.length > 0 ? { 'fleet_alerts.create': alertsToCreate } : {})
				},
				{ key: `ping-effect:${batchKey}` }
			);
		}
	}
});
