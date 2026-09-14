import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import employmentHooks from '../src/collections/employments/+hooks.ts';
import termsHooks from '../src/collections/employment_terms/+hooks.ts';
import {
	buildChangeTermsWrites,
	previousDay
} from '../src/lib/ui/offboarding/change-terms-submit.ts';
import {
	buildOffboardingWrites,
	encashableBalance,
	exitReference
} from '../src/lib/ui/offboarding/offboarding-submit.ts';
import { leaveBalanceSummaries } from '../src/lib/leave/summary.ts';
import {
	approve,
	id,
	leaveContext,
	leaveEntryHooks,
	submission,
	timeOff
} from './helpers/manual-leave-context.ts';

const storedContract = () => ({
	id: id(1),
	employee_id: id(2),
	company_id: id(3),
	effective_range: { start: '2025-01-01T00:00:00.000Z', end: null }
});
const recordWrite = (input: Record<string, unknown>, existing: Record<string, unknown>) =>
	Effect.runSync(
		employmentHooks.mutate.perRecord.before.handler({
			input,
			existing,
			recordId: id(1),
			prepared: {
				candidates: [{ ...storedContract(), ...input }],
				stored: [],
				pending: []
			},
			api: { db: {} }
		} as never)
	);
/** Nothing references the contract: every consumer read is empty. */
const unreferencedApi = {
	db: new Proxy(
		{},
		{
			get: (_target, property) => () => Effect.succeed(property === 'findPending' ? [] : undefined)
		}
	)
};
const recordUnreferencedWrite = (
	input: Record<string, unknown>,
	existing: Record<string, unknown>
) =>
	Effect.runSync(
		employmentHooks.mutate.perRecord.before.handler({
			input,
			existing,
			recordId: id(1),
			prepared: {
				candidates: [{ ...storedContract(), ...input }],
				stored: [],
				pending: []
			},
			api: unreferencedApi
		} as never)
	);

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

test('encash writes exactly the balance the step chose; forfeit writes nothing', () => {
	const context = leaveContext();
	assert.equal(encashableBalance(leaveBalanceSummaries(context, id(1), '2026-06-30')[0]!), 12);
	approve(context, timeOff('2026-03-02'), 11);
	const summaries = leaveBalanceSummaries(context, id(1), '2026-06-30');
	assert.equal(encashableBalance(summaries[0]!), 11);
	const plan = {
		employmentId: id(1),
		rangeStart: '2025-01-01T00:00:00.000Z',
		lastDay: '2026-06-30',
		rangeEnd: '2026-06-30T00:00:00.000Z',
		note: 'Last day agreed',
		summaries,
		currency: 'MYR'
	};
	const { departure, encashments } = buildOffboardingWrites({
		...plan,
		choices: { ANNUAL: { encash: true, gross: 1100, rate: null } }
	});
	assert.deepEqual(departure, {
		id: id(1),
		effective_range: { start: '2025-01-01T00:00:00.000Z', end: '2026-06-30T00:00:00.000Z' },
		comments: 'Last day agreed'
	});
	assert.equal(encashments.length, 1);
	assert.deepEqual(encashments[0], {
		employment_id: id(1),
		catalogue_id: id(7),
		reference: exitReference(id(1), 'ANNUAL'),
		event: {
			kind: 'ENCASHMENT',
			source_window: { start: '2026-01-01', end: '2026-12-31' },
			days: 11,
			gross_amount: { value: 1100, currency: 'MYR' },
			rate: null,
			effective_on: '2026-06-30',
			due_on: '2026-06-30',
			reason: 'Last day agreed'
		}
	});
	// The chosen entry passes the ordinary leave door with the exact days debited.
	const approved = leaveEntryHooks.mutate.perRecord.before.handler({
		input: encashments[0],
		recordId: id(20),
		prepared: { context, inputs: [encashments[0]] }
	} as never);
	assert.equal(approved.event.kind, 'ENCASHMENT');
	assert.equal(
		approved.allocations.reduce((sum, row) => sum + row.days, 0),
		-11
	);
	// The same door refuses more than the balance, so the step cannot overpay.
	const overdraw = submission(
		{
			kind: 'ENCASHMENT',
			source_window: { start: '2026-01-01', end: '2026-12-31' },
			days: 12,
			gross_amount: { value: 1200, currency: 'MYR' },
			rate: null,
			effective_on: '2026-06-30',
			due_on: '2026-06-30',
			reason: null
		},
		'TEST-OVERDRAW'
	);
	assert.throws(
		() =>
			leaveEntryHooks.mutate.perRecord.before.handler({
				input: overdraw,
				recordId: id(21),
				prepared: { context, inputs: [overdraw] }
			} as never),
		/Insufficient leave/
	);
	// Forfeit writes nothing; the departure still records.
	const forfeited = buildOffboardingWrites({
		...plan,
		choices: { ANNUAL: { encash: false, gross: 0, rate: null } }
	});
	assert.deepEqual(forfeited.encashments, []);
	assert.deepEqual(forfeited.departure.effective_range, {
		start: '2025-01-01T00:00:00.000Z',
		end: '2026-06-30T00:00:00.000Z'
	});
	assert.throws(
		() => buildOffboardingWrites({ ...plan, lastDay: '', choices: {} }),
		/needs a last day/
	);
	assert.throws(
		() =>
			buildOffboardingWrites({
				...plan,
				choices: { ANNUAL: { encash: true, gross: 0, rate: null } }
			}),
		/positive agreed amount/
	);
});

