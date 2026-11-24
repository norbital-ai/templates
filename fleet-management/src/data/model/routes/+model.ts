import { model } from '@norbital-ai/bolt';
import { computeRouteDistanceKm, estimateEtaMinutes } from '../../../lib/geo.js';

const createColumns = [
	'title',
	'vehicle_id',
	'driver_id',
	'origin_name',
	'origin_location',
	'destination_name',
	'destination_location',
	'waypoints',
	'planned_departure',
	'planned_arrival',
	'eta_minutes',
	'cargo_notes'
] as const;

const updateColumns = [
	'title',
	'vehicle_id',
	'driver_id',
	'status',
	'origin_name',
	'origin_location',
	'destination_name',
	'destination_location',
	'waypoints',
	'planned_departure',
	'planned_arrival',
	'actual_distance_km',
	'eta_minutes',
	'max_speed_recorded_kmh',
	'cargo_notes'
] as const;

export default model('routes', {
	description:
		'Dispatched vehicle routes tracking origin, destination, intermediate GPS waypoints, schedule window, live ETA, distance, peak speed, and automatic vehicle destination synchronization.',
	icon: 'lucide:route',
	record_label:
		"record.route_number != null ? record.route_number + ' · ' + record.title : record.title",
	fields: {
		route_number: { kind: 'seq', pattern: 'RTE-{yyyy}-{000}' },
		title: { kind: 'text' },
		status: {
			kind: 'state',
			initial: 'planned',
			states: {
				planned: { to: ['dispatched', 'en_route', 'cancelled'] },
				dispatched: { to: ['en_route', 'cancelled'] },
				en_route: { to: ['arrived', 'completed', 'cancelled'] },
				arrived: { to: ['completed'] },
				completed: { to: [] },
				cancelled: { to: [] }
			}
		},
		origin_name: { kind: 'text' },
		origin_location: { kind: 'point' },
		destination_name: { kind: 'text' },
		destination_location: { kind: 'point' },
		waypoints: { kind: 'custom', of: 'route_waypoints', optional: true },
		planned_departure: { kind: 'instant' },
		planned_arrival: { kind: 'instant' },
		actual_departure: { kind: 'instant', optional: true },
		actual_arrival: { kind: 'instant', optional: true },
		planned_distance_km: { kind: 'decimal', scale: 2, default: 0 },
		actual_distance_km: { kind: 'decimal', scale: 2, optional: true },
		eta_minutes: { kind: 'int', min: 0, optional: true },
		max_speed_recorded_kmh: { kind: 'decimal', scale: 1, optional: true },
		cargo_notes: { kind: 'text', format: 'markdown', optional: true },
		vehicle_id: {
			kind: 'ref',
			to: 'vehicles',
			inverse: 'routes',
			on_delete: 'restrict'
		},
		driver_id: {
			kind: 'ref',
			to: 'drivers',
			inverse: 'routes',
			optional: true,
			on_delete: 'set_null'
		}
	},
	constraints: {
		valid_window: { check: { planned_arrival: { gte: { field: 'planned_departure' } } } },
		closed_locked: {
			locked: { status: { in: ['completed', 'cancelled'] } },
			except: ['cargo_notes']
		}
	},
	indexes: {
		by_vehicle_status: { on: ['vehicle_id', 'status'] },
		by_status: { on: ['status', 'planned_departure'] },
		find: { text: ['route_number', 'title', 'origin_name', 'destination_name', 'cargo_notes'] }
	},
	outputs: {
		default: {
			fields: 'all',
			vehicle_id: {
				fields: ['registration_no', 'vehicle_name', 'status', 'current_speed_kmh', 'last_location']
			},
			driver_id: { fields: ['employee_code', 'full_name', 'phone'] }
		}
	},
	create: {
		fields: [...createColumns],
		transform: function* (changes, ctx) {
			const vehicleIds = [...new Set(changes.map((c) => c.after.vehicle_id))];
			const { vehicles } = yield* ctx.query({
				vehicles: {
					where: { id: { in: vehicleIds } },
					fields: ['driver_id', 'last_location', 'current_speed_kmh'],
					limit: vehicleIds.length + 10,
					as_of: 'act'
				}
			});
			const vehicleById = new Map(vehicles.rows.map((v) => [v.id, v]));

			return changes.map(({ set, after }) => {
				const vehicle = vehicleById.get(after.vehicle_id);
				const plannedDistance = computeRouteDistanceKm(
					after.origin_location,
					after.destination_location,
					after.waypoints
				);
				const etaOrigin = vehicle?.last_location ?? after.origin_location;
				const eta =
					after.eta_minutes ??
					estimateEtaMinutes(etaOrigin, after.destination_location, vehicle?.current_speed_kmh);
				return {
					...set,
					...(after.driver_id == null && vehicle?.driver_id != null
						? { driver_id: vehicle.driver_id }
						: {}),
					planned_distance_km: plannedDistance,
					eta_minutes: eta
				};
			});
		}
	},
	update: {
		fields: [...updateColumns],
		transform: function* (changes, ctx) {
			const vehicleIds = [
				...new Set(changes.flatMap((c) => [c.before.vehicle_id, c.after.vehicle_id]))
			];
			const { vehicles } = yield* ctx.query({
				vehicles: {
					where: { id: { in: vehicleIds } },
					fields: ['revision', 'status', 'last_location', 'current_speed_kmh'],
					limit: vehicleIds.length + 10,
					as_of: 'act'
				}
			});
			const vehicleById = new Map(vehicles.rows.map((v) => [v.id, v]));
			const vehicleUpdates = new Map<
				(typeof vehicleIds)[number],
				{
					readonly target: { readonly id: (typeof vehicleIds)[number]; readonly revision: number };
					readonly set: {
						readonly destination_label?: string | null;
						readonly destination_location?: { readonly lat: number; readonly lng: number } | null;
						readonly status?: 'available' | 'en_route';
					};
				}
			>();

			const sets = changes.map((c) => {
				const vehicle = vehicleById.get(c.after.vehicle_id);
				const priorVehicle =
					c.before.vehicle_id !== c.after.vehicle_id
						? vehicleById.get(c.before.vehicle_id)
						: undefined;

				const geometryChanged = c.changed('origin_location', 'destination_location', 'waypoints');
				const plannedDistance = geometryChanged
					? computeRouteDistanceKm(
							c.after.origin_location,
							c.after.destination_location,
							c.after.waypoints
						)
					: undefined;

				const statusChanged = c.changed('status');
				const actualDeparture =
					statusChanged && c.after.status === 'en_route' && c.after.actual_departure == null
						? ctx.now
						: undefined;
				const reachedDestination =
					statusChanged && (c.after.status === 'arrived' || c.after.status === 'completed');
				const actualArrival =
					reachedDestination && c.after.actual_arrival == null ? ctx.now : undefined;

				const etaMinutes = reachedDestination
					? 0
					: geometryChanged && !c.changed('eta_minutes')
						? estimateEtaMinutes(
								vehicle?.last_location ?? c.after.origin_location,
								c.after.destination_location,
								vehicle?.current_speed_kmh
							)
						: undefined;

				const isActive = c.after.status === 'dispatched' || c.after.status === 'en_route';
				const wasActive = c.before.status === 'dispatched' || c.before.status === 'en_route';

				// Clear destination on reassigned prior vehicle when an active route moves to another vehicle.
				if (priorVehicle !== undefined && wasActive) {
					vehicleUpdates.set(priorVehicle.id, {
						target: { id: priorVehicle.id, revision: priorVehicle.revision },
						set: {
							destination_label: null,
							destination_location: null,
							...(priorVehicle.status !== 'maintenance' ? { status: 'available' as const } : {})
						}
					});
				}

				if (vehicle !== undefined) {
					if (isActive) {
						if (
							statusChanged ||
							c.changed('vehicle_id', 'destination_name', 'destination_location')
						) {
							vehicleUpdates.set(vehicle.id, {
								target: { id: vehicle.id, revision: vehicle.revision },
								set: {
									destination_label: c.after.destination_name,
									destination_location: c.after.destination_location,
									...(c.after.status === 'en_route' && vehicle.status !== 'maintenance'
										? { status: 'en_route' as const }
										: {})
								}
							});
						}
					} else if (
						statusChanged &&
						(c.after.status === 'completed' || c.after.status === 'cancelled')
					) {
						vehicleUpdates.set(vehicle.id, {
							target: { id: vehicle.id, revision: vehicle.revision },
							set: {
								destination_label: null,
								destination_location: null,
								...(vehicle.status !== 'maintenance' ? { status: 'available' as const } : {})
							}
						});
					}
				}

				return {
					...c.set,
					...(plannedDistance !== undefined ? { planned_distance_km: plannedDistance } : {}),
					...(actualDeparture !== undefined ? { actual_departure: actualDeparture } : {}),
					...(actualArrival !== undefined ? { actual_arrival: actualArrival } : {}),
					...(etaMinutes !== undefined ? { eta_minutes: etaMinutes } : {})
				};
			});

			const vehicleUpdateList = [...vehicleUpdates.values()];
			if (vehicleUpdateList.length === 0) return sets;
			return {
				sets,
				with: {
					vehicles: { update: vehicleUpdateList }
				}
			};
		}
	},
	delete: {
		transform: function* (changes, ctx) {
			const activeVehicleIds = [
				...new Set(
					changes
						.filter(
							(c) =>
								c.before.status === 'dispatched' ||
								c.before.status === 'en_route' ||
								c.before.status === 'arrived'
						)
						.map((c) => c.before.vehicle_id)
				)
			];
			if (activeVehicleIds.length === 0) return;

			const { vehicles } = yield* ctx.query({
				vehicles: {
					where: { id: { in: activeVehicleIds } },
					fields: ['revision', 'status'],
					limit: activeVehicleIds.length,
					as_of: 'act'
				}
			});
			if (vehicles.rows.length === 0) return;

			return {
				with: {
					vehicles: {
						update: vehicles.rows.map((v) => ({
							target: { id: v.id, revision: v.revision },
							set: {
								destination_label: null,
								destination_location: null,
								...(v.status !== 'maintenance' ? { status: 'available' as const } : {})
							}
						}))
					}
				}
			};
		}
	}
});
