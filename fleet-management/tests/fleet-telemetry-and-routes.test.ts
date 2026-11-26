import { Effect, Option, Schema } from 'effect';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@effect/vitest';
import { JobResult, runAutomation, type TestOptions } from '@norbital-ai/bolt-cli/test';
import {
	computeRouteDistanceKm,
	estimateEtaMinutes,
	haversineKm,
	isInsideGeofence,
	normalizeTransponderPayload,
	parseInstant,
	PlainTimeSchema
} from '../src/lib/geo.js';
import { recordOf, rowsOf, workspace as acquireWorkspace } from './test-runtime.js';
import sys_team from '../seed/public/sys_team.json' with { type: 'json' };

const LinkRequestShape = Schema.Struct({
	path: Schema.optional(Schema.String),
	query: Schema.optional(Schema.Record(Schema.String, Schema.String))
});

const root = fileURLToPath(new URL('..', import.meta.url));

const fakeHttpProvider: NonNullable<TestOptions['providers']>[number] = {
	driver: 'http',
	id: 'fake-http',
	label: 'Fake HTTP',
	setup: { kind: 'form', steps: [], fields: [] },
	async open(ctx) {
		return {
			async pair() {
				await ctx.credentials.write(new Map([['credential', { api_key: 'syn' }]]));
				await ctx.status({ state: 'connected' });
			},
			async close() {}
		};
	}
};

const EtaCallOutput = Schema.Struct({
	updated_routes: Schema.Number,
	delay_alerts_created: Schema.Number,
	used_google_routes: Schema.Boolean
});

const NotificationRow = Schema.Struct({
	title: Schema.String,
	once: Schema.NullOr(Schema.String)
});

it('computes Haversine distances with waypoints, geofence containment, ETAs, and strict boundary timestamp validation', () => {
	const origin = { lat: 1.3206, lng: 103.6368 };
	const dest = { lat: 1.2756, lng: 103.8618 };
	const northDetour = { name: 'Midtown Stop', lat: 1.43, lng: 103.78 };

	const straight = haversineKm(origin, dest);
	expect(straight).toBeGreaterThan(24);
	expect(straight).toBeLessThan(27);

	expect(isInsideGeofence({ lat: 1.321, lng: 103.637 }, origin, 200)).toBe(true);
	expect(isInsideGeofence(dest, origin, 500)).toBe(false);

	const directRoadKm = Number(computeRouteDistanceKm(origin, dest));
	const detourRoadKm = Number(computeRouteDistanceKm(origin, dest, [northDetour]));
	expect(directRoadKm).toBeGreaterThan(straight);
	expect(detourRoadKm).toBeGreaterThan(directRoadKm + 10);

	expect(estimateEtaMinutes(origin, dest, 60)).toBeGreaterThan(20);
	expect(estimateEtaMinutes(dest, dest, 0)).toBe(0);

	// Strict timestamp parser: accepts zoned ISO instants, rejects unzoned and calendar-rollover dates
	expect(parseInstant('2026-06-15T08:05:00Z')).not.toBeNull();
	expect(parseInstant('2026-06-15T16:05:00+08:00')).not.toBeNull();
	expect(parseInstant('2026-06-15 08:05:00')).toBeNull();
	expect(parseInstant('2026-02-30T00:00:00Z')).toBeNull();

	const normalized = normalizeTransponderPayload(
		{
			pings: [
				{
					imei: 'SYN-XPDR-99',
					latitude: 1.31,
					longitude: 103.75,
					speed: 55.4,
					course: 120,
					ignition: 1,
					odometer: 12345.6,
					fuel: 72,
					recorded_at: '2026-06-15T08:05:00Z',
					ping_id: 'EXT-1'
				},
				// Malformed/unzoned timestamp is rejected at the boundary
				{ imei: 'SYN-XPDR-99', lat: 1.31, lng: 103.75, recorded_at: '2026-06-15 08:05:00' },
				// Impossible calendar date is rejected at the boundary
				{ imei: 'SYN-XPDR-99', lat: 1.31, lng: 103.75, recorded_at: '2026-02-30T00:00:00Z' },
				// Out-of-range latitude is rejected
				{ imei: 'BAD-COORD', lat: 999, lng: 103.75 }
			]
		},
		'2026-06-15T08:00:00.000Z'
	);
	expect(normalized).toHaveLength(1);
	expect(normalized[0]).toMatchObject({
		transponder_id: 'SYN-XPDR-99',
		recorded_at: '2026-06-15T08:05:00.000Z',
		speed_kmh: '55.4',
		heading_deg: '120.0',
		ignition_on: true,
		odometer_km: '12345.6',
		fuel_pct: '72.0',
		external_ping_id: 'EXT-1'
	});
});

