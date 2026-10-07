/**
 * The workflows through the real engine on the public seed: booking with and without a preference, the travel buffer,
 * the shift check (ask, no answer, decline with a certificate), the ETA check, a helper leaving, and cancellation.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { testWorkspace } from '@norbital-ai/bolt/test';

type T = Awaited<ReturnType<typeof testWorkspace>>;
type Row = { readonly [field: string]: unknown };

const ALPHA = '0d500002-0000-4000-8000-000000000001'; // east, cleans and deep-cleans, Mon–Sat 08–18
const BRAVO = '0d500002-0000-4000-8000-000000000002'; // west, Mon–Fri 09–19
const CHARLIE = '0d500002-0000-4000-8000-000000000003'; // central, Tue–Sun 07–16
const EAST_CUSTOMER = '0d500003-0000-4000-8000-000000000001';
const WEST_CUSTOMER = '0d500003-0000-4000-8000-000000000002';
const HOME_CLEANING = '0d500001-0000-4000-8000-000000000001'; // 3 h
/** Tuesday 29 September 2026, 10:00 in Singapore: every seeded helper works then. */
const TUESDAY_10 = '2026-09-29T02:00:00.000Z';

/**
 * Google's Routes API, faked: every route takes `minutes[routingPreference]` minutes. `calls` records what was asked.
 * Without it the connection has no key, so every drive stays the straight-line estimate.
 */
function google(minutes: { readonly [preference: string]: number }) {
	const calls: {
		path: string;
		query?: Row;
		body: { destinations: unknown[]; routingPreference: string };
	}[] = [];
	const port = {
		async request(connection: string, r: (typeof calls)[number]) {
			expect(connection).toBe('google_routes');
			calls.push(r);
			return {
				status: 200,
				body: r.body.destinations.map((_, i) => ({
					// Google leaves a zero index out
					...(i === 0 ? {} : { destinationIndex: i }),
					duration: `${minutes[r.body.routingPreference]! * 60}s`,
					condition: 'ROUTE_EXISTS'
				}))
			};
		}
	};
	return { calls, port };
}
const workspace = (http?: ReturnType<typeof google>) =>
	testWorkspace({
		root: `${process.cwd()}/`,
		seed: 'base',
		now: '2026-09-25T02:00:00.000Z',
		...(http === undefined ? {} : { http: http.port as never })
	});
const desk = (t: T) => t.as(t.member(['operations']));
/** Every run a run queues, down the chain (a request → a booking → notices → their delivery). */
const settle = async (t: T) => {
	for (let i = 0; i < 4; i++) await t.runDue();
};

function committed(o: unknown): { output: Row; records: { collection: string; id: string }[] } {
	const x = o as { kind: string };
	if (x.kind !== 'committed') throw new Error(JSON.stringify(o));
	return o as never;
}
const visits = async (t: T) =>
	(await t.as(t.admin).read('visits', { all: true, orderBy: { number: 'asc' } })).rows;
const book = async (t: T, input: Row) =>
	desk(t).act('bookings.book', {
		customer: EAST_CUSTOMER,
		service: HOME_CLEANING,
		preference: 'any',
		start: TUESDAY_10,
		repeat: 'once',
		...input
	} as never);
/** A helper signed in as a member of the Helpers team. */
async function signedIn(t: T, helper: string) {
	const member = t.member(['helper']);
	committed(
		await t.as(t.admin).act('helpers.update', { target: helper, set: { user: member.id } })
	);
	return t.as(member);
}

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
	it('without a preference, matches the nearest helper and keeps them for a recurring customer', async () => {
		const t = await workspace();
		const { output } = committed(await book(t, { repeat: 'weekly', visits: 3 }));
		expect(output).toMatchObject({ assigned: 3, unassigned: 0 });
		expect((await visits(t)).map((v) => v['helper'])).toEqual([ALPHA, ALPHA, ALPHA]);
	});

	it('with a preference, books the first preferred helper free, and refuses when none of them is', async () => {
		const t = await workspace();
		committed(await book(t, { preference: 'preferred', helpers: [BRAVO, ALPHA] }));
		expect((await visits(t))[0]!['helper']).toBe(BRAVO);
		// Sunday: Bravo and Alpha are both off
		expect(
			await book(t, {
				preference: 'preferred',
				helpers: [BRAVO, ALPHA],
				start: '2026-09-27T02:00:00.000Z'
			})
		).toMatchObject({
			kind: 'refused',
			message: expect.stringContaining('No eligible helper')
		});
	});

	it('keeps the drive between visits free, and lays the preferred helper’s open times out', async () => {
		const t = await workspace();
		committed(await book(t, {})); // Alpha, 10:00–13:00 in the east
		// 13:15 in the west is too soon for Alpha: the drive is longer than the gap
		committed(await book(t, { customer: WEST_CUSTOMER, start: '2026-09-29T05:15:00.000Z' }));
		const [, second] = await visits(t);
		expect(second!['helper']).not.toBe(ALPHA);
		const [alpha] = (await desk(t).query('helpers.open_slots', {
			helpers: [ALPHA],
			customer: WEST_CUSTOMER,
			service: HOME_CLEANING,
			from: '2026-09-29',
			days: 1
		})) as { days: { starts: string[] }[] }[];
		expect(alpha!.days[0]!.starts).not.toContain('2026-09-29T05:00:00.000Z');
		expect(alpha!.days[0]!.starts).toContain('2026-09-29T06:30:00.000Z');
	});

	it('refuses a helper without the skill, whoever names them', async () => {
		const t = await workspace();
		committed(await book(t, { service: '0d500001-0000-4000-8000-000000000003' })); // move-in: only Bravo
		const [v] = await visits(t);
		expect(v!['helper']).toBe(BRAVO);
		expect(
			await desk(t).act('visits.reassign', { target: v!['id'], input: { helper: ALPHA } } as never)
		).toMatchObject({
			kind: 'refused',
			message: 'Fixture Helper Alpha does not have the skill this service needs.'
		});
	});
});

