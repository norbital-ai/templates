import assert from 'node:assert/strict';
import test from 'node:test';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';
import { computedEntitlement } from '../src/lib/leave/entitlement.ts';
import { leaveRules } from '../src/lib/leave/context.ts';
import { leaveBalanceSummaries } from '../src/lib/leave/summary.ts';
import { leaveBalanceAt } from '../src/lib/leave/balance.ts';
import { evaluateLeavePreview } from '../src/lib/leave/preview.ts';
import {
	annualWindow,
	approve,
	id,
	leaveContext,
	timeOff
} from './helpers/manual-leave-context.ts';

test('December-only policy supports December leave without inventing January policy or opening credits', () => {
	const context = leaveContext();
	context.versions[0]!.effective_range = { start: '2026-12-01', end: null };
	assert.equal(leaveBalanceSummaries(context, id(1), '2026-12-15')[0]?.available, 12);
	assert.deepEqual(context.entries, []);
	const entry = approve(context, timeOff('2026-12-15'));
	assert.deepEqual(
		entry.allocations.map((row) => [row.date, row.days]),
		[['2026-12-15', -1]]
	);
	assert.equal(leaveBalanceSummaries(context, id(1), '2026-12-15')[0]?.available, 11);
	assert.throws(
		() => leaveBalanceSummaries(context, id(1), '2026-11-30'),
		/No sealed settings cover 2026-11-30/
	);
	assert.throws(
		() => approve(context, timeOff('2026-11-30'), 11),
		/No sealed settings cover 2026-11-30/
	);
	assert.equal(context.entries.length, 1);
});

test('a leave type introduced midyear does not require that type in earlier settings revisions', () => {
	const context = leaveContext();
	context.versions[0]!.effective_range = { start: '2025-01-01', end: '2026-12-01' };
	context.versions.push({
		...context.versions[0]!,
		id: id(20),
		effective_range: { start: '2026-12-01', end: null }
	});
	context.catalogues[0]!.settings_id = id(20);
	assert.equal(leaveBalanceSummaries(context, id(1), '2026-12-15')[0]?.available, 12);
	assert.throws(
		() => leaveRules(context, id(1), id(7)).entitlementAt(annualWindow, '2026-11-30'),
		/No ANNUAL leave catalogue covers 2026-11-30/
	);
	assert.throws(() => approve(context, timeOff('2026-11-30')), /INELIGIBLE/);
	assert.equal(approve(context, timeOff('2026-12-15')).charges.length, 1);
});

test('a current full grant does not require unrelated future policy coverage', () => {
	const context = leaveContext();
	context.versions[0]!.effective_range = { start: '2026-01-01', end: '2026-03-01' };
	assert.equal(leaveBalanceSummaries(context, id(1), '2026-01-31')[0]?.available, 12);
	assert.equal(approve(context, timeOff('2026-01-31')).charges.length, 1);
	assert.throws(
		() => leaveBalanceSummaries(context, id(1), '2026-03-01'),
		/No sealed settings cover 2026-03-01/
	);
	assert.throws(
		() => approve(context, timeOff('2026-03-01'), 11),
		/No sealed settings cover 2026-03-01/
	);
});

test('proration counts only eligible dates covered by approved policy', () => {
	const context = leaveContext();
	context.catalogues[0]!.entitlement = {
		availability: 'UPFRONT',
		year_start_month: 1,
		proration: 'CALENDAR_MONTHS',
		bands: [{ eligibility: '', days: 12 }]
	};
	context.versions[0]!.effective_range = { start: '2026-12-01', end: null };
	assert.equal(leaveBalanceSummaries(context, id(1), '2026-12-31')[0]?.entitlement, 1);
	context.versions[0]!.effective_range = { start: '2026-01-01', end: '2026-03-01' };
	const [january] = leaveBalanceSummaries(context, id(1), '2026-01-31');
	assert.deepEqual([january?.entitlement, january?.earned, january?.available], [2, 1, 2]);
	assert.deepEqual(context.entries, []);
});

test('unmetered leave can start with a midyear policy while retaining strict actual-date validation', () => {
	const context = leaveContext();
	context.versions[0]!.effective_range = { start: '2026-12-01', end: null };
	context.catalogues[0]!.entitlement = {
		availability: 'UNLIMITED',
		year_start_month: 1,
		proration: 'NONE',
		bands: []
	};
	assert.equal(leaveBalanceSummaries(context, id(1), '2026-12-15')[0]?.available, null);
	assert.equal(approve(context, timeOff('2026-12-15')).charges.length, 1);
	assert.throws(
		() => approve(context, timeOff('2026-11-30'), 11),
		/No sealed settings cover 2026-11-30/
	);
});

