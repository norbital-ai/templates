// @ts-nocheck -- Node runs these source-backed runtime probes with type stripping.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { planLeaveActivity } from '../src/lib/leave/activity.ts';
import { leaveRules } from '../src/lib/leave/context.ts';
import { withLeaveDeductionEligibility } from '../src/lib/leave/payroll.ts';
import { calculateLeavePayroll, unpaidLeaveDays } from '../src/lib/leave/payroll.ts';
import { leaveBalanceAt } from '../src/lib/leave/balance.ts';
import { leaveWindowOf } from '../src/lib/leave/entitlement.ts';
import { leaveBalanceSummaries } from '../src/lib/leave/summary.ts';
import { exitEncashments } from '../src/lib/leave/exit-encashment.ts';
import { id, leaveContext, submission } from './helpers/manual-leave-context.ts';
import { buildStatutory, leaveCatalogue, settingsIdOn } from './fixtures/statutory-world.ts';

const leaves = JSON.parse(
	readFileSync(new URL('../seed/jurisdiction/SG/leave_catalogue.json', import.meta.url), 'utf8')
);

// MOM, "Leave for part-time employees": a 20-hour worker compared with a 40-hour, eight-hour-day
// worker is due 56 hours of the 14-day sick grant, without converting it back to days.
test('SG part-time sick entitlement is granted in hours using the declared comparator', () => {
	const context = partTimeContext();
	const rules = leaveRules(context, id(1), id(7));
	const grant = rules.entitlementAt({ start: '2026-01-01', end: '2026-12-31' }, '2026-07-01');
	assert.equal(grant.unit, 'HOUR');
	assert.equal(grant.entitlement, 56);
});

test('SG leave refuses a part-time label that conflicts with contracted weekly hours', () => {
	for (const [employment_type, ordinary_hours_per_week] of [
		['PERMANENT', 20],
		['PART_TIME', 40]
	] as const) {
		const context = partTimeContext();
		Object.assign(context.terms[0], { employment_type, ordinary_hours_per_week });
		const rules = leaveRules(context, id(1), id(7));
		assert.throws(
			() => rules.entitlementAt({ start: '2026-01-01', end: '2026-12-31' }, '2026-07-01'),
			/part-time status conflicts with contracted weekly hours/
		);
	}
});

test('SG leave approval refuses a mismatched part-time label before saving a charge', () => {
	const context = partTimeContext();
	Object.assign(context.terms[0], { employment_type: 'PERMANENT' });
	assert.throws(
		() =>
			planLeaveActivity(
				context,
				submission({ from_date: '2026-07-01', to_date: '2026-07-01', hours: 1 }),
				id(75)
			),
		/part-time status conflicts with contracted weekly hours/
	);
	assert.equal(context.entries.length, 0);
});

test('SG part-time leave rejects a part-time comparator', () => {
	const context = partTimeContext();
	Object.assign(context.terms[0], { comparable_full_time_weekly_hours: 30 });
	const rules = leaveRules(context, id(1), id(7));
	assert.throws(
		() => rules.entitlementAt({ start: '2026-01-01', end: '2026-12-31' }, '2026-07-01'),
		/comparator contracted for full-time weekly hours/
	);
});

test('SG part-time leave refuses an absent comparator with recorded comparator hours', () => {
	const context = partTimeContext();
	Object.assign(context.terms[0], { comparable_full_time_presence: 'ABSENT' });
	const rules = leaveRules(context, id(1), id(7));
	assert.throws(
		() => rules.entitlementAt({ start: '2026-01-01', end: '2026-12-31' }, '2026-07-01'),
		/absent full-time comparator cannot also state comparator hours/
	);
});

test('SG leave refuses a mixed full-time and part-time year before granting the wrong unit', () => {
	for (const startsPartTime of [true, false]) {
		const context = partTimeContext();
		const original = context.terms[0]!;
		context.terms[0] = {
			...original,
			effective_range: { start: '2025-01-01', end: '2026-06-30' },
			employment_type: startsPartTime ? 'PART_TIME' : 'PERMANENT',
			ordinary_hours_per_week: startsPartTime ? 20 : 40
		};
		context.terms.push({
			...original,
			id: id(76),
			effective_range: { start: '2026-07-01', end: null },
			employment_type: startsPartTime ? 'PERMANENT' : 'PART_TIME',
			ordinary_hours_per_week: startsPartTime ? 40 : 20
		});
		const rules = leaveRules(context, id(1), id(7));
		assert.throws(
			() => rules.entitlementAt({ start: '2026-01-01', end: '2026-12-31' }, '2026-07-01'),
			/leave year crossing part-time and full-time terms needs separate hourly accounting/
		);
	}
});

