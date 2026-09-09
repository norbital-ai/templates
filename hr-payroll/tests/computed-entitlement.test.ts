import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from 'effect';
import { computedEntitlement, leaveWindowOf } from '../src/lib/leave/entitlement.ts';
import {
	leaveEntitlementValueSchema,
	type LeaveEntitlement
} from '../src/datatypes/leave_entitlement/+definition.ts';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';

const base: LeaveEntitlement = {
	availability: 'UPFRONT',
	proration: 'NONE',
	year_start_month: 1,
	bands: [
		{ eligibility: 'employment.service_months >= 24', days: 18 },
		{ eligibility: '', days: 12 }
	]
};
const personOn = (hireDate: string) => (date: string) =>
	personContext({ employee: null, employment: { hire_date: hireDate }, terms: null, asOf: date });
const calculate = (
	rule: LeaveEntitlement,
	asOf: string,
	hireDate = '2025-01-01',
	exitDate: string | null = null
) =>
	computedEntitlement({
		rule,
		asOf,
		hireDate,
		exitDate,
		window: leaveWindowOf(asOf, rule.year_start_month),
		eligibleOn: () => true,
		personOn: personOn(hireDate)
	});

test('upfront and monthly availability need no stored annual account or accrual entries', () => {
	assert.equal(calculate(base, '2026-01-01').available, 12);
	const monthly = {
		...base,
		availability: 'MONTHLY' as const,
		proration: 'CALENDAR_MONTHS' as const
	};
	assert.equal(calculate(monthly, '2026-01-30').available, 0);
	assert.equal(calculate(monthly, '2026-01-31').available, 1);
	assert.equal(calculate(monthly, '2026-06-30').available, 6);
	assert.equal(calculate(monthly, '2026-12-31').available, 12);
});

test('upfront availability and earned quantities can differ under ordinary proration', () => {
	const rule = { ...base, proration: 'COMPLETED_MONTHS' as const };
	const balance = calculate(rule, '2026-06-30');
	assert.equal(balance.available, 12);
	assert.equal(balance.earned, 6);
	const departure = calculate(rule, '2026-08-01', '2025-01-01', '2026-06-30');
	assert.equal(departure.entitlement, 6);
	assert.equal(departure.earned, 6);
});

test('joined employment, service bands and eligibility use their effective dates', () => {
	const rule = {
		...base,
		availability: 'MONTHLY' as const,
		proration: 'COMPLETED_MONTHS' as const
	};
	assert.equal(calculate(rule, '2026-07-31', '2026-07-15').earned, 0);
	assert.equal(calculate(rule, '2026-08-14', '2026-07-15').earned, 1);
	assert.equal(calculate(rule, '2026-08-14', '2026-07-15').available, 0);
	assert.equal(calculate(rule, '2026-08-31', '2026-07-15').available, 1);
	assert.equal(calculate(base, '2026-07-14', '2024-07-15').entitlement, 12);
	assert.equal(calculate(base, '2026-07-15', '2024-07-15').entitlement, 18);
	assert.equal(
		computedEntitlement({
			rule: base,
			window: leaveWindowOf('2026-01-01', 1),
			asOf: '2026-04-01',
			hireDate: '2025-01-01',
			exitDate: null,
			eligibleOn: (date) => date >= '2026-05-01',
			personOn: personOn('2025-01-01')
		}).available,
		0
	);
});

test('annual windows and day proration handle fiscal years and leap days', () => {
	assert.deepEqual(leaveWindowOf('2026-03-31', 4), { start: '2025-04-01', end: '2026-03-31' });
	assert.deepEqual(leaveWindowOf('2026-04-01', 4), { start: '2026-04-01', end: '2027-03-31' });
	const result = calculate(
		{ ...base, proration: 'CALENDAR_DAYS', bands: [{ eligibility: '', days: 366 }] },
		'2024-02-29',
		'2024-01-01'
	);
	assert.equal(result.earned, 60);
	assert.equal(result.entitlement, 366);
	assert.equal(calculate({ ...base, availability: 'UNLIMITED' }, '2026-01-01').available, null);
});

test('the catalogue schema admits no automatic carry or encashment policy', () => {
	assert.throws(() =>
		Schema.decodeUnknownSync(leaveEntitlementValueSchema)(
			{ ...base, settlement: { settlement: 'CARRY' } },
			{ onExcessProperty: 'error' }
		)
	);
});

test('a monthly release without earning rules is refused', () => {
	assert.throws(() =>
		Schema.decodeUnknownSync(leaveEntitlementValueSchema)({ ...base, availability: 'MONTHLY' })
	);
});

test('bands read top-down: the first predicate that holds is the grant, and a tier can key on grade', () => {
	const tiered: LeaveEntitlement = {
		...base,
		bands: [
			{ eligibility: 'terms.grade == "M1"', days: 20 },
			{ eligibility: 'employment.service_months >= 24', days: 18 },
			{ eligibility: '', days: 12 }
		]
	};
	const withGrade = (grade: string | null) => (date: string) =>
		personContext({
			employee: null,
			employment: { hire_date: '2020-01-01' },
			terms: { grade },
			asOf: date
		});
	const calculateFor = (grade: string | null) =>
		computedEntitlement({
			rule: tiered,
			window: leaveWindowOf('2026-01-01', 1),
			asOf: '2026-01-01',
			hireDate: '2020-01-01',
			exitDate: null,
			eligibleOn: () => true,
			personOn: withGrade(grade)
		});
	assert.equal(calculateFor('M1').entitlement, 20);
	assert.equal(calculateFor('G3').entitlement, 18);
	// The everyone row last: a general tier listed first would win for everybody.
	assert.equal(
		computedEntitlement({
			rule: { ...tiered, bands: [...tiered.bands].reverse() },
			window: leaveWindowOf('2026-01-01', 1),
			asOf: '2026-01-01',
			hireDate: '2020-01-01',
			exitDate: null,
			eligibleOn: () => true,
			personOn: withGrade('M1')
		}).entitlement,
		12
	);
	// Nobody matched is no days, not the last row.
	assert.equal(
		computedEntitlement({
			rule: { ...tiered, bands: tiered.bands.slice(0, 2) },
			window: leaveWindowOf('2026-01-01', 1),
			asOf: '2026-01-01',
			hireDate: '2025-06-01',
			exitDate: null,
			eligibleOn: () => true,
			personOn: (date) =>
				personContext({
					employee: null,
					employment: { hire_date: '2025-06-01' },
					terms: { grade: 'G3' },
					asOf: date
				})
		}).entitlement,
		0
	);
});

test('unmetered leave still requires an eligible employment date', () => {
	assert.equal(
		calculate({ ...base, availability: 'UNLIMITED' }, '2026-01-01', '2026-05-01').available,
		0
	);
	assert.equal(
		computedEntitlement({
			rule: { ...base, availability: 'UNLIMITED' },
			window: leaveWindowOf('2026-01-01', 1),
			asOf: '2026-06-01',
			hireDate: '2025-01-01',
			exitDate: null,
			eligibleOn: () => false,
			personOn: personOn('2025-01-01')
		}).available,
		0
	);
});
