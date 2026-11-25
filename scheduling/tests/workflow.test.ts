/**
 * End-to-end scheduling, dispatch recovery, native state stamping, Google Routes caching,
 * recurring booking atomicity, portal intake, and RBAC isolation tests through the real Bolt engine.
 */
import { expect, layer } from '@effect/vitest';
import type { ActInput, Id } from '@norbital-ai/bolt';
import { JobResult, TestWorkspace, runAutomation, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { fixtureId, present } from './test-runtime.js';

const SERVICE = fixtureId('services', '019ad736-e778-7000-b1fe-861d5e541192');
const CUSTOMER = fixtureId('customers', '019ad736-f330-7000-a470-f87a20a7b895');
const CUSTOMER_TWO = fixtureId('customers', '019ad736-f330-7000-a470-f87a20a7b896');
const ALPHA = fixtureId('providers', '019b76dc-1f00-7000-a3bb-dd6cc8f5ac58');
const CHARLIE = fixtureId('providers', '019b76dc-22e8-7000-a81d-cf841de9d389');
/** Alpha's 10:00 UTC appointment: shift check asked at 07:45, reply window elapsed at 08:00. */
const CHECKED = fixtureId('appointments', '019b76dc-0f60-7000-a62e-d53c2544c573');
/** Charlie's 08:45 UTC appointment: confirmed, far GPS fix triggers ETA risk. */
const DRIVEN = fixtureId('appointments', '019b76dc-1348-7000-8bfd-cd9a22600c91');
/** Ready availability quote for Wednesday 10:00 UTC. */
const QUOTE = fixtureId('availability_requests', '019b76dc-0790-7000-a470-307912f48d15');
const WEDNESDAY_10 = '2026-09-30T10:00:00.000Z';
const phone = '+15550100101';
const phoneTwo = '+15550100102';
const address = '100 Market Street, Suite 101';

const desk = (t: Kit) => t.as(t.member(['operations']));
function committed(outcome: { readonly kind: string }) {
	if (outcome.kind !== 'committed') throw new Error(JSON.stringify(outcome));
}

const AppointmentPage = Schema.Struct({
	appointments: Schema.Struct({
		rows: Schema.Array(
			Schema.Struct({
				id: Schema.String,
				revision: Schema.Int,
				status: Schema.String,
				attention: Schema.String,
				eta_minutes: Schema.NullOr(Schema.Number),
				shift_check: Schema.String,
				provider: Schema.NullOr(Schema.String),
				proposed_provider: Schema.NullOr(Schema.String),
				started_at: Schema.NullOr(Schema.String),
				completed_at: Schema.NullOr(Schema.String),
				late_cancellation: Schema.Boolean
			})
		)
	})
});

const appointmentRow = Effect.fnUntraced(function* (t: Kit, target: Id<'appointments'>) {
	const admin = yield* t.as(t.admin);
	const page = yield* Schema.decodeUnknownEffect(AppointmentPage)(
		yield* admin.query({ appointments: { where: { id: { eq: target } }, limit: 1 } })
	);
	return present(page.appointments.rows[0]);
});

const Rows = Schema.Struct({ rows: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) });

