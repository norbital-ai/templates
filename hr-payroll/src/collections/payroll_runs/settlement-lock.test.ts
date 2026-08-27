// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The settlement lock: taken when a run persists, released when the payslip that holds it is
 * deleted, and permanent once the run is paid.
 *
 * `payslip_sources` no longer exists. The claim it carried is a `payslip_adjustments` row naming
 * the source — and the row a run reads and prices at nothing has an `amount` of zero, which is
 * the whole of what the second collection was for. One collection, both facts.
 *
 * Five things are exercised here and they are deliberately five different kinds of check, because
 * the lock is enforced in five different places:
 *
 *   1. MEASURE — which sources a payslip claims, and that a source producing no money is claimed
 *      anyway. Pure, over one gathered bundle.
 *   2. GRAPH — that the claim reaches the returned record, with its period and its sequence.
 *   3. `sourceLock` — how a claim reads as a refusal. Pure, shared verbatim with the screens.
 *   4. `payroll_runs` `delete.before` — the refusal that makes a PAID run's claims permanent. The
 *      real authored handler, called directly.
 *   5. `+relationship.ts` — that the two cascade hops a release depends on are declared.
 *
 * What is *not* exercised is the cascade itself, because Postgres performs it. What is checked is
 * that it is declared, which is the only thing this workspace controls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { measureEmployment } from './lib/measure.ts';
import { payrollRunGraph } from './lib/graph.ts';
import { PLAIN_CALENDAR } from './lib/settlement.ts';
import payrollRunHooks from './+hooks.ts';
import relationships from '../+relationship.ts';
import {
	sourceLock,
	sourceLockBlocksWrite,
	sourceLockMessage,
	sourceLockI18nKey
} from '../../lib/scheduling/lock.ts';

// ── 1. what a payslip claims ────────────────────────────────────────────────────────────────────

const JURISDICTION = {
	id: 'jur-my',
	code: 'MY',
	currency: 'MYR',
	proration: { by: 'CALENDAR_DAYS' },
	ordinary_rate_divisor: 26,
	ordinary_rate_basis: 'DAYS_PER_MONTH',
	tax_year_start_month: 1,
	effective_range: { start: '2020-01-01', end: null }
};

const COMPANY = {
	id: 'co-my',
	jurisdiction_id: 'jur-my',
	pay_cutoff_day: 21,
	pay_day: 28,
	leave_year_start_month: 1,
	overtime_calculation_method: 'STATUTORY_AGGREGATE',
	risk_class: null,
	settlement_policy: null,
	effective_range: { start: '2020-01-01', end: null }
};

const BASIC = {
	id: 'pc-basic',
	company_id: 'co-my',
	code: 'BASIC',
	nature: 'EARNING',
	policy: { kind: 'EARNING', settlement: 'ADD', statutory_treatments: [] },
	sequence: 10,
	eligibility: [],
	definition: { source: 'SCHEDULE', unit: 'MONEY', reducible: false },
	effective_range: { start: '2020-01-01', end: null }
};

const PATTERN = {
	type: 'ROSTERED',
	expectation: {
		kind: 'GUARANTEED_SCHEDULE',
		period: 'WEEK',
		required_work_days: 6,
		required_paid_minutes: 2700
	}
};

/** March 2026 under a cutoff of 21: the run pays the month, reading 21 Feb – 20 Mar. */
const MARCH = { start: '2026-03-01', end: '2026-03-31' };
const MARCH_ATTENDANCE = { start: '2026-02-21', end: '2026-03-20' };

/** A day that was read and on which nothing was worked. `[]` is not `null`. */
const readDay = (id, date) => ({
	id,
	work_date: date,
	shift_definition_id: null,
	worked_intervals: [],
	break_minutes: 0
});

