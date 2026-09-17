import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from 'effect';
import {
	calculateLeavePayroll,
	hasLeavePayment,
	leaveCoverage,
	type PreparedLeavePayroll
} from '../src/lib/leave/payroll.ts';
import { leavePayItemsValueSchema } from '../src/datatypes/leave_pay_items/+definition.ts';
import type { LeaveActivity } from '../src/lib/leave/pending.ts';
import type { LeaveCharge } from '../src/datatypes/leave_charges/+definition.ts';
import type { LeaveEntryActivity } from '../src/lib/leave/activity-fields.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const year = { start: '2026-01-01', end: '2026-12-31' };
const december = { start: '2026-12-01', end: '2026-12-31' };
const january = { start: '2027-01-01', end: '2027-01-31' };
const catalogue: PreparedLeavePayroll['catalogues'][number] = {
	id: id(1),
	settings_id: id(2),
	code: 'UNPAID',
	name: 'Unpaid leave',
	eligibility: '',
	entitlement: { availability: 'UNLIMITED', year_start_month: 1, proration: 'NONE', bands: [] },
	evidence_after_days: null,
	is_npl: true,
	can_encash: false
};
function charge(date: string, days: 0.5 | 1 = 1): LeaveCharge {
	return {
		date,
		days,
		catalogue_id: id(1),
		employment_term_id: id(3),
		holiday_id: null,
		shift_definition_id: id(5),
		work_day_id: null
	};
}
function entry(n: number, fields: LeaveEntryActivity, charges: LeaveCharge[] = []): LeaveActivity {
	return {
		id: id(n),
		employment_id: id(6),
		catalogue_id: id(1),
		leave_code: 'UNPAID',
		reference: `manual-${n}`,
		from_date: null,
		to_date: null,
		half_day_start: null,
		half_day_end: null,
		days: null,
		encash_days: null,
		as_adjustment_entry: false,
		reversal_of_id: null,
		effective_on: null,
		due_on: null,
		destination_from: null,
		destination_to: null,
		available_from: null,
		expires_on: null,
		reason: null,
		...fields,
		charges,
		allocations: [],
		approval_id: null,
		payslip_id: null
	};
}
const timeOff = (n: number, charges: LeaveCharge[]) =>
	entry(
		n,
		{
			from_date: charges[0]!.date,
			to_date: charges.at(-1)!.date,
			half_day_start: false,
			half_day_end: charges.at(-1)!.days === 1,
			days: charges.reduce((sum, row) => sum + row.days, 0),
			effective_on: charges[0]!.date,
			reason: 'Approved absence'
		},
		charges
	);
const cash = (n: number, days = 2) =>
	entry(n, {
		from_date: year.start,
		to_date: year.end,
		days,
		encash_days: days,
		effective_on: '2027-01-02',
		due_on: '2027-01-10',
		reason: 'Agreed after departure'
	});
function prepared(
	entries: LeaveActivity[],
	extra: Partial<PreparedLeavePayroll> = {}
): PreparedLeavePayroll {
	return {
		entries,
		catalogues: [catalogue],
		captures: [],
		deductionEligibility: Object.fromEntries(
			entries.flatMap((row) => row.charges.map((charge) => [`${row.id}/${charge.date}`, true]))
		),
		...extra
	};
}
const calculate = (facts: PreparedLeavePayroll, window = january, rate = 100) =>
	calculateLeavePayroll({
		prepared: facts,
		window,
		dueThrough: window.end,
		currency: 'MYR',
		absenceRate: () => rate,
		ordinaryDayRate: () => rate
	});

test('cross-year unpaid leave settles exact dated halves once, with each period’s rate', () => {
	// The split is the caller’s now: a time-off entry settles whole in one window, so the standing
	// December charge and the January half are two entries, each priced by its own period’s rate.
	const decemberRow = timeOff(10, [charge('2026-12-31')]);
	const januaryRow = timeOff(11, [charge('2027-01-01', 0.5)]);
	const first = calculate(prepared([decemberRow]), december);
	assert.equal(first.captures[0]!.gross_amount.value, -100);
	assert.deepEqual(
		first.captures[0]!.charges.map((row) => row.date),
		['2026-12-31']
	);
	const next = prepared([decemberRow, januaryRow], {
		captures: first.captures.map((row) => ({ ...row, paid: true }))
	});
	const second = calculate(next, january, 120);
	assert.equal(second.captures[0]!.gross_amount.value, -60);
	assert.equal(second.adjustments[0]!.quantity, 0.5);
	Schema.decodeUnknownSync(leavePayItemsValueSchema)(second.captures[0]!.pay_items, {
		onExcessProperty: 'error'
	});
	assert.equal(calculate(next, december).captures.length, 0);
});