it.effect(
	'handles chronological telemetry batches, partial unique external_ping_id, exact BigDecimal overspeed thresholds, odometer monotonicity, and alert locking',
	() =>
		Effect.gen(function* () {
			const t = yield* acquireWorkspace({
				root,
				now: '2026-06-15T09:00:00.000Z'
			});
			const dispatcher = yield* t.as(t.member(['fleet_read', 'fleet_operations']));
			const configAdmin = yield* t.as(
				t.member(['fleet_read', 'fleet_operations', 'fleet_configuration'])
			);

			const setup = yield* configAdmin.act({
				'drivers.create': [
					{
						employee_code: 'SYN-DRV-01',
						full_name: 'Jordan Tan',
						license_class: 'class_4',
						phone: '+65 8000 1001'
					}
				],
				'geofences.create': [
					{
						code: 'SYN-ZONE-SLOW',
						name: 'Synthetic Slow Yard',
						zone_type: 'job_site',
						center: { lat: 1.3, lng: 103.8 },
						radius_m: 300,
						// 35.3 - 20.3 === 14.999999999999996 in IEEE-754 float, but exact 15.0 in BigDecimal -> 'critical'
						speed_limit_kmh: '20.3',
						alert_on_enter: true,
						alert_on_exit: true,
						active: true
					}
				]
			});
			if (setup.kind !== 'committed') throw new Error('Config setup failed');
			const driverId = recordOf(setup.records, 'drivers').id;

			const vehCreate = yield* dispatcher.act({
				'vehicles.create': [
					{
						registration_no: 'SYN9001X',
						vehicle_name: 'Synthetic Lorry Alpha',
						vehicle_type: 'lorry',
						transponder_id: 'SYN-XPDR-001',
						driver_id: driverId,
						speed_limit_kmh: '70.0',
						odometer_km: '10000.0'
					}
				]
			});
			if (vehCreate.kind !== 'committed') throw new Error('Vehicle create failed');
			const vehicleRef = recordOf(vehCreate.records, 'vehicles');

			// Two manual pings WITHOUT external_ping_id succeed (partial unique constraint).
			// Delivered out of chronological order with an in-batch odometer dip (10050 -> 10020)
			// to prove chronological sorting, in-batch odometer monotonicity, null preservation, and exact BigDecimal excess.
			const batch = yield* dispatcher.act({
				'telemetry_pings.create': [
					{
						vehicle_id: vehicleRef.id,
						transponder_id: 'SYN-XPDR-001',
						recorded_at: '2026-06-15T08:59:00.000Z',
						location: { lat: 1.3002, lng: 103.8001 },
						speed_kmh: '35.3',
						heading_deg: null,
						ignition_on: true,
						odometer_km: '10020.0',
						fuel_pct: null,
						source: 'manual'
					},
					{
						vehicle_id: vehicleRef.id,
						transponder_id: 'SYN-XPDR-001',
						recorded_at: '2026-06-15T08:55:00.000Z',
						location: { lat: 1.32, lng: 103.7 },
						speed_kmh: '58.0',
						heading_deg: '95.0',
						ignition_on: true,
						odometer_km: '10050.0',
						fuel_pct: '76.0',
						source: 'manual'
					}
				]
			});
			if (batch.kind !== 'committed') throw new Error('Telemetry batch failed');
			yield* t.run_due();

			// Duplicate non-null external_ping_id on same vehicle is refused AND leaves persisted count unchanged
			const extPingOk = yield* dispatcher.act({
				'telemetry_pings.create': [
					{
						vehicle_id: vehicleRef.id,
						transponder_id: 'SYN-XPDR-001',
						recorded_at: '2026-06-15T09:00:00.000Z',
						location: { lat: 1.32, lng: 103.85 },
						speed_kmh: '75.0',
						ignition_on: true,
						source: 'manual',
						external_ping_id: 'DUP-CHECK-1'
					}
				]
			});
			if (extPingOk.kind !== 'committed') throw new Error('Exit ping failed');
			yield* t.run_due();

			const dupPingDenied = yield* dispatcher
				.act({
					'telemetry_pings.create': [
						{
							vehicle_id: vehicleRef.id,
							transponder_id: 'SYN-XPDR-001',
							recorded_at: '2026-06-15T09:01:00.000Z',
							location: { lat: 1.32, lng: 103.86 },
							speed_kmh: '50.0',
							ignition_on: true,
							source: 'manual',
							external_ping_id: 'DUP-CHECK-1'
						}
					]
				})
				.pipe(Effect.flip);
			expect(dupPingDenied._tag).toBe('ActRefused');

			// Out-of-range fuel_pct is refused by telemetry_pings valid_fuel constraint
			const badFuelDenied = yield* dispatcher
				.act({
					'telemetry_pings.create': [
						{
							vehicle_id: vehicleRef.id,
							transponder_id: 'SYN-XPDR-001',
							recorded_at: '2026-06-15T09:02:00.000Z',
							location: { lat: 1.32, lng: 103.86 },
							speed_kmh: '50.0',
							fuel_pct: '125.0',
							ignition_on: true,
							source: 'manual'
						}
					]
				})
				.pipe(Effect.flip);
			expect(badFuelDenied._tag).toBe('ActRefused');

			// Historical backfill ping (08:50 < latest 09:00) inside SYN-ZONE-SLOW must NOT overwrite
			// vehicle's latest snapshot or emit a spurious geofence_enter alert against the newer 09:00 location
			const backfillPing = yield* dispatcher.act({
				'telemetry_pings.create': [
					{
						vehicle_id: vehicleRef.id,
						transponder_id: 'SYN-XPDR-001',
						recorded_at: '2026-06-15T08:50:00.000Z',
						location: { lat: 1.3001, lng: 103.8001 },
						speed_kmh: '18.0',
						ignition_on: true,
						source: 'manual'
					}
				]
			});
			if (backfillPing.kind !== 'committed') throw new Error('Backfill ping failed');
			yield* t.run_due();

			const state = yield* dispatcher.query({
				telemetry_pings: {
					where: { vehicle_id: { eq: vehicleRef.id } },
					fields: ['external_ping_id'],
					limit: 20
				},
				vehicles: {
					where: { id: { eq: vehicleRef.id } },
					fields: [
						'current_speed_kmh',
						'heading_deg',
						'fuel_pct',
						'odometer_km',
						'is_overspeed',
						'last_ping_at',
						'last_location'
					]
				},
				fleet_alerts: {
					where: { vehicle_id: { eq: vehicleRef.id } },
					fields: ['revision', 'alert_type', 'severity', 'limit_kmh', 'status', 'resolved_at']
				}
			});

			// Exactly 4 pings persisted (neither duplicate external_ping_id nor bad fuel persisted)
			expect(rowsOf(state, 'telemetry_pings')).toHaveLength(4);

			const vehRow = rowsOf(state, 'vehicles')[0];
			// Latest snapshot stayed at 09:00 (historical 08:50 backfill did NOT overwrite it)
			expect(vehRow?.['last_ping_at']).toBe('2026-06-15T09:00:00.000Z');
			expect(vehRow?.['last_location']).toEqual({ lat: 1.32, lng: 103.85 });
			expect(vehRow?.['current_speed_kmh']).toBe('75.0');
			// Prior non-null heading, fuel, and higher odometer (10050.0 vs dipped 10020.0) were preserved
			expect(vehRow?.['heading_deg']).toBe('95.0');
			expect(vehRow?.['fuel_pct']).toBe('76.0');
			expect(vehRow?.['odometer_km']).toBe('10050.0');
			expect(vehRow?.['is_overspeed']).toBe(true);

			const alerts = rowsOf(state, 'fleet_alerts');
			// Exactly 1 geofence_enter (08:59) and 1 geofence_exit (09:00): historical 08:50 backfill raised 0 extra transitions
			expect(alerts.filter((a) => a['alert_type'] === 'geofence_enter')).toHaveLength(1);
			expect(alerts.filter((a) => a['alert_type'] === 'geofence_exit')).toHaveLength(1);
			// Exact BigDecimal excess 35.3 - 20.3 = 15.0 >= 15 => 'critical'
			expect(
				alerts.some(
					(a) =>
						a['alert_type'] === 'overspeed' &&
						a['severity'] === 'critical' &&
						a['limit_kmh'] === '20.3'
				)
			).toBe(true);

			// Alert lifecycle: resolve -> native stamp: 'resolved_at', lock severity, allow resolution_notes
			const firstAlert = alerts[0];
			if (!firstAlert) throw new Error('Expected at least one alert');
			const alertId = recordOf(
				[
					{
						model: 'fleet_alerts',
						id: String(firstAlert['id']),
						revision: Number(firstAlert['revision'])
					}
				],
				'fleet_alerts'
			);
			const resolved = yield* dispatcher.act({
				'fleet_alerts.update': [{ target: alertId, set: { status: 'resolved' } }]
			});
			if (resolved.kind !== 'committed') throw new Error('Resolve alert failed');
			const resolvedRef = recordOf(resolved.records, 'fleet_alerts');

			const alternateSeverity = firstAlert['severity'] === 'info' ? 'critical' : 'info';
			const lockedAlertRefusal = yield* dispatcher
				.act({
					'fleet_alerts.update': [{ target: resolvedRef, set: { severity: alternateSeverity } }]
				})
				.pipe(Effect.flip);
			expect(lockedAlertRefusal._tag).toBe('ActRefused');

			// Verify rejected severity edit did not persist and native resolved_at was stamped
			const afterRefusal = rowsOf(
				yield* dispatcher.query({
					fleet_alerts: {
						where: { id: { eq: resolvedRef.id } },
						fields: ['severity', 'resolved_at', 'revision']
					}
				}),
				'fleet_alerts'
			)[0];
			expect(afterRefusal?.['severity']).toBe(firstAlert['severity']);
			expect(afterRefusal?.['resolved_at']).toBe('2026-06-15T09:00:00.000Z');
			expect(afterRefusal?.['revision']).toBe(resolvedRef.revision);

			// Admitted exception on resolved_locked: resolution_notes remains editable
			const noteEdit = yield* dispatcher.act({
				'fleet_alerts.update': [
					{ target: resolvedRef, set: { resolution_notes: 'Driver coached on yard speed.' } }
				]
			});
			expect(noteEdit.kind).toBe('committed');
		}).pipe(Effect.scoped)
);