test('SG full-time sick balance still uses its day grant', () => {
	const context = partTimeContext();
	Object.assign(context.terms[0], { employment_type: 'PERMANENT', ordinary_hours_per_week: 40 });
	const rules = leaveRules(context, id(1), id(7));
	const grant = rules.entitlementAt({ start: '2026-01-01', end: '2026-12-31' }, '2026-07-01');
	assert.equal(grant.unit, 'DAY');
	assert.equal(grant.entitlement, 14);
});

/**
 * Dated attendance for every day of the fixture's years, each day covering its shift's whole paid
 * window. SG's annual balance reads the saved work-day record, so a final or exit-dated read
 * without it refuses rather than assuming presence, and a short day refuses as a partial day.
 */
function recordAttendance(context, from = '2025-01-01', to = '2027-12-31') {
	const { start_time, end_time } = context.shifts[0].variant;
	const minutes =
		Number.parseInt(end_time.slice(0, 2), 10) * 60 +
		Number.parseInt(end_time.slice(3, 5), 10) -
		(Number.parseInt(start_time.slice(0, 2), 10) * 60 +
			Number.parseInt(start_time.slice(3, 5), 10));
	const last = Date.parse(`${to}T00:00:00.000Z`);
	context.annualAttendance = [];
	for (let day = Date.parse(`${from}T00:00:00.000Z`); day <= last; day += 86_400_000) {
		const work_date = new Date(day).toISOString().slice(0, 10);
		context.annualAttendance.push({
			employment_id: id(1),
			work_date,
			shift_definition_id: id(8),
			worked_intervals: [
				{
					start: new Date(day + 60 * 60_000).toISOString(),
					end: new Date(day + (60 + minutes) * 60_000).toISOString()
				}
			]
		});
	}
}

function partTimeContext() {
	const context = leaveContext();
	Object.assign(context.companies[0], { settings_code: 'SG' });
	Object.assign(context.versions[0], { code: 'SG', jurisdiction_code: 'SG' });
	Object.assign(context.terms[0], {
		employment_type: 'PART_TIME',
		ordinary_hours_per_week: 20,
		comparable_full_time_presence: 'PRESENT',
		comparable_full_time_daily_hours: 8,
		comparable_full_time_weekly_hours: 40,
		currency: 'SGD'
	});
	Object.assign(context.shifts[0], {
		variant: { kind: 'WORK', start_time: '09:00', end_time: '13:00', break_minutes: 0 }
	});
	Object.assign(context.catalogues[0], {
		code: 'SICK_LEAVE',
		unit: 'DAY',
		can_encash: false,
		entitlement: leaves.find((leave) => leave.code === 'SICK_LEAVE').entitlement
	});
	recordAttendance(context);
	return context;
}

test('SG part-time request saves exact hour charge and debit, and reduces the hour balance', () => {
	const context = partTimeContext();
	const plan = planLeaveActivity(
		context,
		submission({ from_date: '2026-07-01', to_date: '2026-07-01', hours: 1.25 }),
		id(70)
	);
	assert.equal(plan.charges[0].hours, 1.25);
	assert.equal(plan.charges[0].days, 0.3125);
	assert.equal(plan.allocations[0].hours, -1.25);
	assert.equal(plan.allocations[0].days, 0);
	context.entries.push({ ...plan, id: id(70), approval_id: null });
	const rules = leaveRules(context, id(1), id(7));
	assert.equal(
		leaveBalanceAt({
			entries: context.entries,
			window: { start: '2026-01-01', end: '2026-12-31' },
			date: '2026-07-01',
			entitlementAt: rules.entitlementAt
		}).available,
		54.75
	);
});

