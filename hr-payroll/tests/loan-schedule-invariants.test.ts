// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The three things a loan's repayment schedule has to be, and the write path that now refuses a
 * schedule that is not.
 *
 * The amounts sum to the principal to the cent, the due dates strictly increase along `sequence`,
 * and the last repayment falls inside the agreement's effective period. All three were true only
 * of schedules built on the loans form: `loanScheduleImbalanced` blocked submit, and the sort in
 * `loan-schedule.ts` renumbered `sequence` from the dates. An import, an agent or any direct API
 * call could store a schedule that did not add up, whose dates went backwards, or that collected
 * after the agreement had ended.
 *
 * `loanScheduleRefusals` is the one statement of all three, and everything below drives it — and
 * the `loans` transform that applies it — directly, over rows in memory (`helpers/ctx.ts`).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import loans from '../src/data/collection/loans/+collection.ts';
import loanRepayments from '../src/data/collection/loan_repayments/+collection.ts';
import hrManager from '../src/access/+hr_manager.policy.ts';
import { UNPINNED } from '../src/access/grants.ts';
import { runTransform } from './helpers/ctx.ts';
import {
	loanScheduleRefusals,
	SCHEDULE_IMBALANCED,
	SCHEDULE_OUTSIDE_EFFECTIVE_RANGE,
	SCHEDULE_OUT_OF_ORDER
} from '../src/lib/loan-schedule.ts';

const LOAN = 'loan-1';
const EMPLOYMENT = 'contract-1';
const PERIOD = '2026-07';
/** A closed agreement: April through September 2026, both ends inclusive by day head. */
const RANGE = { from: '2026-04-01', to: '2026-09-01' };
const day = (value) => value;

const repayment = (sequence, dueDay, amountDue) => ({
	id: `r${sequence}`,
	loan_id: LOAN,
	employment_id: EMPLOYMENT,
	due_date: day(dueDay),
	amount_due: amountDue,
	sequence
});

/** A balanced, ordered, in-period schedule: 1000 over four months inside the range. */
const BALANCED = [
	repayment(1, '2026-04-01', 250),
	repayment(2, '2026-05-01', 250),
	repayment(3, '2026-06-01', 250),
	repayment(4, '2026-07-01', 250)
];

const codes = (input) => loanScheduleRefusals(input).map((refusal) => refusal.code);

// ── the pure statement ──────────────────────────────────────────────────────────────────────

test('a schedule that sums to the principal, in date order, inside the period is accepted', () => {
	assert.deepEqual(
		loanScheduleRefusals({ principal: 1000, effectiveRange: RANGE, rows: BALANCED }),
		[]
	);
});

test('a total either side of the principal is refused, by name', () => {
	const over = [...BALANCED.slice(0, 3), repayment(4, '2026-07-01', 250.02)];
	const under = [...BALANCED.slice(0, 3), repayment(4, '2026-07-01', 249.98)];
	assert.deepEqual(codes({ principal: 1000, effectiveRange: RANGE, rows: over }), [
		SCHEDULE_IMBALANCED
	]);
	assert.deepEqual(codes({ principal: 1000, effectiveRange: RANGE, rows: under }), [
		SCHEDULE_IMBALANCED
	]);
	// The sentence names both numbers, because the only two ways out are amending one of them.
	assert.match(
		loanScheduleRefusals({ principal: 1000, rows: over })[0].message,
		/add up to 1000\.02, and the loan's principal is 1000\.00/
	);
});

/**
 * The tolerance is `overConsumesEntry`'s, and so is the comparison: `> 0.01`. Exactly a cent of
 * rounding is not an imbalance; a hair more than a cent is. Tightening this would refuse schedules
 * the generator itself produces once an operator has edited a line by a hundredth.
 */
test('exactly the cent tolerance is accepted and a hair past it is not', () => {
	const outBy = (delta) => [...BALANCED.slice(0, 3), repayment(4, '2026-07-01', 250 + delta)];
	assert.deepEqual(codes({ principal: 1000, rows: outBy(0.01) }), []);
	assert.deepEqual(codes({ principal: 1000, rows: outBy(-0.01) }), []);
	assert.deepEqual(codes({ principal: 1000, rows: outBy(0.0100001) }), [SCHEDULE_IMBALANCED]);
	assert.deepEqual(codes({ principal: 1000, rows: outBy(-0.0100001) }), [SCHEDULE_IMBALANCED]);
});