it.effect(
	'enforces route windows and waypoint bounds, syncs & clears vehicle destinations on dispatch/reassignment/completion/delete, and enforces closed locks',
	() =>
		Effect.gen(function* () {
			const t = yield* acquireWorkspace({
				root,
				now: '2026-06-15T09:00:00.000Z'
			});
			const dispatcher = yield* t.as(t.member(['fleet_read', 'fleet_operations']));

			const created = yield* dispatcher.act({
				'vehicles.create': [
					{
						registration_no: 'SYN9010A',
						vehicle_name: 'Synthetic Truck One',
						vehicle_type: 'lorry',
						transponder_id: 'SYN-XPDR-010',
						speed_limit_kmh: '70.0'
					},
					{
						registration_no: 'SYN9011B',
						vehicle_name: 'Synthetic Truck Two',
						vehicle_type: 'lorry',
						transponder_id: 'SYN-XPDR-011',
						speed_limit_kmh: '70.0'
					}
				]
			});
			if (created.kind !== 'committed') throw new Error('Vehicles create failed');
			const veh1 = recordOf(created.records, 'vehicles', 0);
			const veh2 = recordOf(created.records, 'vehicles', 1);

			// Invalid window (arrival before departure) is refused and persists 0 rows
			const badWindow = yield* dispatcher
				.act({
					'routes.create': [
						{
							title: 'Invalid Route Window',
							vehicle_id: veh1.id,
							origin_name: 'Yard A',
							origin_location: { lat: 1.32, lng: 103.64 },
							destination_name: 'Hub B',
							destination_location: { lat: 1.36, lng: 103.98 },
							planned_departure: '2026-06-15T10:00:00.000Z',
							planned_arrival: '2026-06-15T09:00:00.000Z'
						}
					]
				})
				.pipe(Effect.flip);
			expect(badWindow._tag).toBe('ActRefused');

			// Out-of-range waypoint coordinate (lat > 90) is refused by route_waypoints bounds
			const badWaypoint = yield* dispatcher
				.act({
					'routes.create': [
						{
							title: 'Invalid Waypoint Coords',
							vehicle_id: veh1.id,
							origin_name: 'Yard A',
							origin_location: { lat: 1.32, lng: 103.64 },
							destination_name: 'Hub B',
							destination_location: { lat: 1.36, lng: 103.98 },
							waypoints: [{ name: 'Bad Stop', lat: 95, lng: 103.8, status: 'pending' }],
							planned_departure: '2026-06-15T08:00:00.000Z',
							planned_arrival: '2026-06-15T09:10:00.000Z'
						}
					]
				})
				.pipe(Effect.flip);
			expect(badWaypoint._tag).toBe('ActRefused');
			expect(
				rowsOf(yield* dispatcher.query({ routes: { fields: ['title'] } }), 'routes')
			).toHaveLength(0);

			// Valid route create (with valid waypoint) -> dispatch -> reassign vehicle_id -> complete
			const routeRes = yield* dispatcher.act({
				'routes.create': [
					{
						title: 'Synthetic East Corridor',
						vehicle_id: veh1.id,
						origin_name: 'Yard A',
						origin_location: { lat: 1.32, lng: 103.64 },
						destination_name: 'Hub East',
						destination_location: { lat: 1.36, lng: 103.98 },
						waypoints: [
							{
								name: 'Check-In Gate',
								lat: 1.34,
								lng: 103.81,
								eta: Schema.decodeUnknownSync(PlainTimeSchema)('08:30'),
								status: 'pending'
							}
						],
						planned_departure: '2026-06-15T08:00:00.000Z',
						planned_arrival: '2026-06-15T09:10:00.000Z'
					}
				]
			});
			if (routeRes.kind !== 'committed') throw new Error('Route create failed');
			const r1 = recordOf(routeRes.records, 'routes');

			const started = yield* dispatcher.act({
				'routes.update': [{ target: r1, set: { status: 'en_route' } }]
			});
			if (started.kind !== 'committed') throw new Error('Route start failed');
			const r2 = recordOf(started.records, 'routes');

			// Reassign active route to veh2 -> veh1 destination cleared, veh2 gets destination
			const reassigned = yield* dispatcher.act({
				'routes.update': [{ target: r2, set: { vehicle_id: veh2.id } }]
			});
			if (reassigned.kind !== 'committed') throw new Error('Reassign failed');
			const r3 = recordOf(reassigned.records, 'routes');

			const vehStates = rowsOf(
				yield* dispatcher.query({
					vehicles: {
						where: { id: { in: [veh1.id, veh2.id] } },
						fields: ['registration_no', 'status', 'destination_label']
					}
				}),
				'vehicles'
			);
			const v1After = vehStates.find((v) => v['registration_no'] === 'SYN9010A');
			const v2After = vehStates.find((v) => v['registration_no'] === 'SYN9011B');
			expect(v1After?.['destination_label']).toBeNull();
			expect(v1After?.['status']).toBe('available');
			expect(v2After?.['destination_label']).toBe('Hub East');
			expect(v2After?.['status']).toBe('en_route');

			// Advance clock before completing so actual_departure (09:00) and actual_arrival (09:30) are distinct
			t.clock.set('2026-06-15T09:30:00.000Z');
			const completed = yield* dispatcher.act({
				'routes.update': [{ target: r3, set: { status: 'completed' } }]
			});
			if (completed.kind !== 'committed') throw new Error('Complete failed');
			const r4 = recordOf(completed.records, 'routes');

			const lockedRefusal = yield* dispatcher
				.act({ 'routes.update': [{ target: r4, set: { title: 'Tampered' } }] })
				.pipe(Effect.flip);
			expect(lockedRefusal._tag).toBe('ActRefused');

			const afterCompletion = yield* dispatcher.query({
				routes: {
					where: { id: { eq: r4.id } },
					fields: ['title', 'revision', 'eta_minutes', 'actual_departure', 'actual_arrival']
				},
				vehicles: {
					where: { id: { eq: veh2.id } },
					fields: ['status', 'destination_label', 'destination_location']
				}
			});
			const routeRow = rowsOf(afterCompletion, 'routes')[0];
			expect(routeRow?.['title']).toBe('Synthetic East Corridor');
			expect(routeRow?.['revision']).toBe(r4.revision);
			expect(routeRow?.['eta_minutes']).toBe(0);
			expect(routeRow?.['actual_departure']).toBe('2026-06-15T09:00:00.000Z');
			expect(routeRow?.['actual_arrival']).toBe('2026-06-15T09:30:00.000Z');

			const v2Completed = rowsOf(afterCompletion, 'vehicles')[0];
			expect(v2Completed?.['status']).toBe('available');
			expect(v2Completed?.['destination_label']).toBeNull();
			expect(v2Completed?.['destination_location']).toBeNull();

			// Admitted exception: cargo_notes update succeeds on completed route
			const notesOk = yield* dispatcher.act({
				'routes.update': [{ target: r4, set: { cargo_notes: 'POD signed at loading bay.' } }]
			});
			expect(notesOk.kind).toBe('committed');

			// Deleting an arrived (or active) route clears the parent vehicle's destination and restores available status
			const tempRoute = yield* dispatcher.act({
				'routes.create': [
					{
						title: 'Temporary Dispatch',
						vehicle_id: veh1.id,
						origin_name: 'Yard A',
						origin_location: { lat: 1.32, lng: 103.64 },
						destination_name: 'Temp Site',
						destination_location: { lat: 1.35, lng: 103.9 },
						planned_departure: '2026-06-15T09:00:00.000Z',
						planned_arrival: '2026-06-15T10:00:00.000Z'
					}
				]
			});
			if (tempRoute.kind !== 'committed') throw new Error('Temp route failed');
			const tempStarted = yield* dispatcher.act({
				'routes.update': [
					{ target: recordOf(tempRoute.records, 'routes'), set: { status: 'en_route' } }
				]
			});
			if (tempStarted.kind !== 'committed') throw new Error('Temp start failed');
			const tempArrived = yield* dispatcher.act({
				'routes.update': [
					{ target: recordOf(tempStarted.records, 'routes'), set: { status: 'arrived' } }
				]
			});
			if (tempArrived.kind !== 'committed') throw new Error('Temp arrive failed');
			const tempDel = yield* dispatcher.act({
				'routes.delete': [{ target: recordOf(tempArrived.records, 'routes') }]
			});
			expect(tempDel.kind).toBe('committed');
			const v1AfterDelete = rowsOf(
				yield* dispatcher.query({
					vehicles: {
						where: { id: { eq: veh1.id } },
						fields: ['status', 'destination_label', 'destination_location']
					}
				}),
				'vehicles'
			)[0];
			expect(v1AfterDelete?.['status']).toBe('available');
			expect(v1AfterDelete?.['destination_label']).toBeNull();
			expect(v1AfterDelete?.['destination_location']).toBeNull();
		}).pipe(Effect.scoped)
);

