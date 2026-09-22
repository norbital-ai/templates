import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import employments from '../src/collections/employments/+collection.ts';
import terms from '../src/collections/employment_terms/+collection.ts';
import { transformOne } from './helpers/transform.ts';
import {
	buildChangeTermsWrites,
	previousDay
} from '../src/lib/ui/offboarding/change-terms-submit.ts';
import { id, leaveContext, scheduleDb } from './helpers/manual-leave-context.ts';

const storedContract = () => ({
	id: id(1),
	employee_id: id(2),
	company_id: id(3),
	effective_range: { start: '2025-01-01T00:00:00.000Z', end: null }
});
/** Nothing references the contract: every consumer read is empty. */
const unreferencedDb = new Proxy({}, { get: () => ({ findMany: () => Effect.succeed([]) }) });
const recordWrite = (input: Record<string, unknown>, existing: Record<string, unknown>) =>
	transformOne(employments, input, existing, unreferencedDb);
const recordUnreferencedWrite = recordWrite;

test('departure closes the range; comments stay writable after', () => {
	assert.deepEqual(
		recordWrite(
			{
				effective_range: { start: '2025-01-01T00:00:00.000Z', end: '2026-06-30T00:00:00.000Z' },
				comments: 'Found a new role'
			},
			storedContract()
		),
		{
			effective_range: { start: '2025-01-01T00:00:00.000Z', end: '2026-06-30T00:00:00.000Z' },
			comments: 'Found a new role'
		}
	);
	assert.deepEqual(
		recordWrite(
			{ comments: 'Later note' },
			{
				...storedContract(),
				effective_range: { start: '2025-01-01T00:00:00.000Z', end: '2026-06-30T00:00:00.000Z' }
			}
		),
		{ comments: 'Later note' }
	);
});

test('a closed contract never reopens', () => {
	assert.throws(
		() =>
			recordWrite(
				{ effective_range: { start: '2025-01-01T00:00:00.000Z', end: null } },
				{
					...storedContract(),
					effective_range: { start: '2025-01-01T00:00:00.000Z', end: '2026-06-30T00:00:00.000Z' }
				}
			),
		/cannot be reopened/
	);
	assert.deepEqual(
		recordUnreferencedWrite(
			{ effective_range: { start: '2025-02-01T00:00:00.000Z', end: null } },
			storedContract()
		),
		{ effective_range: { start: '2025-02-01T00:00:00.000Z', end: null } }
	);
});

/** The consumers a terms read sees; through=null is an unconsumed contract. */
const termsDb = (through: string | null) => ({
	...scheduleDb(),
	employments: {
		findMany: () =>
			Effect.succeed([{ id: id(1), effective_range: { start: '2025-01-01', end: null } }])
	},
	work_days: { findMany: () => Effect.succeed([]) },
	leave_entries: { findMany: () => Effect.succeed([]) },
	payslips: {
		findMany: () =>
			Effect.succeed(through == null ? [] : [{ employment_id: id(1), terms_through: through }])
	}
});
const previousTerms = () => ({
	...leaveContext().terms[0]!,
	id: id(4),
	pay_frequency: 'MONTHLY',
	job_title: null,
	grade: null,
	department: null,
	payroll_group: null,
	paid_rest_days: false,
	residency_since: null,
	effective_range: { start: '2025-01-01', end: null }
});

test('change-terms closes the previous row the day before through the transform’s amendment rule', () => {
	assert.equal(previousDay('2026-07-01'), '2026-06-30');
	assert.equal(previousDay('2026-03-01'), '2026-02-28');
	const previous = previousTerms();
	const { close, create } = buildChangeTermsWrites({
		previousId: id(4),
		employmentId: id(1),
		previousStart: '2025-01-01',
		closeEnd: '2026-06-30',
		newStart: '2026-07-01',
		facts: {
			residency_status: null,
			residency_since: null,
			base_salary: { value: 3500, currency: 'MYR' },
			pay_frequency: 'MONTHLY',
			work_classification: 'EA_COVERED',
			statutory_work_category: 'NON_MANUAL',
			employment_type: 'PERMANENT',
			department: null,
			job_title: null,
			payroll_group: null,
			paid_rest_days: false,
			grade: 'G3',
			shift_pattern_id: id(5)
		}
	});
	assert.deepEqual(close, {
		id: id(4),
		effective_range: { start: '2025-01-01', end: '2026-06-30' }
	});
	assert.equal(create.employment_id, id(1));
	assert.equal('id' in create, false, 'the successor carries no id; the runtime assigns it');
	assert.deepEqual(create.effective_range, { start: '2026-07-01', end: null });
	// The change leaves exactly two segments, and they tile the contract: the successor starts
	// the day after the predecessor closes, with no gap and no overlap, and the tail stays open.
	const segments = [close.effective_range, create.effective_range];
	assert.equal(segments.length, 2);
	assert.equal(segments[0]!.start, '2025-01-01');
	assert.equal(previousDay(segments[1]!.start), segments[0]!.end);
	assert.equal(segments[1]!.end, null);
	// Both halves pass the existing amendment rule while nothing is consumed …
	const { id: closeId, ...closePatch } = close;
	assert.equal(closeId, id(4));
	assert.doesNotThrow(() => transformOne(terms, closePatch, previous, termsDb(null)));
	assert.doesNotThrow(() => transformOne(terms, create, undefined, termsDb('2026-01-05')));
	// … and the close is refused once it would uncover consumed dates.
	assert.throws(() => transformOne(terms, closePatch, previous, termsDb('2026-08-01')), /consumed/);
	assert.throws(
		() =>
			buildChangeTermsWrites({
				previousId: id(4),
				employmentId: id(1),
				previousStart: '2025-01-01',
				closeEnd: '2026-06-29',
				newStart: '2026-07-01',
				facts: create
			}),
		/day after/
	);
});