describe('jobs: one-off and recurring', () => {
	const HOURS_3 = 3 * 3_600_000;
	const startOf = (v: Row) => Date.parse((v['slot'] as { start: { $t: string } }).start.$t);
	const endOf = (v: Row) => Date.parse((v['slot'] as { end: { $t: string } }).end.$t);
	/** The local wall time of an instant in Singapore. */
	const wall = (ms: number) =>
		new Date(ms).toLocaleString('en-GB', {
			timeZone: 'Asia/Singapore',
			weekday: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});

	it('a one-off job is one visit for the service length, matched, its cleaner told, then done', async () => {
		const t = await workspace();
		const alpha = await signedIn(t, ALPHA);
		const { output } = committed(await book(t, {}));
		expect(output).toMatchObject({ assigned: 1, unassigned: 0 });
		const all = await visits(t);
		expect(all).toHaveLength(1);
		const [v] = all;
		expect(v).toMatchObject({ helper: ALPHA, status: 'scheduled', attention: 'none' });
		expect(startOf(v!)).toBe(Date.parse(TUESDAY_10));
		expect(endOf(v!) - startOf(v!)).toBe(HOURS_3);
		const booking = (await t.as(t.admin).read('bookings', { all: true })).rows[0]!;
		expect(booking).toMatchObject({ repeat: 'once', status: 'active' });
		await settle(t);
		// the cleaner hears about it on WhatsApp, and it is on their own list
		expect(
			t.fakes.transports.whatsapp.sent.some(
				(s) => (s.message as { to: string }).to === '6590000001@s.whatsapp.net'
			)
		).toBe(true);
		expect((await alpha.read('visits', { all: true })).rows).toHaveLength(1);
		t.clock.set('2026-09-29T02:00:00.000Z');
		committed(
			await alpha.act('visits.update', { target: v!['id'], set: { status: 'in_progress' } })
		);
		t.clock.set('2026-09-29T05:00:00.000Z');
		committed(await alpha.act('visits.update', { target: v!['id'], set: { status: 'done' } }));
		expect((await visits(t))[0]).toMatchObject({ status: 'done' });
	});

	it('a weekly job is eight visits at the same local time a week apart, kept with one cleaner', async () => {
		const t = await workspace();
		const { output } = committed(await book(t, { repeat: 'weekly' }));
		expect(output).toMatchObject({ assigned: 8, unassigned: 0 });
		const all = await visits(t);
		expect(all).toHaveLength(8);
		const starts = all.map(startOf);
		for (let i = 1; i < starts.length; i++)
			expect(starts[i]! - starts[i - 1]!).toBe(7 * 86_400_000);
		expect(new Set(starts.map(wall))).toEqual(new Set(['Tue 10:00']));
		// continuity: the same cleaner every week while they are free
		expect(new Set(all.map((v) => v['helper']))).toEqual(new Set([ALPHA]));
		expect(all.every((v) => endOf(v) - startOf(v) === HOURS_3)).toBe(true);
	});

	it('fortnightly and monthly jobs repeat at their own spacing, the same wall time', async () => {
		const t = await workspace();
		committed(await book(t, { repeat: 'fortnightly', visits: 3 }));
		const fortnightly = (await visits(t)).map(startOf);
		expect(fortnightly.map((s, i) => (i === 0 ? 0 : s - fortnightly[i - 1]!))).toEqual([
			0,
			14 * 86_400_000,
			14 * 86_400_000
		]);
		const m = await workspace();
		committed(await book(m, { repeat: 'monthly', visits: 3 }));
		const monthly = (await visits(m)).map((v) =>
			new Date(startOf(v)).toLocaleString('en-GB', {
				timeZone: 'Asia/Singapore',
				day: '2-digit',
				month: '2-digit',
				hour: '2-digit',
				minute: '2-digit'
			})
		);
		expect(monthly).toEqual(['29/09, 10:00', '29/10, 10:00', '29/11, 10:00']);
	});

	it('a recurring job keeps its cleaner but covers a week they are off with someone else', async () => {
		const t = await workspace();
		committed(
			await t.as(t.admin).act('helper_time_off.create', {
				helper: ALPHA,
				period: { from: '2026-10-13', to: '2026-10-13' },
				reason: 'leave'
			})
		);
		committed(await book(t, { repeat: 'weekly', visits: 4 }));
		const helpers = (await visits(t)).map((v) => v['helper']);
		expect(helpers[0]).toBe(ALPHA);
		expect(helpers[2]).not.toBe(ALPHA); // 13 October, Alpha's leave
		expect([helpers[1], helpers[3]]).toEqual([ALPHA, ALPHA]);
	});

	it('a recurring job nobody can staff in full is not booked at all; no partial series', async () => {
		const t = await workspace();
		committed(
			await t.as(t.admin).act('helper_time_off.create', {
				helper: ALPHA,
				period: { from: '2026-10-06', to: '2026-10-06' },
				reason: 'leave'
			})
		);
		expect(
			await book(t, { repeat: 'weekly', visits: 3, preference: 'preferred', helpers: [ALPHA] })
		).toMatchObject({ kind: 'refused' });
		expect(await visits(t)).toEqual([]);
		expect((await t.as(t.admin).read('bookings', { all: true })).rows).toEqual([]);
	});

	it('cancelling one occurrence leaves the series; cancelling the booking ends the visits still to come', async () => {
		const t = await workspace();
		const { output } = committed(await book(t, { repeat: 'weekly', visits: 4 }));
		const [first] = await visits(t);
		committed(await desk(t).act('visits.cancel', { target: first!['id'] } as never));
		expect((await visits(t)).map((v) => v['status'])).toEqual([
			'cancelled',
			'scheduled',
			'scheduled',
			'scheduled'
		]);
		committed(await desk(t).act('bookings.cancel', { target: output['booking'] } as never));
		expect((await visits(t)).every((v) => v['status'] === 'cancelled')).toBe(true);
		expect((await t.as(t.admin).read('bookings', { all: true })).rows[0]).toMatchObject({
			status: 'cancelled'
		});
	});
});

