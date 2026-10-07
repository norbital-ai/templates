/** The matching rules, pure: hard requirements, the travel buffer, ranking, recurrence and proposals. */
import { describe, expect, it } from 'vitest';
import { Instant } from '@norbital-ai/std/date';
import type { Id, PlainTime } from '@norbital-ai/bolt';
import {
	cellOf,
	driveMinutes,
	legOf,
	lookups,
	occurrences,
	openSlots,
	availableSlots,
	improve,
	planBooking,
	proposal,
	rank,
	refusal,
	slotOf,
	type Helper,
	type Pool
} from '../src/lib/matching.ts';

const SG = 'Asia/Singapore';
const EAST = { lat: 1.3526, lng: 103.9447 };
const WEST = { lat: 1.3404, lng: 103.709 };
const at = (s: string) => Instant(s);
const hid = (id: string) => id as Id<'helpers'>;
const vid = (id: string) => id as Id<'visits'>;
const helper = (id: string, over: Partial<Helper> = {}): Helper => ({
	id: hid(id),
	name: id,
	skills: ['home_cleaning'],
	home_area: 'east',
	home_location: EAST,
	work_days: ['mon', 'tue', 'wed', 'thu', 'fri'],
	day_start: '08:00' as unknown as PlainTime,
	day_end: '18:00' as unknown as PlainTime,
	status: 'active',
	...over
});
// Monday 28 September 2026, 10:00–13:00 in Singapore
const MONDAY = slotOf(at('2026-09-28T02:00:00.000Z'), 180);
const need = { skill: 'home_cleaning', slot: MONDAY, location: EAST, area: 'east' };
const pool = (over: Partial<Pool> = {}): Pool => ({ helpers: [], busy: [], off: [], ...over });

describe('hard requirements', () => {
	it('refuses a helper without the skill, off that weekday, outside hours, on leave or gone', () => {
		expect(refusal(helper('a', { skills: ['ironing'] }), need, pool(), SG)).toBe('skill');
		expect(refusal(helper('a', { work_days: ['tue'] }), need, pool(), SG)).toBe('day');
		expect(
			refusal(helper('a', { day_start: '11:00' as unknown as PlainTime }), need, pool(), SG)
		).toBe('hours');
		expect(
			refusal(helper('a', { day_end: '12:00' as unknown as PlainTime }), need, pool(), SG)
		).toBe('hours');
		expect(
			refusal(
				helper('a'),
				need,
				pool({ off: [{ helper: hid('a'), period: { from: '2026-09-28', to: null } }] }),
				SG
			)
		).toBe('time_off');
		expect(refusal(helper('a', { status: 'left' }), need, pool(), SG)).toBe('left');
		expect(refusal(helper('a'), need, pool(), SG)).toBeNull();
	});

	it('counts the drive between two visits on both sides', () => {
		const earlier = {
			id: vid('v'),
			helper: hid('a'),
			slot: slotOf(at('2026-09-27T23:00:00.000Z'), 180),
			location: WEST
		};
		// ends 10:00 in the west; the east is ~27 km away, so a 10:00 start in the east is too close
		expect(refusal(helper('a'), need, pool({ busy: [earlier] }), SG)).toBe('booked');
		const sameStreet = {
			...earlier,
			location: EAST,
			slot: slotOf(at('2026-09-27T22:30:00.000Z'), 180)
		};
		// ends 09:30 next door: 15 minutes to settle in leaves the 10:00 start free
		expect(refusal(helper('a'), need, pool({ busy: [sameStreet] }), SG)).toBeNull();
		// a visit being re-matched does not block itself
		expect(refusal(helper('a'), { ...need, visit: 'v' }, pool({ busy: [earlier] }), SG)).toBeNull();
	});
});

