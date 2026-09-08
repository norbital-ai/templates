import assert from 'node:assert/strict';
import test from 'node:test';
import {
	computedEntitlement,
	leaveWindowOf,
	assertLeaveWindow
} from '../src/lib/leave/entitlement.ts';
import { leaveRules } from '../src/lib/leave/context.ts';
import type { LeaveEntitlement } from '../src/datatypes/leave_entitlement/+definition.ts';
import { annualWindow, id, leaveContext } from './helpers/manual-leave-context.ts';

const rule: LeaveEntitlement = {
	availability: 'UPFRONT',
	year_start_month: 1,
	proration: 'CALENDAR_MONTHS',
	bands: [{ band_from: 0, days: 12 }]
};
const calculate = (overrides: Partial<Parameters<typeof computedEntitlement>[0]> = {}) =>
	computedEntitlement({
		rule,
		window: annualWindow,
		asOf: '2026-06-30',
		hireDate: '2025-01-01',
		exitDate: null,
		eligibleOn: () => true,
		...overrides
	});

test('annual windows handle fiscal starts and leap-year boundaries', () => {
	assert.deepEqual(leaveWindowOf('2026-01-15', 4), { start: '2025-04-01', end: '2026-03-31' });
	assert.deepEqual(leaveWindowOf('2024-02-29', 3), { start: '2023-03-01', end: '2024-02-29' });
	assert.deepEqual(leaveWindowOf('2026-04-01', 4), { start: '2026-04-01', end: '2027-03-31' });
	assert.throws(() => assertLeaveWindow(annualWindow, 4), /annual period/);
	assert.throws(() => leaveWindowOf('2026-02-30', 1), /valid date/);
});

test('upfront availability and earned leave are computed separately without opening or accrual writes', () => {
	const upfront = calculate();
	assert.deepEqual([upfront.entitlement, upfront.earned, upfront.available], [12, 6, 12]);
	const monthly = (asOf: string) => calculate({ rule: { ...rule, availability: 'MONTHLY' }, asOf });
	assert.equal(monthly('2026-06-29').available, 5);
	assert.equal(monthly('2026-06-30').available, 6);
	assert.equal(monthly('2026-01-01').available, 0);
});

test('late eligibility prorates the eligible months and cannot award leave before eligibility starts', () => {
	const eligibleOn = (date: string) => date >= '2026-07-10';
	const before = calculate({ eligibleOn, asOf: '2026-07-09' });
	assert.deepEqual([before.opening, before.entitlement, before.available], ['2026-07-10', 0, 0]);
	const eligible = calculate({ eligibleOn, asOf: '2026-07-31' });
	assert.deepEqual([eligible.entitlement, eligible.earned, eligible.available], [6, 1, 6]);
	assert.equal(calculate({ eligibleOn: () => false }).entitlement, 0);
});

test('completed-month proration respects hire anniversaries and departure caps', () => {
	const options = {
		rule: { ...rule, proration: 'COMPLETED_MONTHS' as const },
		hireDate: '2026-03-15',
		exitDate: '2026-08-14'
	};
	assert.deepEqual(
		[
			calculate({ ...options, asOf: '2026-04-13' }).earned,
			calculate({ ...options, asOf: '2026-04-14' }).earned
		],
		[0, 1]
	);
	const ended = calculate({ ...options, asOf: '2026-12-31' });
	assert.deepEqual([ended.entitlement, ended.earned, ended.available], [5, 5, 5]);
});

test('calendar-day proration uses the actual leap-year denominator and rounds to half days', () => {
	const result = calculate({
		rule: { ...rule, proration: 'CALENDAR_DAYS', bands: [{ band_from: 0, days: 366 }] },
		window: { start: '2024-01-01', end: '2024-12-31' },
		hireDate: '2024-02-01',
		asOf: '2024-02-29'
	});
	assert.deepEqual([result.entitlement, result.earned, result.available], [335, 29, 335]);
});