describe('the shift check', () => {
	it('asks two hours ahead; silence proposes a replacement, and only controller approval assigns them', async () => {
		const t = await workspace();
		committed(await book(t, { preference: 'preferred', helpers: [ALPHA, CHARLIE] }));
		t.clock.set('2026-09-29T00:05:00.000Z'); // 08:05, under two hours ahead
		await t.runDue();
		expect((await visits(t))[0]).toMatchObject({ shift_check: 'asked', helper: ALPHA });
		t.clock.set('2026-09-29T01:30:00.000Z'); // over an hour later, no answer (cron slots are bucketed, so well past it)
		await t.runDue();
		await t.runDue(); // the warning's letter
		const [v] = await visits(t);
		// the new helper's shift is checked afresh (the ETA watch may already flag them in the same wake)
		expect(v).toMatchObject({
			shift_check: 'no_response',
			helper: null,
			proposed_helper: CHARLIE,
			attention: 'awaiting_approval',
			unavailable_helper: ALPHA
		});
		expect((await t.as(t.admin).read('customer_notices', { all: true })).rows).toHaveLength(1);
		committed(await desk(t).act('visits.accept_proposal', { target: v!['id'] } as never));
		await settle(t);
		expect((await visits(t))[0]).toMatchObject({
			helper: CHARLIE,
			shift_check: 'not_due',
			proposed_helper: null,
			attention: 'none'
		});
		const admin = t.as(t.admin);
		const warnings = (await admin.read('helper_warnings', { all: true })).rows;
		expect(warnings).toMatchObject([{ helper: ALPHA, reason: 'no_response' }]);
		// the kit converts no documents: the letter run ends cleanly and the warning stands without one
		const [letterRun] = (
			await t.db.read([
				{ text: `SELECT state FROM sys_run WHERE automation = 'warning_letter'`, params: [] }
			])
		)[0]!.rows;
		expect(letterRun).toEqual({ state: 'succeeded' });
		// the booking's confirmation, then who comes instead (the customer asked for particular helpers)
		const notices = (
			await admin.read('customer_notices', { all: true, orderBy: { created_at: 'asc' } })
		).rows;
		expect(notices.map((n) => n['subject'])).toEqual([
			expect.stringContaining('Booking confirmed'),
			expect.stringContaining('A new helper')
		]);
		// each went to the customer's WhatsApp number (they gave no email beyond the seed's, which also gets it)
		const toCustomer = t.fakes.transports.whatsapp.sent.filter(
			(s) => (s.message as { to: string }).to === '6580000001@s.whatsapp.net'
		);
		expect(toCustomer).toHaveLength(2);
		const deliveryRuns = await t.db.read([
			{
				text: `SELECT automation, state, error FROM sys_run
				       WHERE automation IN ('deliver_notices', 'customer_mail') ORDER BY due_at, id`,
				params: []
			}
		]);
		expect(
			notices.map((n) => n['whatsapp']),
			JSON.stringify(deliveryRuns)
		).toEqual(['sent', 'sent']);
		// and, since the seeded customer gave an address, by mail through the customer_mail channel, tracked on the notice
		const mails = t.fakes.transports.email.sent;
		expect(mails).toHaveLength(2);
		expect(
			notices.every(
				(n) => n['delivery'] === 'sent' && n['to_address'] !== null && n['sent_at'] !== null
			)
		).toBe(true);

		// what the mailbox reports lands on the notice: presumed delivery, an approximate open, an auto-reply kept apart, a reply
		const [first] = notices;
		const report = (kind: 'delivered' | 'opened', more: Row = {}) =>
			t.fakes.transports.email.emit({
				kind: 'delivery',
				channel: 'customer_mail',
				providerId: mails[0]!.providerId,
				report: { kind, at: '2026-09-29T02:00:00.000Z', provider: 'fake', ...more }
			});
		await report('delivered', { presumed: true });
		await report('opened', { approximate: true });
		const reply = (id: string, text: string, headers: Row = {}) =>
			t.fakes.transports.email.emit({
				kind: 'inbound',
				channel: 'customer_mail',
				message: {
					id,
					thread: String(first!['id']),
					sentAt: '2026-09-29T03:00:00.000Z',
					from: { address: String(first!['to_address']), name: null },
					replyTo: null,
					to: [],
					cc: [],
					subject: 'Re: booking',
					text,
					html: null,
					headers: { 'in-reply-to': mails[0]!.providerId, ...headers },
					attachments: []
				} as never
			});
		await reply('<auto@x.example>', 'I am away.', { 'auto-submitted': 'auto-replied' });
		expect(await admin.get('customer_notices', String(first!['id']))).toMatchObject({
			delivery: 'opened',
			delivery_presumed: true
		});
		await reply('<r1@x.example>', 'Thanks, see you then.');
		const after = (await admin.get('customer_notices', String(first!['id'])))!;
		expect(after).toMatchObject({ delivery: 'replied', reply_excerpt: 'Thanks, see you then.' });
		expect(after['auto_replied_at']).not.toBeNull();
		expect(after['opened_at']).not.toBeNull();
	});

	it('a medical decline blocks the cleaner for the day and waits for controller approval without a warning', async () => {
		const t = await workspace();
		committed(await book(t, {}));
		const alpha = await signedIn(t, ALPHA);
		const [v] = await visits(t);
		committed(await alpha.act('visits.decline_shift', { target: v!['id'], input: { mc: true } }));
		await t.runDue();
		const [after] = await visits(t);
		expect(after).toMatchObject({
			helper: null,
			unavailable_helper: ALPHA,
			attention: 'awaiting_approval'
		});
		expect(after!['proposed_helper']).not.toBeNull();
		expect((await t.as(t.admin).read('helper_time_off', { all: true })).rows).toMatchObject([
			{ helper: ALPHA, reason: 'medical' }
		]);
		const replacement = await signedIn(t, String(after!['proposed_helper']));
		expect((await replacement.read('visits', { all: true })).rows).toEqual([]);
		committed(await desk(t).act('visits.accept_proposal', { target: after!['id'] } as never));
		await settle(t);
		expect((await replacement.read('visits', { all: true })).rows).toHaveLength(1);
		const admin = t.as(t.admin);
		expect((await admin.read('helper_warnings', { all: true })).rows).toEqual([]);
		// Customer receives the confirmed replacement, never an unapproved recommendation.
		expect(
			(await admin.read('customer_notices', { all: true })).rows.map((n) => n['subject'])
		).toEqual(
			expect.arrayContaining([
				expect.stringContaining('Booking confirmed'),
				expect.stringContaining('A new helper')
			])
		);
	});

	it('two cleaners dropping out of overlapping visits the same morning both get recommendations', async () => {
		const t = await workspace();
		committed(await book(t, {}));
		committed(await book(t, { customer: WEST_CUSTOMER }));
		const [first, second] = await visits(t);
		expect(first!['helper']).not.toBe(second!['helper']);
		const a = await signedIn(t, String(first!['helper']));
		const b = await signedIn(t, String(second!['helper']));
		committed(await a.act('visits.decline_shift', { target: first!['id'], input: { mc: true } }));
		committed(await b.act('visits.decline_shift', { target: second!['id'], input: { mc: true } }));
		await t.runDue();
		// both now unassigned at the same time: neither refusal blocks the other's recovery
		for (const v of await visits(t))
			expect(v).toMatchObject({
				helper: null,
				attention: expect.stringMatching(/awaiting_approval|unassigned/)
			});
		// and the one cleaner left is proposed for one of them, not both
		const proposed = (await visits(t)).map((v) => v['proposed_helper']).filter((h) => h !== null);
		expect(new Set(proposed).size).toBe(proposed.length);
	});

	it('lets the controller report unavailability and prepare recommendations for the day', async () => {
		const t = await workspace();
		committed(await book(t, {}));
		const [v] = await visits(t);
		committed(
			await desk(t).act('visits.report_unavailable', {
				target: v!['id'],
				input: { mc: true }
			} as never)
		);
		await settle(t);
		expect((await visits(t))[0]).toMatchObject({
			helper: null,
			unavailable_helper: ALPHA,
			attention: 'awaiting_approval'
		});
	});

	it('rejects stale approval, refreshes the recommendation, and never assigns an unavailable cleaner', async () => {
		const t = await workspace();
		committed(await book(t, {}));
		const alpha = await signedIn(t, ALPHA);
		const [v] = await visits(t);
		committed(await alpha.act('visits.decline_shift', { target: v!['id'], input: { mc: true } }));
		await settle(t);
		const [pending] = await visits(t);
		const proposed = String(pending!['proposed_helper']);
		committed(
			await desk(t).act('helper_time_off.create', {
				helper: proposed,
				period: { from: '2026-09-29', to: '2026-09-29' },
				reason: 'leave'
			} as never)
		);
		expect(
			await desk(t).act('visits.accept_proposal', { target: v!['id'] } as never)
		).toMatchObject({ kind: 'refused' });
		expect((await visits(t))[0]).toMatchObject({ helper: null, attention: 'awaiting_approval' });
		committed(await desk(t).act('visits.recommend', { target: v!['id'] } as never));
		const [refreshed] = await visits(t);
		expect(refreshed!['proposed_helper']).not.toBe(proposed);
		expect(refreshed!['proposed_helper']).not.toBe(ALPHA);
		// Repeated deadline wakes must not issue duplicate absence warnings or leave records.
		await settle(t);
		expect((await t.as(t.admin).read('helper_time_off', { all: true })).rows).toHaveLength(2);
	});

	it('offers recovery starts and rebooks one recurring occurrence inside the cutoff, then notifies its assigned cleaner', async () => {
		const t = await workspace();
		committed(await book(t, { repeat: 'weekly', visits: 2 }));
		const alpha = await signedIn(t, ALPHA);
		const [first, second] = await visits(t);
		t.clock.set('2026-09-29T01:30:00.000Z');
		committed(
			await alpha.act('visits.decline_shift', { target: first!['id'], input: { mc: true } })
		);
		await settle(t);
		const slots = (await desk(t).query('visits.rebooking_slots', {
			visit: first!['id'],
			from: '2026-09-30',
			days: 2
		})) as { day: string; starts: string[] }[];
		expect(slots[0]!.starts.length).toBeGreaterThan(0);
		const start = slots[0]!.starts[0]!;
		const candidates = (await desk(t).query('visits.candidates', {
			visit: first!['id'],
			start
		})) as { helper: string }[];
		expect(candidates.some((c) => c.helper === ALPHA)).toBe(false);
		const replacement = await signedIn(t, candidates[0]!.helper);
		committed(
			await desk(t).act('visits.rebook', {
				target: first!['id'],
				input: { start, helper: candidates[0]!.helper }
			} as never)
		);
		await settle(t);
		const [a, b] = await visits(t);
		expect(a).toMatchObject({
			helper: candidates[0]!.helper,
			attention: 'none',
			proposed_helper: null
		});
		expect((a!['slot'] as { start: unknown }).start).toEqual({ $t: start });
		expect(b).toEqual(second);
		expect((await replacement.read('visits', { all: true })).rows).toHaveLength(1);
		const [{ rows: notices }] = await t.db.read([
			{
				text: "SELECT title, body FROM sys_notification WHERE title = 'Your route has a new assignment'",
				params: []
			}
		]);
		expect(
			notices.some(
				(n) =>
					String(n['body']).includes(String(first!['number'])) &&
					String(n['body']).includes('Open My Day')
			)
		).toBe(true);
		expect(
			t.fakes.transports.whatsapp.sent.some((s) =>
				(s.message as { text?: string }).text?.includes('New visit')
			)
		).toBe(true);
	});

	it('does not let ordinary customer rebooking bypass the cutoff or let cleaners approve replacements', async () => {
		const t = await workspace();
		committed(await book(t, {}));
		const [v] = await visits(t);
		const alpha = await signedIn(t, ALPHA);
		t.clock.set('2026-09-29T01:30:00.000Z');
		expect(
			await desk(t).act('visits.rebook', {
				target: v!['id'],
				input: { start: '2026-09-30T02:00:00.000Z' }
			} as never)
		).toMatchObject({ kind: 'refused' });
		expect(await alpha.act('visits.accept_proposal', { target: v!['id'] } as never)).toMatchObject({
			kind: 'refused'
		});
	});
	it('a confirmed helper is not chased', async () => {
		const t = await workspace();
		committed(await book(t, {}));
		const alpha = await signedIn(t, ALPHA);
		const [v] = await visits(t);
		committed(await alpha.act('visits.confirm_shift', { target: v!['id'] }));
		t.clock.set('2026-09-29T01:30:00.000Z');
		await t.runDue();
		expect((await visits(t))[0]).toMatchObject({ helper: ALPHA, shift_check: 'confirmed' });
	});
});