function measure(overrides = {}) {
	return measureEmployment({
		bundle: {
			employment: {
				id: 'emp-1',
				employee_id: 'ee-1',
				employee_number: 'NHPMY0023',
				company_id: 'co-my',
				hire_date: '2021-06-01',
				exit_date: null,
				effective_range: { start: '2021-06-01', end: null }
			},
			employee: { id: 'ee-1', date_of_birth: '1992-01-04', gender: 'FEMALE' },
			terms: [
				{
					id: 'terms-1',
					employment_id: 'emp-1',
					base_salary: { value: 3451, currency: 'MYR' },
					pay_frequency: 'MONTHLY',
					work_pattern: PATTERN,
					statutory_work_category: 'NON_MANUAL',
					work_classification: 'NON_MANUAL',
					employment_type: 'PERMANENT',
					department: null,
					payroll_group: null,
					effective_range: { start: '2020-01-01', end: null }
				}
			],
			statutoryFacts: [],
			obligations: [],
			ledger: [],
			workDays: [],
			serviceMonths: 57,
			age: 34,
			employedDays: MARCH,
			wageDays: MARCH,
			attendance: MARCH_ATTENDANCE,
			arrearsFor: null,
			deferral: null,
			extendedLeaveSettlesInOwnMonth: false,
			...overrides
		},
		configuration: {
			company: COMPANY,
			jurisdiction: JURISDICTION,
			contributions: [],
			treatments: new Map(),
			payComponents: [BASIC],
			overtimeRules: [],
			overtimeLimits: [],
			overtimeCoverageRule: null,
			shiftById: new Map(),
			holidays: new Map(),
			leaveTypes: [],
			hash: 'test'
		},
		period: '2026-03',
		salary: MARCH,
		periodsRemaining: 10,
		headcount: 1,
		policy: PLAIN_CALENDAR,
		consumedObligations: new Map()
	});
}

const claimsOf = (measured) =>
	measured.adjustments.map((row) => [row.source.kind, row.source.id, row.amount]);

test('a day the run read and priced at nothing is claimed with an amount of zero', () => {
	// This is the whole of what `payslip_sources` was. The day produced no overtime — it produced
	// nothing at all — and it is still frozen, because the `restrict` foreign key on the WORK_DAY
	// arm is what refuses the delete and the row is what the refusal quotes the period back from.
	const measured = measure({ workDays: [readDay('wd-1', '2026-03-02')] });
	assert.deepEqual(claimsOf(measured), [['WORK_DAY', 'wd-1', 0]]);
	// "Consumed nothing" and "was never read" are different claims, and only one of them is a row.
	const untouched = measure();
	assert.deepEqual(claimsOf(untouched), []);
});

test('a payslip claims the span it measured and not the months it only counted', () => {
	// GATHER reads both calendar months the cutoff touches, so the statutory overtime counter can
	// reset on the 1st. Days before the span this employment was measured over belong to a period
	// already settled: locking them would freeze attendance an earlier run priced.
	//
	// The span is the union of the attendance window and the wage window, because they genuinely
	// differ and both are consumed — attendance prices the days worked, and the wage window is what
	// recurring salary covers. So the tail of the salary month is claimed even though the cutoff
	// closed on the 20th, and that is the same span the settlement claim has always used.
	const measured = measure({
		workDays: [
			readDay('wd-early', '2026-02-10'),
			readDay('wd-before', '2026-02-20'),
			readDay('wd-edge-start', '2026-02-21'),
			readDay('wd-in', '2026-03-02'),
			readDay('wd-cutoff', '2026-03-20'),
			readDay('wd-wage-tail', '2026-03-31')
		]
	});
	assert.deepEqual(
		measured.adjustments.map((row) => row.source.id),
		['wd-edge-start', 'wd-in', 'wd-cutoff', 'wd-wage-tail']
	);
	for (const row of measured.adjustments) assert.equal(row.source.kind, 'WORK_DAY');
});

