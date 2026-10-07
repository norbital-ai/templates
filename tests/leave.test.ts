/** L-TPL-hr-payroll-072 balances; 073 preview; 075 write refusals; 078 roster coverage. */
import type { Id } from '@norbital-ai/bolt';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
	chargeableDays,
	coversDay,
	entitlementDays,
	leaveBalances,
	previewLeave,
	refuseCoveredWorkDay,
	refuseLeaveWrite,
	type LeaveClass,
	type LeaveEntitlement,
	type LeaveMovement
} from '../src/lib/payroll_engine/leave.ts';

const catalog = (id: string) => id as Id<'leave_catalog'>;
/** The seeded entitlement shape: the highest band reached, else the record's own first-year proration. */
const banded = (fallback = '0.0') =>
	`size(bands.filter(b, service_months >= b.service_months).map(b, b.days)) > 0 ? first(bands.filter(b, service_months >= b.service_months).map(b, b.days)) : ${fallback}`;
const annual: LeaveClass = {
	id: catalog('al'),
	code: 'ANNUAL_LEAVE',
	name: 'Annual leave',
	can_encash: true,
	is_npl: false,
	consumes_code: null,
	entitlement: {
		days: banded('round(7.0 * min(service_months, 12.0) / 12.0, 1.0, "HALF_UP")'),
		bands: [
			{ service_months: 84, days: 13 },
			{ service_months: 12, days: 7 }
		]
	}
};
const sick: LeaveClass = {
	id: catalog('sl'),
	code: 'SICK_LEAVE',
	name: 'Outpatient sick leave',
	can_encash: false,
	is_npl: false,
	consumes_code: 'HOSPITALIZATION_LEAVE',
	entitlement: { days: banded(), bands: [{ service_months: 6, days: 14 }] }
};
const hospital: LeaveClass = {
	id: catalog('hl'),
	code: 'HOSPITALIZATION_LEAVE',
	name: 'Hospitalization leave',
	can_encash: false,
	is_npl: false,
	consumes_code: null,
	entitlement: { days: banded(), bands: [{ service_months: 6, days: 60 }] }
};
const unpaid: LeaveClass = {
	id: catalog('ul'),
	code: 'UNPAID_LEAVE',
	name: 'Unpaid leave',
	can_encash: false,
	is_npl: true,
	consumes_code: null,
	entitlement: null
};
const ns: LeaveClass = {
	id: catalog('ns'),
	code: 'NS_LEAVE',
	name: 'National service leave',
	can_encash: true,
	is_npl: false,
	consumes_code: null,
	entitlement: null
};

const taken = (
	catalog_id: string,
	days: number,
	extra: Partial<LeaveMovement> = {}
): LeaveMovement => ({
	id: extra.id ?? `${catalog_id}-${days}`,
	catalog_id: catalog(catalog_id),
	activity: extra.activity ?? 'TIME_OFF',
	occurred_on: extra.occurred_on ?? '2026-03-02',
	approval_id: extra.approval_id ?? null,
	days: extra.days ?? days,
	from: extra.from ?? extra.occurred_on ?? '2026-03-02',
	to: extra.to ?? null
});