test('full and unmetered entitlement never inspect eligibility after the requested date', () => {
	for (const availability of ['UPFRONT', 'UNLIMITED'] as const) {
		const inspected: string[] = [];
		const result = computedEntitlement({
			rule: {
				availability,
				year_start_month: 1,
				proration: 'NONE',
				bands: [{ eligibility: '', days: 12 }]
			},
			window: annualWindow,
			asOf: '2026-01-31',
			hireDate: '2025-01-01',
			exitDate: null,
			eligibleOn: (date) => {
				inspected.push(date);
				assert.ok(date <= '2026-01-31');
				return true;
			},
			personOn: (date) =>
				personContext({
					employee: null,
					employment: { hire_date: '2025-01-01' },
					terms: null,
					asOf: date
				})
		});
		assert.equal(inspected.at(-1), '2026-01-31');
		assert.equal(result.available, availability === 'UPFRONT' ? 12 : null);
	}
});

test('balance reservation reads actual commitments and still refuses missing evidence for a future debit', () => {
	const inspected: string[] = [];
	const result = leaveBalanceAt({
		entries: [],
		window: annualWindow,
		date: '2026-01-31',
		entitlementAt: (_window, date) => {
			inspected.push(date);
			assert.equal(date, '2026-01-31');
			return { available: 12, earned: 12 };
		}
	});
	assert.equal(result.available, 12);
	assert.ok(inspected.length > 0);
	const context = leaveContext();
	approve(context, timeOff('2026-03-05'));
	context.versions[0]!.effective_range = { start: '2026-01-01', end: '2026-03-01' };
	assert.throws(
		() => leaveBalanceSummaries(context, id(1), '2026-01-31'),
		/No sealed settings cover 2026-03-05/
	);
});

test('manual adjustments and encashment use their actual source date instead of future year-end settings', () => {
	const context = leaveContext();
	context.versions[0]!.effective_range = { start: '2026-01-01', end: '2026-03-01' };
	approve(context, {
		kind: 'ADJUSTMENT',
		window: annualWindow,
		days: 2,
		effective_on: '2026-01-31',
		reason: 'Documented additional award'
	});
	const cash = approve(
		context,
		{
			kind: 'ENCASHMENT',
			source_window: annualWindow,
			days: 1,
			gross_amount: { value: 100, currency: 'MYR' },
			rate: 100,
			effective_on: '2026-01-31',
			due_on: '2026-02-01',
			reason: 'Approved manual payment'
		},
		11
	);
	assert.equal(cash.event.kind, 'ENCASHMENT');
	assert.equal(leaveBalanceSummaries(context, id(1), '2026-01-31')[0]?.balance, 13);
	assert.equal(context.entries.length, 2);
});

test('manual carry validates its source debit and destination availability without requiring destination year-end policy', () => {
	const context = leaveContext();
	context.versions[0]!.effective_range = { start: '2025-12-01', end: '2026-03-01' };
	const carry = approve(context, {
		kind: 'CARRY_FORWARD',
		source_window: { start: '2025-01-01', end: '2025-12-31' },
		destination_window: annualWindow,
		days: 5,
		available_from: '2026-01-01',
		expires_on: '2026-03-31',
		effective_on: '2026-01-15',
		reason: 'Approved manual transfer'
	});
	assert.deepEqual(
		carry.allocations.map((row) => [row.date, row.days]),
		[
			['2025-12-31', -5],
			['2026-01-01', 5]
		]
	);
	assert.equal(leaveBalanceSummaries(context, id(1), '2026-01-31')[0]?.available, 17);
	assert.equal(context.entries.length, 1);
});

test('calendar padding and a policy’s later start do not prevent previewing its covered month', () => {
	const context = leaveContext();
	context.versions[0]!.effective_range = { start: '2026-12-15', end: null };
	const input = { employment_id: id(1), leave_catalogue_id: id(7), calendar_month: '2026-12' };
	const preview = evaluateLeavePreview(context, input);
	assert.equal(preview.remaining_days, 12);
	assert.equal(preview.availability['2026-11-30']?.eligible, false);
	assert.equal(preview.availability['2026-12-14']?.eligible, false);
	assert.equal(preview.availability['2026-12-15']?.eligible, true);
	assert.deepEqual(preview.issues, []);
	assert.throws(
		() =>
			evaluateLeavePreview(context, {
				...input,
				range: {
					start: { date: '2026-12-14', half: 'FIRST' },
					end: { date: '2026-12-15', half: 'SECOND' }
				}
			}),
		/No sealed settings cover 2026-12-14/
	);
});