test('a day carrying only a plan is not claimed, because there is no punch to freeze', () => {
	// `worked_intervals: null` says no attendance was recorded at all. The day-shaped window guard
	// is what stops a record appearing on a settled day; a record lock needs a record.
	const measured = measure({
		workDays: [
			{
				id: 'wd-planned',
				work_date: '2026-03-02',
				shift_definition_id: null,
				worked_intervals: null,
				break_minutes: 0
			}
		]
	});
	assert.deepEqual(claimsOf(measured), []);
});

test('a leaver’s wage window widens the claim, because it widened the measurement', () => {
	// A leaver settling in their final period is measured to their exit date rather than to the end
	// of the attendance window. The claim span is the union of both for exactly that reason.
	const measured = measure({
		attendance: { start: '2026-02-21', end: '2026-03-10' },
		wageDays: { start: '2026-02-21', end: '2026-03-20' },
		ledger: [
			{
				id: 'lr-1',
				leave_type_id: 'lt-1',
				entry_date: '2026-03-15',
				kind: 'TAKEN',
				days: -1,
				source_id: 'lr-1',
				approval_id: null
			}
		]
	});
	assert.deepEqual(claimsOf(measured), [['LEAVE_REQUEST', 'lr-1', 0]]);
});

test('the same source is claimed once, whatever derived it', () => {
	// `unique(source, payslip_id)` would refuse the second row, and the whole run's write would fail
	// on a duplicate that means nothing. The lock pass skips a source an amount already named.
	const day = {
		id: 'wd-1',
		work_date: '2026-03-02',
		shift_definition_id: null,
		worked_intervals: [],
		break_minutes: 0
	};
	const measured = measure({ workDays: [day, { ...day }] });
	assert.deepEqual(claimsOf(measured), [['WORK_DAY', 'wd-1', 0]]);
});

// ── 2. the claim reaches the returned record ────────────────────────────────────────────────────

/**
 * A run that priced attendance takes a lock over every record it read.
 *
 * No api, no `mutate`, no double for one. The run's whole result is a value, so what used to need a
 * fake database to observe is observed by reading the return.
 */
test('a run takes a settlement lock over every record it consumed', () => {
	const graph = payrollRunGraph({
		period: '2026-03',
		pending: [
			{
				employmentId: 'emp-1',
				currency: 'MYR',
				proration: [
					{
						term_id: 'terms-1',
						from: '2026-03-01',
						to: '2026-03-31',
						basis: { by: 'CALENDAR_DAYS' },
						days: 31,
						denominator: 31,
						contract_amount: 1200,
						prorated_amount: 1200
					}
				],
				settlement: {
					gross: 1200,
					totalDeductions: 80,
					net: 1120,
					employerCost: 0,
					base: [
						{
							payComponent: { id: 'pc-salary' },
							nature: 'EARNING',
							label: 'BASIC',
							amount: 1200,
							entry: { pay_component_id: 'pc-salary', amount: 1200 }
						}
					],
					adjustments: [
						{
							source: { kind: 'OBLIGATION', id: 'ob-1' },
							payComponent: { id: 'pc-loan' },
							overtimeBand: null,
							nature: 'DEDUCTION',
							label: 'LOAN',
							amount: 80,
							quantity: null,
							rate: null
						},
						{
							source: { kind: 'WORK_DAY', id: 'wd-1' },
							payComponent: null,
							overtimeBand: {
								day_type: 'ORDINARY',
								measure: 'BEYOND_NORMAL',
								band_from: 0,
								excess: false
							},
							nature: 'EARNING',
							label: 'OT_ORDINARY_BEYOND_NORMAL_0',
							amount: 74.66,
							quantity: 3,
							rate: 16.59
						},
						{
							source: { kind: 'LEAVE_REQUEST', id: 'lr-1' },
							payComponent: null,
							overtimeBand: null,
							nature: 'ABSENCE',
							label: 'LEAVE_2026-03-04',
							amount: 0,
							quantity: null,
							rate: null
						}
					],
					shortfalls: []
				},
				charges: []
			}
		]
	});

	assert.equal(graph.length, 1);
	const payslip = graph[0];
	// Base, proration and statutory are columns on the payslip; only adjustments are a relation.
	assert.deepEqual(payslip.base, [{ pay_component_id: 'pc-salary', amount: 1200 }]);
	assert.equal(payslip.proration.length, 1);
	assert.deepEqual(payslip.statutory, []);

	const rows = payslip.payslip_adjustment_payslip;
	// An adjustment carries no `payslip_id`: nested under the payslip that owns it, the runtime
	// fills the foreign key from the parent it assigned.
	for (const row of rows) assert.equal(Object.hasOwn(row, 'payslip_id'), false);
	assert.deepEqual(
		rows.map((row) => [row.source.kind, row.source.id, row.amount, row.sequence]),
		[
			['OBLIGATION', 'ob-1', 80, 1],
			['WORK_DAY', 'wd-1', 74.66, 2],
			['LEAVE_REQUEST', 'lr-1', 0, 3]
		]
	);
	// Exactly one of the two on every row: a catalogue component, or the band that priced it.
	assert.deepEqual(
		rows.map((row) => [row.pay_component_id, row.overtime_band?.day_type ?? null]),
		[
			['pc-loan', null],
			[null, 'ORDINARY'],
			[null, null]
		]
	);
	// The zero row is a claim, not a figure, and it carries a bucket like any other.
	assert.deepEqual(
		rows.map((row) => row.bucket),
		['DEDUCTION', 'EARNING', 'ABSENCE']
	);
	// The period travels with the lock: two runs of different periods can each hold their own
	// claims, and a release names the payslip rather than sweeping a collection.
	assert.deepEqual([...new Set(rows.map((row) => row.period))], ['2026-03']);
});

