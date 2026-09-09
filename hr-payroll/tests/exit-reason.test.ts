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
	hire_date: '2025-01-01',
	effective_range: { start: '2025-01-01T00:00:00.000Z', end: null },
	children: []
});
const recordDeparture = (input: Record<string, unknown>) =>
	Effect.runSync(
		employmentHooks.mutate.perRecord.before.handler({
			input,
			existing: storedContract(),
			recordId: id(1),
			prepared: {
				candidates: [{ ...storedContract(), ...input }],
				stored: [],
				pending: []
			},
			api: { db: {} }
		} as never)
	);

test('a departure needs a last day and a reason', () => {
	assert.throws(() => recordDeparture({ exit_date: '2026-06-30' }), /date and reason/);
	assert.throws(() => recordDeparture({ exit_reason: 'RESIGNATION' }), /date and reason/);
	assert.throws(() => recordDeparture({ exit_note: 'Goodbye' }), /date and reason/);
	assert.throws(
		() => recordDeparture({ exit_date: '2024-12-31', exit_reason: 'RESIGNATION' }),
		/cannot end before/
	);
	assert.deepEqual(
		recordDeparture({
			exit_date: '2026-06-30',
			exit_reason: 'RESIGNATION',
			exit_note: 'Found a new role'
		}),
		{
			exit_date: '2026-06-30',
			exit_reason: 'RESIGNATION',
			exit_note: 'Found a new role'
		}
	);
});

test('MISCONDUCT is recorded as the departure reason', () => {
	const recorded = recordDeparture({
		exit_date: '2026-06-30',
		exit_reason: 'MISCONDUCT',
		exit_note: 'Gross misconduct on shift'
	});
	assert.equal(recorded.exit_reason, 'MISCONDUCT');
	assert.equal(recorded.exit_note, 'Gross misconduct on shift');
});

test('encash writes exactly the balance the step chose; forfeit writes nothing', () => {
	const context = leaveContext();
	assert.equal(encashableBalance(leaveBalanceSummaries(context, id(1), '2026-06-30')[0]!), 12);
	approve(context, timeOff('2026-03-02'), 11);
	const summaries = leaveBalanceSummaries(context, id(1), '2026-06-30');
	assert.equal(encashableBalance(summaries[0]!), 11);
	const plan = {
		employmentId: id(1),
		lastDay: '2026-06-30',
		reason: 'RESIGNATION',
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
		exit_date: '2026-06-30',
		exit_reason: 'RESIGNATION',
		exit_note: 'Last day agreed'
	});
	assert.equal(encashments.length, 1);
	assert.deepEqual(encashments[0], {
		employment_id: id(1),
		leave_catalogue_id: id(7),
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
	assert.equal(forfeited.departure.exit_reason, 'RESIGNATION');
	assert.throws(
		() => buildOffboardingWrites({ ...plan, reason: '', choices: {} }),
		/needs a reason/
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
				lastDay: '2026-06-30',
				reason: 'RESIGNATION',
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
		employments: { findFirst: () => Effect.succeed({ exit_date: null }) },
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