describe('ranking', () => {
	it('prefers less driving and the same area, then a lighter week, and keeps a recurring customer’s helper', () => {
		const near = helper('near');
		const far = helper('far', { home_area: 'west', home_location: WEST });
		expect(rank(need, pool({ helpers: [far, near] }), SG).map((c) => c.helper)).toEqual([
			'near',
			'far'
		]);
		// Continuity is modest: it cannot justify a large detour.
		expect(rank(need, pool({ helpers: [far, near] }), SG, hid('far'))[0]!.helper).toBe('near');
		// the same helper twice over: the one with a visit already this week ranks second
		const twin = helper('twin');
		const tuesday = {
			id: vid('t'),
			helper: hid('near'),
			slot: slotOf(at('2026-09-29T02:00:00.000Z'), 60),
			location: EAST
		};
		expect(rank(need, pool({ helpers: [near, twin], busy: [tuesday] }), SG)[0]!.helper).toBe(
			'twin'
		);
	});

	it('estimates a drive from straight-line distance', () => {
		expect(driveMinutes(EAST, EAST)).toBe(0);
		expect(driveMinutes(EAST, WEST)).toBeGreaterThan(30);
		expect(driveMinutes(null, EAST)).toBe(30);
	});
});

const leg = (a: typeof EAST, b: typeof EAST) => legOf(a, b)!;

describe('Google drive times', () => {
	it('override the straight-line estimate, one way at a time', () => {
		const drive = new Map([[leg(WEST, EAST), 20]]);
		expect(driveMinutes(WEST, EAST, drive)).toBe(20);
		expect(driveMinutes(EAST, WEST, drive)).toBeGreaterThan(30); // the way back is not timed yet
		// two addresses in one ~1 km square are never looked up
		expect(legOf(EAST, { lat: EAST.lat + 0.001, lng: EAST.lng })).toBeNull();
		expect(cellOf(EAST)).toBe('1.35,103.94');
	});

	it('free a start the estimate would refuse, and refuse one it would allow', () => {
		// ends 10:00 in the west; the estimate (~65 min) blocks a 10:40 start in the east, a timed 20 min does not
		const earlier = {
			id: vid('v'),
			helper: hid('a'),
			slot: slotOf(at('2026-09-27T23:00:00.000Z'), 180),
			location: WEST
		};
		const tenForty = { ...need, slot: slotOf(at('2026-09-28T02:40:00.000Z'), 120) };
		expect(refusal(helper('a'), tenForty, pool({ busy: [earlier] }), SG)).toBe('booked');
		const timed = pool({ busy: [earlier], drive: new Map([[leg(WEST, EAST), 20]]) });
		expect(refusal(helper('a'), tenForty, timed, SG)).toBeNull();
		// a short hop the estimate allows is refused once Google says it takes an hour
		const near = { lat: 1.33, lng: 103.94 };
		const hop = { ...earlier, location: near };
		const tenTwentyFive = { ...need, slot: slotOf(at('2026-09-28T02:25:00.000Z'), 120) };
		expect(refusal(helper('a'), tenTwentyFive, pool({ busy: [hop] }), SG)).toBeNull();
		const slow = pool({ busy: [hop], drive: new Map([[leg(near, EAST), 60]]) });
		expect(refusal(helper('a'), tenTwentyFive, slow, SG)).toBe('booked');
	});

	it('are looked up for every planned leg and every leg to and from the spot', () => {
		const h = helper('a');
		const day = [
			{
				id: vid('1'),
				helper: hid('a'),
				slot: slotOf(at('2026-09-28T00:00:00.000Z'), 60),
				location: WEST
			},
			{
				id: vid('2'),
				helper: hid('a'),
				slot: slotOf(at('2026-09-28T06:00:00.000Z'), 60),
				location: EAST
			}
		];
		const near = { lat: 1.3, lng: 103.8 };
		expect(new Set(lookups(pool({ helpers: [h], busy: day }), [near], SG))).toEqual(
			new Set([
				leg(EAST, WEST), // home to the first visit
				leg(WEST, EAST), // first to second
				leg(WEST, near),
				leg(near, WEST),
				leg(near, EAST),
				leg(EAST, near) // also home to the spot: home is in the east
			])
		);
	});
});