describe('the ETA check', () => {
	it('flags a visit whose helper is more than 30 minutes away, and one whose helper sent no position', async () => {
		const t = await workspace();
		committed(await book(t, {}));
		committed(await book(t, { customer: WEST_CUSTOMER, start: '2026-09-29T03:00:00.000Z' }));
		const alpha = await signedIn(t, ALPHA);
		t.clock.set('2026-09-29T01:20:00.000Z');
		// Alpha reports from the far west; the other helper reports nothing
		committed(
			await alpha.act('helpers.update', {
				target: ALPHA,
				set: { last_location: { lat: 1.3404, lng: 103.65 } }
			})
		);
		t.clock.set('2026-09-29T01:25:00.000Z');
		await t.runDue();
		const [first, second] = await visits(t);
		expect(first).toMatchObject({ attention: 'eta_risk' });
		expect(first!['eta_minutes']).toBeGreaterThan(30);
		expect(second).toMatchObject({ attention: 'none', eta_minutes: null });
		t.clock.set('2026-09-29T02:05:00.000Z');
		await t.runDue();
		expect((await visits(t))[1]).toMatchObject({ attention: 'eta_risk', eta_minutes: null });
	});
	it('keeps re-checking until the visit starts: a helper who gets close clears the flag', async () => {
		const t = await workspace();
		committed(await book(t, {})); // Customer One, east, 10:00 Singapore
		const alpha = await signedIn(t, ALPHA);
		const report = async (at: string, lat: number, lng: number) => {
			t.clock.set(at);
			committed(
				await alpha.act('helpers.update', { target: ALPHA, set: { last_location: { lat, lng } } })
			);
			await t.runDue();
		};
		await report('2026-09-29T01:20:00.000Z', 1.3404, 103.65); // far west
		expect((await visits(t))[0]).toMatchObject({ attention: 'eta_risk' });
		await report('2026-09-29T01:40:00.000Z', 1.324, 103.927); // around the corner
		const [v] = await visits(t);
		expect(v).toMatchObject({ attention: 'none' });
		expect(v!['eta_minutes']).toBeLessThan(5);
	});
});