it.effect(
	'runs transponder sync with cursor discipline, CSV import validation, Google Routes live ETA with persisted checks, multi-vehicle health notifications, and strict RBAC boundaries',
	() =>
		Effect.gen(function* () {
			const t = yield* acquireWorkspace({
				root,
				now: '2026-06-15T09:00:00.000Z',
				providers: [fakeHttpProvider],
				// the health notice goes to the seeded teams holding `fleet_operations`
				seed: { sys_team }
			});
			const admin = yield* t.as(t.admin);
			const viewer = yield* t.as(t.member(['fleet_read']));
			const dispatcher = yield* t.as(
				t.member(['fleet_read', 'fleet_operations'], { teams: ['fleet_dispatchers'] })
			);
			const configAdmin = yield* t.as(
				t.member(['fleet_read', 'fleet_operations', 'fleet_configuration'])
			);

			// RBAC: viewer cannot create vehicles or invoke operational automations
			const viewerWrite = yield* viewer
				.act({
					'vehicles.create': [
						{
							registration_no: 'SYN-NOPE',
							vehicle_name: 'Denied',
							transponder_id: 'SYN-DENY-1'
						}
					]
				})
				.pipe(Effect.flip);
			expect(viewerWrite._tag).toBe('ActRefused');
			expect(
				rowsOf(yield* viewer.query({ vehicles: { fields: ['registration_no'] } }), 'vehicles')
			).toHaveLength(0);

			const viewerEtaDenied = yield* viewer
				.run('refresh_route_eta', {}, EtaCallOutput)
				.pipe(Effect.flip);
			expect(viewerEtaDenied._tag).toBe('ActRefused');

			const viewerHealthDenied = yield* viewer
				.run('check_fleet_health', {}, JobResult)
				.pipe(Effect.flip);
			expect(viewerHealthDenied._tag).toBe('ActRefused');

			// RBAC: dispatcher cannot modify isolated configuration (geofences, drivers, or sys_integration)
			const dispatcherGeofenceDenied = yield* dispatcher
				.act({
					'geofences.create': [
						{
							code: 'GF-DENY',
							name: 'Unauthorized Zone',
							center: { lat: 1.3, lng: 103.8 },
							radius_m: 100
						}
					]
				})
				.pipe(Effect.flip);
			expect(dispatcherGeofenceDenied._tag).toBe('ActRefused');

			const dispatcherDriverDenied = yield* dispatcher
				.act({
					'drivers.create': [
						{
							employee_code: 'DRV-DENY',
							full_name: 'Unauthorized Driver',
							license_class: 'class_4'
						}
					]
				})
				.pipe(Effect.flip);
			expect(dispatcherDriverDenied._tag).toBe('ActRefused');

			const dispatcherConnDenied = yield* dispatcher
				.act({
					'sys_integration.create': [
						{ integration: 'gps_transponder', name: 'Unauthorized Gateway', owner: null }
					]
				})
				.pipe(Effect.flip);
			expect(dispatcherConnDenied._tag).toBe('ActRefused');

			const afterConfigDenials = yield* admin.query({
				geofences: { fields: ['code'] },
				drivers: { fields: ['employee_code'] },
				sys_integration: { fields: ['name'] }
			});
			expect(rowsOf(afterConfigDenials, 'geofences')).toHaveLength(0);
			expect(rowsOf(afterConfigDenials, 'drivers')).toHaveLength(0);
			expect(rowsOf(afterConfigDenials, 'sys_integration')).toHaveLength(0);

			// Fleet administrator (fleet_configuration) creates integrations & vehicles
			const infra = yield* configAdmin.act({
				'sys_integration.create': [
					{ integration: 'gps_transponder', name: 'Synthetic Telematics', owner: null },
					{ integration: 'google_routes', name: 'Synthetic Google Routes', owner: null }
				],
				'vehicles.create': [
					{
						registration_no: 'SYN9020A',
						vehicle_name: 'Sync Vehicle A',
						transponder_id: 'SYN-XPDR-020',
						speed_limit_kmh: '70.0'
					},
					{
						registration_no: 'SYN9021B',
						vehicle_name: 'Sync Vehicle B',
						transponder_id: 'SYN-XPDR-021',
						speed_limit_kmh: '70.0'
					}
				]
			});
			if (infra.kind !== 'committed') throw new Error('Infra create failed');
			const gpsConnId = recordOf(infra.records, 'sys_integration', 0).id;
			const googleConnId = recordOf(infra.records, 'sys_integration', 1).id;
			const vehA = recordOf(infra.records, 'vehicles', 0);
			const vehB = recordOf(infra.records, 'vehicles', 1);

			let pollPhase: 'test' | 'populated' | 'quiet' = 'test';
			const observedGpsSince: Array<string | undefined> = [];
			t.fakes.links.answer = (instance, rawReq) => {
				const parsedReq = Option.getOrNull(Schema.decodeUnknownOption(LinkRequestShape)(rawReq));
				if (instance === gpsConnId) {
					if (pollPhase !== 'test') {
						observedGpsSince.push(parsedReq?.query?.['since']);
					}
					if (pollPhase === 'populated') {
						return Effect.succeed({
							status: 200,
							body: {
								pings: [
									{
										transponder_id: 'SYN-XPDR-020',
										recorded_at: '2026-06-15T08:50:00.000Z',
										lat: 1.32,
										lng: 103.65,
										speed_kmh: 50,
										ignition_on: true,
										external_ping_id: 'POLL-A-1'
									},
									{
										transponder_id: 'SYN-XPDR-021',
										recorded_at: '2026-06-15T08:52:00.000Z',
										lat: 1.33,
										lng: 103.68,
										speed_kmh: 48,
										ignition_on: true,
										external_ping_id: 'POLL-B-1'
									}
								]
							}
						});
					}
					return Effect.succeed({ status: 200, body: { pings: [] } });
				}
				if (instance === googleConnId) {
					// Google Routes traffic ETA: 42 minutes (2520s)
					return Effect.succeed({
						status: 200,
						body: [
							{ originIndex: 0, destinationIndex: 0, condition: 'ROUTE_EXISTS', duration: '2520s' }
						]
					});
				}
				return Effect.die(
					new Error(`Unexpected link call: ${instance} ${parsedReq?.path ?? 'unknown'}`)
				);
			};

			// Pair both HTTP connections through the real host integration manager
			yield* t.integrations.pair(gpsConnId, {
				api_key: 'syn-key',
				webhook_secret: 'syn-secret'
			});
			yield* t.integrations.pair(googleConnId, { api_key: 'syn-gkey' });

			// Run remote transponder sync: populated poll advances cursor to max ping timestamp (08:52:00Z, NOT wall clock 09:00:00Z),
			// then quiet poll sends that exact `since` cursor and preserves ping count & cursor
			pollPhase = 'populated';
			const readRes = yield* t.syncs.read('telemetry_pings.sync.transponder', {
				instance: gpsConnId
			});
			expect(readRes.pages).toBeGreaterThanOrEqual(1);
			yield* t.run_due();

			pollPhase = 'quiet';
			yield* t.syncs.read('telemetry_pings.sync.transponder', { instance: gpsConnId });
			yield* t.syncs.read('telemetry_pings.sync.transponder', { instance: gpsConnId });
			expect(observedGpsSince).toEqual([
				undefined,
				'2026-06-15T08:52:00.000Z',
				'2026-06-15T08:52:00.000Z'
			]);

			const syncedPings = rowsOf(
				yield* viewer.query({
					telemetry_pings: { fields: ['transponder_id', 'source'] }
				}),
				'telemetry_pings'
			);
			expect(syncedPings).toHaveLength(2);
			expect(syncedPings.every((p) => p['source'] === 'transponder_sync')).toBe(true);

			// CSV file sync: out-of-range latitude produces a refuse finding, fails the import run, and persists 0 csv_import rows
			const badCsv = [
				'transponder_id,recorded_at,lat,lng,speed_kmh,ignition_on',
				'SYN-XPDR-020,2026-06-15T08:54:00.000Z,95.0,103.66,52,true'
			].join('\n');
			const badCsvUpload = yield* dispatcher.upload('telemetry_pings.$import.gps_csv', {
				name: 'bad-gps.csv',
				mime: 'text/csv',
				bytes: new TextEncoder().encode(badCsv)
			});
			if (badCsvUpload.kind !== 'committed') throw new Error('Bad CSV upload failed');
			const badImport = yield* dispatcher.sync_control('telemetry_pings', 'gps_csv', {
				mode: 'import',
				file: badCsvUpload.output.id
			});
			if (badImport.kind !== 'committed') throw new Error('Bad CSV job enqueue failed');
			yield* t.run_due();
			const FileImportOutput = Schema.Struct({
				applied: Schema.Boolean,
				findings: Schema.Array(
					Schema.Struct({
						field: Schema.optional(Schema.String),
						severity: Schema.String,
						message: Schema.String
					})
				)
			});
			const badRunRows = yield* t.db.rows(Schema.Struct({ output: FileImportOutput }), {
				text: 'SELECT output FROM sys_run WHERE id = $1',
				params: [badImport.output.id]
			});
			expect(badRunRows[0]?.output.applied).toBe(false);
			expect(badRunRows[0]?.output.findings[0]).toMatchObject({
				field: 'lat',
				severity: 'refuse',
				message: 'Coordinates out of WGS84 range.'
			});
			expect(
				rowsOf(
					yield* viewer.query({
						telemetry_pings: {
							where: { source: { eq: 'csv_import' } },
							fields: ['transponder_id']
						}
					}),
					'telemetry_pings'
				)
			).toHaveLength(0);

			// Paired admitted CSV file sync import
			const csv = [
				'transponder_id,recorded_at,lat,lng,speed_kmh,ignition_on',
				'SYN-XPDR-020,2026-06-15T08:55:00.000Z,1.321,103.66,52,true'
			].join('\n');
			const uploadedCsv = yield* dispatcher.upload('telemetry_pings.$import.gps_csv', {
				name: 'gps.csv',
				mime: 'text/csv',
				bytes: new TextEncoder().encode(csv)
			});
			if (uploadedCsv.kind !== 'committed') throw new Error('CSV upload failed');
			const importJob = yield* dispatcher.sync_control('telemetry_pings', 'gps_csv', {
				mode: 'import',
				file: uploadedCsv.output.id
			});
			expect(importJob.kind).toBe('committed');
			yield* t.run_due();
			const afterCsv = rowsOf(
				yield* viewer.query({
					telemetry_pings: {
						where: { source: { eq: 'csv_import' } },
						fields: ['transponder_id', 'speed_kmh']
					}
				}),
				'telemetry_pings'
			);
			expect(afterCsv).toHaveLength(1);
			expect(afterCsv[0]?.['speed_kmh']).toBe('52.0');

			// Dispatch route on vehA and run refresh_route_eta -> uses Google Routes (42 min > 09:10 planned -> 32 min late)
			const rCreate = yield* dispatcher.act({
				'routes.create': [
					{
						title: 'Traffic Checked Delivery',
						vehicle_id: vehA.id,
						origin_name: 'West Yard',
						origin_location: { lat: 1.32, lng: 103.65 },
						destination_name: 'East Hub',
						destination_location: { lat: 1.37, lng: 103.99 },
						planned_departure: '2026-06-15T08:00:00.000Z',
						planned_arrival: '2026-06-15T09:10:00.000Z'
					}
				]
			});
			if (rCreate.kind !== 'committed') throw new Error('Route create failed');
			const activeRouteRef = recordOf(rCreate.records, 'routes');
			yield* dispatcher.act({
				'routes.update': [{ target: activeRouteRef, set: { status: 'en_route' } }]
			});

			const eta1 = yield* dispatcher.run('refresh_route_eta', {}, EtaCallOutput);
			expect(eta1.used_google_routes).toBe(true);
			expect(eta1.delay_alerts_created).toBe(1);
			// Second call suppresses duplicate delay alert
			const eta2 = yield* dispatcher.run('refresh_route_eta', {}, EtaCallOutput);
			expect(eta2.delay_alerts_created).toBe(0);

			// Verify persisted DB state for both route ETA and deduplicated delay alert
			const afterEta = yield* viewer.query({
				routes: {
					where: { id: { eq: activeRouteRef.id } },
					fields: ['eta_minutes']
				},
				fleet_alerts: {
					where: { alert_type: { eq: 'route_delay' } },
					fields: ['route_id', 'vehicle_id', 'severity']
				}
			});
			expect(rowsOf(afterEta, 'routes')[0]?.['eta_minutes']).toBe(42);
			const delayRows = rowsOf(afterEta, 'fleet_alerts');
			expect(delayRows).toHaveLength(1);
			expect(delayRows[0]?.['route_id']).toBe(activeRouteRef.id);
			expect(delayRows[0]?.['vehicle_id']).toBe(vehA.id);
			expect(delayRows[0]?.['severity']).toBe('warning');

			// Two separate vehicles going offline on the same day must BOTH trigger distinct notifications (no once-key collision)
			yield* dispatcher.act({
				'telemetry_pings.create': [
					{
						vehicle_id: vehA.id,
						transponder_id: 'SYN-XPDR-020',
						recorded_at: '2026-06-15T09:20:00.000Z',
						location: { lat: 1.325, lng: 103.7 },
						speed_kmh: '50.0',
						ignition_on: true,
						source: 'manual'
					}
				]
			});
			yield* t.run_due();

			t.clock.set('2026-06-15T09:26:00.000Z');
			const h1 = yield* runAutomation(t, dispatcher.run('check_fleet_health', {}, JobResult));
			expect(h1.state).toBe('succeeded');
			const afterH1 = yield* admin.query({
				fleet_alerts: {
					where: { alert_type: { eq: 'offline' } },
					fields: ['vehicle_id']
				},
				vehicles: {
					where: { id: { in: [vehA.id, vehB.id] } },
					fields: ['registration_no', 'status', 'current_speed_kmh']
				}
			});
			const offlineAfterFirst = rowsOf(afterH1, 'fleet_alerts');
			expect(offlineAfterFirst).toHaveLength(1);
			expect(offlineAfterFirst[0]?.['vehicle_id']).toBe(vehB.id);
			const h1Vehs = rowsOf(afterH1, 'vehicles');
			expect(h1Vehs.find((v) => v['registration_no'] === 'SYN9021B')).toMatchObject({
				status: 'offline',
				current_speed_kmh: '0.0'
			});
			expect(h1Vehs.find((v) => v['registration_no'] === 'SYN9020A')?.['status']).toBe('en_route');

			t.clock.set('2026-06-15T09:55:00.000Z');
			const h2 = yield* runAutomation(t, dispatcher.run('check_fleet_health', {}, JobResult));
			expect(h2.state).toBe('succeeded');

			// Verify both offline vehicles persisted offline status + 0.0 speed AND produced separate alerts
			const afterH2 = yield* admin.query({
				fleet_alerts: {
					where: { alert_type: { eq: 'offline' } },
					fields: ['vehicle_id', 'summary']
				},
				vehicles: {
					where: { id: { in: [vehA.id, vehB.id] } },
					fields: ['registration_no', 'status', 'current_speed_kmh']
				}
			});
			expect(rowsOf(afterH2, 'fleet_alerts')).toHaveLength(2);
			for (const v of rowsOf(afterH2, 'vehicles')) {
				expect(v['status']).toBe('offline');
				expect(v['current_speed_kmh']).toBe('0.0');
			}

			// Both distinct offline vehicles fired separate notifications (proving no once-key collision)
			const notifRows = yield* t.db.rows(NotificationRow, {
				text: 'SELECT title, once FROM sys_notification ORDER BY at ASC',
				params: []
			});
			expect(notifRows).toHaveLength(2);
			expect(new Set(notifRows.map((n) => n.once)).size).toBe(2);
		}).pipe(Effect.scoped)
);