layer(
	TestWorkspace.layer({
		root: `${process.cwd()}/`,
		now: '2026-09-29T08:00:00.000Z'
	}),
	{ excludeTestServices: true }
)('scheduling workflow', (it) => {
	it.effect('flags eta_risk when provider live travel exceeds the configured ETA limit', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			const run = yield* runAutomation(
				t,
				admin.run('eta_check', { appointment: DRIVEN }, JobResult)
			);
			expect(run.state).toBe('succeeded');
			const late = yield* appointmentRow(t, DRIVEN);
			expect(late.attention).toBe('eta_risk');
			expect(late.eta_minutes).toBeGreaterThan(30);
		})
	);

	it.effect('logs time off and proposes a replacement after shift-check silence', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			expect((yield* runAutomation(t, admin.run('shift_watch', {}, JobResult))).state).toBe(
				'succeeded'
			);
			expect(yield* appointmentRow(t, CHECKED)).toMatchObject({
				shift_check: 'no_response',
				provider: null,
				proposed_provider: CHARLIE,
				attention: 'awaiting_approval'
			});
			const timeOff = yield* Schema.decodeUnknownEffect(Schema.Struct({ provider_time_off: Rows }))(
				yield* admin.query({ provider_time_off: { where: { provider: { eq: ALPHA } } } })
			);
			expect(timeOff.provider_time_off.rows).toMatchObject([{ reason: 'unavailable' }]);

			const accept = yield* runAutomation(
				t,
				(yield* desk(t)).run('appointments_accept_proposal', { targets: [CHECKED] }, JobResult)
			);
			expect(accept.state).toBe('succeeded');
			expect(yield* appointmentRow(t, CHECKED)).toMatchObject({
				provider: CHARLIE,
				proposed_provider: null,
				attention: 'none'
			});
		})
	);

	it.effect(
		'enforces provider ownership on shift answers, GPS updates, and native status stamps',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = yield* t.as(t.admin);
				const linkProvider = (row: Id<'providers'>) =>
					Effect.gen(function* () {
						const member = t.member(['provider']);
						const user = fixtureId('sys_user', member.id);
						const { providers } = yield* Schema.decodeUnknownEffect(
							Schema.Struct({
								providers: Schema.Struct({
									rows: Schema.Array(Schema.Struct({ revision: Schema.Int }))
								})
							})
						)(
							yield* admin.query({
								providers: { where: { id: { eq: row } }, fields: ['revision'] }
							})
						);
						const revision = present(providers.rows[0]).revision;
						committed(
							yield* admin.act({
								'providers.update': [{ target: { id: row, revision }, set: { user } }]
							})
						);
						return yield* t.as(member);
					});

				const alpha = yield* linkProvider(ALPHA);
				const charlie = yield* linkProvider(CHARLIE);

				// Denied: Alpha cannot confirm Charlie's appointment
				expect(
					yield* Effect.flip(
						runAutomation(
							t,
							alpha.run('appointments_confirm_shift', { targets: [DRIVEN] }, JobResult)
						)
					)
				).toMatchObject({ _tag: 'ActRefused' });
				expect(yield* appointmentRow(t, CHECKED)).toMatchObject({
					provider: CHARLIE,
					shift_check: 'not_due'
				});

				// Denied: Alpha cannot overwrite Charlie's GPS position
				const charlieRev = present(
					(yield* Schema.decodeUnknownEffect(
						Schema.Struct({
							providers: Schema.Struct({
								rows: Schema.Array(Schema.Struct({ revision: Schema.Int }))
							})
						})
					)(
						yield* admin.query({
							providers: { where: { id: { eq: CHARLIE } }, fields: ['revision'] }
						})
					)).providers.rows[0]
				).revision;
				expect(
					yield* Effect.flip(
						alpha.act({
							'providers.update': [
								{
									target: { id: CHARLIE, revision: charlieRev },
									set: { last_location: { lat: 40.75, lng: -73.99 } }
								}
							]
						})
					)
				).toMatchObject({ _tag: 'ActRefused' });

				// Admitted: Charlie confirms their day and completes their own appointment with native stamps
				expect(
					(yield* runAutomation(
						t,
						charlie.run('appointments_confirm_shift', { targets: [DRIVEN] }, JobResult)
					)).state
				).toBe('succeeded');
				expect(yield* appointmentRow(t, CHECKED)).toMatchObject({ shift_check: 'confirmed' });

				const drivenBefore = yield* appointmentRow(t, DRIVEN);
				committed(
					yield* charlie.act({
						'appointments.update': [
							{
								target: { id: DRIVEN, revision: drivenBefore.revision },
								set: { status: 'in_progress' }
							}
						]
					})
				);
				const inProgress = yield* appointmentRow(t, DRIVEN);
				expect(inProgress.status).toBe('in_progress');
				expect(inProgress.started_at).not.toBeNull();

				committed(
					yield* charlie.act({
						'appointments.update': [
							{
								target: { id: DRIVEN, revision: inProgress.revision },
								set: { status: 'completed', completion_notes: 'System inspected and tuned.' }
							}
						]
					})
				);
				const done = yield* appointmentRow(t, DRIVEN);
				expect(done.status).toBe('completed');
				expect(done.completed_at).not.toBeNull();
			})
	);

	it.effect(
		'enforces appointment eligibility on direct bookings.create, atomic recurring bookings_book, and bookings_cancel',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const ops = yield* desk(t);
				const admin = yield* t.as(t.admin);

				// Direct bookings.create with an ineligible skill for Alpha is refused by appointments.create.transform
				expect(
					yield* Effect.flip(
						ops.act({
							'bookings.create': [
								{
									customer: CUSTOMER,
									service: SERVICE,
									address,
									location: { lat: 40.7128, lng: -74.006 },
									preference: 'any',
									repeat: 'once',
									appointments: [
										{
											slot: {
												start: '2026-10-01T10:00:00.000Z',
												end: '2026-10-01T13:00:00.000Z'
											},
											address,
											location: { lat: 40.7128, lng: -74.006 },
											skill: 'unheld_specialty',
											provider: ALPHA,
											attention: 'none'
										}
									]
								}
							]
						})
					)
				).toMatchObject({ _tag: 'ActRefused', key: 'errors.provider.skill' });

				// Block Alpha on 2026-10-08 so a 2-week preferred recurring booking cannot cover week 2
				committed(
					yield* ops.act({
						'provider_time_off.create': [
							{
								provider: ALPHA,
								period: { from: '2026-10-08', to: '2026-10-08' },
								reason: 'leave'
							}
						]
					})
				);
				const countBookings = Effect.fnUntraced(function* () {
					const page = yield* Schema.decodeUnknownEffect(Schema.Struct({ bookings: Rows }))(
						yield* admin.query({ bookings: { limit: 100 } })
					);
					return page.bookings.rows.length;
				});
				const beforeCount = yield* countBookings();
				const failedRecurring = yield* runAutomation(
					t,
					ops.run(
						'bookings_book',
						{
							customer: CUSTOMER,
							service: SERVICE,
							preference: 'preferred',
							providers: [ALPHA],
							start: '2026-10-01T10:00:00.000Z',
							repeat: 'weekly',
							appointments: 2
						},
						JobResult
					)
				);
				expect(failedRecurring.state).toBe('failed');
				expect(yield* countBookings()).toBe(beforeCount);

				// Book 2-week recurring with `any` (week 1 -> Alpha/Charlie, week 2 -> Charlie)
				const okRecurring = yield* runAutomation(
					t,
					ops.run(
						'bookings_book',
						{
							customer: CUSTOMER,
							service: SERVICE,
							preference: 'any',
							start: '2026-10-01T10:00:00.000Z',
							repeat: 'weekly',
							appointments: 2
						},
						JobResult
					)
				);
				expect(okRecurring.state).toBe('succeeded');
				const out = yield* Schema.decodeUnknownEffect(
					Schema.Struct({ booking: Schema.String, assigned: Schema.Int, unassigned: Schema.Int })
				)(okRecurring.output);
				expect(out.assigned).toBe(2);
				expect(out.unassigned).toBe(0);
				const bookingId = fixtureId('bookings', out.booking);

				// Cancel the booking and verify both appointments move to cancelled
				const cancelled = yield* runAutomation(
					t,
					ops.run('bookings_cancel', { targets: [bookingId] }, JobResult)
				);
				expect(cancelled.state).toBe('succeeded');
				const appts = yield* Schema.decodeUnknownEffect(AppointmentPage)(
					yield* admin.query({ appointments: { where: { booking: { eq: bookingId } }, limit: 10 } })
				);
				expect(appts.appointments.rows).toHaveLength(2);
				expect(appts.appointments.rows.every((r) => r.status === 'cancelled')).toBe(true);
			})
	);

	it.effect(
		'enforces free_change_hours on routine appointments_rebook while permitting recovery rebooking',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const ops = yield* desk(t);
				const admin = yield* t.as(t.admin);

				// CHECKED starts at 2026-09-29T10:00Z (2h from now < 24h free_change_hours) with attention = none
				const blocked = yield* runAutomation(
					t,
					ops.run(
						'appointments_rebook',
						{ targets: [CHECKED], start: '2026-10-02T10:00:00.000Z' },
						JobResult
					)
				);
				expect(blocked.state).toBe('failed');
				expect(blocked.error?.message).toContain('24 hours');

				// Put CHECKED into recovery (attention = unassigned) -> rebook now succeeds
				const cur = yield* appointmentRow(t, CHECKED);
				committed(
					yield* admin.act({
						'appointments.update': [
							{
								target: { id: CHECKED, revision: cur.revision },
								set: { attention: 'unassigned', provider: null }
							}
						]
					})
				);
				const allowed = yield* runAutomation(
					t,
					ops.run(
						'appointments_rebook',
						{ targets: [CHECKED], start: '2026-10-02T10:00:00.000Z', provider: CHARLIE },
						JobResult
					)
				);
				expect(allowed.state).toBe('succeeded');
				expect(yield* appointmentRow(t, CHECKED)).toMatchObject({
					provider: CHARLIE,
					attention: 'none'
				});
			})
	);

	it.effect(
		'caches Google Routes legs in check_drives and reassigns unreachable appointments',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const ops = yield* desk(t);
				const admin = yield* t.as(t.admin);

				// Create active Google Routes integration instance and stub matrix to return 90 min (5400s)
				const routesRes = yield* admin.act({
					'sys_integration.create': [
						{ integration: 'google_routes', name: 'Google Routes', owner: null }
					]
				});
				committed(routesRes);
				const routesId = present(routesRes.records.find((r) => r.model === 'sys_integration')).id;
				t.fakes.links.answer = (instance) =>
					Effect.succeed(
						instance === routesId
							? {
									status: 200,
									body: [
										{
											originIndex: 0,
											destinationIndex: 0,
											duration: '5400s',
											condition: 'ROUTE_EXISTS'
										}
									]
								}
							: { status: 404, body: {} }
					);

				// Book two back-to-back appointments on 2026-10-03 for Alpha with a 30 min gap at two different spots
				// Under Haversine (close spots), 30 min gap is fine; under 90-min cached Google Routes leg, the 2nd is unreachable.
				const spotA = { lat: 40.7128, lng: -74.006 };
				const spotB = { lat: 40.7306, lng: -73.9866 };
				const created = yield* ops.act({
					'bookings.create': [
						{
							customer: CUSTOMER,
							service: SERVICE,
							address,
							location: spotA,
							preference: 'any',
							repeat: 'once',
							appointments: [
								{
									slot: {
										start: '2026-10-03T08:00:00.000Z',
										end: '2026-10-03T10:00:00.000Z'
									},
									address,
									location: spotA,
									skill: 'hvac_service',
									provider: ALPHA,
									attention: 'none'
								}
							]
						},
						{
							customer: CUSTOMER_TWO,
							service: SERVICE,
							address: '200 Harbor Road, Unit 202',
							location: spotB,
							preference: 'any',
							repeat: 'once',
							appointments: [
								{
									slot: {
										start: '2026-10-03T10:30:00.000Z',
										end: '2026-10-03T12:30:00.000Z'
									},
									address: '200 Harbor Road, Unit 202',
									location: spotB,
									skill: 'hvac_service',
									provider: ALPHA,
									attention: 'none'
								}
							]
						}
					]
				});
				committed(created);
				const apptIds = created.records
					.filter((r) => r.model === 'appointments')
					.map((r) => fixtureId('appointments', r.id));
				const secondAppt = present(apptIds[1]);

				expect((yield* runAutomation(t, admin.run('check_drives', {}, JobResult))).state).toBe(
					'succeeded'
				);

				// Google Routes legs were cached in drive_times
				const legs = yield* Schema.decodeUnknownEffect(Schema.Struct({ drive_times: Rows }))(
					yield* admin.query({ drive_times: { limit: 100 } })
				);
				expect(legs.drive_times.rows.length).toBeGreaterThan(0);

				// Second appointment was moved off Alpha because real 90m travel made 10:30 unreachable
				const moved = yield* appointmentRow(t, secondAppt);
				expect(moved.provider).not.toBe(ALPHA);
			})
	);

	it.effect(
		'enforces portal_visitor and cross-customer RBAC, prepares quotes, handles slot contention fallback, and expires quotes',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = yield* t.as(t.admin);
				const ops = yield* desk(t);

				// Publish openings and verify portal_visitor can read active services & openings, but NOT private tables
				expect((yield* runAutomation(t, admin.run('publish_openings', {}, JobResult))).state).toBe(
					'succeeded'
				);
				const visitor = yield* t.visitor('portal');
				const publicData = yield* Schema.decodeUnknownEffect(
					Schema.Struct({ services: Rows, openings: Rows })
				)(
					yield* visitor.query({
						services: { output: 'portal', limit: 20 },
						openings: { output: 'portal', limit: 200 }
					})
				);
				expect(publicData.services.rows.length).toBeGreaterThan(0);
				expect(publicData.openings.rows.length).toBeGreaterThan(0);
				expect(
					yield* Effect.flip(visitor.query({ customers: { output: 'customer', limit: 1 } }))
				).toMatchObject({ _tag: 'ReadFailed' });
				expect(
					yield* Effect.flip(
						visitor.act({
							'services.create': [
								{ name: 'Unauthorized', skill: 'hvac', duration_minutes: 60, price: '10.00' }
							]
						})
					)
				).toMatchObject({ _tag: 'ActRefused' });

				// Cross-customer isolation: Customer Two cannot see Customer One's bookings/appointments or run staff automations
				const customerTwo = yield* t.as(
					t.member(['customer'], {
						external: true,
						phone: phoneTwo,
						party: { model: 'customers', id: CUSTOMER_TWO }
					})
				);
				const c2Read = yield* Schema.decodeUnknownEffect(
					Schema.Struct({
						bookings: Schema.Struct({
							rows: Schema.Array(Schema.Struct({ customer: Schema.String }))
						}),
						appointments: Rows
					})
				)(
					yield* customerTwo.query({
						bookings: { output: 'customer', limit: 50 },
						appointments: {
							output: 'customer',
							where: { id: { in: [CHECKED, DRIVEN] } },
							limit: 50
						}
					})
				);
				expect(c2Read.bookings.rows.every((r) => r.customer === CUSTOMER_TWO)).toBe(true);
				expect(c2Read.appointments.rows).toHaveLength(0);
				expect(
					yield* Effect.flip(
						customerTwo.run('appointments_cancel', { targets: [CHECKED] }, JobResult)
					)
				).toMatchObject({ _tag: 'ActRefused' });

				// Customer One quote binding + portal_intake booking + fallback to follow_up when slot fills
				const customer = yield* t.as(
					t.member(['customer'], {
						external: true,
						phone,
						party: { model: 'customers', id: CUSTOMER }
					})
				);
				const request = (
					over: Partial<ActInput<'booking_requests.create'>[number]> = {}
				): ActInput<'booking_requests.create'>[number] => ({
					name: 'Fixture Customer One',
					phone,
					address,
					service: SERVICE,
					repeat: 'once',
					start: WEDNESDAY_10,
					availability: QUOTE,
					...over
				});

				// Denied: mismatched address and spoofed phone are refused with zero rows created
				expect(
					yield* Effect.flip(
						customer.act({ 'booking_requests.create': [request({ address: 'Another address' })] })
					)
				).toMatchObject({ _tag: 'ActRefused' });
				expect(
					yield* Effect.flip(
						customer.act({ 'booking_requests.create': [request({ phone: '+15550199999' })] })
					)
				).toMatchObject({ _tag: 'ActRefused', field: 'phone' });

				// Prepare a live quote via prepare_availability, then fill all providers on that day before submitting -> follow_up
				const quoteCreate = yield* customer.act({
					'availability_requests.create': [
						{
							phone,
							address,
							location: { lat: 40.7128, lng: -74.006 },
							service: SERVICE,
							preference: 'any',
							repeat: 'once'
						}
					]
				});
				committed(quoteCreate);
				yield* t.run_due();
				const liveQuoteId = fixtureId(
					'availability_requests',
					present(quoteCreate.records.find((r) => r.model === 'availability_requests')).id
				);
				const liveQuote = present(
					(yield* Schema.decodeUnknownEffect(
						Schema.Struct({
							availability_requests: Schema.Struct({
								rows: Schema.Array(
									Schema.Struct({
										status: Schema.String,
										starts: Schema.Array(Schema.String)
									})
								)
							})
						})
					)(
						yield* admin.query({
							availability_requests: { where: { id: { eq: liveQuoteId } }, limit: 1 }
						})
					)).availability_requests.rows[0]
				);
				expect(liveQuote.status).toBe('ready');
				expect(liveQuote.starts.length).toBeGreaterThan(0);

				// Valid bound request against seeded QUOTE succeeds automatically
				committed(yield* customer.act({ 'booking_requests.create': [request()] }));
				yield* t.run_due();
				const firstReq = yield* Schema.decodeUnknownEffect(
					Schema.Struct({ booking_requests: Rows })
				)(
					yield* admin.query({
						booking_requests: { where: { availability: { eq: QUOTE } } }
					})
				);
				expect(firstReq.booking_requests.rows).toMatchObject([{ status: 'booked' }]);

				// Now mark both providers off on 2026-10-05 and submit a request against liveQuote -> falls back to follow_up
				const targetStart = present(
					liveQuote.starts.find((s) => s.startsWith('2026-10-05')) ?? liveQuote.starts.at(-1)
				);
				const targetDay = targetStart.slice(0, 10);
				committed(
					yield* ops.act({
						'provider_time_off.create': [
							{ provider: ALPHA, period: { from: targetDay, to: targetDay }, reason: 'leave' },
							{ provider: CHARLIE, period: { from: targetDay, to: targetDay }, reason: 'leave' }
						]
					})
				);
				committed(
					yield* customer.act({
						'booking_requests.create': [request({ start: targetStart, availability: liveQuoteId })]
					})
				);
				yield* t.run_due();
				const fallbackReq = yield* Schema.decodeUnknownEffect(
					Schema.Struct({ booking_requests: Rows })
				)(
					yield* admin.query({
						booking_requests: { where: { availability: { eq: liveQuoteId } } }
					})
				);
				expect(fallbackReq.booking_requests.rows).toMatchObject([{ status: 'follow_up' }]);

				// Quote expires after 15 minutes
				t.clock.advance('16min');
				expect(
					yield* Effect.flip(customer.act({ 'booking_requests.create': [request()] }))
				).toMatchObject({
					_tag: 'ActRefused',
					key: 'errors.availability_changed'
				});
			})
	);

	it.effect(
		'normalizes service skills, marks late cancellations, and deactivates providers cleanly',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const ops = yield* desk(t);
				const admin = yield* t.as(t.admin);

				// Service skill normalization and blank refusal
				expect(
					yield* Effect.flip(
						ops.act({
							'services.create': [
								{ name: 'Invalid Service', skill: '   ', duration_minutes: 60, price: '50.00' }
							]
						})
					)
				).toMatchObject({ _tag: 'ActRefused', key: 'errors.skill_required' });
				committed(
					yield* ops.act({
						'services.create': [
							{
								name: 'Electrical Safety Audit',
								category: 'Electrical',
								skill: '  Electrical Audit ',
								duration_minutes: 60,
								price: '95.00'
							}
						]
					})
				);
				const createdService = yield* Schema.decodeUnknownEffect(
					Schema.Struct({
						services: Schema.Struct({
							rows: Schema.Array(Schema.Struct({ skill: Schema.String }))
						})
					})
				)(yield* admin.query({ services: { where: { name: { eq: 'Electrical Safety Audit' } } } }));
				expect(present(createdService.services.rows[0]).skill).toBe('electrical_audit');

				// Late cancellation within 24h free_change_hours flags late_cancellation = true
				const soonBooking = yield* ops.act({
					'bookings.create': [
						{
							customer: CUSTOMER,
							service: SERVICE,
							address,
							location: { lat: 40.7128, lng: -74.006 },
							preference: 'any',
							repeat: 'once',
							appointments: [
								{
									slot: {
										start: '2026-09-29T14:00:00.000Z',
										end: '2026-09-29T15:30:00.000Z'
									},
									address,
									location: { lat: 40.7128, lng: -74.006 },
									skill: 'hvac_service',
									provider: CHARLIE,
									attention: 'none'
								}
							]
						}
					]
				});
				committed(soonBooking);
				const soonApptId = fixtureId(
					'appointments',
					present(soonBooking.records.find((r) => r.model === 'appointments')).id
				);
				expect(
					(yield* runAutomation(
						t,
						ops.run('appointments_cancel', { targets: [soonApptId] }, JobResult)
					)).state
				).toBe('succeeded');
				expect(yield* appointmentRow(t, soonApptId)).toMatchObject({
					status: 'cancelled',
					late_cancellation: true
				});

				// Deactivating an active provider sets status = inactive and rejects a second deactivation
				expect(
					(yield* runAutomation(
						t,
						ops.run('providers_deactivate', { targets: [ALPHA], last_day: '2026-09-29' }, JobResult)
					)).state
				).toBe('succeeded');
				const alphaRow = yield* Schema.decodeUnknownEffect(
					Schema.Struct({
						providers: Schema.Struct({
							rows: Schema.Array(
								Schema.Struct({
									status: Schema.String,
									inactive_since: Schema.NullOr(Schema.String)
								})
							)
						})
					})
				)(yield* admin.query({ providers: { where: { id: { eq: ALPHA } } } }));
				expect(present(alphaRow.providers.rows[0])).toEqual({
					status: 'inactive',
					inactive_since: '2026-09-29'
				});
				const secondDeactivate = yield* runAutomation(
					t,
					ops.run('providers_deactivate', { targets: [ALPHA], last_day: '2026-09-29' }, JobResult)
				);
				expect(secondDeactivate.state).toBe('failed');
				expect(secondDeactivate.error?.message).toBe('Fixture Provider Alpha is already inactive.');
			})
	);
});