describe('efficiency', () => {
	const MID = { lat: 1.345, lng: 103.83 };
	const run = (helperId: string, start: string, minutes: number, location: typeof EAST) => ({
		id: `${helperId}-${start}`,
		helper: helperId,
		slot: slotOf(at(start), minutes),
		location
	});
	const midday = { skill: 'home_cleaning', slot: MONDAY, location: MID, area: 'central' };

	it('ranks by the drive a visit adds to the day: a visit on the way costs nearly nothing', () => {
		// on the way from the west (08:00) to the east (14:00), versus a helper at home nearer than either end
		const onTheWay = helper('on_the_way', { home_location: WEST, home_area: 'west' });
		const atHome = helper('at_home', { home_location: EAST, home_area: 'east' });
		const drive = new Map([
			[leg(WEST, MID), 20],
			[leg(MID, EAST), 20],
			[leg(WEST, EAST), 35],
			[leg(EAST, MID), 15]
		]);
		const busy = [
			run('on_the_way', '2026-09-28T00:00:00.000Z', 60, WEST),
			run('on_the_way', '2026-09-28T06:00:00.000Z', 60, EAST)
		];
		const [first, second] = rank(midday, pool({ helpers: [atHome, onTheWay], busy, drive }), SG);
		expect(first).toMatchObject({ helper: hid('on_the_way'), drive_minutes: 5, week_hours: 2 });
		expect(second).toMatchObject({ helper: hid('at_home'), drive_minutes: 15, week_hours: 0 });
	});

	it('balances the week by hours booked: a heavy week outweighs a slightly shorter drive', () => {
		const busyOne = helper('busy', { home_location: EAST });
		const idle = helper('idle', { home_location: WEST });
		const drive = new Map([
			[leg(EAST, MID), 15],
			[leg(WEST, MID), 25]
		]);
		// 30 hours already that week (Tuesday to Saturday): 60 minutes' worth against 10 minutes more driving
		const heavy = ['09-29', '09-30', '10-01', '10-02', '10-03'].map((d) =>
			run('busy', `2026-${d}T01:00:00.000Z`, 360, EAST)
		);
		const order = rank(midday, pool({ helpers: [busyOne, idle], busy: heavy, drive }), SG);
		expect(order.map((c) => [c.helper, c.week_hours])).toEqual([
			['idle', 0],
			['busy', 30]
		]);
	});
});

describe('scheduling', () => {
	it('repeats at the same local wall time', () => {
		expect(occurrences('2026-09-28T02:00:00.000Z', 'weekly', 3, SG)).toEqual([
			'2026-09-28T02:00:00.000Z',
			'2026-10-05T02:00:00.000Z',
			'2026-10-12T02:00:00.000Z'
		]);
		expect(occurrences('2026-01-31T02:00:00.000Z', 'monthly', 2, SG)[1]).toBe(
			'2026-02-28T02:00:00.000Z'
		);
		expect(occurrences('2026-09-28T02:00:00.000Z', 'once', 8, SG)).toHaveLength(1);
	});

	it('lays out a helper’s open half-hours around what they hold', () => {
		const h = helper('a');
		const held = { id: vid('v'), helper: hid('a'), slot: MONDAY, location: EAST };
		const [monday] = openSlots(
			h,
			{ ...need, minutes: 60 },
			['2026-09-28' as never],
			pool({ busy: [held] }),
			SG,
			'2026-09-27T00:00:00.000Z'
		);
		const local = monday!.starts.map((s) =>
			new Date(Date.parse(s) + 8 * 3_600_000).toISOString().slice(11, 16)
		);
		// 08:00 and 08:30 end by 09:30 (15 min settle to 10:00 would need 08:45); 13:15 onwards clears the buffer
		expect(local[0]).toBe('08:00');
		expect(local).not.toContain('09:00');
		expect(local).not.toContain('13:00');
		expect(local).toContain('13:30');
		expect(local.at(-1)).toBe('17:00');
	});

	it('proposes the closest skillset at the same time, else the nearest time', () => {
		const gone = ['home_cleaning', 'deep_cleaning'];
		const generalist = helper('generalist', { skills: ['home_cleaning', 'handyman', 'ironing'] });
		const deep = helper('deep', {
			skills: ['home_cleaning', 'deep_cleaning'],
			home_area: 'west',
			home_location: WEST
		});
		expect(proposal(need, gone, pool({ helpers: [generalist, deep] }), SG)?.helper).toBe('deep');
		const held = { id: vid('x'), helper: hid('deep'), slot: MONDAY, location: EAST };
		const next = proposal(need, gone, pool({ helpers: [deep], busy: [held] }), SG);
		expect(next?.helper).toBe('deep');
		expect(next!.slot.start).not.toBe(MONDAY.start);
	});
});