test('paid time off captures its exact dates even when no money is generated', () => {
	const row = timeOff(10, [charge('2027-01-04')]);
	const facts = prepared([row], {
		catalogues: [{ ...catalogue, is_npl: false }]
	});
	const output = calculate(facts);
	assert.equal(output.adjustments.length, 0);
	assert.deepEqual(output.captures[0]!.gross_amount, { value: 0, currency: 'MYR' });
	assert.equal(output.captures[0]!.charges.length, 1);
	assert.equal(
		calculate({ ...facts, captures: output.captures.map((row) => ({ ...row, paid: false })) })
			.captures.length,
		0
	);
});

test('manual encashment stays due after departure and prices at the ordinary day wage', () => {
	const row = cash(11);
	assert.equal(hasLeavePayment(prepared([row]), '2027-01-09'), false);
	assert.equal(hasLeavePayment(prepared([row]), '2027-02-28'), true);
	const output = calculateLeavePayroll({
		prepared: prepared([row], {
			catalogues: [{ ...catalogue, is_npl: false, can_encash: true }]
		}),
		window: january,
		dueThrough: january.end,
		currency: 'MYR',
		absenceRate: () => {
			throw new Error('An encashment never reads the absence rate');
		},
		ordinaryDayRate: () => 68.625
	});
	assert.equal(output.adjustments[0]!.amount, 137.25, 'two days at the ordinary day wage');
	assert.equal(output.captures[0]!.gross_amount.value, 137.25);
	assert.equal(
		hasLeavePayment(
			prepared([row], { captures: output.captures.map((row) => ({ ...row, paid: true })) }),
			'2027-02-28'
		),
		false
	);
});

test('a paid reversal preserves the original amounts and contribution direction', () => {
	const original = timeOff(10, [charge('2026-12-30', 0.5), charge('2026-12-31')]);
	const paid = calculate(prepared([original]), december, 123.46);
	const reversal = entry(12, {
		as_adjustment_entry: true,
		reversal_of_id: original.id,
		effective_on: '2027-01-04',
		due_on: '2027-01-31',
		days: null,
		reason: 'Approved correction'
	});
	const facts = prepared([original, reversal], {
		catalogues: [{ ...catalogue, is_npl: false }],
		captures: paid.captures.map((row) => ({ ...row, paid: true }))
	});
	const output = calculate(facts, january, 999);
	assert.deepEqual(
		output.adjustments.map((row) => [row.bucket, row.amount, row.quantity]),
		[
			['ABSENCE', -61.73, -0.5],
			['ABSENCE', -123.46, -1]
		]
	);
	assert.equal(
		output.captures[0]!.gross_amount.value,
		185.19,
		'the computed negation is the whole of the reversal money'
	);
	assert.ok(output.adjustments.every((row) => row.bucket === 'ABSENCE'));
	assert.equal(output.captures[0]!.charges.length, 0);
});

test('unpaid cancellation produces no compensating payment and pending money is ignored', () => {
	const original = cash(11);
	const reversal = entry(12, {
		as_adjustment_entry: true,
		reversal_of_id: original.id,
		effective_on: '2027-01-04',
		due_on: null,
		days: null,
		reason: 'Cancelled before payment'
	});
	assert.equal(calculate(prepared([original, reversal])).captures.length, 0);
	assert.equal(calculate(prepared([{ ...cash(13), approval_id: id(50) }])).captures.length, 0);
});

test('coverage retains half-day quantities and refuses overlapping full-day coverage', () => {
	assert.equal(
		leaveCoverage(prepared([timeOff(10, [charge('2027-01-04', 0.5)])]), january).days['2027-01-04'],
		0.5
	);
	assert.throws(
		() =>
			leaveCoverage(
				prepared([timeOff(10, [charge('2027-01-04')]), timeOff(11, [charge('2027-01-04', 0.5)])]),
				january
			),
		/exceeds one day/
	);
});

test('a reversal refuses a payroll currency that differs from the money it negates', () => {
	const original = timeOff(10, [charge('2026-12-30')]);
	const paid = calculate(prepared([original]), december, 123.46);
	const reversal = entry(12, {
		as_adjustment_entry: true,
		reversal_of_id: original.id,
		effective_on: '2027-01-04',
		due_on: '2027-01-31',
		days: null,
		reason: 'Approved correction'
	});
	assert.throws(
		() =>
			calculateLeavePayroll({
				prepared: prepared([original, reversal], {
					captures: paid.captures.map((row) => ({ ...row, paid: true }))
				}),
				window: january,
				dueThrough: january.end,
				currency: 'SGD',
				absenceRate: () => 100,
				ordinaryDayRate: () => 100
			}),
		/currency differs/
	);
});