describe('leave', () => {
	it('L-TPL-hr-payroll-072 prorates the first year and uses the service band after twelve months', () => {
		assert.equal(entitlementDays(annual.entitlement, 6), 4);
		assert.equal(entitlementDays(annual.entitlement, 86), 13);
		// The seeded SG row: EA s.88A, 7 days pro-rated half-up below a year (6 months → 3.5 → 4), 14 from 84 months.
		const seeded = (
			JSON.parse(
				readFileSync(
					resolve(process.cwd(), 'seed/jurisdiction/SG/version_4/leave_catalog.json'),
					'utf8'
				)
			) as { code: string; entitlement: LeaveEntitlement }[]
		).find((row) => row.code === 'ANNUAL_LEAVE')!.entitlement;
		assert.deepEqual(
			[0, 1, 6, 11, 12, 86].map((months) => entitlementDays(seeded, months)),
			[0, 1, 4, 6, 8, 14]
		);
		const rows = leaveBalances({
			classes: [annual],
			movements: [taken('al', 4)],
			serviceMonths: 86
		});
		assert.deepEqual(rows[0], {
			catalog_id: 'al',
			code: 'ANNUAL_LEAVE',
			name: 'Annual leave',
			metered: true,
			entitlement: 13,
			carried: 0,
			taken: 4,
			reserved: 0,
			available: 9,
			window_key: ''
		});
	});

	it('L-TPL-hr-payroll-073 previews the same remaining days the write would see', () => {
		const preview = previewLeave({
			catalog_id: 'al',
			days: 3,
			from: '2026-04-01',
			to: '2026-04-03',
			classes: [annual],
			movements: [taken('al', 4)],
			serviceMonths: 86
		});
		assert.ok(preview);
		assert.equal(preview.available, 9);
		assert.equal(preview.requested, 3);
		assert.equal(preview.remaining, 6);
		assert.equal(preview.ok, true);
		assert.equal(preview.covered_from, '2026-04-01');
		assert.equal(preview.covered_to, '2026-04-03');
		assert.equal(
			previewLeave({
				catalog_id: 'al',
				days: 10,
				classes: [annual],
				movements: [taken('al', 4)],
				serviceMonths: 86
			})?.ok,
			false
		);
	});

	it('L-TPL-hr-payroll-075 refuses over-balance time off and encashment of a class that cannot cash out', () => {
		const classes = [annual, sick, hospital, unpaid, ns];
		const movements = [taken('al', 4), taken('sl', 2), taken('hl', 5)];
		assert.equal(
			refuseLeaveWrite({
				proposed: taken('al', 10, { id: 'new-al' }),
				classes,
				movements,
				serviceMonths: 86
			}),
			'This selection exceeds the available 9 day(s).'
		);
		assert.equal(
			refuseLeaveWrite({
				proposed: {
					...taken('sl', 1, { id: 'cash', activity: 'ENCASHMENT' }),
					activity: 'ENCASHMENT'
				},
				classes,
				movements,
				serviceMonths: 86
			}),
			'Outpatient sick leave cannot be encashed.'
		);
		assert.equal(
			refuseLeaveWrite({
				proposed: taken('al', 2, {
					id: 'carry',
					activity: 'CARRY_FORWARD',
					days: 2
				}),
				classes,
				movements,
				serviceMonths: 86
			}),
			null
		);
		assert.equal(
			refuseLeaveWrite({
				proposed: taken('ul', 5, { id: 'npl' }),
				classes,
				movements,
				serviceMonths: 86
			}),
			null
		);
		assert.equal(
			refuseLeaveWrite({
				proposed: taken('ns', 2, { id: 'ns-1' }),
				classes,
				movements,
				serviceMonths: 86
			}),
			null
		);
		const afterCarry = leaveBalances({
			classes: [annual],
			movements: [
				taken('al', 4),
				{ ...taken('al', 2, { id: 'cf', activity: 'CARRY_FORWARD' }), activity: 'CARRY_FORWARD' }
			],
			serviceMonths: 86
		});
		assert.equal(afterCarry[0]?.taken, 2);
		assert.equal(afterCarry[0]?.available, 11);
	});

	it('L-TPL-hr-payroll-075 outpatient sick leave draws from the hospitalization pool', () => {
		const classes = [sick, hospital];
		const rows = leaveBalances({
			classes,
			movements: [taken('sl', 4), taken('hl', 10)],
			serviceMonths: 12
		});
		const outpatient = rows.find((row) => row.code === 'SICK_LEAVE');
		const stay = rows.find((row) => row.code === 'HOSPITALIZATION_LEAVE');
		assert.equal(outpatient?.taken, 4);
		assert.equal(stay?.taken, 14);
		assert.equal(stay?.available, 46);
		assert.equal(
			refuseLeaveWrite({
				proposed: taken('sl', 11, { id: 'too-much-sick' }),
				classes,
				movements: [taken('sl', 4)],
				serviceMonths: 12
			}),
			'This selection exceeds the available 10 day(s).'
		);
	});

	it('L-TPL-hr-payroll-078 blocks a rostered day that approved time off already covers', () => {
		const leave: LeaveMovement = {
			id: 'l1',
			catalog_id: catalog('al'),
			employment_id: 'e1',
			activity: 'TIME_OFF',
			occurred_on: '2026-03-02',
			approval_id: null,
			days: 3,
			from: '2026-03-02',
			to: '2026-03-04'
		};
		assert.equal(coversDay(leave, '2026-03-03'), true);
		assert.equal(coversDay(leave, '2026-03-05'), false);
		assert.equal(
			refuseCoveredWorkDay('2026-03-03', 'e1', [leave]),
			'Leave already covers this day.'
		);
		assert.equal(refuseCoveredWorkDay('2026-03-03', 'e2', [leave]), null);
	});
});