test('SG part-time annual leave carries earned hours into the next leave year', () => {
	const context = partTimeContext();
	context.employments[0].effective_range = { start: '2026-01-01', end: null };
	Object.assign(context.catalogues[0], {
		code: 'ANNUAL_LEAVE',
		can_encash: true,
		entitlement: leaves.find((leave) => leave.code === 'ANNUAL_LEAVE').entitlement
	});
	const rules = leaveRules(context, id(1), id(7));
	const source = { start: '2026-01-01', end: '2026-12-31' };
	const destination = { start: '2027-01-01', end: '2027-12-31' };
	const before = leaveBalanceAt({
		entries: context.entries,
		window: source,
		date: source.end,
		entitlementAt: rules.entitlementAt
	}).balance;
	const plan = planLeaveActivity(
		context,
		submission({
			from_date: source.start,
			to_date: source.end,
			destination_from: destination.start,
			destination_to: destination.end,
			available_from: destination.start,
			expires_on: destination.end,
			effective_on: destination.start,
			days: null,
			hours: 2.5,
			reason: 'Unused annual leave'
		}),
		id(77)
	);
	assert.equal(plan.allocations[0].days, 0);
	assert.equal(plan.allocations[0].hours, -2.5);
	context.entries.push({ ...plan, id: id(77), approval_id: null });
	assert.equal(
		leaveBalanceAt({
			entries: context.entries,
			window: source,
			date: source.end,
			entitlementAt: rules.entitlementAt
		}).balance,
		before - 2.5
	);
	assert.equal(
		leaveBalanceAt({
			entries: context.entries,
			window: destination,
			date: destination.start,
			entitlementAt: rules.entitlementAt
		}).balance,
		before
	);
	assert.throws(
		() =>
			planLeaveActivity(
				context,
				submission(
					{
						from_date: source.start,
						to_date: source.end,
						destination_from: destination.start,
						destination_to: destination.end,
						available_from: destination.start,
						expires_on: destination.end,
						effective_on: destination.start,
						days: 1,
						reason: 'Wrong unit'
					},
					'WRONG-CARRY-UNIT'
				),
				id(78)
			),
		/leave balance unit/
	);
	const reversal = planLeaveActivity(
		context,
		submission(
			{
				as_adjustment_entry: true,
				reversal_of_id: id(77),
				effective_on: destination.start,
				reason: 'Carry entered in error'
			},
			'REVERSE-CARRY'
		),
		id(82)
	);
	assert.equal(
		reversal.allocations.reduce((sum, row) => sum + (row.hours ?? 0), 0),
		0
	);
	context.entries.push({ ...reversal, id: id(82), approval_id: null });
	assert.equal(
		leaveBalanceAt({
			entries: context.entries,
			window: source,
			date: source.end,
			entitlementAt: rules.entitlementAt
		}).balance,
		before
	);
	assert.equal(
		leaveBalanceAt({
			entries: context.entries,
			window: destination,
			date: destination.start,
			entitlementAt: rules.entitlementAt
		}).balance,
		before
	);
});

test('SG annual leave automatically carries the service-year balance once', () => {
	const context = partTimeContext();
	context.employments[0].effective_range = { start: '2025-03-14', end: null };
	context.annualAttendance = Array.from({ length: 730 }, (_, index) => ({
		employment_id: id(1),
		work_date: new Date(Date.UTC(2025, 2, 14 + index)).toISOString().slice(0, 10),
		shift_definition_id: id(8),
		worked_intervals: [
			{
				start: new Date(Date.UTC(2025, 2, 14 + index, 9)).toISOString(),
				end: new Date(Date.UTC(2025, 2, 14 + index, 18)).toISOString()
			}
		]
	}));
	Object.assign(context.catalogues[0], {
		code: 'ANNUAL_LEAVE',
		can_encash: true,
		entitlement: leaves.find((leave) => leave.code === 'ANNUAL_LEAVE').entitlement
	});
	const rules = leaveRules(context, id(1), id(7));
	const rule = context.catalogues[0].entitlement;
	const prior = leaveWindowOf('2026-03-13', rule, rules.hire);
	const current = leaveWindowOf('2026-03-14', rule, rules.hire);
	assert.deepEqual(prior, { start: '2025-03-14', end: '2026-03-13' });
	assert.deepEqual(current, { start: '2026-03-14', end: '2027-03-13' });
	const carried = rules.entitlementAt(prior, prior.end).earned;
	assert.ok(carried > 0);
	assert.equal(
		leaveBalanceAt({
			entries: context.entries,
			window: current,
			date: current.start,
			entitlementAt: rules.entitlementAt
		}).available,
		carried
	);
	const timeOff = planLeaveActivity(
		context,
		submission({ from_date: '2026-03-16', to_date: '2026-03-16', hours: 1.5 }),
		id(85)
	);
	assert.equal(timeOff.allocations[0].hours, -1.5);
	assert.equal(timeOff.allocations[0].original_date, prior.end);
	assert.notEqual(timeOff.allocations[0].credit_entry_id, null);
	context.entries.push({ ...timeOff, id: id(85), approval_id: null });
	assert.equal(
		leaveBalanceAt({
			entries: context.entries,
			window: current,
			date: '2026-03-16',
			entitlementAt: rules.entitlementAt
		}).balance,
		carried - 1.5
	);
	const next = leaveWindowOf('2027-03-14', rule, rules.hire);
	assert.equal(
		leaveBalanceAt({
			entries: context.entries,
			window: next,
			date: next.start,
			entitlementAt: rules.entitlementAt
		}).balance,
		rules.entitlementAt(current, current.end).earned
	);
	// A late correction that takes the whole prior-year balance back cannot be saved: the carry
	// it funded is what the 1.5 hours above already spent, so the credit that allocation names is
	// no longer there. The refusal names that, where it once read as a bare overdraw.
	assert.throws(
		() =>
			planLeaveActivity(
				context,
				submission(
					{
						from_date: prior.start,
						to_date: prior.end,
						effective_on: prior.end,
						hours: -carried,
						reason: 'Late correction of the prior year'
					},
					'PRIOR-CORRECTION'
				),
				id(88)
			),
		/missing or unapproved carry credit/
	);
	const pending = planLeaveActivity(
		context,
		submission({ from_date: prior.end, to_date: prior.end, hours: 1 }, 'PRIOR-PENDING'),
		id(86)
	);
	context.entries.push({ ...pending, id: id(86), approval_id: id(87) });
	assert.throws(
		() =>
			leaveBalanceAt({
				entries: context.entries,
				window: current,
				date: current.start,
				entitlementAt: rules.entitlementAt
			}),
		/pending leave in the prior year/
	);
});

