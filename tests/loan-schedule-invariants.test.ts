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
 * the `loans` transform that applies it — directly. The transform is called as the authored
 * callback, not through the runtime, for the reason `captured-input-refusals.test.ts` gives: the
 * question is whether the transform asks, on the right path, against the right rows.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import loans from '../src/collections/loans/+collection.ts';
import loanRepayments from '../src/collections/loan_repayments/+collection.ts';
import { requestGrants } from '../src/lib/policy_grants.ts';
import { transformOne } from './helpers/transform.ts';
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
const RANGE = { start: '2026-04-01T00:00:00.000Z', end: '2026-09-01T00:00:00.000Z' };
const day = (value) => `${value}T00:00:00.000Z`;

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

/**
 * A database double over the reads the agreement's transform makes. Narrow on purpose, for the
 * reason the attendance lock tests keep theirs narrow: a broader fake is a second description of
 * the authoring api, free to drift from the real one.
 */
const world = (options = {}) => {
	const stored = (options.stored ?? BALANCED).map((row) =>
		options.captured === true ? { ...row, payslip_id: row.payslip_id ?? 'slip-1' } : row
	);
	const within = (where, column, rows) => {
		const wanted = where?.[column]?.in;
		return wanted === undefined ? rows : rows.filter((row) => wanted.includes(row[column]));
	};
	return {
		loan_repayments: {
			findMany: ({ where } = {}) => Effect.succeed(within(where, 'loan_id', stored))
		},
		loan_catalogue: {
			findMany: () => Effect.succeed([{ id: 'loan-type', code: 'LOAN', eligibility: '' }])
		},
		// The contract the agreement rides, with the person nested as the transform's one read has it.
		employments: {
			findMany: () =>
				Effect.succeed([
					{
						id: EMPLOYMENT,
						employee_id: 'person-1',
						company_id: 'company-1',
						employee_number: 'E-1',
						effective_range: { start: '2026-01-01T00:00:00.000Z', end: null },
						employment_employee: null,
						employment_company: null,
						term_employment: []
					}
				])
		}
	};
};

const agreement = {
	id: LOAN,
	employment_id: EMPLOYMENT,
	loan_catalogue_id: 'loan-type',
	principal: 1000,
	effective_range: RANGE
};

/** The house pattern: refusals are thrown, and the sentence is what is asserted on. */
const writeAgreement = (input, existing, options = {}) =>
	transformOne(loans, input, existing, world(options));
/** An edit of the stored agreement's schedule: patches by id, judged as the schedule they leave. */
const patch = (updates, options = {}) =>
	writeAgreement(
		{ repayment_loan: { update: updates.map(({ id, ...set }) => ({ id, set })) } },
		agreement,
		options
	);

test('a create whose schedule does not add up is refused on the write path', () => {
	assert.throws(
		() =>
			writeAgreement(
				{
					...agreement,
					repayment_loan: {
						create: [
							{ due_date: day('2026-04-01'), amount_due: 400, sequence: 1 },
							{ due_date: day('2026-05-01'), amount_due: 400, sequence: 2 }
						]
					}
				},
				undefined,
				{ stored: [] }
			),
		new RegExp(SCHEDULE_IMBALANCED)
	);
});

/**
 * A partial update is judged as the row it would produce — the patch merged over the stored row —
 * and against the whole schedule it would leave, not against the two columns it carries.
 */
test('a one-column patch is judged as the schedule it would leave behind', () => {
	assert.throws(() => patch([{ id: 'r2', amount_due: 300 }]), new RegExp(SCHEDULE_IMBALANCED));
	// The sentence proves the overlay ran: 250 + 300 + 250 + 250, not the 300 the patch carried.
	assert.throws(() => patch([{ id: 'r2', amount_due: 300 }]), /add up to 1050\.00/);
});

/**
 * The negative control. A guard that refuses everything reads identically to a working one from
 * the refusing case alone, so a legal edit has to be shown landing.
 */
test('a legal edit to an uncaptured repayment still lands', () => {
	// 250 → 200 on one line and 250 → 300 on another: the schedule still sums to 1000.
	assert.doesNotThrow(() =>
		patch([
			{ id: 'r1', amount_due: 200 },
			{ id: 'r2', amount_due: 300 }
		])
	);
});

test('re-dating a repayment out of order is refused, and re-dating it in order is not', () => {
	assert.throws(
		() => patch([{ id: 'r3', due_date: day('2026-04-01') }]),
		new RegExp(SCHEDULE_OUT_OF_ORDER)
	);
	assert.doesNotThrow(() => patch([{ id: 'r4', due_date: day('2026-08-01') }]));
});

test('moving the last repayment past the agreement’s end is refused', () => {
	assert.throws(
		() => patch([{ id: 'r4', due_date: day('2026-10-01') }]),
		new RegExp(SCHEDULE_OUTSIDE_EFFECTIVE_RANGE)
	);
});

test('a repayment named in an edit must belong to the agreement', () => {
	assert.throws(() => patch([{ id: 'stranger', amount_due: 999 }]), /not part of this loan/);
	assert.throws(
		() => writeAgreement({ repayment_loan: { delete: [{ id: 'stranger' }] } }, agreement),
		/not part of this loan/
	);
});