describe('chargeable days', () => {
	const none = new Set<string>();
	// A Monday-to-Thursday week: Friday and Saturday off, Sunday the rest day.
	const off = new Set(['2026-03-06', '2026-03-07', '2026-03-08']);

	it('counts the working days of a range and skips the days not rostered', () => {
		assert.equal(chargeableDays({ from: '2026-03-02', to: '2026-03-08', nonWorking: off }), 4);
		assert.equal(chargeableDays({ from: '2026-03-02', to: '2026-03-03', nonWorking: none }), 2);
	});

	it('halves a flagged first or last day', () => {
		assert.equal(
			chargeableDays({
				from: '2026-03-02',
				to: '2026-03-03',
				half_day_start: true,
				nonWorking: none
			}),
			1.5
		);
		assert.equal(
			chargeableDays({
				from: '2026-03-02',
				to: '2026-03-03',
				half_day_end: true,
				nonWorking: none
			}),
			1.5
		);
		assert.equal(
			chargeableDays({
				from: '2026-03-02',
				to: '2026-03-03',
				half_day_start: true,
				half_day_end: true,
				nonWorking: none
			}),
			1
		);
	});

	it('a range of only non-working days costs nothing, and a half-flagged single day costs half', () => {
		assert.equal(chargeableDays({ from: '2026-03-06', to: '2026-03-08', nonWorking: off }), 0);
		assert.equal(
			chargeableDays({
				from: '2026-03-02',
				to: '2026-03-02',
				half_day_start: true,
				nonWorking: none
			}),
			0.5
		);
		// The range opens on days off, so the half flag falls on the first day actually worked.
		assert.equal(
			chargeableDays({
				from: '2026-03-06',
				to: '2026-03-09',
				half_day_start: true,
				nonWorking: off
			}),
			0.5
		);
	});

	it('a CALENDAR_YEAR class meters each year on its own; the default LIFETIME meters every movement', () => {
		const sickYear: LeaveClass = {
			...unpaid,
			id: catalog('sy'),
			code: 'SICK_YEAR',
			name: 'Sick leave',
			is_npl: false,
			entitlement: { days: '14.0', window: 'CALENDAR_YEAR' }
		};
		const lastYear = taken('sy', 14, { id: 'y1', occurred_on: '2025-06-02', from: '2025-06-02' });
		const refuse = (from: string, days: number, cls = sickYear) =>
			refuseLeaveWrite({
				proposed: taken(cls.id, days, { id: 'new', occurred_on: from, from }),
				classes: [cls],
				movements: [lastYear],
				serviceMonths: 30
			});
		assert.equal(refuse('2026-03-02', 14), null);
		assert.match(String(refuse('2025-12-01', 1)), /available 0 day/);
		const lifetime = { ...sickYear, entitlement: { days: '14.0' } };
		assert.match(String(refuse('2026-03-02', 1, lifetime)), /available 0 day/);
		const [balance] = leaveBalances({
			classes: [sickYear],
			movements: [lastYear],
			serviceMonths: 30,
			asOf: '2026-01-05'
		});
		assert.equal(balance!.available, 14);
	});

	it('an EVENT class meters each absence event (facts.event_id); its CEL reads taken and the subject', () => {
		const paternity: LeaveClass = {
			...unpaid,
			id: catalog('pa'),
			code: 'PATERNITY_LEAVE',
			name: 'Paternity leave',
			is_npl: false,
			// RA 8187: seven days a delivery, for the first four deliveries only.
			entitlement: {
				days: 'employee.gender != "MALE" ? 0.0 : (taken.lifetime >= 28.0 ? 0.0 : 7.0)',
				window: 'EVENT'
			}
		};
		const birth = (event_id: string, days: number, id = event_id): LeaveMovement => ({
			...taken('pa', days, { id }),
			event_id
		});
		const context = { employee: { gender: 'MALE' } };
		const refuse = (proposed: LeaveMovement, movements: LeaveMovement[]) =>
			refuseLeaveWrite({
				proposed,
				classes: [paternity],
				movements,
				serviceMonths: 12,
				context
			});
		assert.match(String(refuse(birth('b1', 1, 'more'), [birth('b1', 7)])), /available 0 day/);
		assert.equal(refuse(birth('b2', 7, 'next'), [birth('b1', 7)]), null);
		const four = ['b1', 'b2', 'b3', 'b4'].map((event) => birth(event, 7));
		assert.match(String(refuse(birth('b5', 7, 'fifth'), four)), /available 0 day/);
		assert.match(
			String(
				refuseLeaveWrite({
					proposed: birth('b1', 1),
					classes: [paternity],
					movements: [],
					serviceMonths: 12,
					context: { employee: { gender: 'FEMALE' } }
				})
			),
			/available 0 day/
		);
	});

	it('a window_key meters an EVENT class per key (one child across births); as_of reads the day', () => {
		const childcare: LeaveClass = {
			...unpaid,
			id: catalog('cc'),
			code: 'CHILDCARE_LEAVE',
			name: 'Childcare leave',
			is_npl: false,
			// ten days a child over every birth event, fourteen from July 2026
			entitlement: {
				days: 'as_of >= "2026-07-01" ? 14.0 : 10.0',
				window: 'EVENT',
				window_key: 'entry.facts.child_id'
			}
		};
		const day = (id: string, days: number, child: string, event: string, from = '2026-03-02') => ({
			...taken('cc', days, { id, occurred_on: from, from }),
			event_id: event,
			facts: { child_id: child, event_id: event }
		});
		const refuse = (proposed: LeaveMovement, movements: LeaveMovement[]) =>
			refuseLeaveWrite({ proposed, classes: [childcare], movements, serviceMonths: 12 });
		const held = [day('a1', 4, 'A', 'e1'), day('a2', 4, 'A', 'e2'), day('b1', 2, 'B', 'e3')];
		// child A has 8 of 10 across two events; child B 2
		assert.match(String(refuse(day('a3', 3, 'A', 'e4'), held)), /available 2 day/);
		assert.equal(refuse(day('b2', 8, 'B', 'e5'), held), null);
		assert.equal(refuse(day('a4', 6, 'A', 'e6', '2026-07-06'), held), null);
	});

	it('a listing gives a window_key class one view per key, its CEL reading the key’s first entry', () => {
		const maternity: LeaveClass = {
			...unpaid,
			id: catalog('ma'),
			code: 'MATERNITY_LEAVE',
			name: 'Maternity leave',
			is_npl: false,
			// a per-birth grant: twins add thirty days to that pregnancy only
			entitlement: {
				days: 'has(entry.facts.twins) && entry.facts.twins == true ? 120.0 : 90.0',
				window: 'EVENT',
				window_key: 'entry.facts.pregnancy_id'
			}
		};
		const day = (id: string, days: number, pregnancy: string, from: string, facts = {}) => ({
			...taken('ma', days, { id, occurred_on: from, from }),
			facts: { pregnancy_id: pregnancy, ...facts }
		});
		const rows = leaveBalances({
			classes: [maternity, annual],
			movements: [
				day('p1b', 10, 'P1', '2026-03-02'),
				day('p1', 30, 'P1', '2026-01-05', { twins: true }),
				day('p2', 20, 'P2', '2027-01-04')
			],
			serviceMonths: 24
		});
		assert.deepEqual(
			rows.map((row) => [row.code, row.window_key, row.entitlement, row.taken, row.available]),
			[
				['MATERNITY_LEAVE', '', 90, 0, 90],
				['MATERNITY_LEAVE', 'P1', 120, 40, 80],
				['MATERNITY_LEAVE', 'P2', 90, 20, 70],
				['ANNUAL_LEAVE', '', 7, 0, 7]
			]
		);
	});

	it('a leave year carries a capped number of unused days into the next one', () => {
		const annualYear: LeaveClass = {
			...annual,
			id: catalog('ay'),
			entitlement: { days: '12.0', window: 'CALENDAR_YEAR', carry_forward: '5.0' }
		};
		const day = (id: string, days: number, from: string) =>
			taken('ay', days, { id, occurred_on: from, from });
		// 2025: 12 granted, 4 taken → 8 unused, of which 5 carry into 2026.
		const [balance] = leaveBalances({
			classes: [annualYear],
			movements: [day('y25', 4, '2025-05-04')],
			serviceMonths: 40,
			asOf: '2026-02-02',
			employmentStart: '2022-10-01'
		});
		assert.deepEqual([balance!.entitlement, balance!.carried, balance!.available], [12, 5, 17]);
		// Only 2 unused: 2 carry. Carried days do not roll on: 2024's surplus never reaches 2026.
		const [short] = leaveBalances({
			classes: [annualYear],
			movements: [day('y24', 0.5, '2024-03-04'), day('y25', 10, '2025-05-04')],
			serviceMonths: 40,
			asOf: '2026-02-02',
			employmentStart: '2022-10-01'
		});
		assert.equal(short!.available, 14);
		// Joined this year: nothing to carry.
		const [joiner] = leaveBalances({
			classes: [annualYear],
			movements: [],
			serviceMonths: 1,
			asOf: '2026-02-02',
			employmentStart: '2026-01-02'
		});
		assert.equal(joiner!.carried, 0);
	});
});
