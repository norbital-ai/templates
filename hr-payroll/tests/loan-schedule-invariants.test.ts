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
 * the `mutate.prepare` hook that applies it — directly. The hook is called as the authored handler,
 * not through the runtime, for the reason `captured-input-refusals.test.ts` gives: the question is
 * whether the hook asks, on the right path, against the right rows.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import loanRepaymentHooks from '../src/collections/loan_repayments/+hooks.ts';
import {
	loanScheduleRefusals,
	SCHEDULE_IMBALANCED,
	SCHEDULE_OUTSIDE_EFFECTIVE_RANGE,
	SCHEDULE_OUT_OF_ORDER
} from '../src/lib/loan-schedule.ts';

const LOAN = 'loan-1';
const PERIOD = '2026-07';
/** A closed agreement: April through September 2026, both ends inclusive by day head. */
const RANGE = { start: '2026-04-01T00:00:00.000Z', end: '2026-09-01T00:00:00.000Z' };
const day = (value) => `${value}T00:00:00.000Z`;

const repayment = (sequence, dueDay, amountDue) => ({
	id: `r${sequence}`,
	loan_id: LOAN,
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
 * A database double over the three reads the batch guard makes, and the one the capture guard
 * makes. Narrow on purpose, for the reason the attendance lock tests keep theirs narrow: a broader
 * fake is a second description of the authoring api, free to drift from the real one.
 */
const world = (options = {}) => {
	const stored = options.stored ?? BALANCED;
	const loans = options.loans ?? [
		{ id: LOAN, principal: options.principal ?? 1000, effective_range: RANGE }
	];
	// The doubles honour their `where`, which matters for exactly one case: a repayment moved
	// between loans reads two loans and two schedules, and a double that answers the same rows to
	// every question would make that test pass without the guard ever looking at the source.
	const within = (where, column, rows) => {
		const wanted = where?.[column]?.in;
		return wanted === undefined ? rows : rows.filter((row) => wanted.includes(row[column]));
	};
	return {
		db: {
			loans: { findMany: ({ where } = {}) => Effect.succeed(within(where, 'id', loans)) },
			loan_repayments: {
				findMany: ({ where } = {}) =>
					Effect.succeed(
						where?.id?.in === undefined
							? within(where, 'loan_id', stored)
							: within(where, 'id', stored)
					)
			},
			payslip_loan_repayment_inputs: {
				findFirst: () => Effect.succeed(options.captured === true ? { period: PERIOD } : undefined)
			}
		}
	};
};

/** The house pattern: refusals are thrown, and the sentence is what is asserted on. */
const run = (effect) => (Effect.isEffect(effect) ? Effect.runSync(effect) : effect);
const prepare = (inputs, options) =>
	run(loanRepaymentHooks.mutate.prepare({ inputs, api: world(options) }));
const before = (input, existing, options) =>
	run(loanRepaymentHooks.mutate.perRecord.before.handler({ input, existing, api: world(options) }));

test('a direct create batch that does not add up is refused on the write path', () => {
	assert.throws(
		() =>
			prepare(
				[
					{ loan_id: LOAN, due_date: day('2026-04-01'), amount_due: 400, sequence: 1 },
					{ loan_id: LOAN, due_date: day('2026-05-01'), amount_due: 400, sequence: 2 }
				],
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
	const patch = () => prepare([{ id: 'r2', loan_id: LOAN, amount_due: 300 }]);
	assert.throws(patch, new RegExp(SCHEDULE_IMBALANCED));
	// The sentence proves the overlay ran: 250 + 300 + 250 + 250, not the 300 the patch carried.
	assert.throws(patch, /add up to 1050\.00/);
});

/**
 * The negative control. A guard that refuses everything reads identically to a working one from
 * the refusing case alone, so a legal edit has to be shown landing.
 */
test('a legal edit to an uncaptured repayment still lands', () => {
	// 250 → 200 on one line and 250 → 300 on another: the schedule still sums to 1000.
	assert.doesNotThrow(() =>
		prepare([
			{ id: 'r1', loan_id: LOAN, amount_due: 200 },
			{ id: 'r2', loan_id: LOAN, amount_due: 300 }
		])
	);
});

test('re-dating a repayment out of order is refused, and re-dating it in order is not', () => {
	assert.throws(
		() => prepare([{ id: 'r3', loan_id: LOAN, due_date: day('2026-04-01') }]),
		new RegExp(SCHEDULE_OUT_OF_ORDER)
	);
	assert.doesNotThrow(() => prepare([{ id: 'r4', loan_id: LOAN, due_date: day('2026-08-01') }]));
});

test('moving the last repayment past the agreement’s end is refused', () => {
	assert.throws(
		() => prepare([{ id: 'r4', loan_id: LOAN, due_date: day('2026-10-01') }]),
		new RegExp(SCHEDULE_OUTSIDE_EFFECTIVE_RANGE)
	);
});

/**
 * A nested write under the loan states no `loan_id` — the engine injects it from the graph position
 * after both hooks have run — and the loan carrying the principal to judge against is unwritten in
 * the same graph. Judging the sum or the period for such a write refuses the loans screen's own
 * flow, which `public-seed-loan-schedule.integration.test.ts` holds against a running host. What is
 * still judged is the order, which needs nothing outside the batch.
 */
test('a batch that names no loan is judged on its order and nothing else', () => {
	assert.doesNotThrow(() => prepare([{ id: 'r1', amount_due: 999 }]));
	assert.throws(
		() =>
			prepare([
				{ id: 'r1', due_date: day('2026-05-01'), amount_due: 500, sequence: 1 },
				{ id: 'r2', due_date: day('2026-04-01'), amount_due: 500, sequence: 2 }
			]),
		new RegExp(SCHEDULE_OUT_OF_ORDER)
	);
});

// ── the capture, which still wins ───────────────────────────────────────────────────────────

test('a repayment a payroll run has captured still cannot be rewritten', () => {
	assert.throws(
		() => before({ amount_due: 250 }, { ...BALANCED[0] }, { captured: true }),
		new RegExp(`payroll ${PERIOD} has already taken this record into account`)
	);
});

test('and an uncaptured one can', () => {
	assert.doesNotThrow(() => before({ amount_due: 250 }, { ...BALANCED[0] }));
});

/**
 * Moving a repayment between loans leaves two schedules behind, and only one of them is the one
 * the caller was thinking about.
 *
 * The guard reads the loans a write *names* — which for this write is the destination alone. That
 * would let somebody balance the loan they meant to touch while quietly unbalancing the one they
 * did not, and the second loan would then be a schedule no later write has any reason to look at.
 * The source is knowable for exactly the writes the sum rule applies to: the prior row was already
 * read to build the candidate, and it carries the loan the row is leaving.
 */
test('a repayment moved between loans is judged against the loan it leaves as well', () => {
	const OTHER = 'loan-2';
	const otherRepayment = (sequence, dueDay, amountDue) => ({
		id: `o${sequence}`,
		loan_id: OTHER,
		due_date: day(dueDay),
		amount_due: amountDue,
		sequence
	});
	// Two balanced loans: 1000 over four, and 500 over two.
	const both = {
		loans: [
			// The destination's principal already accounts for the row about to arrive, so the move
			// leaves *it* balanced. That is the whole design of this case.
			{ id: LOAN, principal: 1250, effective_range: RANGE },
			{ id: OTHER, principal: 500, effective_range: RANGE }
		],
		stored: [
			...BALANCED,
			otherRepayment(1, '2026-04-15', 250),
			otherRepayment(2, '2026-05-15', 250)
		]
	};

	// `o2` (250) moves across, and the destination balances at 1250 because that is its principal.
	// The only thing wrong with this write is on the loan nobody named: the source is left holding
	// 250 against a principal of 500. A guard that read only the loans a write names would accept
	// it, which is why the assertion is on the source's numbers.
	assert.throws(
		() =>
			prepare(
				[{ id: 'o2', loan_id: LOAN, sequence: 5, due_date: day('2026-08-01'), amount_due: 250 }],
				both
			),
		(error) => {
			const message = String(error?.message ?? error);
			assert.match(
				message,
				/add up to 250\.00, and the loan's principal is 500\.00/,
				`the source loan is judged too: ${message}`
			);
			return true;
		}
	);

	// And the control: a write that names the loan the row is already on reads one loan, not two,
	// so an ordinary in-place edit does not start dragging an unrelated schedule into its refusal.
	prepare([{ id: 'r4', loan_id: LOAN, amount_due: 500 }], {
		...both,
		loans: [{ id: LOAN, principal: 1250, effective_range: RANGE }]
	});
});