/**
 * A rebuild releases the previous build's locks, and nothing in this repository does it.
 *
 * `clearRunResults` used to: a `mutate` stating `payslip_payroll_run: []`, issued before the write
 * that then stated the real list. Both statements said the same thing, because an included `many`
 * relationship is the parent's complete desired state — so the second one already removed what the
 * first one removed, and the pair only added a window in which a failure left a run with no results.
 *
 * What is left is one invariant, and it is load-bearing: the graph must **always state** the
 * relationship. An omitted key means "touch nothing", so a run that produced no payslips and said
 * nothing about them would keep the previous build's — a payroll reporting figures it did not
 * calculate, with locks over records it did not read. Stating an empty list is what deletes them.
 */
test('a build always states its payslips, so a rebuild that produces none releases them all', () => {
	assert.deepEqual(payrollRunGraph({ pending: [], period: '2026-03' }), []);
});

// ── 3. how a claim reads as a refusal ───────────────────────────────────────────────────────────

test('a settled work day refuses mutation, and the refusal names the adjustment path', () => {
	const lock = sourceLock({
		existing: true,
		approvalId: null,
		dates: ['2026-03-02'],
		settledBy: { period: '2026-03' }
	});
	assert.equal(lock.kind, 'SETTLED');
	assert.equal(lock.period, '2026-03');
	assert.equal(sourceLockBlocksWrite(lock), true);
	assert.equal(sourceLockI18nKey(lock), 'component.lock_settled_by_run');

	const message = sourceLockMessage(lock, 'Changing attendance');
	assert.match(message, /Changing attendance/);
	assert.match(message, /2026-03/);
	// The two ways out, both stated. "Locked" on its own sends the person hunting for a setting.
	assert.match(message, /adjustment entry/);
	assert.match(message, /Delete that run/);
});

test('a draft run’s claim locks the record, which the paid-window arithmetic never did', () => {
	// No window is consulted at all — the record lock is the stored claim and nothing else. The old
	// arithmetic froze nothing while the run was still a draft; the claim freezes it the moment the
	// payslip that priced it exists.
	assert.equal(
		sourceLock({ existing: true, approvalId: null, dates: [], settledBy: null }).kind,
		'NONE'
	);
	assert.equal(
		sourceLock({
			existing: true,
			approvalId: null,
			dates: [],
			settledBy: { period: '2026-03' }
		}).kind,
		'SETTLED'
	);
});