test('SG annual leave needs the no-pay request origin and excludes approved requested days', () => {
	const context = partTimeContext();
	Object.assign(context.terms[0], {
		employment_type: 'PERMANENT',
		ordinary_hours_per_week: 40
	});
	Object.assign(context.catalogues[0], {
		code: 'ANNUAL_LEAVE',
		entitlement: {
			...leaves.find((leave) => leave.code === 'ANNUAL_LEAVE').entitlement,
			bands: [{ eligibility: '', days: 12 }]
		}
	});
	context.catalogues.push({
		...context.catalogues[0],
		id: id(89),
		code: 'UNPAID_LEAVE',
		is_npl: true
	});
	for (const [index, month] of ['01', '02', '03', '04'].entries()) {
		const date = `2025-${month}-10`;
		context.entries.push({
			...submission({ from_date: date, to_date: date }, `NPL-${month}`),
			id: id(90 + index),
			catalogue_id: id(89),
			leave_code: 'UNPAID_LEAVE',
			charges: [{ date, days: 1, catalogue_id: id(89), employment_term_id: id(4) }],
			allocations: [],
			approval_id: null
		});
	}
	const rules = leaveRules(context, id(1), id(7));
	assert.throws(
		() =>
			rules.entitlementAt(
				leaveWindowOf('2025-04-30', context.catalogues[0].entitlement, rules.hire),
				'2025-04-30'
			),
		/request origin/
	);
	for (const entry of context.entries) Object.assign(entry, { no_pay_origin: 'OTHER' });
	assert.throws(
		() =>
			leaveRules(context, id(1), id(7)).entitlementAt(
				leaveWindowOf('2025-04-30', context.catalogues[0].entitlement, rules.hire),
				'2025-04-30'
			),
		/other-origin no-pay leave service basis/
	);
	for (const entry of context.entries)
		Object.assign(entry, { no_pay_origin: 'EMPLOYEE_REQUESTED' });
	assert.equal(
		leaveRules(context, id(1), id(7)).entitlementAt(
			leaveWindowOf('2025-04-30', context.catalogues[0].entitlement, rules.hire),
			'2025-04-30'
		).available,
		3
	);
	assert.throws(
		() =>
			leaveRules(context, id(1), id(7)).entitlementAt(
				leaveWindowOf('2026-04-30', context.catalogues[0].entitlement, rules.hire),
				'2026-04-30'
			),
		/shifted service year/
	);
	Object.assign(context.entries[0].charges[0], { days: 0.5 });
	assert.throws(
		() =>
			leaveRules(context, id(1), id(7)).entitlementAt(
				leaveWindowOf('2025-04-30', context.catalogues[0].entitlement, rules.hire),
				'2025-04-30'
			),
		/partial no-pay leave/
	);
});

test('SG no-pay approval refuses to leave previously used annual credit underfunded', () => {
	const context = partTimeContext();
	Object.assign(context.terms[0], {
		employment_type: 'PERMANENT',
		ordinary_hours_per_week: 40
	});
	Object.assign(context.catalogues[0], {
		code: 'ANNUAL_LEAVE',
		entitlement: {
			...leaves.find((leave) => leave.code === 'ANNUAL_LEAVE').entitlement,
			bands: [{ eligibility: '', days: 12 }]
		}
	});
	context.catalogues.push({
		...context.catalogues[0],
		id: id(89),
		code: 'UNPAID_LEAVE',
		is_npl: true,
		entitlement: leaves.find((leave) => leave.code === 'UNPAID_LEAVE').entitlement
	});
	context.entries.push({
		id: id(95),
		employment_id: id(1),
		catalogue_id: id(7),
		leave_code: 'ANNUAL_LEAVE',
		reference: 'FULL-YEAR-DEBIT',
		from_date: '2025-01-01',
		to_date: '2025-12-31',
		effective_on: '2025-12-31',
		days: -12,
		charges: [],
		allocations: [
			{
				window: { start: '2025-01-01', end: '2025-12-31' },
				date: '2025-12-31',
				days: -12,
				credit_entry_id: null
			}
		],
		approval_id: null,
		payslip_id: null
	});
	assert.throws(
		() =>
			planLeaveActivity(
				context,
				{
					...submission(
						{
							from_date: '2025-06-02',
							to_date: '2025-06-02',
							no_pay_origin: 'EMPLOYEE_REQUESTED'
						},
						'NPL-UNDERFUNDS'
					),
					catalogue_id: id(89)
				},
				id(96)
			),
		/reduces the ANNUAL_LEAVE balance below existing usage/
	);
});