// Prevent booking-order bias without moving any existing appointment.
describe('small booking heuristics', () => {
	it('spreads otherwise-identical ad hoc visits across cleaners', () => {
		const p = pool({ helpers: [helper('a'), helper('b')] });
		const first = planBooking({ ...need, minutes: 60 }, [MONDAY.start], p, SG);
		expect(first.visits[0]?.helper).toBe('a');
		const held = {
			id: vid('first'),
			helper: hid('a'),
			slot: first.visits[0]!.slot,
			location: EAST
		};
		const second = planBooking(
			{ ...need, minutes: 60 },
			[at('2026-09-29T02:00:00.000Z')],
			{ ...p, busy: [held] },
			SG
		);
		expect(second.visits[0]?.helper).toBe('b');
	});

	it('balances utilization rather than penalizing a longer available shift', () => {
		const short = helper('short', { day_end: '12:00' as never });
		const full = helper('full');
		const busy = [
			{
				id: vid('s'),
				helper: hid('short'),
				slot: slotOf('2026-09-29T00:00:00.000Z', 120),
				location: EAST
			},
			{
				id: vid('f'),
				helper: hid('full'),
				slot: slotOf('2026-09-29T00:00:00.000Z', 240),
				location: EAST
			}
		];
		const found = rank(
			{ ...need, slot: slotOf(MONDAY.start, 60) },
			pool({ helpers: [short, full], busy }),
			SG
		);
		expect(found[0]).toMatchObject({ helper: hid('full'), week_hours: 4 });
	});

	it('preserves a uniquely skilled cleaner when travel and utilization tie', () => {
		const specialist = helper('a', { skills: ['home_cleaning', 'handyman'] });
		expect(rank(need, pool({ helpers: [specialist, helper('b')] }), SG)[0]?.helper).toBe('b');
	});

	it('scopes starts to the preference, and checks every recurring occurrence', () => {
		const p = pool({
			helpers: [helper('a'), helper('b', { skills: ['handyman'] })],
			off: [{ helper: hid('a'), period: { from: '2026-10-05', to: '2026-10-05' } }]
		});
		const args = { ...need, minutes: 180 };
		const days = ['2026-09-28' as never];
		const once = availableSlots(args, days, p, SG, '2026-09-25T00:00:00Z', 'once', 2, [hid('a')]);
		expect(once[0]!.starts).toContain(MONDAY.start);
		expect(
			availableSlots(args, days, p, SG, '2026-09-25T00:00:00Z', 'weekly', 2, [hid('a')])[0]!.starts
		).toEqual([]);
		expect(
			availableSlots(args, days, p, SG, '2026-09-25T00:00:00Z', 'once', 2, [hid('b')])[0]!.starts
		).toEqual([]);
		expect(
			planBooking(args, occurrences(MONDAY.start, 'weekly', 2, SG), p, SG, ['a']).missing
		).toBe(1);
	});

	it('uses continuity for recurring visits but falls back when the cleaner is unavailable', () => {
		const p = pool({
			helpers: [helper('a'), helper('b')],
			off: [{ helper: hid('a'), period: { from: '2026-10-12', to: '2026-10-12' } }]
		});
		const plan = planBooking(
			{ ...need, minutes: 180 },
			occurrences(MONDAY.start, 'weekly', 3, SG),
			p,
			SG
		);
		expect(plan.missing).toBeNull();
		expect(plan.visits.map((v) => v.helper)).toEqual(['a', 'a', 'b']);
	});
});