describe('drive times and double booking', () => {
	/** Customer One (east) to Customer Two (west), each rounded to its ~1 km square. */
	const EAST_TO_WEST = '1.32,103.93>1.33,103.74';

	it('times every planned leg with Google, caches it, and moves a visit its helper can no longer reach', async () => {
		const maps = google({ TRAFFIC_UNAWARE: 90 });
		const t = await workspace(maps);
		// Alpha, 10:00–13:00 in the east, asked for by name so the optimiser leaves it (the fake times every leg at 90)
		committed(await book(t, { preference: 'preferred', helpers: [ALPHA] }));
		// 14:15 in the west: the straight-line estimate (~50 min + 15 to settle) lets Alpha, whom the customer asked for, go
		committed(
			await book(t, {
				customer: WEST_CUSTOMER,
				preference: 'preferred',
				helpers: [ALPHA],
				start: '2026-09-29T06:15:00.000Z'
			})
		);
		expect((await visits(t)).map((v) => v['helper'])).toEqual([ALPHA, ALPHA]);
		await settle(t);
		// Google says 90 minutes: Alpha cannot make it, so the west visit goes to the best other helper
		const [first, second] = await visits(t);
		expect(first!['helper']).toBe(ALPHA);
		expect(second).toMatchObject({ helper: BRAVO, attention: 'none' });
		const cached = (await t.as(t.admin).read('drive_times', { all: true })).rows;
		expect(cached).toContainEqual(expect.objectContaining({ leg: EAST_TO_WEST, minutes: 90 }));
		expect(maps.calls[0]).toMatchObject({
			path: 'distanceMatrix/v2:computeRouteMatrix',
			query: { fields: 'originIndex,destinationIndex,duration,condition' },
			body: { routingPreference: 'TRAFFIC_UNAWARE' }
		});
		// a timed leg is not asked for again
		const asked = maps.calls.length;
		t.clock.advance('15min');
		await settle(t);
		expect(maps.calls.length).toBe(asked);
		// the customer who asked for Alpha is told who comes instead
		const notices = (await t.as(t.admin).read('customer_notices', { all: true })).rows;
		expect(notices.map((n) => n['subject'])).toContainEqual(
			expect.stringContaining('A new helper for your visit')
		);
	});

	it('optimises on its own: a cleaner back from cancelled leave takes the visit nearest her', async () => {
		const t = await workspace();
		const admin = t.as(t.admin);
		const leave = committed(
			await admin.act('helper_time_off.create', {
				helper: ALPHA,
				period: { from: '2026-09-29', to: '2026-09-29' },
				reason: 'other'
			})
		);
		committed(await book(t, {})); // east, Tuesday 10:00: Alpha is off, so someone farther takes it
		await settle(t);
		expect((await visits(t))[0]!['helper']).not.toBe(ALPHA);
		committed(await admin.act('helper_time_off.delete', { target: leave.records[0]!.id }));
		// no button: the next scheduled run rebalances
		t.clock.advance('15min');
		await settle(t);
		expect((await visits(t))[0]!['helper']).toBe(ALPHA);
	});

	it('matches with the cached time: a shorter real drive opens an earlier start', async () => {
		const t = await workspace();
		committed(await book(t, {})); // Alpha, 10:00–13:00 in the east
		const openings = async () =>
			(
				(await desk(t).query('helpers.open_slots', {
					helpers: [ALPHA],
					customer: WEST_CUSTOMER,
					service: HOME_CLEANING,
					from: '2026-09-29',
					days: 1
				})) as { days: { starts: string[] }[] }[]
			)[0]!.days[0]!.starts;
		// estimated: 13:00 + ~50 min + 15 → 14:30 is the first start
		expect(await openings()).not.toContain('2026-09-29T06:00:00.000Z');
		committed(
			await t.as(t.admin).act('drive_times.create', { leg: EAST_TO_WEST, minutes: 20 } as never)
		);
		// timed at 20 minutes: 13:00 + 20 + 15 → 14:00 opens, 13:30 still does not
		const timed = await openings();
		expect(timed).toContain('2026-09-29T06:00:00.000Z');
		expect(timed).not.toContain('2026-09-29T05:30:00.000Z');
	});

	it('never lets one helper hold two overlapping visits, and moves one written too close by hand', async () => {
		const t = await workspace();
		committed(await book(t, {})); // Alpha, 10:00–13:00 in the east
		const [booked] = await visits(t);
		const direct = (start: string) =>
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
							slot: { start, end: new Date(Date.parse(start) + 3 * 3_600_000).toISOString() },
							address: 'By hand',
							location: booked!['location'],
							area: 'east',
							skill: 'home_cleaning',
							helper: ALPHA,
							attention: 'none'
						}
					]
				}
			} as never);
		// an overlap is refused by the database, whoever writes it
		expect(await direct('2026-09-29T03:00:00.000Z')).toMatchObject({ kind: 'refused' });
		// 13:05, next door: no overlap, but no time to settle in — the drive check hands it to another helper
		committed(await direct('2026-09-29T05:05:00.000Z'));
		await settle(t);
		const [, second] = await visits(t);
		expect(second!['helper']).not.toBe(ALPHA);
		expect(second!['helper']).not.toBeNull();
		// and a drag onto Alpha is refused with the reason
		expect(
			await desk(t).act('visits.update', { target: second!['id'], set: { helper: ALPHA } } as never)
		).toMatchObject({ kind: 'refused', message: expect.stringContaining('too close') });
	});

	it('the ETA check asks Google in live traffic when the helper is not plainly close', async () => {
		const maps = google({ TRAFFIC_UNAWARE: 20, TRAFFIC_AWARE: 50 });
		const t = await workspace(maps);
		committed(await book(t, {}));
		const alpha = await signedIn(t, ALPHA);
		t.clock.set('2026-09-29T01:20:00.000Z');
		// central: ~26 minutes by straight line, under the 30-minute limit; Google in traffic says 50
		committed(
			await alpha.act('helpers.update', {
				target: ALPHA,
				set: { last_location: { lat: 1.3048, lng: 103.8318 } }
			})
		);
		t.clock.set('2026-09-29T01:25:00.000Z');
		await t.runDue();
		expect((await visits(t))[0]).toMatchObject({ attention: 'eta_risk', eta_minutes: 50 });
		expect(maps.calls.at(-1)).toMatchObject({ body: { routingPreference: 'TRAFFIC_AWARE' } });
	});
});