test('SG part-time manual hour credits and debits change only the hour balance', () => {
	const context = partTimeContext();
	const rules = leaveRules(context, id(1), id(7));
	const window = { start: '2026-01-01', end: '2026-12-31' };
	const before = leaveBalanceAt({
		entries: context.entries,
		window,
		date: '2026-07-01',
		entitlementAt: rules.entitlementAt
	}).balance;
	for (const [hours, entryId] of [
		[1.5, id(79)],
		[-0.5, id(80)]
	] as const) {
		const plan = planLeaveActivity(
			context,
			submission(
				{
					from_date: window.start,
					to_date: window.end,
					effective_on: '2026-07-01',
					days: null,
					hours,
					reason: 'Documented balance correction'
				},
				`ADJUST-${entryId}`
			),
			entryId
		);
		assert.equal(
			plan.allocations.reduce((sum, row) => sum + row.days, 0),
			0
		);
		assert.equal(
			plan.allocations.reduce((sum, row) => sum + (row.hours ?? 0), 0),
			hours
		);
		context.entries.push({ ...plan, id: entryId, approval_id: null });
	}
	assert.equal(
		leaveBalanceAt({
			entries: context.entries,
			window,
			date: '2026-07-01',
			entitlementAt: rules.entitlementAt
		}).balance,
		before + 1
	);
	assert.throws(
		() =>
			planLeaveActivity(
				context,
				submission({
					from_date: window.start,
					to_date: window.end,
					effective_on: '2026-07-01',
					days: 1,
					reason: 'Wrong unit'
				}),
				id(81)
			),
		/leave balance unit/
	);
});

test('SG payroll accepts approved hourly carry and adjustment allocations', () => {
	const context = partTimeContext();
	context.employments[0].effective_range = { start: '2026-01-01', end: null };
	Object.assign(context.catalogues[0], {
		code: 'ANNUAL_LEAVE',
		can_encash: true,
		entitlement: leaves.find((leave) => leave.code === 'ANNUAL_LEAVE').entitlement
	});
	const carry = planLeaveActivity(
		context,
		submission(
			{
				from_date: '2026-01-01',
				to_date: '2026-12-31',
				destination_from: '2027-01-01',
				destination_to: '2027-12-31',
				available_from: '2027-01-01',
				expires_on: '2027-12-31',
				effective_on: '2027-01-01',
				hours: 2,
				reason: 'Carry'
			},
			'PAYROLL-CARRY'
		),
		id(83)
	);
	context.entries.push({ ...carry, id: id(83), approval_id: null });
	const adjustment = planLeaveActivity(
		context,
		submission(
			{
				from_date: '2027-01-01',
				to_date: '2027-12-31',
				effective_on: '2027-07-01',
				hours: 1,
				reason: 'Documented credit'
			},
			'PAYROLL-ADJUSTMENT'
		),
		id(84)
	);
	const entries = [...context.entries, { ...adjustment, id: id(84), approval_id: null }];
	assert.doesNotThrow(() =>
		withLeaveDeductionEligibility(
			{ entries, catalogues: context.catalogues, captures: [], schemes: [] },
			{
				employment: context.employments[0],
				servicePeriods: [{ start: '2025-01-01', end: null }],
				employee: context.employees[0],
				configuration: {
					company: { id: id(3), settings_code: 'SG', facts: {} },
					recordedCompanyFacts: {},
					companyFactRevisions: [],
					lineageVersions: context.versions,
					patternById: new Map(context.patterns.map((row) => [row.id, row])),
					shiftById: new Map(context.shifts.map((row) => [row.id, row]))
				},
				statutoryFacts: [],
				terms: context.terms
			}
		)
	);
});

