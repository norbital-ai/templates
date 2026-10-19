import { present } from './test-runtime.js';
import type { ActInput, Committed, PendingApproval, Id, Row } from '@norbital-ai/bolt';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import { Context, Effect, Result, Schema } from 'effect';
import { Conversations, Writes, type Json } from '@norbital-ai/bolt/engine';
/**
 * The workflows through the real engine on the public seed: booking with and without a preference, the travel buffer,
 * the shift check (ask, no answer, decline with a certificate), the ETA check, a helper leaving, and cancellation.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from '@effect/vitest';
import { workspace as acquireWorkspace, fixtureId } from './test-runtime.js';
type T = Effect.Success<ReturnType<typeof acquireWorkspace>>;
type BookingInput = Exclude<ActInput<'booking_requests.create'>, readonly unknown[]>;
type AvailabilityInput = Exclude<ActInput<'availability_requests.create'>, readonly unknown[]>;
const whatsapp = Schema.decodeUnknownSync(
	Schema.Struct({ to: Schema.String, text: Schema.String })
);
const ALPHA = fixtureId('helpers', '0d500002-0000-4000-8000-000000000001'); // east, cleans and deep-cleans, Mon–Sat 08–18
const BRAVO = fixtureId('helpers', '0d500002-0000-4000-8000-000000000002'); // west, Mon–Fri 09–19
const CHARLIE = fixtureId('helpers', '0d500002-0000-4000-8000-000000000003'); // central, Tue–Sun 07–16
const EAST_CUSTOMER = fixtureId('customers', '0d500003-0000-4000-8000-000000000001');
const WEST_CUSTOMER = fixtureId('customers', '0d500003-0000-4000-8000-000000000002');
const HOME_CLEANING = fixtureId('services', '0d500001-0000-4000-8000-000000000001'); // 3 h
/** Tuesday 29 September 2026, 10:00 in Singapore: every seeded helper works then. */
const TUESDAY_10 = Instant('2026-09-29T02:00:00.000Z');
/**
 * Google's Routes API, faked: every route takes `minutes[routingPreference]` minutes. `calls` records what was asked.
 * Without it the connection has no key, so every drive stays the straight-line estimate.
 */
