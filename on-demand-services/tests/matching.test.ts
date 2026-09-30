/** The matching rules, pure: hard requirements, the travel buffer, ranking, recurrence and proposals. */
import { describe, expect, it } from 'vitest';
import { Instant } from '@norbital-ai/std/date';
import type { PlainTime } from '@norbital-ai/bolt';
import {
	driveMinutes,
	occurrences,
	openSlots,
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
const helper = (id: string, over: Partial<Helper> = {}): Helper => ({
	id,
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
				pool({ off: [{ helper: 'a', period: { from: '2026-09-28', to: null } }] }),
				SG
			)
		).toBe('time_off');
		expect(refusal(helper('a', { status: 'left' }), need, pool(), SG)).toBe('left');
		expect(refusal(helper('a'), need, pool(), SG)).toBeNull();
	});

	it('counts the drive between two visits on both sides', () => {
		const earlier = {
			id: 'v',
			helper: 'a',
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
		expect(rank(need, pool({ helpers: [far, near] }), SG, 'far')[0]!.helper).toBe('far');
		// the same helper twice over: the one with a visit already this week ranks second
		const twin = helper('twin');
		const tuesday = {
			id: 't',
			helper: 'near',
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
		const held = { id: 'v', helper: 'a', slot: MONDAY, location: EAST };
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
		const held = { id: 'x', helper: 'deep', slot: MONDAY, location: EAST };
		const next = proposal(need, gone, pool({ helpers: [deep], busy: [held] }), SG);
		expect(next?.helper).toBe('deep');
		expect(next!.slot.start).not.toBe(MONDAY.start);
	});
});