test('encash of a spent balance is refused before anything is written', () => {
	const context = leaveContext();
	approve(context, timeOff('2026-03-02', '2026-03-13'), 12);
	const summaries = leaveBalanceSummaries(context, id(1), '2026-06-30');
	assert.equal(encashableBalance(summaries[0]!), null);
	assert.throws(
		() =>
			buildOffboardingWrites({
				employmentId: id(1),
				rangeStart: '2025-01-01T00:00:00.000Z',
				lastDay: '2026-06-30',
				rangeEnd: '2026-06-30T00:00:00.000Z',
				note: null,
				summaries,
				choices: { ANNUAL: { encash: true, gross: 100, rate: null } },
				currency: 'MYR'
			}),
		/no remaining balance/
	);
});

/** The consumers a terms read sees; through=null is an unconsumed contract. */
const termsApi = (through: string | null) => ({
	db: {
		employments: {
			findFirst: () => Effect.succeed({ effective_range: { start: '2025-01-01', end: null } })
		},
		work_days: {
			findFirst: () => Effect.succeed(undefined),
			findPending: () => Effect.succeed([])
		},
		leave_entries: {
			findMany: () => Effect.succeed([]),
			findPending: () => Effect.succeed([])
		},
		payslips: {
			findFirst: () => Effect.succeed(through == null ? undefined : { terms_through: through })
		}
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
	residency_since: null,
	effective_range: { start: '2025-01-01', end: null }
});

test('change-terms closes the previous row the day before through the existing hook rule', () => {
	assert.equal(previousDay('2026-07-01'), '2026-06-30');
	assert.equal(previousDay('2026-03-01'), '2026-02-28');
	const previous = previousTerms();
	const { close, create } = buildChangeTermsWrites({
		previousId: id(4),
		employmentId: id(1),
		previousStart: '2025-01-01',
		closeEnd: '2026-06-30',
		newStart: '2026-07-01',
		newId: id(81),
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
			grade: 'G3',
			shift_pattern_id: id(5)
		}
	});
	assert.deepEqual(close, {
		id: id(4),
		effective_range: { start: '2025-01-01', end: '2026-06-30' }
	});
	assert.equal(create.employment_id, id(1));
	assert.equal(create.id, id(81));
	assert.deepEqual(create.effective_range, { start: '2026-07-01', end: null });
	// The change leaves exactly two segments, and they tile the contract: the successor starts
	// the day after the predecessor closes, with no gap and no overlap, and the tail stays open.
	const segments = [close.effective_range, create.effective_range];
	assert.equal(segments.length, 2);
	assert.equal(segments[0]!.start, '2025-01-01');
	assert.equal(previousDay(segments[1]!.start), segments[0]!.end);
	assert.equal(segments[1]!.end, null);
	// Both halves pass the existing amendment rule while nothing is consumed …
	assert.doesNotThrow(() =>
		Effect.runSync(
			termsHooks.mutate.perRecord.before.handler({
				input: close,
				existing: previous,
				api: termsApi(null)
			} as never)
		)
	);
	assert.doesNotThrow(() =>
		Effect.runSync(
			termsHooks.mutate.perRecord.before.handler({
				input: create,
				api: termsApi('2026-01-05')
			} as never)
		)
	);
	// … and the close is refused once it would uncover consumed dates.
	assert.throws(
		() =>
			Effect.runSync(
				termsHooks.mutate.perRecord.before.handler({
					input: close,
					existing: previous,
					api: termsApi('2026-08-01')
				} as never)
			),
		/consumed/
	);
	assert.throws(
		() =>
			buildChangeTermsWrites({
				previousId: id(4),
				employmentId: id(1),
				previousStart: '2025-01-01',
				closeEnd: '2026-06-29',
				newStart: '2026-07-01',
				newId: id(82),
				facts: create
			}),
		/day after/
	);
});