test('service bands use this contract hire date at the query date', () => {
	const serviceRule: LeaveEntitlement = {
		...rule,
		proration: 'NONE',
		bands: [
			{ band_from: 24, days: 16 },
			{ band_from: 0, days: 12 }
		]
	};
	assert.equal(
		calculate({ rule: serviceRule, hireDate: '2024-07-01', asOf: '2026-06-30' }).entitlement,
		12
	);
	assert.equal(
		calculate({ rule: serviceRule, hireDate: '2024-07-01', asOf: '2026-07-01' }).entitlement,
		16
	);
	assert.equal(
		calculate({ rule: serviceRule, hireDate: '2026-07-01', asOf: '2026-07-01' }).entitlement,
		12
	);
});

test('unlimited entitlement remains subject to eligibility and employment dates', () => {
	const unlimited: LeaveEntitlement = { ...rule, availability: 'UNLIMITED', bands: [] };
	assert.equal(calculate({ rule: unlimited }).available, null);
	assert.equal(calculate({ rule: unlimited, eligibleOn: () => false }).available, 0);
	assert.equal(calculate({ rule: unlimited, hireDate: '2026-07-01' }).available, 0);
});

test('effective catalogue revisions are resolved by date without posting adjustment entries', () => {
	const context = leaveContext();
	context.versions[0]!.effective_range = { start: '2025-01-01', end: '2026-07-01' };
	context.versions.push({
		...context.versions[0]!,
		id: id(20),
		effective_range: { start: '2026-07-01', end: null }
	});
	context.catalogues.push({
		...context.catalogues[0]!,
		id: id(21),
		settings_id: id(20),
		entitlement: { ...rule, proration: 'NONE', bands: [{ band_from: 0, days: 18 }] }
	});
	const rules = leaveRules(context, id(1), id(7));
	assert.equal(rules.entitlementAt(annualWindow, '2026-06-30').entitlement, 12);
	assert.equal(rules.entitlementAt(annualWindow, '2026-07-01').entitlement, 18);
	assert.deepEqual(context.entries, []);
});

test('person and effective contract terms determine eligibility during the annual query', () => {
	const context = leaveContext();
	context.catalogues[0]!.eligibility =
		'employee.gender == "FEMALE" && employment.type == "PERMANENT"';
	assert.equal(leaveRules(context, id(1), id(7)).eligibleOn('2026-04-01'), true);
	context.employees[0]!.gender = 'MALE';
	assert.equal(
		leaveRules(context, id(1), id(7)).entitlementAt(annualWindow, '2026-04-01').entitlement,
		0
	);
	assert.deepEqual(context.entries, [], 'changed facts do not emit annual reconciliation entries');
});

test('a catalogue can allow unlimited leave by gender and jurisdiction residency without an annual account', () => {
	const context = leaveContext();
	context.catalogues[0]!.entitlement = { ...rule, availability: 'UNLIMITED', bands: [] };
	context.catalogues[0]!.eligibility =
		'employee.gender == "MALE" && (employee.citizenship == "CITIZEN" || employee.citizenship == "PERMANENT_RESIDENT")';
	for (const [gender, residency, expected] of [
		['MALE', 'CITIZEN', null],
		['MALE', 'PERMANENT_RESIDENT', null],
		['MALE', 'FOREIGNER', 0],
		['FEMALE', 'CITIZEN', 0]
	] as const) {
		context.employees[0]!.gender = gender;
		context.terms[0]!.residency_status = residency;
		assert.equal(
			leaveRules(context, id(1), id(7)).entitlementAt(annualWindow, '2026-06-30').available,
			expected
		);
	}
	assert.deepEqual(context.entries, []);
});

test('effective child facts open computed eligibility on the relevant date without emitting leave', () => {
	const context = leaveContext();
	context.catalogues[0]!.eligibility = 'children.under(7) > 0';
	context.children.push({
		id: id(30),
		employment_id: id(1),
		child_birthdate: '2026-07-10',
		supersedes_id: null,
		effective_range: { start: '2026-07-10', end: null }
	});
	const rules = leaveRules(context, id(1), id(7));
	assert.equal(rules.eligibleOn('2026-07-09'), false);
	assert.equal(rules.eligibleOn('2026-07-10'), true);
	assert.equal(rules.entitlementAt(annualWindow, '2026-07-09').available, 0);
	assert.equal(rules.entitlementAt(annualWindow, '2026-07-10').available, 12);
	assert.deepEqual(context.entries, []);
});