test('SG payroll refuses an older day-only part-time absence before pricing a payslip', () => {
	const context = partTimeContext();
	Object.assign(context.catalogues[0], {
		code: 'UNPAID_LEAVE',
		is_npl: true,
		entitlement: leaves.find((leave) => leave.code === 'UNPAID_LEAVE').entitlement
	});
	const entry = {
		id: id(70),
		employment_id: id(1),
		catalogue_id: id(7),
		leave_code: 'UNPAID_LEAVE',
		no_pay_origin: 'EMPLOYEE_REQUESTED',
		from_date: '2026-07-01',
		to_date: '2026-07-01',
		charges: [
			{
				date: '2026-07-01',
				days: 0.375,
				catalogue_id: id(7),
				employment_term_id: id(4)
			}
		],
		allocations: [],
		approval_id: null,
		payslip_id: null
	};
	const prepared = {
		entries: [entry],
		catalogues: context.catalogues,
		captures: [],
		schemes: []
	};
	assert.throws(
		() =>
			withLeaveDeductionEligibility(prepared, {
				employment: context.employments[0],
				servicePeriods: [{ start: '2025-01-01', end: null }],
				employee: context.employees[0],
				configuration: {
					company: { id: id(3), settings_code: 'SG', facts: {} },
					recordedCompanyFacts: {},
					companyFactRevisions: [],
					lineageVersions: context.versions,
					patternById: new Map(context.patterns.map((row) => [row.id, row])),
					shiftById: new Map(context.shifts.map((row) => [row.id, row]))
				},
				statutoryFacts: [],
				terms: context.terms
			}),
		/hourly leave needs a saved hour charge/i
	);
	assert.equal(entry.payslip_id, null);
});

// MOM, "Encashing annual leave": even by agreement, cash-in-hourly-rate is unavailable where
// the employee works at least five days and 30–34 hours a week.
test('SG five-day, 32-hour part-timer cannot encash annual leave', () => {
	const context = partTimeContext();
	Object.assign(context.terms[0], { ordinary_hours_per_week: 32 });
	Object.assign(context.shifts[0], {
		variant: { kind: 'WORK', start_time: '09:00', end_time: '15:24', break_minutes: 0 }
	});
	context.shifts.push(
		{
			id: id(81),
			company_id: id(3),
			effective_range: { start: '2025-01-01', end: null },
			variant: { kind: 'OFF' }
		},
		{
			id: id(82),
			company_id: id(3),
			effective_range: { start: '2025-01-01', end: null },
			variant: { kind: 'REST' }
		}
	);
	context.patterns[0].pattern = {
		days: [id(8), id(8), id(8), id(8), id(8), id(81), id(82)].map((roster_code_id) => ({
			roster_code_id
		}))
	};
	// The attendance follows the longer 09:00–15:24 day this test sets.
	recordAttendance(context);
	Object.assign(context.catalogues[0], {
		code: 'ANNUAL_LEAVE',
		unit: 'DAY',
		can_encash: true,
		entitlement: leaves.find((leave) => leave.code === 'ANNUAL_LEAVE').entitlement
	});
	assert.throws(
		() =>
			planLeaveActivity(
				context,
				submission({
					from_date: '2026-01-01',
					to_date: '2026-12-31',
					encash_days: 1,
					effective_on: '2026-08-01',
					due_on: '2026-08-31',
					reason: 'Contractual cashout'
				}),
				id(71)
			),
		/same day or hour unit as its leave balance/
	);
});

test('SG agreed annual-leave incorporation cannot be saved as a one-off hourly cash-out', () => {
	const context = partTimeContext();
	Object.assign(context.catalogues[0], {
		code: 'ANNUAL_LEAVE',
		can_encash: true,
		entitlement: leaves.find((leave) => leave.code === 'ANNUAL_LEAVE').entitlement
	});
	assert.throws(
		() =>
			planLeaveActivity(
				context,
				submission({
					from_date: '2026-01-01',
					to_date: '2026-12-31',
					encash_hours: 1,
					effective_on: '2026-08-01',
					due_on: '2026-08-31',
					reason: 'Agreement to incorporate annual leave in the hourly rate'
				}),
				id(74)
			),
		/recorded employment departure/
	);
	assert.equal(context.entries.length, 0);
});

test('SG hourly unpaid leave prices the saved hours at the dated gross hourly rate', () => {
	const context = partTimeContext();
	Object.assign(context.catalogues[0], {
		code: 'UNPAID_LEAVE',
		is_npl: true,
		entitlement: leaves.find((leave) => leave.code === 'UNPAID_LEAVE').entitlement
	});
	context.catalogues.push({
		...context.catalogues[0],
		id: id(88),
		code: 'ANNUAL_LEAVE',
		is_npl: false,
		entitlement: leaves.find((leave) => leave.code === 'ANNUAL_LEAVE').entitlement
	});
	const plan = planLeaveActivity(
		context,
		submission({
			from_date: '2026-07-01',
			to_date: '2026-07-01',
			hours: 1.25,
			no_pay_origin: 'EMPLOYEE_REQUESTED'
		}),
		id(72)
	);
	const entry = { ...plan, id: id(72), approval_id: null };
	const prepared = {
		entries: [entry],
		catalogues: context.catalogues,
		captures: [],
		deductionEligibility: { [`${id(72)}/2026-07-01`]: true }
	};
	const measured = calculateLeavePayroll({
		prepared,
		window: { start: '2026-07-01', end: '2026-07-31' },
		dueThrough: '2026-07-31',
		currency: 'SGD',
		absenceRate: () => {
			throw new Error('Day rate must not price hourly leave.');
		},
		absenceHourlyRate: () => 10,
		encashmentRate: () => 0
	});
	assert.equal(measured.adjustments[0].amount, 12.5);
	assert.equal(measured.adjustments[0].quantity, 1.25);
	assert.equal(unpaidLeaveDays(prepared, { start: '2026-07-01', end: '2026-07-31' }), 0.3125);
	assert.equal(unpaidLeaveDays(prepared, { start: '2026-07-01', end: '2026-07-31' }, true), 0);
});