test('a pending approval still answers first, because it is the platform’s lock and not ours', () => {
	const lock = sourceLock({
		existing: true,
		approvalId: '019efa4b-b947-755a-990e-53c8da7b855f',
		dates: ['2026-03-02'],
		settledBy: { period: '2026-03' }
	});
	assert.equal(lock.kind, 'PENDING_APPROVAL');
	// And the hooks leave it alone: a pending write is a 409 the platform raises, not a refusal.
	assert.equal(sourceLockBlocksWrite(lock), false);
});

// ── 4. the refusal that makes a paid run's claims permanent ─────────────────────────────────────

test('a PAID payroll run refuses deletion', () => {
	assert.throws(
		() =>
			payrollRunHooks.delete.perRecord.before.handler({
				existing: { id: 'run-1', period: '2026-03', lifecycle: 'PAID' }
			}),
		(error) => {
			assert.match(error.message, /2026-03/);
			assert.match(error.message, /PAID/);
			// The reason, not just the rule: deleting it would cascade its settlement claims away and
			// reopen every record behind money that has already been paid.
			assert.match(error.message, /release every work day, obligation and leave record it settled/);
			assert.match(error.message, /adjustment obligation/);
			return true;
		}
	);
});

test('a DRAFT payroll run may be deleted, which is the only release the lock has', () => {
	assert.doesNotThrow(() =>
		payrollRunHooks.delete.perRecord.before.handler({
			existing: { id: 'run-1', period: '2026-03', lifecycle: 'DRAFT' }
		})
	);
});

// ── 5. the declarations the release depends on ──────────────────────────────────────────────────

test('deleting a payroll run releases its settlement locks — the declarations that cascade', () => {
	/**
	 * What this asserts is the *declaration*, and the title says so because the distinction is real:
	 * the two-hop cascade — run → payslips → adjustments — is performed by Postgres, and what this
	 * workspace controls is that each hop is declared. A single `cascade(` wrapper is the whole of
	 * that declaration: the compiler turns it into `ON DELETE CASCADE` in the migration lineage.
	 *
	 * The alternative — a hook looping over `api.db.<collection>.delete(identifiers)` — would have
	 * been wrong in a way no happy-path test catches, because that call takes `identifiers[0]` and
	 * drops the rest: the release would free one claim out of several hundred and report success.
	 *
	 * The marker is read the only way it can be read from outside the authoring package.
	 */
	const probe = new Proxy(
		{},
		{
			get: (_target, property) =>
				property === 'one' || property === 'many'
					? new Proxy({}, { get: () => () => ({}) })
					: new Proxy({}, { get: () => ({}) })
		}
	);
	const graph = relationships(probe);
	const markersOf = (edge) =>
		Object.getOwnPropertySymbols(edge).map((symbol) => Reflect.get(edge, symbol));

	assert.ok(
		markersOf(graph.payslip_adjustments.payslip_adjustment_payslip).includes('cascade'),
		'payslip_adjustments must cascade from payslips, or deleting a run leaves its locks standing'
	);
	// The first hop, asserted beside it so the two are visibly one chain. If one of them ever
	// renders `ON DELETE CASCADE` and the other does not, this is where that shows up.
	assert.ok(markersOf(graph.payslips.payslip_payroll_run).includes('cascade'));

	/**
	 * And the edge that must NOT cascade, asserted for the same reason.
	 *
	 * `rosters → work_days` was a cascade while the row was only a plan. It is not one now: the same
	 * row carries attendance, and a drafted month must not be able to delete a punch. Deleting a
	 * roster releases its days instead — see `rosters/+hooks.ts`.
	 */
	assert.equal(
		markersOf(graph.work_days.work_day_roster).includes('cascade'),
		false,
		'work_days must not cascade from rosters, or deleting a drafted month deletes attendance'
	);
});