describe('the helper app', () => {
	it("a signed-in helper finds their own record by their account, and nobody else's", async () => {
		const t = await workspace();
		const alpha = await signedIn(t, ALPHA);
		const me = alpha.authority.actor as { id: string };
		const found = (await alpha.read('helpers', { where: { user: { eq: me.id } }, limit: 5 })).rows;
		expect(found.map((h) => h['id'])).toEqual([ALPHA]);
		expect((await alpha.read('helpers', { all: true })).rows).toHaveLength(1);
	});
});

describe('changes', () => {
	it('a helper leaving gets each later visit a proposal from the closest skillset, which the desk accepts', async () => {
		const t = await workspace();
		committed(await book(t, { service: '0d500001-0000-4000-8000-000000000002' })); // deep cleaning: Alpha or Charlie
		const [v] = await visits(t);
		expect(v!['helper']).toBe(ALPHA);
		const { output } = committed(
			await desk(t).act('helpers.offboard', {
				target: ALPHA,
				input: { last_day: '2026-09-28' }
			} as never)
		);
		expect(output).toEqual({ proposed: 1, open: 0 });
		const [proposed] = await visits(t);
		expect(proposed).toMatchObject({
			helper: null,
			proposed_helper: CHARLIE,
			attention: 'helper_left'
		});
		committed(await desk(t).act('visits.accept_proposal', { target: v!['id'] } as never));
		expect((await visits(t))[0]).toMatchObject({
			helper: CHARLIE,
			proposed_helper: null,
			attention: 'none'
		});
	});

	it('a cancellation inside a day is late; a move inside a day is refused', async () => {
		const t = await workspace();
		committed(await book(t, { repeat: 'weekly', visits: 2 }));
		const [first, second] = await visits(t);
		t.clock.set('2026-09-28T12:00:00.000Z');
		expect(
			await desk(t).act('visits.reschedule', {
				target: first!['id'],
				input: { start: '2026-09-30T02:00:00.000Z' }
			} as never)
		).toMatchObject({ kind: 'refused' });
		committed(await desk(t).act('visits.cancel', { target: first!['id'] } as never));
		committed(
			await desk(t).act('visits.reschedule', {
				target: second!['id'],
				input: { start: '2026-10-07T03:00:00.000Z' }
			} as never)
		);
		const [a, b] = await visits(t);
		expect(a).toMatchObject({ status: 'cancelled', late_cancellation: true });
		expect(b).toMatchObject({ status: 'scheduled', helper: ALPHA });
	});
});

