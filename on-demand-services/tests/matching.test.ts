import { describe, expect, it } from '@effect/vitest';
import { input_schema, type PlainTime } from '@norbital-ai/bolt';
import { DateTime, Schema } from 'effect';
import { createHash } from 'node:crypto';
import { formatInstant } from '../src/lib/format.js';
import {
	availableSlots,
	cellOf,
	driveMinutes,
	improve,
	legOf,
	lookups,
	normalizeSkill,
	occurrences,
	openSlots,
	planBooking,
	proposal,
	rank,
	refusal,
	slotOf,
	type Pool,
	type Provider
} from '../src/lib/matching.ts';
import { fixtureId, present } from './test-runtime.js';

const ZONE = 'UTC';
const EAST = { lat: 40.76, lng: -73.76 };
const WEST = { lat: 40.75, lng: -74.06 };
const at = (s: string) => s;
const uuid = (label: string) => {
	const hex = createHash('sha256').update(label).digest('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};
const pid = (id: string) => fixtureId('providers', uuid(`provider:${id}`));
const aid = (id: string) => fixtureId('appointments', uuid(`appointment:${id}`));
const time = (input: string) => {
	const schema = input_schema({ kind: 'time' });
	const decoded = Schema.decodeUnknownSync(schema)(input);
	return Schema.decodeUnknownSync(
		Schema.declare<PlainTime>((value): value is PlainTime =>
			Schema.is(Schema.toType(schema))(value)
		)
	)(decoded);
};
const provider = (id: string, over: Partial<Provider> = {}): Provider => ({
	id: pid(id),
	name: id,
	skills: ['hvac_service'],
	home_location: EAST,
	work_days: ['mon', 'tue', 'wed', 'thu', 'fri'],
	day_start: time('08:00'),
	day_end: time('18:00'),
	status: 'active',
	...over
});
// Monday 28 September 2026, 10:00-13:00 UTC
const MONDAY = slotOf(at('2026-09-28T10:00:00.000Z'), 180);
const need = { skill: 'hvac_service', slot: MONDAY, location: EAST };
const pool = (over: Partial<Pool> = {}): Pool => ({ providers: [], busy: [], off: [], ...over });
const localTime = (iso: string) =>
	formatInstant(iso, ZONE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, 'en-GB');

describe('hard requirements', () => {
	it('refuses a provider without the skill, off weekday, outside hours, on time off, or inactive', () => {
		expect(refusal(provider('a', { skills: ['plumbing'] }), need, pool(), ZONE)).toBe('skill');
		expect(refusal(provider('a', { work_days: ['tue'] }), need, pool(), ZONE)).toBe('day');
		expect(refusal(provider('a', { day_start: time('11:00') }), need, pool(), ZONE)).toBe('hours');
		expect(refusal(provider('a', { day_end: time('12:00') }), need, pool(), ZONE)).toBe('hours');
		expect(
			refusal(
				provider('a'),
				need,
				pool({ off: [{ provider: pid('a'), period: { from: '2026-09-28', to: null } }] }),
				ZONE
			)
		).toBe('time_off');
		expect(refusal(provider('a', { status: 'inactive' }), need, pool(), ZONE)).toBe('inactive');
		expect(refusal(provider('a'), need, pool(), ZONE)).toBeNull();
	});

	it('normalizes runtime skill tags case- and whitespace-insensitively', () => {
		expect(normalizeSkill('  HVAC Service ')).toBe('hvac_service');
		expect(
			refusal(
				provider('a', { skills: ['HVAC Service'] }),
				{ ...need, skill: 'hvac_service' },
				pool(),
				ZONE
			)
		).toBeNull();
	});

	it('enforces travel plus configurable turnaround buffer on both sides', () => {
		const earlier = {
			id: aid('v'),
			provider: pid('a'),
			slot: slotOf(at('2026-09-28T07:00:00.000Z'), 180),
			location: WEST
		};
		expect(refusal(provider('a'), need, pool({ busy: [earlier] }), ZONE)).toBe('booked');
		const sameStreet = {
			...earlier,
			location: EAST,
			slot: slotOf(at('2026-09-28T06:30:00.000Z'), 180)
		};
		// ends 09:30 next door: 15 min buffer allows 10:00, 45 min buffer refuses it
		expect(refusal(provider('a'), need, pool({ busy: [sameStreet] }), ZONE)).toBeNull();
		expect(
			refusal(provider('a'), need, pool({ busy: [sameStreet], bufferMinutes: 45 }), ZONE)
		).toBe('booked');
		// an appointment being re-matched does not block itself
		expect(
			refusal(provider('a'), { ...need, appointment: aid('v') }, pool({ busy: [earlier] }), ZONE)
		).toBeNull();
	});
});

describe('ranking', () => {
	it('prefers less driving, then lighter weekly load, with modest recurring continuity', () => {
		const near = provider('near');
		const far = provider('far', { home_location: WEST });
		expect(rank(need, pool({ providers: [far, near] }), ZONE).map((c) => c.provider)).toEqual([
			pid('near'),
			pid('far')
		]);
		expect(
			present(rank(need, pool({ providers: [far, near] }), ZONE, pid('far'))[0]).provider
		).toBe(pid('near'));
		const twin = provider('twin');
		const tuesday = {
			id: aid('t'),
			provider: pid('near'),
			slot: slotOf(at('2026-09-29T10:00:00.000Z'), 60),
			location: EAST
		};
		expect(
			present(rank(need, pool({ providers: [near, twin], busy: [tuesday] }), ZONE)[0]).provider
		).toBe(pid('twin'));
	});

	it('estimates drive minutes from Haversine distance when uncached', () => {
		expect(driveMinutes(EAST, EAST)).toBe(0);
		expect(driveMinutes(EAST, WEST)).toBeGreaterThan(30);
		expect(driveMinutes(null, EAST)).toBe(30);
	});
});

const leg = (a: typeof EAST, b: typeof EAST) => present(legOf(a, b));

describe('Google Routes cache', () => {
	it('overrides straight-line estimates directionally per grid cell', () => {
		const drive = new Map([[leg(WEST, EAST), 20]]);
		expect(driveMinutes(WEST, EAST, drive)).toBe(20);
		expect(driveMinutes(EAST, WEST, drive)).toBeGreaterThan(30);
		expect(legOf(EAST, { lat: EAST.lat + 0.001, lng: EAST.lng })).toBeNull();
		expect(cellOf(EAST)).toBe('40.76,-73.76');
	});

	it('frees or blocks starts when cached route duration differs from estimate', () => {
		const earlier = {
			id: aid('v'),
			provider: pid('a'),
			slot: slotOf(at('2026-09-28T07:00:00.000Z'), 180),
			location: WEST
		};
		const tenForty = { ...need, slot: slotOf(at('2026-09-28T10:40:00.000Z'), 120) };
		expect(refusal(provider('a'), tenForty, pool({ busy: [earlier] }), ZONE)).toBe('booked');
		expect(
			refusal(
				provider('a'),
				tenForty,
				pool({ busy: [earlier], drive: new Map([[leg(WEST, EAST), 20]]) }),
				ZONE
			)
		).toBeNull();
		const near = { lat: 40.74, lng: -73.76 };
		const hop = { ...earlier, location: near };
		const tenTwentyFive = { ...need, slot: slotOf(at('2026-09-28T10:25:00.000Z'), 120) };
		expect(refusal(provider('a'), tenTwentyFive, pool({ busy: [hop] }), ZONE)).toBeNull();
		expect(
			refusal(
				provider('a'),
				tenTwentyFive,
				pool({ busy: [hop], drive: new Map([[leg(near, EAST), 60]]) }),
				ZONE
			)
		).toBe('booked');
	});

	it('collects all planned route legs plus candidate spot legs', () => {
		const p = provider('a');
		const day = [
			{
				id: aid('1'),
				provider: pid('a'),
				slot: slotOf(at('2026-09-28T08:00:00.000Z'), 60),
				location: WEST
			},
			{
				id: aid('2'),
				provider: pid('a'),
				slot: slotOf(at('2026-09-28T14:00:00.000Z'), 60),
				location: EAST
			}
		];
		const near = { lat: 40.71, lng: -73.92 };
		expect(new Set(lookups(pool({ providers: [p], busy: day }), [near], ZONE))).toEqual(
			new Set([
				leg(EAST, WEST),
				leg(WEST, EAST),
				leg(WEST, near),
				leg(near, WEST),
				leg(near, EAST),
				leg(EAST, near)
			])
		);
	});
});

describe('efficiency and scheduling', () => {
	const MID = { lat: 40.755, lng: -73.91 };
	const run = (providerId: string, start: string, minutes: number, location: typeof EAST) => ({
		id: aid(`${providerId}-${start}`),
		provider: pid(providerId),
		slot: slotOf(at(start), minutes),
		location
	});
	const midday = { skill: 'hvac_service', slot: MONDAY, location: MID };

	it('ranks by marginal detour added to an existing day route', () => {
		const onTheWay = provider('on_the_way', { home_location: WEST });
		const atHome = provider('at_home', { home_location: EAST });
		const drive = new Map([
			[leg(WEST, MID), 20],
			[leg(MID, EAST), 20],
			[leg(WEST, EAST), 35],
			[leg(EAST, MID), 15]
		]);
		const busy = [
			run('on_the_way', '2026-09-28T08:00:00.000Z', 60, WEST),
			run('on_the_way', '2026-09-28T14:00:00.000Z', 60, EAST)
		];
		const [first, second] = rank(
			midday,
			pool({ providers: [atHome, onTheWay], busy, drive }),
			ZONE
		);
		expect(first).toMatchObject({ provider: pid('on_the_way'), drive_minutes: 5, week_hours: 2 });
		expect(second).toMatchObject({ provider: pid('at_home'), drive_minutes: 15, week_hours: 0 });
	});

	it('balances weekly utilization across providers', () => {
		const busyOne = provider('busy', { home_location: EAST });
		const idle = provider('idle', { home_location: WEST });
		const drive = new Map([
			[leg(EAST, MID), 15],
			[leg(WEST, MID), 25]
		]);
		const heavy = ['09-29', '09-30', '10-01', '10-02', '10-03'].map((d) =>
			run('busy', `2026-${d}T09:00:00.000Z`, 360, EAST)
		);
		const order = rank(midday, pool({ providers: [busyOne, idle], busy: heavy, drive }), ZONE);
		expect(order.map((c) => [c.provider, c.week_hours])).toEqual([
			[pid('idle'), 0],
			[pid('busy'), 30]
		]);
	});

	it('repeats at the same local wall time and respects configurable slot intervals', () => {
		expect(occurrences('2026-09-28T10:00:00.000Z', 'weekly', 3, ZONE)).toEqual([
			'2026-09-28T10:00:00.000Z',
			'2026-10-05T10:00:00.000Z',
			'2026-10-12T10:00:00.000Z'
		]);
		expect(occurrences('2026-01-31T10:00:00.000Z', 'monthly', 2, ZONE)[1]).toBe(
			'2026-02-28T10:00:00.000Z'
		);
		expect(occurrences('2026-09-28T10:00:00.000Z', 'once', 8, ZONE)).toHaveLength(1);

		const p = provider('a');
		const held = { id: aid('v'), provider: pid('a'), slot: MONDAY, location: EAST };
		const [thirtyMin] = openSlots(
			p,
			{ ...need, minutes: 60 },
			['2026-09-28'],
			pool({ busy: [held], slotIntervalMinutes: 30 }),
			ZONE,
			'2026-09-27T08:00:00.000Z'
		);
		const local = present(thirtyMin).starts.map(localTime);
		expect(local[0]).toBe('08:00');
		expect(local).not.toContain('09:00');
		expect(local).not.toContain('13:00');
		expect(local).toContain('13:30');
		expect(local.at(-1)).toBe('17:00');

		const [fifteenMin] = openSlots(
			p,
			{ ...need, minutes: 60 },
			['2026-09-28'],
			pool({ slotIntervalMinutes: 15 }),
			ZONE,
			'2026-09-27T08:00:00.000Z'
		);
		expect(present(fifteenMin).starts.map(localTime).slice(0, 3)).toEqual([
			'08:00',
			'08:15',
			'08:30'
		]);
	});

	it('proposes the closest skillset at the same time, else the nearest open time', () => {
		const departing = ['hvac_service', 'electrical'];
		const generalist = provider('generalist', {
			skills: ['hvac_service', 'plumbing', 'carpentry']
		});
		const specialist = provider('specialist', {
			skills: ['hvac_service', 'electrical'],
			home_location: WEST
		});
		expect(
			proposal(need, departing, pool({ providers: [generalist, specialist] }), ZONE)?.provider
		).toBe(pid('specialist'));
		const held = { id: aid('x'), provider: pid('specialist'), slot: MONDAY, location: EAST };
		const next = proposal(need, departing, pool({ providers: [specialist], busy: [held] }), ZONE);
		expect(next?.provider).toBe(pid('specialist'));
		expect(present(next).slot.start).not.toBe(MONDAY.start);
	});
});

describe('booking heuristics and local search', () => {
	it('preserves scarce skills, checks recurring preferences, and keeps recurring continuity', () => {
		const multi = provider('a', { skills: ['hvac_service', 'electrical'] });
		expect(rank(need, pool({ providers: [multi, provider('b')] }), ZONE)[0]?.provider).toBe(
			pid('b')
		);

		const scoped = pool({
			providers: [provider('a'), provider('b', { skills: ['electrical'] })],
			off: [{ provider: pid('a'), period: { from: '2026-10-05', to: '2026-10-05' } }]
		});
		const args = { ...need, minutes: 180 };
		expect(
			present(
				availableSlots(args, ['2026-09-28'], scoped, ZONE, '2026-09-25T08:00:00Z', 'once', 2, [
					pid('a')
				])[0]
			).starts
		).toContain(MONDAY.start);
		expect(
			present(
				availableSlots(args, ['2026-09-28'], scoped, ZONE, '2026-09-25T08:00:00Z', 'weekly', 2, [
					pid('a')
				])[0]
			).starts
		).toEqual([]);
		expect(
			planBooking(args, occurrences(MONDAY.start, 'weekly', 2, ZONE), scoped, ZONE, [pid('a')])
				.missing
		).toBe(1);

		const contPool = pool({
			providers: [provider('a'), provider('b')],
			off: [{ provider: pid('a'), period: { from: '2026-10-12', to: '2026-10-12' } }]
		});
		const plan = planBooking(args, occurrences(MONDAY.start, 'weekly', 3, ZONE), contPool, ZONE);
		expect(plan.missing).toBeNull();
		expect(plan.appointments.map((a) => a.provider)).toEqual([pid('a'), pid('a'), pid('b')]);
	});

	it('reaches a local minimum lowering total planned drive time', () => {
		const HOMES = [
			EAST,
			WEST,
			{ lat: 40.84, lng: -73.92 },
			{ lat: 40.68, lng: -73.9 },
			{ lat: 40.79, lng: -73.84 }
		];
		const providers = HOMES.map((home, i) => provider(`p${i}`, { home_location: home }));
		let seed = 7;
		const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
		const base = DateTime.makeUnsafe('2026-09-28T08:00:00Z');
		const needs = Array.from({ length: 60 }, (_, i) => ({
			appointment: aid(`a${i}`),
			skill: 'hvac_service',
			slot: slotOf(
				DateTime.formatIso(
					DateTime.add(base, { days: Math.floor(i / 12), minutes: (i % 4) * 150 })
				),
				120
			),
			location: { lat: 40.68 + random() * 0.16, lng: -74.06 + random() * 0.3 }
		}));
		const busy: Pool['busy'][number][] = [];
		for (const n of needs) {
			const free = providers.filter((p) => refusal(p, n, pool({ providers, busy }), ZONE) === null);
			const chosen = free[Math.floor(random() * free.length)];
			if (chosen !== undefined)
				busy.push({ id: n.appointment, provider: chosen.id, slot: n.slot, location: n.location });
		}
		const held = needs.filter((n) => busy.some((b) => b.id === n.appointment));
		const result = improve(pool({ providers, busy }), held, ZONE);
		const after = pool({ providers, busy: result.busy });
		expect(result.moves.length).toBeGreaterThan(0);
		expect(result.after).toBeLessThan(result.before);
		for (const n of held) {
			const current = present(result.busy.find((b) => b.id === n.appointment)).provider;
			expect(refusal(present(providers.find((p) => p.id === current)), n, after, ZONE)).toBeNull();
			expect(present(rank(n, after, ZONE, current)[0]).provider).toBe(current);
		}
		expect(improve(after, held, ZONE).moves).toEqual([]);
	});

	it('derives quarter-hour gap starts around adjacent travel legs', () => {
		const MID = { lat: 40.755, lng: -73.91 };
		const drive = new Map([
			[leg(EAST, MID), 33],
			[leg(MID, EAST), 33]
		]);
		const at9 = {
			id: aid('a'),
			provider: pid('a'),
			slot: slotOf(at('2026-09-28T09:00:00.000Z'), 60),
			location: EAST
		};
		const at2 = {
			id: aid('b'),
			provider: pid('a'),
			slot: slotOf(at('2026-09-28T14:00:00.000Z'), 60),
			location: EAST
		};
		const { starts } = present(
			openSlots(
				provider('a'),
				{ skill: 'hvac_service', location: MID, minutes: 60 },
				['2026-09-28'],
				pool({ providers: [provider('a')], busy: [at9, at2], drive }),
				ZONE,
				'2026-09-27T08:00:00.000Z'
			)[0]
		);
		const local = starts.map(localTime);
		expect(local).toContain('11:00');
		expect(local).not.toContain('10:30');
		expect(local).not.toContain('10:45');
		expect(local).toContain('12:00');
		expect(local).not.toContain('12:30');
		expect(local[0]).toBe('11:00');
	});
});