function google(minutes: { readonly [preference: string]: number }) {
	const Request = Schema.Struct({
		path: Schema.String,
		query: Schema.optionalKey(Schema.JsonObject),
		body: Schema.Struct({
			destinations: Schema.Array(Schema.Unknown),
			routingPreference: Schema.String
		})
	});
	const calls: (typeof Request.Type)[] = [];
	const answer = Effect.fnUntraced(function* (instance: string, operation: Json) {
		expect(instance).toBe('google_routes');
		const request = Schema.decodeUnknownSync(Request)(operation);
		calls.push(request);
		return {
			status: 200,
			body: request.body.destinations.map((_, index) => ({
				...(index === 0 ? {} : { destinationIndex: index }),
				duration: `${present(minutes[request.body.routingPreference]) * 60}s`,
				condition: 'ROUTE_EXISTS'
			}))
		};
	});
	return { calls, answer };
}
const workspace = Effect.fnUntraced(function* (http?: ReturnType<typeof google>) {
	const t = yield* acquireWorkspace({
		root: `${process.cwd()}/`,
		seed: 'base',
		now: '2026-09-25T02:00:00.000Z'
	});
	if (http !== undefined) t.fakes.links.answer = http.answer;
	return t;
});
const desk = (t: T) => t.as(t.member(['operations']));
/** Every run a run queues, down the chain (a request → a booking → notices → their delivery). */
const settle = Effect.fnUntraced(function* (t: T) {
	for (let i = 0; i < 4; i++) yield* t.runDue();
});
function committed<O, N extends string>(outcome: Committed<O, N> | PendingApproval<N>) {
	if (outcome.kind !== 'committed') throw new Error(JSON.stringify(outcome));
	return outcome;
}
const visits = Effect.fnUntraced(function* (t: T) {
	return (yield* t.as(t.admin).read('visits', { all: true, orderBy: { number: 'asc' } })).rows;
});
const book = Effect.fnUntraced(function* (t: T, input: Partial<ActInput<'bookings.book'>>) {
	return yield* desk(t).act('bookings.book', {
		customer: EAST_CUSTOMER,
		service: HOME_CLEANING,
		preference: 'any',
		start: TUESDAY_10,
		repeat: 'once',
		...input
	});
});
const signedIn = Effect.fnUntraced(function* (t: T, helper: Id<'helpers'>) {
	const member = t.member(['helper']);
	committed(
		yield* t
			.as(t.admin)
			.act('helpers.update', { target: helper, set: { user: fixtureId('sys_user', member.id) } })
	);
	return t.as(member);
});
describe('the template', () => {
	it('declares what its catalogue card says', () => {
		const files = readdirSync('src', { recursive: true }).map(String);
		const count = (pattern: RegExp) => files.filter((file) => pattern.test(file)).length;
		expect({
			collections: count(/^data\/collection\/[^/]+\/\+collection\.ts$/),
			apps: count(/^app\/.+\/\+app\.ts$/),
			automations: count(/^automation\/\+[^/]+\.automation\.ts$/)
		}).toEqual(JSON.parse(readFileSync('norbital.template.json', 'utf8')).counts);
	});
});
describe('booking', () => {
	it.live(
		'without a preference, matches the nearest helper and keeps them for a recurring customer',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				const reads = vi.spyOn(t.db, 'read');
				const { output } = committed(yield* book(t, { repeat: 'weekly', visits: 3 }));
				// Count native read batches for the complete booking, excluding setup and verification.
				expect(reads.mock.calls).toHaveLength(7);
				expect(reads.mock.calls.map(([statements]) => statements.length)).toEqual([
					1, 1, 1, 1, 1, 1, 1
				]);
				reads.mockRestore();
				expect(output).toMatchObject({ assigned: 3, unassigned: 0 });
				expect((yield* visits(t)).map((v) => v.helper)).toEqual([ALPHA, ALPHA, ALPHA]);
			})
	);
	it.live(
		'with a preference, books the first preferred helper free, and refuses when none of them is',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				committed(yield* book(t, { preference: 'preferred', helpers: [BRAVO, ALPHA] }));
				expect(present((yield* visits(t))[0]).helper).toBe(BRAVO);
				expect(
					(yield* desk(t).read('booking_helpers', { all: true, orderBy: { rank: 'asc' } })).rows
				).toMatchObject([
					{ helper: BRAVO, rank: 1 },
					{ helper: ALPHA, rank: 2 }
				]);
				// Sunday: Bravo and Alpha are both off
				expect(
					yield* Effect.flip(
						book(t, {
							preference: 'preferred',
							helpers: [BRAVO, ALPHA],
							start: Instant('2026-09-27T02:00:00.000Z')
						})
					)
				).toMatchObject({
					_tag: 'ActRefused',
					message: expect.stringContaining('No eligible helper')
				});
			})
	);
	it.live(
		'rejects duplicate preferences atomically, including all visits and confirmation notices',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				expect(
					yield* Effect.flip(book(t, { preference: 'preferred', helpers: [ALPHA, ALPHA] }))
				).toMatchObject({
					_tag: 'ActRefused',
					code: 'unique'
				});
				expect((yield* desk(t).read('bookings', { all: true })).rows).toEqual([]);
				expect(yield* visits(t)).toEqual([]);
				expect((yield* desk(t).read('customer_notices', { all: true })).rows).toEqual([]);
			})
	);
	it.live('checks the existence of every preferred helper on direct creates too', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			expect(
				yield* Effect.flip(
					desk(t).act('bookings.create', {
						customer: EAST_CUSTOMER,
						service: HOME_CLEANING,
						address: 'Fixture address',
						preference: 'preferred',
						repeat: 'once',
						preferred_helpers: {
							create: [
								{ helper: ALPHA, rank: 1 },
								{ helper: fixtureId('helpers', '0d500002-0000-4000-8000-000000000099'), rank: 2 }
							]
						}
					})
				)
			).toMatchObject({ _tag: 'ActRefused', code: 'notFound', field: 'helper' });
			expect((yield* desk(t).read('bookings', { all: true })).rows).toEqual([]);
			expect(yield* visits(t)).toEqual([]);
		})
	);
	it.live('keeps helper visibility on direct preference writes', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const actor = desk(t);
			const helpers = actor.authority.collections.helpers;
			if (helpers === undefined) throw new Error('The scheduler must have a helpers grant.');
			const restricted = t.as({
				...actor.authority,
				collections: {
					...actor.authority.collections,
					helpers: { ...helpers, read: [] }
				}
			});
			const input: Exclude<ActInput<'bookings.create'>, readonly unknown[]> = {
				customer: EAST_CUSTOMER,
				service: HOME_CLEANING,
				address: 'Fixture address',
				preference: 'preferred',
				repeat: 'once',
				preferred_helpers: { create: [{ helper: ALPHA, rank: 1 }] }
			};
			expect(yield* Effect.flip(restricted.act('bookings.create', input))).toMatchObject({
				_tag: 'ActRefused',
				code: 'notFound',
				field: 'helper'
			});
			expect((yield* actor.read('bookings', { all: true })).rows).toEqual([]);
			committed(yield* actor.act('bookings.create', input));
			expect((yield* actor.read('booking_helpers', { all: true })).rows).toMatchObject([
				{ helper: ALPHA, rank: 1 }
			]);
		})
	);
	it.live(
		'preserves ranked preferences when notes change and refuses direct preference edits',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				committed(yield* book(t, { preference: 'preferred', helpers: [BRAVO, ALPHA] }));
				const booking = (yield* desk(t).read('bookings', { all: true })).rows[0];
				if (booking === undefined || typeof booking.id !== 'string')
					throw new Error('The booking must exist.');
				committed(
					yield* desk(t).act('bookings.update', {
						target: booking.id,
						set: { notes: 'Keep Bravo first.' }
					})
				);
				const now = t.clock.now();
				expect(
					(yield* Context.get(t.services, Writes).act({
						mode: { _tag: 'Direct' },
						collection: 'bookings',
						verb: 'update',
						input: {
							target: booking.id,
							set: { preferred_helpers: { create: [{ helper: CHARLIE, rank: 3 }] } }
						},
						key: 'invalid-preference-edit',
						invocationId: 'invalid-preference-edit',
						issuedAt: now,
						authority: desk(t).authority,
						bindings: { now, today: '2026-09-25', tz: 'Asia/Singapore', params: {} }
					})).outcome
				).toMatchObject({ kind: 'refused', code: 'invalidInput', field: 'preferred_helpers' });
				expect((yield* desk(t).read('bookings', { all: true })).rows).toMatchObject([
					{ notes: 'Keep Bravo first.' }
				]);
				expect(
					(yield* desk(t).read('booking_helpers', { all: true, orderBy: { rank: 'asc' } })).rows
				).toMatchObject([
					{ helper: BRAVO, rank: 1 },
					{ helper: ALPHA, rank: 2 }
				]);
				expect((yield* visits(t))[0]?.helper).toBe(BRAVO);
			})
	);
	it.live('keeps a preferred helper on file when an administrator requests removal', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			committed(yield* book(t, { preference: 'preferred', helpers: [BRAVO, ALPHA] }));
			// Alpha is only a preference here; the visit itself is assigned to Bravo.
			const now = t.clock.now();
			const removed = yield* Context.get(t.services, Writes).act({
				mode: { _tag: 'Direct' },
				collection: 'helpers',
				verb: 'erase',
				input: { target: ALPHA },
				key: 'remove-preferred-helper',
				invocationId: 'remove-preferred-helper',
				issuedAt: now,
				authority: t.as(t.admin).authority,
				bindings: { now, today: '2026-09-25', tz: 'Asia/Singapore', params: {} }
			});
			expect(removed.outcome).toMatchObject({ kind: 'refused', code: 'restricted' });
			expect(yield* t.as(t.admin).get('helpers', ALPHA)).toMatchObject({
				id: ALPHA,
				status: 'active'
			});
			expect(
				(yield* desk(t).read('booking_helpers', { all: true, orderBy: { rank: 'asc' } })).rows
			).toMatchObject([
				{ helper: BRAVO, rank: 1 },
				{ helper: ALPHA, rank: 2 }
			]);
			const unused = yield* Context.get(t.services, Writes).act({
				mode: { _tag: 'Direct' },
				collection: 'helpers',
				verb: 'erase',
				input: { target: CHARLIE },
				key: 'remove-unused-helper',
				invocationId: 'remove-unused-helper',
				issuedAt: now,
				authority: t.as(t.admin).authority,
				bindings: { now, today: '2026-09-25', tz: 'Asia/Singapore', params: {} }
			});
			expect(unused.outcome.kind).toBe('committed');
			expect(yield* t.as(t.admin).get('helpers', CHARLIE)).toBeNull();
		})
	);
	it.live(
		'keeps the drive between visits free, and lays the preferred helper’s open times out',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				committed(yield* book(t, {})); // Alpha, 10:00–13:00 in the east
				// 13:15 in the west is too soon for Alpha: the drive is longer than the gap
				committed(
					yield* book(t, { customer: WEST_CUSTOMER, start: Instant('2026-09-29T05:15:00.000Z') })
				);
				const [, second] = yield* visits(t);
				expect(present(second).helper).not.toBe(ALPHA);
				const [alpha] = yield* desk(t).query('helpers.open_slots', {
					helpers: [ALPHA],
					customer: WEST_CUSTOMER,
					service: HOME_CLEANING,
					from: PlainDate('2026-09-29'),
					days: 1
				});
				expect(present(present(alpha).days[0]).starts).not.toContain('2026-09-29T05:00:00.000Z');
				expect(present(present(alpha).days[0]).starts).toContain('2026-09-29T06:30:00.000Z');
			})
	);
	it.live('refuses a helper without the skill, whoever names them', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			committed(
				yield* book(t, { service: fixtureId('services', '0d500001-0000-4000-8000-000000000003') })
			); // move-in: only Bravo
			const [v] = yield* visits(t);
			expect(present(v).helper).toBe(BRAVO);
			expect(
				yield* Effect.flip(
					desk(t).act('visits.reassign', { target: present(v).id, input: { helper: ALPHA } })
				)
			).toMatchObject({
				_tag: 'ActRefused',
				message: 'Fixture Helper Alpha does not have the skill this service needs.'
			});
		})
	);
});
describe('jobs: one-off and recurring', () => {
	const HOURS_3 = 3 * 3600000;
	const startOf = (v: Pick<Row<'visits'>, 'slot'>) => Date.parse(v.slot.start);
	const endOf = (v: Pick<Row<'visits'>, 'slot'>) => {
		if (v.slot.end === null) throw new Error('Visit has no end');
		return Date.parse(v.slot.end);
	};
	/** The local wall time of an instant in Singapore. */
	const wall = (ms: number) =>
		new Date(ms).toLocaleString('en-GB', {
			timeZone: 'Asia/Singapore',
			weekday: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	it.live(
		'a one-off job is one visit for the service length, matched, its cleaner told, then done',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				const alpha = yield* signedIn(t, ALPHA);
				const { output } = committed(yield* book(t, {}));
				expect(output).toMatchObject({ assigned: 1, unassigned: 0 });
				const all = yield* visits(t);
				expect(all).toHaveLength(1);
				const [v] = all;
				expect(v).toMatchObject({ helper: ALPHA, status: 'scheduled', attention: 'none' });
				expect(startOf(present(v))).toBe(Date.parse(TUESDAY_10));
				expect(endOf(present(v)) - startOf(present(v))).toBe(HOURS_3);
				const booking = present((yield* t.as(t.admin).read('bookings', { all: true })).rows[0]);
				expect(booking).toMatchObject({ repeat: 'once', status: 'active' });
				yield* settle(t);
				// the cleaner hears about it on WhatsApp, and it is on their own list
				expect(
					t.fakes.links.sent
						.filter((send) => send.instance === 'whatsapp')
						.some((s) => whatsapp(s.message).to === '6590000001@s.whatsapp.net')
				).toBe(true);
				expect((yield* alpha.read('visits', { all: true })).rows).toHaveLength(1);
				t.clock.set('2026-09-29T02:00:00.000Z');
				committed(
					yield* alpha.act('visits.update', {
						target: present(v).id,
						set: { status: 'in_progress' }
					})
				);
				t.clock.set('2026-09-29T05:00:00.000Z');
				committed(
					yield* alpha.act('visits.update', { target: present(v).id, set: { status: 'done' } })
				);
				expect((yield* visits(t))[0]).toMatchObject({ status: 'done' });
			})
	);
	it.live(
		'a weekly job is eight visits at the same local time a week apart, kept with one cleaner',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				const { output } = committed(yield* book(t, { repeat: 'weekly' }));
				expect(output).toMatchObject({ assigned: 8, unassigned: 0 });
				const all = yield* visits(t);
				expect(all).toHaveLength(8);
				const starts = all.map(startOf);
				for (let i = 1; i < starts.length; i++)
					expect(present(starts[i]) - present(starts[i - 1])).toBe(7 * 86400000);
				expect(new Set(starts.map(wall))).toEqual(new Set(['Tue 10:00']));
				// continuity: the same cleaner every week while they are free
				expect(new Set(all.map((v) => v.helper))).toEqual(new Set([ALPHA]));
				expect(all.every((v) => endOf(v) - startOf(v) === HOURS_3)).toBe(true);
			})
	);
	it.live('fortnightly and monthly jobs repeat at their own spacing, the same wall time', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			committed(yield* book(t, { repeat: 'fortnightly', visits: 3 }));
			const fortnightly = (yield* visits(t)).map(startOf);
			expect(fortnightly.map((s, i) => (i === 0 ? 0 : s - present(fortnightly[i - 1])))).toEqual([
				0,
				14 * 86400000,
				14 * 86400000
			]);
			const m = yield* workspace();
			committed(yield* book(m, { repeat: 'monthly', visits: 3 }));
			const monthly = (yield* visits(m)).map((v) =>
				new Date(startOf(v)).toLocaleString('en-GB', {
					timeZone: 'Asia/Singapore',
					day: '2-digit',
					month: '2-digit',
					hour: '2-digit',
					minute: '2-digit'
				})
			);
			expect(monthly).toEqual(['29/09, 10:00', '29/10, 10:00', '29/11, 10:00']);
		})
	);
	it.live(
		'a recurring job keeps its cleaner but covers a week they are off with someone else',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				committed(
					yield* t.as(t.admin).act('helper_time_off.create', {
						helper: ALPHA,
						period: { from: '2026-10-13', to: '2026-10-13' },
						reason: 'leave'
					})
				);
				committed(yield* book(t, { repeat: 'weekly', visits: 4 }));
				const helpers = (yield* visits(t)).map((v) => v.helper);
				expect(helpers[0]).toBe(ALPHA);
				expect(helpers[2]).not.toBe(ALPHA); // 13 October, Alpha's leave
				expect([helpers[1], helpers[3]]).toEqual([ALPHA, ALPHA]);
			})
	);
	it.live('a recurring job nobody can staff in full is not booked at all; no partial series', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			committed(
				yield* t.as(t.admin).act('helper_time_off.create', {
					helper: ALPHA,
					period: { from: '2026-10-06', to: '2026-10-06' },
					reason: 'leave'
				})
			);
			expect(
				yield* Effect.flip(
					book(t, { repeat: 'weekly', visits: 3, preference: 'preferred', helpers: [ALPHA] })
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(yield* visits(t)).toEqual([]);
			expect((yield* t.as(t.admin).read('bookings', { all: true })).rows).toEqual([]);
		})
	);
	it.live(
		'cancelling one occurrence leaves the series; cancelling the booking ends the visits still to come',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				const { output } = committed(yield* book(t, { repeat: 'weekly', visits: 4 }));
				const [first] = yield* visits(t);
				committed(yield* desk(t).act('visits.cancel', { target: present(first).id }));
				expect((yield* visits(t)).map((v) => v.status)).toEqual([
					'cancelled',
					'scheduled',
					'scheduled',
					'scheduled'
				]);
				committed(yield* desk(t).act('bookings.cancel', { target: output.booking }));
				expect((yield* visits(t)).every((v) => v.status === 'cancelled')).toBe(true);
				expect((yield* t.as(t.admin).read('bookings', { all: true })).rows[0]).toMatchObject({
					status: 'cancelled'
				});
			})
	);
});
describe('the shift check', () => {
	it.live(
		'asks two hours ahead; silence proposes a replacement, and only controller approval assigns them',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				committed(yield* book(t, { preference: 'preferred', helpers: [ALPHA, CHARLIE] }));
				t.clock.set('2026-09-29T00:05:00.000Z'); // 08:05, under two hours ahead
				yield* t.runDue();
				expect((yield* visits(t))[0]).toMatchObject({ shift_check: 'asked', helper: ALPHA });
				t.clock.set('2026-09-29T01:30:00.000Z'); // over an hour later, no answer (cron slots are bucketed, so well past it)
				yield* t.runDue();
				yield* t.runDue(); // the warning's letter
				const [v] = yield* visits(t);
				// the new helper's shift is checked afresh (the ETA watch may already flag them in the same wake)
				expect(v).toMatchObject({
					shift_check: 'no_response',
					helper: null,
					proposed_helper: CHARLIE,
					attention: 'awaiting_approval',
					unavailable_helper: ALPHA
				});
				expect((yield* t.as(t.admin).read('customer_notices', { all: true })).rows).toHaveLength(1);
				committed(yield* desk(t).act('visits.accept_proposal', { target: present(v).id }));
				yield* settle(t);
				expect((yield* visits(t))[0]).toMatchObject({
					helper: CHARLIE,
					shift_check: 'not_due',
					proposed_helper: null,
					attention: 'none'
				});
				const admin = t.as(t.admin);
				const warnings = (yield* admin.read('helper_warnings', { all: true })).rows;
				expect(warnings).toMatchObject([{ helper: ALPHA, reason: 'no_response' }]);
				// the kit converts no documents: the letter run ends cleanly and the warning stands without one
				const [letterRun] = present(
					(yield* t.db.read([
						{ text: `SELECT state FROM sys_run WHERE automation = 'warning_letter'`, params: [] }
					]))[0]
				).rows;
				expect(letterRun).toEqual({ state: 'succeeded' });
				// the booking's confirmation, then who comes instead (the customer asked for particular helpers)
				const notices = (yield* admin.read('customer_notices', {
					all: true,
					orderBy: { created_at: 'asc' }
				})).rows;
				expect(notices.map((n) => n.subject)).toEqual([
					expect.stringContaining('Booking confirmed'),
					expect.stringContaining('A new helper')
				]);
				// each went to the customer's WhatsApp number (they gave no email beyond the seed's, which also gets it)
				const toCustomer = t.fakes.links.sent
					.filter((send) => send.instance === 'whatsapp')
					.filter((s) => whatsapp(s.message).to === '6580000001@s.whatsapp.net');
				expect(toCustomer).toHaveLength(2);
				const deliveryRuns = yield* t.db.read([
					{
						text: `SELECT automation, state, error FROM sys_run
				       WHERE automation = 'deliver_notices' ORDER BY due_at, id`,
						params: []
					}
				]);
				expect(
					notices.map((n) => n.whatsapp),
					JSON.stringify(deliveryRuns)
				).toEqual(['sent', 'sent']);
				// and, since the seeded customer gave an address, by mail through the customer_mail connection, tracked on the notice
				const mails = t.fakes.links.sent.filter((send) => send.instance === 'customer_mail');
				expect(mails).toHaveLength(2);
				expect(
					notices.every((n) => n.delivery === 'sent' && n.to_address !== null && n.sent_at !== null)
				).toBe(true);
				// what the mailbox reports lands on the notice: presumed delivery, an approximate open, an auto-reply kept apart, a reply
				const [first] = notices;
				const providerId = present(
					present(
						(yield* t.db.read([
							{
								text: "SELECT m.provider_id FROM sys_message m JOIN sys_conversation c ON c.id = m.conversation WHERE m.integration = 'customer_mail' AND c.thread = $1 AND m.direction = 'outbound' LIMIT 1",
								params: [String(present(first).id)]
							}
						]))[0]
					).rows[0]
				).provider_id;
				if (typeof providerId !== 'string')
					throw new Error('Missing native mail delivery identity');
				const report = (
					kind: 'delivered' | 'opened',
					more: { presumed?: boolean; approximate?: boolean } = {}
				) =>
					Context.get(t.services, Conversations).receive('customer_mail', {
						kind: 'delivery',
						providerId,
						report: { kind, at: '2026-09-29T02:00:00.000Z', provider: 'fake', ...more }
					});
				yield* report('delivered', { presumed: true });
				yield* report('opened', { approximate: true });
				const reply = (id: string, text: string, headers: Readonly<Record<string, string>> = {}) =>
					t.receive('customer_mail', {
						id,
						thread: String(present(first).id),
						sentAt: '2026-09-29T03:00:00.000Z',
						from: { address: String(present(first).to_address), name: null },
						replyTo: null,
						to: [],
						cc: [],
						subject: 'Re: booking',
						text,
						html: null,
						headers: { 'in-reply-to': providerId, ...headers },
						attachments: []
					});
				yield* reply('<auto@x.example>', 'I am away.', { 'auto-submitted': 'auto-replied' });
				expect(
					yield* admin.get('customer_notices', fixtureId('customer_notices', first?.id))
				).toMatchObject({
					delivery: 'opened',
					delivery_presumed: true
				});
				yield* reply('<r1@x.example>', 'Thanks, see you then.');
				const after = yield* admin.get(
					'customer_notices',
					fixtureId('customer_notices', first?.id)
				);
				if (after === null) throw new Error('Missing replied notice');
				expect(after).toMatchObject({
					delivery: 'replied',
					reply_excerpt: 'Thanks, see you then.'
				});
				expect(after.auto_replied_at).not.toBeNull();
				expect(after.opened_at).not.toBeNull();
			})
	);
	it.live(
		'a medical decline blocks the cleaner for the day and waits for controller approval without a warning',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				committed(yield* book(t, {}));
				const alpha = yield* signedIn(t, ALPHA);
				const [v] = yield* visits(t);
				committed(
					yield* alpha.act('visits.decline_shift', { target: present(v).id, input: { mc: true } })
				);
				yield* t.runDue();
				const [after] = yield* visits(t);
				expect(after).toMatchObject({
					helper: null,
					unavailable_helper: ALPHA,
					attention: 'awaiting_approval'
				});
				expect(present(after).proposed_helper).not.toBeNull();
				expect((yield* t.as(t.admin).read('helper_time_off', { all: true })).rows).toMatchObject([
					{ helper: ALPHA, reason: 'medical' }
				]);
				const replacement = yield* signedIn(t, fixtureId('helpers', after?.proposed_helper));
				expect((yield* replacement.read('visits', { all: true })).rows).toEqual([]);
				committed(yield* desk(t).act('visits.accept_proposal', { target: present(after).id }));
				yield* settle(t);
				expect((yield* replacement.read('visits', { all: true })).rows).toHaveLength(1);
				const admin = t.as(t.admin);
				expect((yield* admin.read('helper_warnings', { all: true })).rows).toEqual([]);
				// Customer receives the confirmed replacement, never an unapproved recommendation.
				expect(
					(yield* admin.read('customer_notices', { all: true })).rows.map((n) => n.subject)
				).toEqual(
					expect.arrayContaining([
						expect.stringContaining('Booking confirmed'),
						expect.stringContaining('A new helper')
					])
				);
			})
	);
	it.live(
		'two cleaners dropping out of overlapping visits the same morning both get recommendations',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				committed(yield* book(t, {}));
				committed(yield* book(t, { customer: WEST_CUSTOMER }));
				const [first, second] = yield* visits(t);
				expect(present(first).helper).not.toBe(present(second).helper);
				const a = yield* signedIn(t, fixtureId('helpers', first?.helper));
				const b = yield* signedIn(t, fixtureId('helpers', second?.helper));
				committed(
					yield* a.act('visits.decline_shift', { target: present(first).id, input: { mc: true } })
				);
				committed(
					yield* b.act('visits.decline_shift', { target: present(second).id, input: { mc: true } })
				);
				yield* t.runDue();
				// both now unassigned at the same time: neither refusal blocks the other's recovery
				for (const v of yield* visits(t))
					expect(v).toMatchObject({
						helper: null,
						attention: expect.stringMatching(/awaiting_approval|unassigned/)
					});
				// and the one cleaner left is proposed for one of them, not both
				const proposed = (yield* visits(t)).map((v) => v.proposed_helper).filter((h) => h !== null);
				expect(new Set(proposed).size).toBe(proposed.length);
			})
	);
	it.live('lets the controller report unavailability and prepare recommendations for the day', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			committed(yield* book(t, {}));
			const [v] = yield* visits(t);
			committed(
				yield* desk(t).act('visits.report_unavailable', {
					target: present(v).id,
					input: { mc: true }
				})
			);
			yield* settle(t);
			expect((yield* visits(t))[0]).toMatchObject({
				helper: null,
				unavailable_helper: ALPHA,
				attention: 'awaiting_approval'
			});
		})
	);
	it.live(
		'rejects stale approval, refreshes the recommendation, and never assigns an unavailable cleaner',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				committed(yield* book(t, {}));
				const alpha = yield* signedIn(t, ALPHA);
				const [v] = yield* visits(t);
				committed(
					yield* alpha.act('visits.decline_shift', { target: present(v).id, input: { mc: true } })
				);
				yield* settle(t);
				const [pending] = yield* visits(t);
				const proposed = fixtureId('helpers', pending?.proposed_helper);
				committed(
					yield* desk(t).act('helper_time_off.create', {
						helper: proposed,
						period: { from: '2026-09-29', to: '2026-09-29' },
						reason: 'leave'
					})
				);
				expect(
					yield* Effect.flip(desk(t).act('visits.accept_proposal', { target: present(v).id }))
				).toMatchObject({ _tag: 'ActRefused' });
				expect((yield* visits(t))[0]).toMatchObject({
					helper: null,
					attention: 'awaiting_approval'
				});
				committed(yield* desk(t).act('visits.recommend', { target: present(v).id }));
				const [refreshed] = yield* visits(t);
				expect(present(refreshed).proposed_helper).not.toBe(proposed);
				expect(present(refreshed).proposed_helper).not.toBe(ALPHA);
				// Repeated deadline wakes must not issue duplicate absence warnings or leave records.
				yield* settle(t);
				expect((yield* t.as(t.admin).read('helper_time_off', { all: true })).rows).toHaveLength(2);
			})
	);
	it.live(
		'offers recovery starts and rebooks one recurring occurrence inside the cutoff, then notifies its assigned cleaner',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				committed(yield* book(t, { repeat: 'weekly', visits: 2 }));
				const alpha = yield* signedIn(t, ALPHA);
				const [first, second] = yield* visits(t);
				t.clock.set('2026-09-29T01:30:00.000Z');
				committed(
					yield* alpha.act('visits.decline_shift', {
						target: present(first).id,
						input: { mc: true }
					})
				);
				yield* settle(t);
				const slots = yield* desk(t).query('visits.rebooking_slots', {
					visit: present(first).id,
					from: PlainDate('2026-09-30'),
					days: 2
				});
				expect(present(slots[0]).starts.length).toBeGreaterThan(0);
				const start = present(present(slots[0]).starts[0]);
				const candidates = yield* desk(t).query('visits.candidates', {
					visit: present(first).id,
					start
				});
				expect(candidates.some((c) => c.helper === ALPHA)).toBe(false);
				const replacement = yield* signedIn(t, present(candidates[0]).helper);
				committed(
					yield* desk(t).act('visits.rebook', {
						target: present(first).id,
						input: { start, helper: present(candidates[0]).helper }
					})
				);
				yield* settle(t);
				const [a, b] = yield* visits(t);
				expect(a).toMatchObject({
					helper: present(candidates[0]).helper,
					attention: 'none',
					proposed_helper: null
				});
				expect(a?.slot.start).toEqual(start);
				expect(b).toEqual(second);
				expect((yield* replacement.read('visits', { all: true })).rows).toHaveLength(1);
				const { rows: notices } = present(
					(yield* t.db.read([
						{
							text: "SELECT title, body FROM sys_notification WHERE title = 'Your route has a new assignment'",
							params: []
						}
					]))[0]
				);
				expect(
					notices.some(
						(n) =>
							String(n.body).includes(String(present(first).number)) &&
							String(n.body).includes('Open My Day')
					)
				).toBe(true);
				expect(
					t.fakes.links.sent
						.filter((send) => send.instance === 'whatsapp')
						.some((s) => whatsapp(s.message).text.includes('New visit'))
				).toBe(true);
			})
	);
	it.live(
		'does not let ordinary customer rebooking bypass the cutoff or let cleaners approve replacements',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				committed(yield* book(t, {}));
				const [v] = yield* visits(t);
				const alpha = yield* signedIn(t, ALPHA);
				t.clock.set('2026-09-29T01:30:00.000Z');
				expect(
					yield* Effect.flip(
						desk(t).act('visits.rebook', {
							target: present(v).id,
							input: { start: Instant('2026-09-30T02:00:00.000Z') }
						})
					)
				).toMatchObject({ _tag: 'ActRefused' });
				expect(
					yield* Effect.flip(alpha.act('visits.accept_proposal', { target: present(v).id }))
				).toMatchObject({
					_tag: 'ActRefused'
				});
			})
	);
	it.live('a confirmed helper is not chased', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			committed(yield* book(t, {}));
			const alpha = yield* signedIn(t, ALPHA);
			const [v] = yield* visits(t);
			committed(yield* alpha.act('visits.confirm_shift', { target: present(v).id }));
			t.clock.set('2026-09-29T01:30:00.000Z');
			yield* t.runDue();
			expect((yield* visits(t))[0]).toMatchObject({ helper: ALPHA, shift_check: 'confirmed' });
		})
	);
});
describe('the ETA check', () => {
	it.live('preserves a dispatch warning while updating a late helper ETA', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			committed(yield* book(t, {}));
			const [visit] = yield* visits(t);
			if (visit === undefined || typeof visit.id !== 'string')
				throw new Error('Booked visit is absent');
			committed(
				yield* t.as(t.admin).act('visits.update', {
					target: visit.id,
					set: { attention: 'helper_left' }
				})
			);
			const alpha = yield* signedIn(t, ALPHA);
			t.clock.set('2026-09-29T01:20:00.000Z');
			committed(
				yield* alpha.act('helpers.update', {
					target: ALPHA,
					set: { last_location: { lat: 1.3404, lng: 103.65 } }
				})
			);
			t.clock.set('2026-09-29T01:25:00.000Z');
			yield* t.runDue();
			const [checked] = yield* visits(t);
			expect(checked).toMatchObject({ attention: 'helper_left' });
			expect(checked?.eta_minutes).toBeGreaterThan(30);
		})
	);
	it.live(
		'flags a visit whose helper is more than 30 minutes away, and one whose helper sent no position',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				committed(yield* book(t, {}));
				committed(
					yield* book(t, { customer: WEST_CUSTOMER, start: Instant('2026-09-29T03:00:00.000Z') })
				);
				const alpha = yield* signedIn(t, ALPHA);
				t.clock.set('2026-09-29T01:20:00.000Z');
				// Alpha reports from the far west; the other helper reports nothing
				committed(
					yield* alpha.act('helpers.update', {
						target: ALPHA,
						set: { last_location: { lat: 1.3404, lng: 103.65 } }
					})
				);
				t.clock.set('2026-09-29T01:25:00.000Z');
				yield* t.runDue();
				const [first, second] = yield* visits(t);
				expect(first).toMatchObject({ attention: 'eta_risk' });
				expect(present(first).eta_minutes).toBeGreaterThan(30);
				expect(second).toMatchObject({ attention: 'none', eta_minutes: null });
				t.clock.set('2026-09-29T02:05:00.000Z');
				yield* t.runDue();
				expect((yield* visits(t))[1]).toMatchObject({ attention: 'eta_risk', eta_minutes: null });
			})
	);
	it.live('keeps re-checking until the visit starts: a helper who gets close clears the flag', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			committed(yield* book(t, {})); // Customer One, east, 10:00 Singapore
			const alpha = yield* signedIn(t, ALPHA);
			const report = Effect.fnUntraced(function* (at: string, lat: number, lng: number) {
				t.clock.set(at);
				committed(
					yield* alpha.act('helpers.update', {
						target: ALPHA,
						set: { last_location: { lat, lng } }
					})
				);
				yield* t.runDue();
			});
			yield* report('2026-09-29T01:20:00.000Z', 1.3404, 103.65); // far west
			expect((yield* visits(t))[0]).toMatchObject({ attention: 'eta_risk' });
			yield* report('2026-09-29T01:40:00.000Z', 1.324, 103.927); // around the corner
			const [v] = yield* visits(t);
			expect(v).toMatchObject({ attention: 'none' });
			expect(present(v).eta_minutes).toBeLessThan(5);
		})
	);
});
describe('drive times and double booking', () => {
	/** Customer One (east) to Customer Two (west), each rounded to its ~1 km square. */
	const EAST_TO_WEST = '1.32,103.93>1.33,103.74';
	it.live(
		'times every planned leg with Google, caches it, and moves a visit its helper can no longer reach',
		() =>
			Effect.gen(function* () {
				const maps = google({ TRAFFIC_UNAWARE: 90 });
				const t = yield* workspace(maps);
				// Alpha, 10:00–13:00 in the east, asked for by name so the optimiser leaves it (the fake times every leg at 90)
				committed(yield* book(t, { preference: 'preferred', helpers: [ALPHA] }));
				// 14:15 in the west: the straight-line estimate (~50 min + 15 to settle) lets Alpha, whom the customer asked for, go
				committed(
					yield* book(t, {
						customer: WEST_CUSTOMER,
						preference: 'preferred',
						helpers: [ALPHA],
						start: Instant('2026-09-29T06:15:00.000Z')
					})
				);
				expect((yield* visits(t)).map((v) => v.helper)).toEqual([ALPHA, ALPHA]);
				yield* settle(t);
				// Google says 90 minutes: Alpha cannot make it, so the west visit goes to the best other helper
				const [first, second] = yield* visits(t);
				expect(present(first).helper).toBe(ALPHA);
				expect(second).toMatchObject({ helper: BRAVO, attention: 'none' });
				const cached = (yield* t.as(t.admin).read('drive_times', { all: true })).rows;
				expect(cached).toContainEqual(expect.objectContaining({ leg: EAST_TO_WEST, minutes: 90 }));
				expect(maps.calls[0]).toMatchObject({
					path: 'distanceMatrix/v2:computeRouteMatrix',
					query: { fields: 'originIndex,destinationIndex,duration,condition' },
					body: { routingPreference: 'TRAFFIC_UNAWARE' }
				});
				// a timed leg is not asked for again
				const asked = maps.calls.length;
				t.clock.advance('15min');
				yield* settle(t);
				expect(maps.calls.length).toBe(asked);
				// the customer who asked for Alpha is told who comes instead
				const notices = (yield* t.as(t.admin).read('customer_notices', { all: true })).rows;
				expect(notices.map((n) => n.subject)).toContainEqual(
					expect.stringContaining('A new helper for your visit')
				);
			})
	);
	it.live(
		'optimises on its own: a cleaner back from cancelled leave takes the visit nearest her',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				const admin = t.as(t.admin);
				const leave = committed(
					yield* admin.act('helper_time_off.create', {
						helper: ALPHA,
						period: { from: '2026-09-29', to: '2026-09-29' },
						reason: 'other'
					})
				);
				committed(yield* book(t, {})); // east, Tuesday 10:00: Alpha is off, so someone farther takes it
				yield* settle(t);
				expect(present((yield* visits(t))[0]).helper).not.toBe(ALPHA);
				committed(
					yield* admin.act('helper_time_off.delete', {
						target: fixtureId('helper_time_off', leave.records[0]?.id)
					})
				);
				// no button: the next scheduled run rebalances
				t.clock.advance('15min');
				yield* settle(t);
				expect(present((yield* visits(t))[0]).helper).toBe(ALPHA);
			})
	);
	it.live('matches with the cached time: a shorter real drive opens an earlier start', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			committed(yield* book(t, {})); // Alpha, 10:00–13:00 in the east
			const openings = Effect.fnUntraced(function* () {
				return present(
					present(
						(yield* desk(t).query('helpers.open_slots', {
							helpers: [ALPHA],
							customer: WEST_CUSTOMER,
							service: HOME_CLEANING,
							from: PlainDate('2026-09-29'),
							days: 1
						}))[0]
					).days[0]
				).starts;
			});
			// estimated: 13:00 + ~50 min + 15 → 14:30 is the first start
			expect(yield* openings()).not.toContain('2026-09-29T06:00:00.000Z');
			committed(yield* t.as(t.admin).act('drive_times.create', { leg: EAST_TO_WEST, minutes: 20 }));
			// timed at 20 minutes: 13:00 + 20 + 15 → 14:00 opens, 13:30 still does not
			const timed = yield* openings();
			expect(timed).toContain('2026-09-29T06:00:00.000Z');
			expect(timed).not.toContain('2026-09-29T05:30:00.000Z');
		})
	);
	it.live(
		'never lets one helper hold two overlapping visits, and moves one written too close by hand',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				committed(yield* book(t, {})); // Alpha, 10:00–13:00 in the east
				const [booked] = yield* visits(t);
				const direct = (start: Row<'visits'>['slot']['start']) =>
					desk(t).act('bookings.create', {
						customer: EAST_CUSTOMER,
						service: HOME_CLEANING,
						address: 'By hand',
						area: 'east',
						preference: 'any',
						repeat: 'once',
						visits: {
							create: [
								{
									slot: {
										start,
										end: Instant(new Date(Date.parse(start) + 3 * 3600000).toISOString())
									},
									address: 'By hand',
									location: present(booked).location,
									area: 'east',
									skill: 'home_cleaning',
									helper: ALPHA,
									attention: 'none'
								}
							]
						}
					});
				// an overlap is refused by the database, whoever writes it
				expect(yield* Effect.flip(direct(Instant('2026-09-29T03:00:00.000Z')))).toMatchObject({
					_tag: 'ActRefused'
				});
				// 13:05, next door: no overlap, but no time to settle in — the drive check hands it to another helper
				committed(yield* direct(Instant('2026-09-29T05:05:00.000Z')));
				yield* settle(t);
				const [, second] = yield* visits(t);
				expect(present(second).helper).not.toBe(ALPHA);
				expect(present(second).helper).not.toBeNull();
				// and a drag onto Alpha is refused with the reason
				expect(
					yield* Effect.flip(
						desk(t).act('visits.update', { target: present(second).id, set: { helper: ALPHA } })
					)
				).toMatchObject({ _tag: 'ActRefused', message: expect.stringContaining('too close') });
			})
	);
	it.live('the ETA check asks Google in live traffic when the helper is not plainly close', () =>
		Effect.gen(function* () {
			const maps = google({ TRAFFIC_UNAWARE: 20, TRAFFIC_AWARE: 50 });
			const t = yield* workspace(maps);
			committed(yield* book(t, {}));
			const alpha = yield* signedIn(t, ALPHA);
			t.clock.set('2026-09-29T01:20:00.000Z');
			// central: ~26 minutes by straight line, under the 30-minute limit; Google in traffic says 50
			committed(
				yield* alpha.act('helpers.update', {
					target: ALPHA,
					set: { last_location: { lat: 1.3048, lng: 103.8318 } }
				})
			);
			t.clock.set('2026-09-29T01:25:00.000Z');
			yield* t.runDue();
			expect((yield* visits(t))[0]).toMatchObject({ attention: 'eta_risk', eta_minutes: 50 });
			expect(maps.calls.at(-1)).toMatchObject({ body: { routingPreference: 'TRAFFIC_AWARE' } });
		})
	);
});
describe('the helper app', () => {
	it.live("a signed-in helper finds their own record by their account, and nobody else's", () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const alpha = yield* signedIn(t, ALPHA);
			const me = alpha.authority.actor;
			if (me.kind !== 'member') throw new Error('Helper has no member identity');
			const found = (yield* alpha.read('helpers', {
				where: { user: { eq: fixtureId('sys_user', me.id) } },
				limit: 5
			})).rows;
			expect(found.map((h) => h.id)).toEqual([ALPHA]);
			expect((yield* alpha.read('helpers', { all: true })).rows).toHaveLength(1);
		})
	);
});
describe('changes', () => {
	it.live(
		'a helper leaving gets each later visit a proposal from the closest skillset, which the desk accepts',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				committed(
					yield* book(t, { service: fixtureId('services', '0d500001-0000-4000-8000-000000000002') })
				); // deep cleaning: Alpha or Charlie
				const [v] = yield* visits(t);
				expect(present(v).helper).toBe(ALPHA);
				const { output } = committed(
					yield* desk(t).act('helpers.offboard', {
						target: ALPHA,
						input: { last_day: PlainDate('2026-09-28') }
					})
				);
				expect(output).toEqual({ proposed: 1, open: 0 });
				const [proposed] = yield* visits(t);
				expect(proposed).toMatchObject({
					helper: null,
					proposed_helper: CHARLIE,
					attention: 'helper_left'
				});
				committed(yield* desk(t).act('visits.accept_proposal', { target: present(v).id }));
				expect((yield* visits(t))[0]).toMatchObject({
					helper: CHARLIE,
					proposed_helper: null,
					attention: 'none'
				});
			})
	);
	it.live('a cancellation inside a day is late; a move inside a day is refused', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			committed(yield* book(t, { repeat: 'weekly', visits: 2 }));
			const [first, second] = yield* visits(t);
			t.clock.set('2026-09-28T12:00:00.000Z');
			expect(
				yield* Effect.flip(
					desk(t).act('visits.reschedule', {
						target: present(first).id,
						input: { start: Instant('2026-09-30T02:00:00.000Z') }
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
			committed(yield* desk(t).act('visits.cancel', { target: present(first).id }));
			committed(
				yield* desk(t).act('visits.reschedule', {
					target: present(second).id,
					input: { start: Instant('2026-10-07T03:00:00.000Z') }
				})
			);
			const [a, b] = yield* visits(t);
			expect(a).toMatchObject({ status: 'cancelled', late_cancellation: true });
			expect(b).toMatchObject({ status: 'scheduled', helper: ALPHA });
		})
	);
});
describe('the customer portal', () => {
	const request: BookingInput = {
		name: 'Portal Customer',
		phone: '+6581234567',
		address: '9 Portal Lane, Singapore 400009',
		area: 'east',
		service: HOME_CLEANING,
		start: TUESDAY_10,
		repeat: 'once'
	};
	/** A customer who verified their number on the portal (signed up: external, the `customer` policy). */
	const customer = (t: T, phone = request.phone) =>
		t.as(t.member(['customer'], { external: true, phone }));
	it.live(
		'a visitor sees the services and their open times, and nothing else — not even a way to book',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				yield* t.as(t.admin).start('publish_openings', {});
				yield* settle(t);
				const visitor = t.visitor('portal');
				expect((yield* visitor.read('services', { all: true })).rows).toHaveLength(4);
				const open = (yield* visitor.read('openings', { all: true })).rows;
				expect(open.length).toBeGreaterThan(0);
				yield* Effect.tryPromise({
					try: () =>
						expect(Effect.runPromise(visitor.read('helpers', { all: true }))).rejects.toThrow(),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				expect(yield* Effect.flip(visitor.act('booking_requests.create', request))).toMatchObject({
					_tag: 'ActRefused'
				});
			})
	);
	it.live('the open times are when a helper with the skill is free, and a booked time closes', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			yield* t.as(t.admin).start('publish_openings', {});
			yield* settle(t);
			const admin = t.as(t.admin);
			const tuesday = Effect.fnUntraced(function* () {
				return present(
					(yield* admin.read('openings', {
						where: { service: { eq: HOME_CLEANING }, day: { eq: '2026-09-29' } },
						all: true
					})).rows[0]
				).starts;
			});
			expect(yield* tuesday()).toContain(TUESDAY_10);
			// book 10:00 until no helper who cleans is left free then
			for (;;) {
				const outcome = yield* Effect.result(book(t, {}));
				if (Result.isFailure(outcome)) {
					expect(outcome.failure).toMatchObject({ _tag: 'ActRefused' });
					break;
				}
				if (outcome.success.kind !== 'committed') break;
			}
			yield* settle(t);
			expect(yield* tuesday()).not.toContain(TUESDAY_10);
		})
	);
	it.live(
		'a verified customer books under their own number: filed by phone, booked, told on WhatsApp, and sees it',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				const me = customer(t);
				const filed = committed(yield* me.act('booking_requests.create', request));
				yield* settle(t);
				const admin = t.as(t.admin);
				const [r] = (yield* admin.read('booking_requests', { all: true })).rows;
				expect(r).toMatchObject({ status: 'booked' });
				expect((yield* me.read('booking_requests', { all: true })).rows).toMatchObject([
					{ id: present(filed.records[0]).id, status: 'booked' }
				]);
				const customers = (yield* admin.read('customers', {
					where: { phone: { eq: request.phone } },
					all: true
				})).rows;
				expect(customers).toHaveLength(1);
				expect((yield* visits(t))[0]).toMatchObject({ helper: ALPHA });
				expect((yield* admin.read('customer_notices', { all: true })).rows).toMatchObject([
					{
						subject: expect.stringContaining('Booking confirmed'),
						whatsapp: 'sent',
						to_address: null,
						delivery: null
					}
				]);
				expect(
					t.fakes.links.sent
						.filter((send) => send.instance === 'whatsapp')
						.map((s) => whatsapp(s.message).to)
				).toContain('6581234567@s.whatsapp.net');
				expect(t.fakes.links.sent.filter((send) => send.instance === 'customer_mail')).toEqual([]);
			})
	);
	it.live('a customer cannot book under, or read, another number', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const me = customer(t);
			expect(
				yield* Effect.flip(me.act('booking_requests.create', { ...request, phone: '+6580000001' }))
			).toMatchObject({ _tag: 'ActRefused' });
			committed(
				yield* customer(t, '+6580000001').act('booking_requests.create', {
					...request,
					phone: '+6580000001'
				})
			);
			expect((yield* me.read('booking_requests', { all: true })).rows).toEqual([]);
		})
	);
	it.live('a returning customer is recognised by their number, not filed twice', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			committed(
				yield* customer(t, '+6580000001').act('booking_requests.create', {
					...request,
					name: 'Someone Else',
					phone: '+6580000001'
				})
			);
			yield* settle(t);
			const admin = t.as(t.admin);
			expect((yield* admin.read('customers', { all: true })).rows).toHaveLength(2);
			expect((yield* admin.read('bookings', { all: true })).rows[0]).toMatchObject({
				customer: EAST_CUSTOMER
			});
		})
	);
	it.live(
		'a request nobody is free for goes to the desk, and the customer is told a time will follow',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				// Sunday 06:00: nobody works then
				committed(
					yield* customer(t).act('booking_requests.create', {
						...request,
						start: '2026-09-26T22:00:00.000Z'
					})
				);
				yield* settle(t);
				const admin = t.as(t.admin);
				expect((yield* admin.read('booking_requests', { all: true })).rows[0]).toMatchObject({
					status: 'follow_up'
				});
				expect(yield* visits(t)).toEqual([]);
				expect((yield* admin.read('customer_notices', { all: true })).rows).toMatchObject([
					{ subject: expect.stringContaining('received'), whatsapp: 'sent', delivery: null }
				]);
			})
	);
});
describe('completing a visit', () => {
	it.live('the helper starts and completes their visit, stamped with when, with their notes', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			committed(yield* book(t, {}));
			const alpha = yield* signedIn(t, ALPHA);
			const [v] = yield* visits(t);
			t.clock.set('2026-09-29T02:05:00.000Z');
			committed(
				yield* alpha.act('visits.update', { target: present(v).id, set: { status: 'in_progress' } })
			);
			t.clock.set('2026-09-29T05:00:00.000Z');
			committed(
				yield* alpha.act('visits.update', {
					target: present(v).id,
					set: { status: 'done', completion_notes: 'Oven left for next time' }
				})
			);
			expect((yield* visits(t))[0]).toMatchObject({
				status: 'done',
				started_at: '2026-09-29T02:05:00.000Z',
				completed_at: '2026-09-29T05:00:00.000Z',
				completion_notes: 'Oven left for next time'
			});
		})
	);
	it.live('a helper cannot complete a visit that is not theirs', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			committed(yield* book(t, {}));
			const bravo = yield* signedIn(t, BRAVO);
			const [v] = yield* visits(t);
			expect(
				yield* Effect.flip(
					bravo.act('visits.update', { target: present(v).id, set: { status: 'in_progress' } })
				)
			).toMatchObject({
				_tag: 'ActRefused'
			});
		})
	);
});
describe('dispatch settings', () => {
	it.live('the free-change window is the configured one', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			committed(yield* book(t, {}));
			const [v] = yield* visits(t);
			const [row] = (yield* t.as(t.admin).read('dispatch_settings', { all: true })).rows;
			committed(
				yield* desk(t).act('dispatch_settings.update', {
					target: present(row).id,
					set: { free_change_hours: 2 }
				})
			);
			t.clock.set('2026-09-28T12:00:00.000Z'); // 14 h ahead: late at 24 h, free at 2 h
			committed(yield* desk(t).act('visits.cancel', { target: present(v).id }));
			expect((yield* visits(t))[0]).toMatchObject({
				status: 'cancelled',
				late_cancellation: false
			});
		})
	);
});
describe('helper alerts', () => {
	it.live('a helper is messaged on WhatsApp the visits given to them, one message per helper', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			committed(yield* book(t, { repeat: 'weekly', visits: 3 }));
			yield* settle(t);
			const toAlpha = t.fakes.links.sent
				.filter((send) => send.instance === 'whatsapp')
				.filter((s) => whatsapp(s.message).to === '6590000001@s.whatsapp.net');
			expect(toAlpha).toHaveLength(1);
			const alert = whatsapp(toAlpha[0]?.message);
			expect(alert.text).toMatch(/^New visits for you:\n• V-/);
			expect(alert.text.split('•')).toHaveLength(4);
		})
	);
});
describe('registered customers', () => {
	it.live(
		"a customer signed up by their number sees their own bookings, visits and helper, and nobody else's",
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				committed(yield* book(t, {}));
				committed(
					yield* book(t, { customer: WEST_CUSTOMER, start: Instant('2026-09-30T02:00:00.000Z') })
				);
				const me = t.as(
					t.member(['customer'], {
						external: true,
						party: { collection: 'customers', id: EAST_CUSTOMER }
					})
				);
				const mine = (yield* me.read('visits', {
					all: true,
					select: { number: true, helper: { select: { name: true } } }
				})).rows;
				expect(mine).toHaveLength(1);
				expect(mine[0]).toMatchObject({ helper: { name: 'Fixture Helper Alpha' } });
				expect((yield* me.read('bookings', { all: true })).rows.map((b) => b.customer)).toEqual([
					EAST_CUSTOMER
				]);
				expect((yield* me.read('customers', { all: true })).rows.map((c) => c.id)).toEqual([
					EAST_CUSTOMER
				]);
				expect((yield* me.read('customer_notices', { all: true })).rows).toHaveLength(1);
				// a member bound to no record yet sees nothing
				const unbound = t.as(t.member(['customer'], { external: true }));
				expect((yield* unbound.read('visits', { all: true })).rows).toEqual([]);
			})
	);
	it.live(
		'lets newcomers sign up by mobile number, as customers bound to the customer with that number',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				expect(t.manifest.workspace.signup).toEqual({
					via: ['phone'],
					policies: ['customer'],
					party: { collection: 'customers', match: { phone: 'phone' } }
				});
			})
	);
});
// These tests cross the private computation boundary: customer data must not expose another customer's schedule.
describe('destination-specific booking availability', () => {
	const phone = '+6580000001';
	const address = '1 Example Avenue, Singapore 400001';
	const quoteInput: AvailabilityInput = {
		phone,
		address,
		area: 'east',
		service: HOME_CLEANING,
		preference: 'any',
		repeat: 'once'
	};
	const customer = (t: T, number = phone) =>
		t.as(t.member(['customer'], { external: true, phone: number }));
	const quote = Effect.fnUntraced(function* (t: T, over: Partial<AvailabilityInput> = {}) {
		const filed = committed(
			yield* customer(t, String(over.phone ?? phone)).act('availability_requests.create', {
				...quoteInput,
				...over
			})
		);
		yield* settle(t);
		const id = fixtureId('availability_requests', filed.records[0]?.id);
		const result = yield* t.as(t.admin).get('availability_requests', id);
		if (result === null) throw new Error('Missing filed availability request');
		return { id, result };
	});
	const request = (
		availability: Id<'availability_requests'>,
		over: Partial<BookingInput> = {}
	): BookingInput => ({
		name: 'Fixture Customer One',
		phone,
		address,
		area: 'east',
		service: HOME_CLEANING,
		repeat: 'once',
		start: TUESDAY_10,
		availability,
		...over
	});
	// The map pin must reach matching and the saved visit without a redundant region or a second geocode.
	it.live('books the selected map destination without asking for an area', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const point = { lat: 1.3521, lng: 103.8198 };
			const newAddress = 'Map-selected fixture destination';
			const { area: _area, ...input } = quoteInput;
			const filed = committed(
				yield* customer(t).act('availability_requests.create', {
					...input,
					address: newAddress,
					location: point,
					preference: 'preferred',
					helper: BRAVO
				})
			);
			yield* settle(t);
			const q = {
				id: fixtureId('availability_requests', filed.records[0]?.id),
				result: yield* t
					.as(t.admin)
					.get('availability_requests', fixtureId('availability_requests', filed.records[0]?.id))
			};
			expect(q.result).toMatchObject({
				status: 'ready',
				area: null,
				location: point,
				starts: expect.arrayContaining([TUESDAY_10])
			});
			const { area: _bookingArea, ...bookingInput } = request(q.id, { address: newAddress });
			committed(yield* customer(t).act('booking_requests.create', bookingInput));
			yield* settle(t);
			expect((yield* visits(t))[0]).toMatchObject({
				address: newAddress,
				area: null,
				location: point,
				helper: BRAVO
			});
		})
	);
	it.live(
		'returns preference-scoped starts and books the selected cleaner instead of the nearer one',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				const q = yield* quote(t, { preference: 'preferred', helper: BRAVO });
				expect(q.result).toMatchObject({
					status: 'ready',
					starts: expect.arrayContaining([TUESDAY_10])
				});
				committed(yield* customer(t).act('booking_requests.create', request(q.id)));
				yield* settle(t);
				expect((yield* visits(t))[0]).toMatchObject({ helper: BRAVO, address });
			})
	);
	it.live('flags an incompatible preferred cleaner and creates no booking', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const deep = fixtureId('services', '0d500001-0000-4000-8000-000000000002');
			const q = yield* quote(t, { preference: 'preferred', helper: BRAVO, service: deep });
			expect(q.result).toMatchObject({
				status: 'failed',
				problem: expect.stringContaining('cannot perform')
			});
			expect(
				yield* Effect.flip(book(t, { service: deep, preference: 'preferred', helpers: [BRAVO] }))
			).toMatchObject({ _tag: 'ActRefused', message: expect.stringContaining('cannot perform') });
			expect(yield* visits(t)).toEqual([]);
			expect((yield* t.as(t.admin).read('bookings', { all: true })).rows).toEqual([]);
		})
	);
	it.live(
		'does not sell a recurring start when a later occurrence cannot be staffed; ad hoc still fits',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				committed(
					yield* t.as(t.admin).act('helper_time_off.create', {
						helper: ALPHA,
						period: { from: '2026-10-06', to: '2026-10-06' },
						reason: 'leave'
					})
				);
				const q = yield* quote(t, { preference: 'preferred', helper: ALPHA, repeat: 'weekly' });
				expect(q.result).toMatchObject({ status: 'ready' });
				expect(present(q.result).starts).not.toContain(TUESDAY_10);
				const once = yield* quote(t, { preference: 'preferred', helper: ALPHA });
				expect(present(once.result).starts).toContain(TUESDAY_10);
				expect(
					yield* Effect.flip(
						book(t, { repeat: 'weekly', visits: 2, preference: 'preferred', helpers: [ALPHA] })
					)
				).toMatchObject({ _tag: 'ActRefused', message: expect.stringContaining('occurrence 2') });
				expect(yield* visits(t)).toEqual([]);
				expect((yield* t.as(t.admin).read('bookings', { all: true })).rows).toEqual([]);
			})
	);
	it.live('rechecks capacity after a quote instead of overbooking a preferred cleaner', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const q = yield* quote(t, { preference: 'preferred', helper: ALPHA });
			expect(present(q.result).starts).toContain(TUESDAY_10);
			committed(yield* book(t, { preference: 'preferred', helpers: [ALPHA] }));
			committed(yield* customer(t).act('booking_requests.create', request(q.id)));
			yield* settle(t);
			expect((yield* t.as(t.admin).read('booking_requests', { all: true })).rows[0]).toMatchObject({
				status: 'follow_up'
			});
			expect(yield* visits(t)).toHaveLength(1);
		})
	);
	it.live('binds quotes to the verified phone and exact inputs and keeps schedules private', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const q = yield* quote(t);
			expect(present(q.result).starts).toContain(TUESDAY_10);
			const other = customer(t, '+6580000002');
			expect((yield* other.read('availability_requests', { all: true })).rows).toEqual([]);
			expect((yield* other.read('visits', { all: true, select: { location: true } })).rows).toEqual(
				[]
			);
			const publicHelpers = (yield* customer(t).read('helpers', {
				all: true,
				select: { phone: true }
			})).rows;
			expect(publicHelpers.map((h) => h.phone)).toEqual([
				{ $masked: true },
				{ $masked: true },
				{ $masked: true }
			]);
			expect(
				yield* Effect.flip(
					other.act('booking_requests.create', request(q.id, { phone: '+6580000002' }))
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				yield* Effect.flip(
					customer(t).act('booking_requests.create', request(q.id, { address: 'Another address' }))
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect((yield* t.as(t.admin).read('booking_requests', { all: true })).rows).toEqual([]);
		})
	);
	it.live('expires old quotes and exposes only travel-feasible starts in the desk union', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const q = yield* quote(t);
			expect(present(q.result).starts).toContain(TUESDAY_10);
			t.clock.advance('16min');
			expect(
				yield* Effect.flip(customer(t).act('booking_requests.create', request(q.id)))
			).toMatchObject({
				_tag: 'ActRefused',
				message: expect.stringContaining('Check times again')
			});
			committed(yield* book(t, { preference: 'preferred', helpers: [ALPHA] }));
			const starts = yield* desk(t).query('bookings.open_slots', {
				customer: WEST_CUSTOMER,
				service: HOME_CLEANING,
				preference: 'preferred',
				helpers: [ALPHA],
				repeat: 'once',
				from: PlainDate('2026-09-29'),
				days: 1
			});
			expect(present(starts[0]).starts).not.toContain('2026-09-29T05:00:00.000Z');
			expect(present(starts[0]).starts).toContain('2026-09-29T06:30:00.000Z');
		})
	);
	it.live('applies the submitted destination to a returning customer booking', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const newAddress = 'Changed fixture destination';
			const q = yield* quote(t, { address: newAddress });
			expect(q.result).toMatchObject({
				status: 'ready',
				estimated: true,
				starts: expect.arrayContaining([TUESDAY_10])
			});
			committed(
				yield* customer(t).act('booking_requests.create', request(q.id, { address: newAddress }))
			);
			yield* settle(t);
			expect((yield* visits(t))[0]).toMatchObject({ address: newAddress, location: null });
		})
	);
	it.live('uses Google travel durations when preparing customer-specific starts', () =>
		Effect.gen(function* () {
			const t = yield* workspace(google({ TRAFFIC_UNAWARE: 60, TRAFFIC_AWARE: 60 }));
			committed(yield* book(t, { preference: 'preferred', helpers: [ALPHA] }));
			const q = yield* quote(t, {
				phone: '+6580000002',
				address: '2 Sample Road, Singapore 600002',
				preference: 'preferred',
				helper: ALPHA
			});
			// 13:00 finish + Google 60 minutes + 15 buffer => first grid start 14:30.
			expect(q.result).toMatchObject({ status: 'ready' });
			expect(present(q.result).starts).not.toContain('2026-09-29T06:00:00.000Z');
			expect(present(q.result).starts).toContain('2026-09-29T06:30:00.000Z');
		})
	);
});
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
