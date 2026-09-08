import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from 'effect';
import { computedEntitlement, leaveWindowOf } from '../src/lib/leave/entitlement.ts';
import {
	leaveEntitlementValueSchema,
	type LeaveEntitlement
} from '../src/datatypes/leave_entitlement/+definition.ts';

const base: LeaveEntitlement = {
	availability: 'UPFRONT',
	proration: 'NONE',
	year_start_month: 1,
	bands: [
		{ band_from: 0, days: 12 },
		{ band_from: 24, days: 18 }
	]
};
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
		eligibleOn: () => true
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
			eligibleOn: (date) => date >= '2026-05-01'
		}).available,
		0
	);
});

test('annual windows and day proration handle fiscal years and leap days', () => {
	assert.deepEqual(leaveWindowOf('2026-03-31', 4), { start: '2025-04-01', end: '2026-03-31' });
	assert.deepEqual(leaveWindowOf('2026-04-01', 4), { start: '2026-04-01', end: '2027-03-31' });
	const result = calculate(
		{ ...base, proration: 'CALENDAR_DAYS', bands: [{ band_from: 0, days: 366 }] },
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

test('ambiguous service bands and a monthly release without earning rules are refused', () => {
	assert.throws(() =>
		Schema.decodeUnknownSync(leaveEntitlementValueSchema)({
			...base,
			bands: [
				{ band_from: 0, days: 12 },
				{ band_from: 0, days: 20 }
			]
		})
	);
	assert.throws(() =>
		Schema.decodeUnknownSync(leaveEntitlementValueSchema)({ ...base, availability: 'MONTHLY' })
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
			eligibleOn: () => false
		}).available,
		0
	);
});