describe('the customer portal', () => {
	const request = {
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

	it('a visitor sees the services and their open times, and nothing else — not even a way to book', async () => {
		const t = await workspace();
		await t.as(t.admin).start('publish_openings');
		await settle(t);
		const visitor = t.visitor('portal');
		expect((await visitor.read('services', { all: true })).rows).toHaveLength(4);
		const open = (await visitor.read('openings', { all: true })).rows;
		expect(open.length).toBeGreaterThan(0);
		await expect(visitor.read('helpers', { all: true })).rejects.toThrow();
		expect(await visitor.act('booking_requests.create', request as never)).toMatchObject({
			kind: 'refused'
		});
	});

	it('the open times are when a helper with the skill is free, and a booked time closes', async () => {
		const t = await workspace();
		await t.as(t.admin).start('publish_openings');
		await settle(t);
		const admin = t.as(t.admin);
		const tuesday = async () =>
			(
				await admin.read('openings', {
					where: { service: { eq: HOME_CLEANING }, day: { eq: '2026-09-29' } },
					all: true
				})
			).rows[0]!['starts'] as string[];
		expect(await tuesday()).toContain(TUESDAY_10);
		// book 10:00 until no helper who cleans is left free then
		while ((await book(t, {})).kind === 'committed');
		await settle(t);
		expect(await tuesday()).not.toContain(TUESDAY_10);
	});

	it('a verified customer books under their own number: filed by phone, booked, told on WhatsApp, and sees it', async () => {
		const t = await workspace();
		const me = customer(t);
		const filed = committed(await me.act('booking_requests.create', request as never));
		await settle(t);
		const admin = t.as(t.admin);
		const [r] = (await admin.read('booking_requests', { all: true })).rows;
		expect(r).toMatchObject({ status: 'booked' });
		expect((await me.read('booking_requests', { all: true })).rows).toMatchObject([
			{ id: filed.records[0]!.id, status: 'booked' }
		]);
		const customers = (
			await admin.read('customers', { where: { phone: { eq: request.phone } }, all: true })
		).rows;
		expect(customers).toHaveLength(1);
		expect((await visits(t))[0]).toMatchObject({ helper: ALPHA });
		expect((await admin.read('customer_notices', { all: true })).rows).toMatchObject([
			{
				subject: expect.stringContaining('Booking confirmed'),
				whatsapp: 'sent',
				to_address: null,
				delivery: null
			}
		]);
		expect(t.fakes.transports.whatsapp.sent.map((s) => (s.message as { to: string }).to)).toContain(
			'6581234567@s.whatsapp.net'
		);
		expect(t.fakes.transports.email.sent).toEqual([]);
	});

	it('a customer cannot book under, or read, another number', async () => {
		const t = await workspace();
		const me = customer(t);
		expect(
			await me.act('booking_requests.create', { ...request, phone: '+6580000001' } as never)
		).toMatchObject({ kind: 'refused' });
		committed(
			await customer(t, '+6580000001').act('booking_requests.create', {
				...request,
				phone: '+6580000001'
			} as never)
		);
		expect((await me.read('booking_requests', { all: true })).rows).toEqual([]);
	});

	it('a returning customer is recognised by their number, not filed twice', async () => {
		const t = await workspace();
		committed(
			await customer(t, '+6580000001').act('booking_requests.create', {
				...request,
				name: 'Someone Else',
				phone: '+6580000001'
			} as never)
		);
		await settle(t);
		const admin = t.as(t.admin);
		expect((await admin.read('customers', { all: true })).rows).toHaveLength(2);
		expect((await admin.read('bookings', { all: true })).rows[0]).toMatchObject({
			customer: EAST_CUSTOMER
		});
	});

	it('a request nobody is free for goes to the desk, and the customer is told a time will follow', async () => {
		const t = await workspace();
		// Sunday 06:00: nobody works then
		committed(
			await customer(t).act('booking_requests.create', {
				...request,
				start: '2026-09-26T22:00:00.000Z'
			} as never)
		);
		await settle(t);
		const admin = t.as(t.admin);
		expect((await admin.read('booking_requests', { all: true })).rows[0]).toMatchObject({
			status: 'follow_up'
		});
		expect(await visits(t)).toEqual([]);
		expect((await admin.read('customer_notices', { all: true })).rows).toMatchObject([
			{ subject: expect.stringContaining('received'), whatsapp: 'sent', delivery: null }
		]);
	});
});

describe('completing a visit', () => {
	it('the helper starts and completes their visit, stamped with when, with their notes', async () => {
		const t = await workspace();
		committed(await book(t, {}));
		const alpha = await signedIn(t, ALPHA);
		const [v] = await visits(t);
		t.clock.set('2026-09-29T02:05:00.000Z');
		committed(
			await alpha.act('visits.update', { target: v!['id'], set: { status: 'in_progress' } })
		);
		t.clock.set('2026-09-29T05:00:00.000Z');
		committed(
			await alpha.act('visits.update', {
				target: v!['id'],
				set: { status: 'done', completion_notes: 'Oven left for next time' }
			})
		);
		expect((await visits(t))[0]).toMatchObject({
			status: 'done',
			started_at: { $t: '2026-09-29T02:05:00.000Z' },
			completed_at: { $t: '2026-09-29T05:00:00.000Z' },
			completion_notes: 'Oven left for next time'
		});
	});

	it('a helper cannot complete a visit that is not theirs', async () => {
		const t = await workspace();
		committed(await book(t, {}));
		const bravo = await signedIn(t, BRAVO);
		const [v] = await visits(t);
		expect(
			await bravo.act('visits.update', { target: v!['id'], set: { status: 'in_progress' } })
		).toMatchObject({
			kind: 'refused'
		});
	});
});

describe('dispatch settings', () => {
	it('the free-change window is the configured one', async () => {
		const t = await workspace();
		committed(await book(t, {}));
		const [v] = await visits(t);
		const [row] = (await t.as(t.admin).read('dispatch_settings', { all: true })).rows;
		committed(
			await desk(t).act('dispatch_settings.update', {
				target: row!['id'],
				set: { free_change_hours: 2 }
			} as never)
		);
		t.clock.set('2026-09-28T12:00:00.000Z'); // 14 h ahead: late at 24 h, free at 2 h
		committed(await desk(t).act('visits.cancel', { target: v!['id'] } as never));
		expect((await visits(t))[0]).toMatchObject({ status: 'cancelled', late_cancellation: false });
	});
});

describe('helper alerts', () => {
	it('a helper is messaged on WhatsApp the visits given to them, one message per helper', async () => {
		const t = await workspace();
		committed(await book(t, { repeat: 'weekly', visits: 3 }));
		await settle(t);
		const toAlpha = t.fakes.transports.whatsapp.sent.filter(
			(s) => (s.message as { to: string }).to === '6590000001@s.whatsapp.net'
		);
		expect(toAlpha).toHaveLength(1);
		expect((toAlpha[0]!.message as { text: string }).text).toMatch(/^New visits for you:\n• V-/);
		expect((toAlpha[0]!.message as { text: string }).text.split('•')).toHaveLength(4);
	});
});

describe('registered customers', () => {
	it("a customer signed up by their number sees their own bookings, visits and helper, and nobody else's", async () => {
		const t = await workspace();
		committed(await book(t, {}));
		committed(await book(t, { customer: WEST_CUSTOMER, start: '2026-09-30T02:00:00.000Z' }));
		const me = t.as(
			t.member(['customer'], {
				external: true,
				party: { collection: 'customers', id: EAST_CUSTOMER }
			})
		);
		const mine = (
			await me.read('visits', {
				all: true,
				select: { number: true, helper: { select: { name: true } } }
			})
		).rows;
		expect(mine).toHaveLength(1);
		expect(mine[0]).toMatchObject({ helper: { name: 'Fixture Helper Alpha' } });
		expect((await me.read('bookings', { all: true })).rows.map((b) => b['customer'])).toEqual([
			EAST_CUSTOMER
		]);
		expect((await me.read('customers', { all: true })).rows.map((c) => c['id'])).toEqual([
			EAST_CUSTOMER
		]);
		expect((await me.read('customer_notices', { all: true })).rows).toHaveLength(1);
		// a member bound to no record yet sees nothing
		const unbound = t.as(t.member(['customer'], { external: true }));
		expect((await unbound.read('visits', { all: true })).rows).toEqual([]);
	});

	it('lets newcomers sign up by mobile number, as customers bound to the customer with that number', async () => {
		const t = await workspace();
		expect((t.manifest.workspace as { signup?: unknown }).signup).toEqual({
			via: ['phone'],
			policies: ['customer'],
			party: { collection: 'customers', match: { phone: 'phone' } }
		});
	});
});

// These tests cross the private computation boundary: customer data must not expose another customer's schedule.
describe('destination-specific booking availability', () => {
	const phone = '+6580000001';
	const address = '1 Example Avenue, Singapore 400001';
	const quoteInput = {
		phone,
		address,
		area: 'east',
		service: HOME_CLEANING,
		preference: 'any',
		repeat: 'once'
	};
	const customer = (t: T, number = phone) =>
		t.as(t.member(['customer'], { external: true, phone: number }));
	async function quote(t: T, over: Row = {}) {
		const filed = committed(
			await customer(t, String(over.phone ?? phone)).act('availability_requests.create', {
				...quoteInput,
				...over
			} as never)
		);
		await settle(t);
		const id = filed.records[0]!.id;
		const result = await t.as(t.admin).get('availability_requests', id);
		return { id, result };
	}
	const request = (availability: string, over: Row = {}) => ({
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
	it('books the selected map destination without asking for an area', async () => {
		const t = await workspace();
		const point = { lat: 1.3521, lng: 103.8198 };
		const newAddress = 'Map-selected fixture destination';
		const { area: _area, ...input } = quoteInput;
		const filed = committed(
			await customer(t).act('availability_requests.create', {
				...input,
				address: newAddress,
				location: point,
				preference: 'preferred',
				helper: BRAVO
			} as never)
		);
		await settle(t);
		const q = {
			id: filed.records[0]!.id,
			result: await t.as(t.admin).get('availability_requests', filed.records[0]!.id)
		};
		expect(q.result).toMatchObject({
			status: 'ready',
			area: null,
			location: point,
			starts: expect.arrayContaining([TUESDAY_10])
		});
		const { area: _bookingArea, ...bookingInput } = request(q.id, { address: newAddress });
		committed(await customer(t).act('booking_requests.create', bookingInput as never));
		await settle(t);
		expect((await visits(t))[0]).toMatchObject({
			address: newAddress,
			area: null,
			location: point,
			helper: BRAVO
		});
	});

	it('returns preference-scoped starts and books the selected cleaner instead of the nearer one', async () => {
		const t = await workspace();
		const q = await quote(t, { preference: 'preferred', helper: BRAVO });
		expect(q.result).toMatchObject({
			status: 'ready',
			starts: expect.arrayContaining([TUESDAY_10])
		});
		committed(await customer(t).act('booking_requests.create', request(q.id) as never));
		await settle(t);
		expect((await visits(t))[0]).toMatchObject({ helper: BRAVO, address });
	});

	it('flags an incompatible preferred cleaner and creates no booking', async () => {
		const t = await workspace();
		const deep = '0d500001-0000-4000-8000-000000000002';
		const q = await quote(t, { preference: 'preferred', helper: BRAVO, service: deep });
		expect(q.result).toMatchObject({
			status: 'failed',
			problem: expect.stringContaining('cannot perform')
		});
		expect(
			await book(t, { service: deep, preference: 'preferred', helpers: [BRAVO] })
		).toMatchObject({ kind: 'refused', message: expect.stringContaining('cannot perform') });
		expect(await visits(t)).toEqual([]);
		expect((await t.as(t.admin).read('bookings', { all: true })).rows).toEqual([]);
	});

	it('does not sell a recurring start when a later occurrence cannot be staffed; ad hoc still fits', async () => {
		const t = await workspace();
		committed(
			await t.as(t.admin).act('helper_time_off.create', {
				helper: ALPHA,
				period: { from: '2026-10-06', to: '2026-10-06' },
				reason: 'leave'
			})
		);
		const q = await quote(t, { preference: 'preferred', helper: ALPHA, repeat: 'weekly' });
		expect(q.result).toMatchObject({ status: 'ready' });
		expect(q.result!['starts']).not.toContain(TUESDAY_10);
		const once = await quote(t, { preference: 'preferred', helper: ALPHA });
		expect(once.result!['starts']).toContain(TUESDAY_10);
		expect(
			await book(t, { repeat: 'weekly', visits: 2, preference: 'preferred', helpers: [ALPHA] })
		).toMatchObject({ kind: 'refused', message: expect.stringContaining('occurrence 2') });
		expect(await visits(t)).toEqual([]);
		expect((await t.as(t.admin).read('bookings', { all: true })).rows).toEqual([]);
	});

	it('rechecks capacity after a quote instead of overbooking a preferred cleaner', async () => {
		const t = await workspace();
		const q = await quote(t, { preference: 'preferred', helper: ALPHA });
		expect(q.result!['starts']).toContain(TUESDAY_10);
		committed(await book(t, { preference: 'preferred', helpers: [ALPHA] }));
		committed(await customer(t).act('booking_requests.create', request(q.id) as never));
		await settle(t);
		expect((await t.as(t.admin).read('booking_requests', { all: true })).rows[0]).toMatchObject({
			status: 'follow_up'
		});
		expect(await visits(t)).toHaveLength(1);
	});

	it('binds quotes to the verified phone and exact inputs and keeps schedules private', async () => {
		const t = await workspace();
		const q = await quote(t);
		expect(q.result!['starts']).toContain(TUESDAY_10);
		const other = customer(t, '+6580000002');
		expect((await other.read('availability_requests', { all: true })).rows).toEqual([]);
		expect((await other.read('visits', { all: true, select: { location: true } })).rows).toEqual(
			[]
		);
		const publicHelpers = (
			await customer(t).read('helpers', { all: true, select: { phone: true } })
		).rows;
		expect(publicHelpers.map((h) => h.phone)).toEqual([
			{ $masked: true },
			{ $masked: true },
			{ $masked: true }
		]);
		expect(
			await other.act('booking_requests.create', request(q.id, { phone: '+6580000002' }) as never)
		).toMatchObject({ kind: 'refused' });
		expect(
			await customer(t).act(
				'booking_requests.create',
				request(q.id, { address: 'Another address' }) as never
			)
		).toMatchObject({ kind: 'refused' });
		expect((await t.as(t.admin).read('booking_requests', { all: true })).rows).toEqual([]);
	});

	it('expires old quotes and exposes only travel-feasible starts in the desk union', async () => {
		const t = await workspace();
		const q = await quote(t);
		expect(q.result!['starts']).toContain(TUESDAY_10);
		await t.clock.advance('16min');
		expect(await customer(t).act('booking_requests.create', request(q.id) as never)).toMatchObject({
			kind: 'refused',
			message: expect.stringContaining('Check times again')
		});
		committed(await book(t, { preference: 'preferred', helpers: [ALPHA] }));
		const starts = (await desk(t).query('bookings.open_slots', {
			customer: WEST_CUSTOMER,
			service: HOME_CLEANING,
			preference: 'preferred',
			helpers: [ALPHA],
			repeat: 'once',
			from: '2026-09-29',
			days: 1
		})) as { starts: string[] }[];
		expect(starts[0]!.starts).not.toContain('2026-09-29T05:00:00.000Z');
		expect(starts[0]!.starts).toContain('2026-09-29T06:30:00.000Z');
	});

	it('applies the submitted destination to a returning customer booking', async () => {
		const t = await workspace();
		const newAddress = 'Changed fixture destination';
		const q = await quote(t, { address: newAddress });
		expect(q.result).toMatchObject({
			status: 'ready',
			estimated: true,
			starts: expect.arrayContaining([TUESDAY_10])
		});
		committed(
			await customer(t).act(
				'booking_requests.create',
				request(q.id, { address: newAddress }) as never
			)
		);
		await settle(t);
		expect((await visits(t))[0]).toMatchObject({ address: newAddress, location: null });
	});

	it('uses Google travel durations when preparing customer-specific starts', async () => {
		const t = await workspace(google({ TRAFFIC_UNAWARE: 60, TRAFFIC_AWARE: 60 }));
		committed(await book(t, { preference: 'preferred', helpers: [ALPHA] }));
		const q = await quote(t, {
			phone: '+6580000002',
			address: '2 Sample Road, Singapore 600002',
			preference: 'preferred',
			helper: ALPHA
		});
		// 13:00 finish + Google 60 minutes + 15 buffer => first grid start 14:30.
		expect(q.result).toMatchObject({ status: 'ready' });
		expect(q.result!['starts']).not.toContain('2026-09-29T06:00:00.000Z');
		expect(q.result!['starts']).toContain('2026-09-29T06:30:00.000Z');
	});
});
