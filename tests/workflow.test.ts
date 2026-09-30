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

const workspace = () =>
	testWorkspace({ root: `${process.cwd()}/`, seed: 'base', now: '2026-09-25T02:00:00.000Z' });
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
			message: expect.stringContaining('None of the preferred helpers')
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

describe('the shift check', () => {
	it('asks two hours ahead; no answer in an hour means a warning letter, another helper and a note to a preferring customer', async () => {
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
		expect(v).toMatchObject({ shift_check: 'not_due' });
		expect(v!['helper']).toBe(CHARLIE);
		const admin = t.as(t.admin);
		const warnings = (await admin.read('helper_warnings', { all: true })).rows;
		expect(warnings).toMatchObject([{ helper: ALPHA, reason: 'no_response' }]);
		// the kit renders no PDFs: the letter run ends cleanly and the warning stands without one
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
		expect(notices.every((n) => n['delivery'] === 'whatsapp; email')).toBe(true);
	});

	it('a decline with a medical certificate reassigns the day without a warning, and a customer with no preference is not told', async () => {
		const t = await workspace();
		committed(await book(t, {}));
		const alpha = await signedIn(t, ALPHA);
		const [v] = await visits(t);
		committed(await alpha.act('visits.decline_shift', { target: v!['id'], input: { mc: true } }));
		await t.runDue();
		const [after] = await visits(t);
		expect(after!['helper']).not.toBe(ALPHA);
		const admin = t.as(t.admin);
		expect((await admin.read('helper_warnings', { all: true })).rows).toEqual([]);
		// only the booking's confirmation: no preference, so the change of helper is not news to them
		expect(
			(await admin.read('customer_notices', { all: true })).rows.map((n) => n['subject'])
		).toEqual([expect.stringContaining('Booking confirmed')]);
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
		name: 'Portal Visitor',
		phone: '+6581234567',
		address: '9 Portal Lane, Singapore 400009',
		area: 'east',
		service: HOME_CLEANING,
		start: TUESDAY_10,
		repeat: 'once'
	};

	it('a visitor with no account files a request, and sees nothing else', async () => {
		const t = await workspace();
		const visitor = t.visitor('portal');
		committed(await visitor.act('booking_requests.create', request));
		expect((await visitor.read('services', { all: true })).rows).toHaveLength(4);
		await expect(visitor.read('helpers', { all: true })).rejects.toThrow();
		await expect(visitor.read('booking_requests', { all: true })).rejects.toThrow();
	});

	it('a request a helper is free for is booked on its own, the customer filed by phone and told on WhatsApp', async () => {
		const t = await workspace();
		committed(await t.visitor('portal').act('booking_requests.create', request));
		await settle(t);
		const admin = t.as(t.admin);
		const [r] = (await admin.read('booking_requests', { all: true })).rows;
		expect(r).toMatchObject({ status: 'booked' });
		expect(r!['booking']).not.toBeNull();
		const customers = (
			await admin.read('customers', { where: { phone: { eq: request.phone } }, all: true })
		).rows;
		expect(customers).toHaveLength(1);
		expect((await visits(t))[0]).toMatchObject({ helper: ALPHA });
		const notices = (await admin.read('customer_notices', { all: true })).rows;
		expect(notices).toMatchObject([
			{ subject: expect.stringContaining('Booking confirmed'), delivery: 'whatsapp' }
		]);
		expect(t.fakes.transports.whatsapp.sent.map((s) => (s.message as { to: string }).to)).toContain(
			'6581234567@s.whatsapp.net'
		);
		expect(t.fakes.transports.email.sent).toEqual([]);
	});

	it('a returning customer is recognised by their number, not filed twice', async () => {
		const t = await workspace();
		committed(
			await t.visitor('portal').act('booking_requests.create', {
				...request,
				name: 'Someone Else',
				phone: '+6580000001'
			})
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
			await t
				.visitor('portal')
				.act('booking_requests.create', { ...request, start: '2026-09-26T22:00:00.000Z' })
		);
		await settle(t);
		const admin = t.as(t.admin);
		expect((await admin.read('booking_requests', { all: true })).rows[0]).toMatchObject({
			status: 'follow_up'
		});
		expect(await visits(t)).toEqual([]);
		expect((await admin.read('customer_notices', { all: true })).rows).toMatchObject([
			{ subject: expect.stringContaining('received'), delivery: 'whatsapp' }
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