test('a nested schedule derives its employment contract from the agreement', () => {
	const rows = [
		{ due_date: day('2026-04-01'), amount_due: 300, sequence: 1 },
		{ due_date: day('2026-05-01'), amount_due: 400, sequence: 2 }
	];
	const result = writeAgreement(
		{ ...agreement, id: undefined, principal: 700, repayment_loan: { create: rows } },
		undefined,
		{ stored: [] }
	);
	assert.deepEqual(
		result.repayment_loan.create.map((row) => row.employment_id),
		[EMPLOYMENT, EMPLOYMENT]
	);
	assert.throws(
		() =>
			writeAgreement(
				{
					...agreement,
					id: undefined,
					principal: 700,
					repayment_loan: { create: [{ ...rows[0], amount_due: 299 }, rows[1]] }
				},
				undefined,
				{ stored: [] }
			),
		/SCHEDULE_IMBALANCED/
	);
});

test('a repayment is written through its agreement: the collection exposes no create or update', () => {
	assert.equal(loanRepayments.create, undefined);
	assert.equal(loanRepayments.update, undefined);
	assert.ok(loanRepayments.delete, 'the direct delete exists, judged by its grant');
});

// ── the capture, which still wins ───────────────────────────────────────────────────────────

test('a repayment a payroll run has captured still cannot be rewritten', () => {
	assert.throws(
		() => patch([{ id: 'r1', amount_due: 251 }], { captured: true }),
		/settled by a payroll and cannot be changed/
	);
});

test('a captured repayment can be restated exactly when the remaining schedule is edited', () => {
	assert.doesNotThrow(() => patch([{ ...BALANCED[0] }], { captured: true }));
});

test('captured no-op restatement compares PostgreSQL zoned and numeric representations by value', () => {
	for (const [storedInstant, submittedInstant] of [
		['2026-04-01T00:00:00+00:00', '2026-04-01T00:00:00.000Z'],
		['2026-04-01T08:00:00+08:00', '2026-04-01T00:00:00.000Z'],
		['2026-03-31T19:00:00-05:00', '2026-04-01T00:00:00.000Z'],
		['2026-04-01T08:00:00.1234+08:00', '2026-04-01T00:00:00.123400Z']
	]) {
		const stored = [
			{ ...BALANCED[0], due_date: storedInstant, amount_due: '250.00' },
			...BALANCED.slice(1)
		];
		assert.doesNotThrow(() =>
			patch([{ ...BALANCED[0], due_date: submittedInstant }], { stored, captured: true })
		);
		for (const due_date of [
			'2026-04-02T00:00:00.000Z',
			'2026-04-01T00:00:01.000Z',
			'2026-04-01T00:00:00.123401Z'
		])
			assert.throws(
				() => patch([{ id: 'r1', due_date }], { stored, captured: true }),
				/settled by a payroll and cannot be changed/
			);
	}
});

test('an agreement starts with a nonempty schedule and cannot replace it with an empty set', () => {
	assert.throws(() => writeAgreement(agreement, undefined), /complete repayment schedule/);
	assert.throws(
		() => writeAgreement({ ...agreement, repayment_loan: { create: [] } }, undefined),
		/complete repayment schedule/
	);
	assert.doesNotThrow(() =>
		writeAgreement({ ...agreement, repayment_loan: { create: BALANCED } }, undefined, {
			stored: []
		})
	);
	assert.throws(
		() =>
			writeAgreement({ repayment_loan: { delete: BALANCED.map(({ id }) => ({ id })) } }, agreement),
		/cannot be empty/
	);
});

test('principal or period edits without a replacement schedule must still match stored repayments', () => {
	assert.throws(() => writeAgreement({ principal: 1100 }, agreement), /SCHEDULE_IMBALANCED/);
	assert.throws(
		() =>
			writeAgreement(
				{ effective_range: { start: RANGE.start, end: day('2026-06-01') } },
				agreement
			),
		/SCHEDULE_OUTSIDE_EFFECTIVE_RANGE/
	);
	assert.doesNotThrow(() => writeAgreement({ principal: 1000 }, agreement));
	assert.doesNotThrow(() =>
		writeAgreement(
			{
				principal: 1100,
				repayment_loan: { update: [{ id: 'r4', set: { amount_due: 350 } }] }
			},
			agreement
		)
	);
});

test('a captured repayment is not deleted through its agreement nor directly; an uncaptured one goes either way', () => {
	const replacement = { create: [{ due_date: day('2026-04-01'), amount_due: 250, sequence: 1 }] };
	assert.doesNotThrow(() =>
		writeAgreement({ repayment_loan: { delete: [{ id: 'r1' }], ...replacement } }, agreement)
	);
	assert.throws(
		() =>
			writeAgreement({ repayment_loan: { delete: [{ id: 'r1' }], ...replacement } }, agreement, {
				captured: true
			}),
		/settled by a payroll and cannot be deleted/
	);
	const authorize = requestGrants().loan_repayments.delete.authorize;
	assert.equal(authorize({ record: BALANCED[0] }), true);
	assert.equal(authorize({ record: { ...BALANCED[0], payslip_id: 'slip-1' } }), false);
});