test('SG saved hourly absence deducts basic and gross allowance once, leaving travel allowance whole', () => {
	const settingsId = settingsIdOn('SG', '2026-01-15');
	const unpaid = leaveCatalogue('SG').find(
		(row) => row.settings_id === settingsId && row.code === 'UNPAID_LEAVE'
	)!;
	const shiftAllowanceId = 'c1000000-0000-4000-8000-000000000011';
	const travelAllowanceId = 'c1000000-0000-4000-8000-000000000012';
	const priced = (classifyTravel: boolean) =>
		buildStatutory(
			{
				code: 'SG',
				period: '2026-01',
				people: [
					{
						key: 'HOURLY-NPL',
						wage: 1040,
						employment_type: 'PART_TIME',
						ordinary_hours_per_week: 20
					}
				]
			},
			(world) => {
				const term = world.employment_terms[0]!;
				term.comparable_full_time_presence = 'PRESENT';
				term.comparable_full_time_daily_hours = 8;
				term.comparable_full_time_weekly_hours = 40;
				term.allowances = [
					{ catalogue_id: shiftAllowanceId, amount: 260 },
					{ catalogue_id: travelAllowanceId, amount: 100 }
				];
				world.shift_definitions[0]!.variant = {
					kind: 'WORK',
					start_time: '09:00',
					end_time: '13:00',
					break_minutes: 0
				};
				if (classifyTravel)
					world.jurisdiction_settings = world.jurisdiction_settings.map((row) =>
						row.id === settingsId
							? { ...row, work_rules: { ...row.work_rules, gross_excluded_allowances: ['TRAVEL'] } }
							: row
					);
				world.allowance_catalogue.push(
					{
						id: shiftAllowanceId,
						settings_id: settingsId,
						code: 'SHIFT',
						name: 'Shift',
						eligibility: '',
						destination: 'PAY',
						direction: 'ADD',
						bands: [{ when: '', amount: 'entry.amount', limit: null }],
						counts_toward: [],
						approval_id: null
					},
					{
						id: travelAllowanceId,
						settings_id: settingsId,
						code: 'TRAVEL',
						name: 'Travel',
						eligibility: '',
						destination: 'PAY',
						direction: 'ADD',
						npl_prorates: false,
						bands: [{ when: '', amount: 'entry.amount', limit: null }],
						counts_toward: [],
						approval_id: null
					}
				);
				world.leave_catalogue.push(unpaid);
				world.leave_entries.push({
					id: 'e1000000-0000-4000-8000-000000000001',
					employment_id: world.employments[0]!.id,
					catalogue_id: unpaid.id,
					leave_code: 'UNPAID_LEAVE',
					no_pay_origin: 'EMPLOYEE_REQUESTED',
					reference: 'PT-NPL',
					from_date: '2026-01-14',
					to_date: '2026-01-14',
					effective_on: '2026-01-14',
					half_day_start: false,
					half_day_end: false,
					days: 0.3125,
					reason: 'Unpaid',
					allocations: [],
					approval_id: null,
					charges: [
						{
							date: '2026-01-14',
							days: 0.3125,
							hours: 1.25,
							catalogue_id: unpaid.id,
							employment_term_id: term.id,
							shift_definition_id: world.shift_definitions[0]!.id,
							holiday_id: null,
							work_day_id: null
						}
					]
				});
			}
		);
	const built = priced(true);
	const slip = built.slips.get('HOURLY-NPL')!;
	assert.equal(
		slip.adjustments.find((row) => row.component_code === 'UNPAID_LEAVE')?.amount,
		18.75
	);
	assert.equal(
		built.allowances.get('HOURLY-NPL')!.find((row) => row.component_code === 'SHIFT')
			?.prorated_amount,
		260
	);
	assert.equal(
		built.allowances.get('HOURLY-NPL')!.find((row) => row.component_code === 'TRAVEL')
			?.prorated_amount,
		100
	);
	assert.equal(slip.gross, 1381.25);
	assert.throws(() => priced(false), /gross-rate classification for allowance TRAVEL/);
});