test('dates that go backwards along the sequence are refused, and so are equal dates', () => {
	const backwards = [repayment(1, '2026-05-01', 500), repayment(2, '2026-04-01', 500)];
	const sameDay = [repayment(1, '2026-04-01', 500), repayment(2, '2026-04-01', 500)];
	assert.deepEqual(codes({ principal: 1000, rows: backwards }), [SCHEDULE_OUT_OF_ORDER]);
	// Strictly increasing: two instalments on one day are one instalment, and `sequence` would be
	// deciding which of them the engine recovers first.
	assert.deepEqual(codes({ principal: 1000, rows: sameDay }), [SCHEDULE_OUT_OF_ORDER]);
});

/**
 * The order is judged along `sequence`, not along the order the rows arrived in — a batch reaches
 * the hook in whatever order the caller sent it.
 */
test('the order judged is the sequence order, whatever order the rows arrive in', () => {
	const shuffled = [BALANCED[2], BALANCED[0], BALANCED[3], BALANCED[1]];
	assert.deepEqual(codes({ principal: 1000, effectiveRange: RANGE, rows: shuffled }), []);
});

test('a last repayment past the end of the effective period is refused', () => {
	const late = [repayment(1, '2026-04-01', 500), repayment(2, '2026-09-02', 500)];
	assert.deepEqual(codes({ principal: 1000, effectiveRange: RANGE, rows: late }), [
		SCHEDULE_OUTSIDE_EFFECTIVE_RANGE
	]);
});

/**
 * The boundary, read rather than guessed: a stored `instant_range` is compared by day head with
 * both ends inclusive (`inForceOnDay`), which is the same boundary `loanInstalmentDays` generates
 * against — it emits the end day itself and stops after it. A schedule the generator produces
 * therefore cannot be refused by the rule that judges it.
 */
test('a repayment on the period’s end day is inside it, as the range helpers read it', () => {
	const onEnd = [repayment(1, '2026-04-01', 500), repayment(2, '2026-09-01', 500)];
	assert.deepEqual(codes({ principal: 1000, effectiveRange: RANGE, rows: onEnd }), []);
});

test('an open-ended agreement accepts any last date', () => {
	const open = { start: '2026-04-01T00:00:00.000Z', end: null };
	const late = [repayment(1, '2026-04-01', 500), repayment(2, '2031-04-01', 500)];
	assert.deepEqual(codes({ principal: 1000, effectiveRange: open, rows: late }), []);
});

test('every issue is returned at once, never just the first', () => {
	const broken = [
		repayment(1, '2026-05-01', 400),
		repayment(2, '2026-04-01', 400),
		repayment(3, '2026-10-01', 400)
	];
	assert.deepEqual(codes({ principal: 1000, effectiveRange: RANGE, rows: broken }), [
		SCHEDULE_IMBALANCED,
		SCHEDULE_OUT_OF_ORDER,
		SCHEDULE_OUTSIDE_EFFECTIVE_RANGE
	]);
});

// ── the write path ──────────────────────────────────────────────────────────────────────────

const tables = (options = {}) => ({
	loan_repayments: (options.stored ?? BALANCED).map((row) =>
		options.captured === true ? { ...row, payslip_id: row.payslip_id ?? 'slip-1' } : row
	),
	loan_catalogue: [{ id: 'loan-type', code: 'LOAN', eligibility: '' }],
	employments: [
		{
			id: EMPLOYMENT,
			employee_id: 'person-1',
			company_id: 'company-1',
			employee_number: 'E-1',
			effective_range: { from: '2026-01-01', to: null }
		}
	],
	employees: [{ id: 'person-1' }],
	companies: [{ id: 'company-1' }],
	employment_terms: []
});

const agreement = {
	id: LOAN,
	employment_id: EMPLOYMENT,
	loan_catalogue_id: 'loan-type',
	principal: 1000,
	effective_range: RANGE
};