describe('schedule optimisation', () => {
	// Five helpers spread over the island, a Monday-to-Friday week of 2-hour visits at random addresses
	const HOMES = [
		EAST,
		WEST,
		{ lat: 1.43, lng: 103.83 },
		{ lat: 1.3, lng: 103.84 },
		{ lat: 1.37, lng: 103.89 }
	];
	const helpers = HOMES.map((home, i) => helper(`h${i}`, { home_location: home }));
	let seed = 7;
	const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
	const needs = Array.from({ length: 60 }, (_, i) => ({
		visit: `v${i}`,
		skill: 'home_cleaning',
		// 28 Sep–2 Oct, 08:00/10:30/13:00/15:30 Singapore
		slot: slotOf(
			at(
				new Date(
					Date.parse('2026-09-28T00:00:00Z') + Math.floor(i / 12) * 86_400_000 + (i % 4) * 9_000_000
				).toISOString()
			),
			120
		),
		location: { lat: 1.29 + random() * 0.15, lng: 103.68 + random() * 0.28 },
		area: null
	}));
	// Any feasible assignment, taken in the order the visits arrive: the drift booking-time choices leave behind
	const busy: Pool['busy'][number][] = [];
	for (const need of needs) {
		const free = helpers.filter((h) => refusal(h, need, pool({ helpers, busy }), SG) === null);
		const h = free[Math.floor(random() * free.length)];
		if (h !== undefined)
			busy.push({ id: vid(need.visit), helper: h.id, slot: need.slot, location: need.location });
	}
	const held = needs.filter((n) => busy.some((b) => b.id === n.visit));

	it('reaches a local minimum: no single reassignment improves the objective, and less is driven', () => {
		const p = pool({ helpers, busy });
		const result = improve(p, held, SG);
		const after = pool({ helpers, busy: result.busy });
		expect(result.moves.length).toBeGreaterThan(0);
		expect(result.after).toBeLessThan(result.before);
		for (const need of held) {
			const current = result.busy.find((b) => b.id === need.visit)!.helper;
			// every visit is still feasible for its helper, travel buffers included
			expect(
				refusal(
					helpers.find((h) => h.id === current)!,
					need,
					after,
					SG
				)
			).toBeNull();
			// and its own helper ranks first: no relocation beats staying
			expect(rank(need, after, SG, current)[0]!.helper).toBe(current);
		}
		// a second pass finds nothing left to do
		expect(improve(after, held, SG).moves).toEqual([]);
	});
});

describe('open starts follow the drive', () => {
	it('offers the arrival after a visit rounded up to the quarter hour, and the last start before one rounded down', () => {
		const MID = { lat: 1.345, lng: 103.83 };
		// 33 min each way + 15 min to settle = 48 min between the two addresses
		const drive = new Map([
			[leg(EAST, MID), 33],
			[leg(MID, EAST), 33]
		]);
		const at9 = {
			id: vid('a'),
			helper: hid('a'),
			slot: slotOf(at('2026-09-28T01:00:00.000Z'), 60),
			location: EAST
		};
		const at2 = {
			id: vid('b'),
			helper: hid('a'),
			slot: slotOf(at('2026-09-28T06:00:00.000Z'), 60),
			location: EAST
		};
		const [{ starts }] = openSlots(
			helper('a'),
			{ skill: 'home_cleaning', location: MID, area: null, minutes: 60 },
			['2026-09-28' as never],
			pool({ helpers: [helper('a')], busy: [at9, at2], drive }),
			SG,
			'2026-09-27T00:00:00.000Z'
		);
		const local = starts.map((s) =>
			new Date(s).toLocaleTimeString('en-GB', { timeZone: SG, hour: '2-digit', minute: '2-digit' })
		);
		// the 9–10 visit: arrival 10:48 → 11:00 is the first start after it, never 10:30 or 10:45
		expect(local).toContain('11:00');
		expect(local).not.toContain('10:30');
		expect(local).not.toContain('10:45');
		// the 2 pm visit: an hour's job must be done by 13:12 → 12:00 (12:12 rounded down to the quarter); 12:30 is refused
		expect(local).toContain('12:00');
		expect(local).not.toContain('12:30');
		// and 8:00 cannot reach the 9:00 visit 48 minutes away, so the day opens at 11:00
		expect(local[0]).toBe('11:00');
	});
});