test('SG outpatient sick leave excludes classified shift allowance and refuses an unclassified one', () => {
	const settingsId = settingsIdOn('SG', '2026-01-15');
	const sick = leaveCatalogue('SG').find(
		(row) => row.settings_id === settingsId && row.code === 'SICK_LEAVE'
	)!;
	const shiftId = 'c1000000-0000-4000-8000-000000000021';
	const ordinaryId = 'c1000000-0000-4000-8000-000000000022';
	const priced = (classifyShift: boolean) =>
		buildStatutory(
			{
				code: 'SG',
				period: '2026-01',
				people: [
					{
						key: 'SICK-HOURS',
						wage: 1040,
						employment_type: 'PART_TIME',
						ordinary_hours_per_week: 20
					}
				]
			},
			(world) => {
				const term = world.employment_terms[0]!;
				term.comparable_full_time_presence = 'PRESENT';
				term.comparable_full_time_daily_hours = 8;
				term.comparable_full_time_weekly_hours = 40;
				term.allowances = [
					{ catalogue_id: shiftId, amount: 260 },
					{ catalogue_id: ordinaryId, amount: 100 }
				];
				world.shift_definitions[0]!.variant = {
					kind: 'WORK',
					start_time: '09:00',
					end_time: '13:00',
					break_minutes: 0
				};
				world.allowance_catalogue.push(
					{
						id: shiftId,
						settings_id: settingsId,
						code: 'SHIFT',
						name: 'Shift',
						eligibility: '',
						destination: 'PAY',
						direction: 'ADD',
						...(classifyShift ? { outpatient_sick_pay: 'EXCLUDE' } : {}),
						bands: [{ when: '', amount: 'entry.amount', limit: null }],
						counts_toward: [],
						approval_id: null
					},
					{
						id: ordinaryId,
						settings_id: settingsId,
						code: 'ORDINARY',
						name: 'Ordinary',
						eligibility: '',
						destination: 'PAY',
						direction: 'ADD',
						outpatient_sick_pay: 'INCLUDE',
						bands: [{ when: '', amount: 'entry.amount', limit: null }],
						counts_toward: [],
						approval_id: null
					}
				);
				world.leave_catalogue.push(sick);
				world.leave_entries.push({
					id: 'e1000000-0000-4000-8000-000000000021',
					employment_id: world.employments[0]!.id,
					catalogue_id: sick.id,
					leave_code: 'SICK_LEAVE',
					reference: 'PT-SICK',
					from_date: '2026-01-14',
					to_date: '2026-01-14',
					effective_on: '2026-01-14',
					half_day_start: false,
					half_day_end: false,
					days: 0.3125,
					reason: 'Medical certificate',
					allocations: [],
					approval_id: null,
					charges: [
						{
							date: '2026-01-14',
							days: 0.3125,
							hours: 1.25,
							catalogue_id: sick.id,
							employment_term_id: term.id,
							shift_definition_id: world.shift_definitions[0]!.id,
							holiday_id: null,
							work_day_id: null
						}
					]
				});
			}
		);
	const slip = priced(true).slips.get('SICK-HOURS')!;
	assert.equal(slip.adjustments.find((row) => row.component_code === 'SICK_LEAVE')?.amount, 3.75);
	assert.equal(slip.gross, 1396.25);
	assert.throws(() => priced(false), /allowance SHIFT classified as included or excluded/);
});

test('SG departure raises, allocates and prices unused annual leave in hours', () => {
	const context = partTimeContext();
	Object.assign(context.catalogues[0], {
		code: 'ANNUAL_LEAVE',
		can_encash: true,
		encash_on_exit: true,
		entitlement: leaves.find((leave) => leave.code === 'ANNUAL_LEAVE').entitlement
	});
	context.employments[0].effective_range = { start: '2025-01-01', end: '2026-08-31' };
	const [submission] = exitEncashments({
		employmentId: id(1),
		exitDate: '2026-08-31',
		summaries: leaveBalanceSummaries(context, id(1), '2026-08-31'),
		encashable: new Set([id(7)]),
		posted: new Set(),
		reason: 'Departure'
	});
	assert.ok(submission.encash_hours > 0);
	assert.equal(submission.encash_days, undefined);
	const plan = planLeaveActivity(context, submission, id(73));
	assert.equal(plan.encash_hours, submission.encash_hours);
	assert.equal(
		plan.allocations.reduce((sum, row) => sum - (row.hours ?? 0), 0),
		submission.encash_hours
	);
	const measured = calculateLeavePayroll({
		prepared: {
			entries: [{ ...plan, id: id(73), approval_id: null }],
			catalogues: context.catalogues,
			captures: [],
			deductionEligibility: {}
		},
		window: { start: '2026-08-01', end: '2026-08-31' },
		dueThrough: '2026-08-31',
		currency: 'SGD',
		absenceRate: () => 0,
		encashmentRate: () => 10
	});
	assert.equal(measured.adjustments[0].quantity, submission.encash_hours);
	assert.equal(measured.adjustments[0].amount, Math.round(submission.encash_hours * 1000) / 100);
});