const write = async (input, existing, options = {}) =>
	(await runTransform(loans, [input], { tables: tables(options), existing: [existing] }))[0];
/** An edit of the stored agreement's schedule: patches by id, judged as the schedule they leave. */
const patch = (updates, options = {}) =>
	write(
		{ loan_repayments: { update: updates.map(({ id, ...set }) => ({ target: id, set })) } },
		agreement,
		options
	);
const NEW = { ...agreement, id: undefined };

test('a create is judged whole, derives its first day, and its schedule rides the agreement’s contract', async () => {
	const rows = [
		{ due_date: '2026-04-01', amount_due: 300, sequence: 1 },
		{ due_date: '2026-05-01', amount_due: 400, sequence: 2 }
	];
	await assert.rejects(
		write({ ...NEW, loan_repayments: { create: rows } }, undefined, { stored: [] }),
		new RegExp(SCHEDULE_IMBALANCED)
	);
	const saved = await write(
		{ ...NEW, principal: 700, loan_repayments: { create: rows } },
		undefined,
		{
			stored: []
		}
	);
	assert.equal(saved.effective_from, '2026-04-01');
	assert.deepEqual(
		saved.loan_repayments.create.map((row) => row.employment_id),
		[EMPLOYMENT, EMPLOYMENT]
	);
	await assert.rejects(write(NEW, undefined, { stored: [] }), /complete repayment schedule/);
});

test('a patch is judged as the schedule it leaves behind; a legal edit lands', async () => {
	// The sentence proves the overlay ran: 250 + 300 + 250 + 250, not the 300 the patch carried.
	await assert.rejects(patch([{ id: 'r2', amount_due: 300 }]), /add up to 1050\.00/);
	await patch([
		{ id: 'r1', amount_due: 200 },
		{ id: 'r2', amount_due: 300 }
	]);
	await assert.rejects(
		patch([{ id: 'r3', due_date: '2026-04-01' }]),
		new RegExp(SCHEDULE_OUT_OF_ORDER)
	);
	await assert.rejects(
		patch([{ id: 'r4', due_date: '2026-10-01' }]),
		new RegExp(SCHEDULE_OUTSIDE_EFFECTIVE_RANGE)
	);
	await assert.rejects(patch([{ id: 'stranger', amount_due: 999 }]), /not part of this loan/);
});

test('principal or period edits without a replacement schedule must still match the stored repayments', async () => {
	await assert.rejects(write({ principal: 1100 }, agreement), /SCHEDULE_IMBALANCED/);
	await assert.rejects(
		write({ effective_range: { from: '2026-04-01', to: '2026-06-01' } }, agreement),
		/SCHEDULE_OUTSIDE_EFFECTIVE_RANGE/
	);
	await write(
		{ principal: 1100, loan_repayments: { update: [{ target: 'r4', set: { amount_due: 350 } }] } },
		agreement
	);
	await assert.rejects(
		write({ loan_repayments: { delete: BALANCED.map(({ id }) => id) } }, agreement),
		/cannot be empty/
	);
});

test('a captured repayment is money history: restated exactly, never changed or deleted', async () => {
	await assert.rejects(
		patch([{ id: 'r1', amount_due: 251 }], { captured: true }),
		/settled by a payroll and cannot be changed/
	);
	await patch([{ ...BALANCED[0] }], { captured: true });
	const replacement = { create: [{ due_date: '2026-04-01', amount_due: 250, sequence: 1 }] };
	await write({ loan_repayments: { delete: ['r1'], ...replacement } }, agreement);
	await assert.rejects(
		write({ loan_repayments: { delete: ['r1'], ...replacement } }, agreement, { captured: true }),
		/settled by a payroll and cannot be deleted/
	);
});

test('a repayment is written through its agreement; directly it is only deleted, and only unpinned', () => {
	assert.equal(loanRepayments.spec.create, undefined);
	assert.equal(loanRepayments.spec.update, undefined);
	assert.ok(loanRepayments.spec.delete);
	assert.deepEqual(hrManager.grants.loan_repayments.delete, UNPINNED);
});
