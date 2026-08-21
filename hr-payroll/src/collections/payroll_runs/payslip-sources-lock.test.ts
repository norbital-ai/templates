// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The settlement lock: taken when a run persists, released when the payslip that holds it is
 * deleted, and permanent once the run is paid.
 *
 * Four things are exercised here and they are deliberately four different kinds of check, because
 * the lock is enforced in four different places:
 *
 *   1. `claimsForBundle` — what a payslip claims. Pure arithmetic over one gathered bundle.
 *   2. `sourceLock` — how a claim reads as a refusal. Pure, shared verbatim with the screens.
 *   3. `payroll_runs` `delete.before` — the refusal that makes a PAID run's claims permanent. The
 *      real authored handler, called directly.
 *   4. `clearRunResults` — the rebuild's release. The real function, against a database double whose
 *      whole surface is the two calls that function makes.
 *
 * What is *not* exercised is the cascade itself, because Postgres performs it. What is checked is
 * that the cascade is declared, which is the only thing this workspace controls: see the last test.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';

import { claimsForBundle, dedupeClaims } from './lib/claims.ts';
import { clearRunResults, persistPayslips } from './lib/persist.ts';
import payrollRunHooks from './+hooks.ts';
import relationships from '../+relationship.ts';
import {
	sourceLock,
	sourceLockBlocksWrite,
	sourceLockMessage,
	sourceLockI18nKey
} from '../../lib/scheduling/lock.ts';

const MARCH = { start: '2026-02-21', end: '2026-03-20' };

/** Enough of a gathered bundle for the claim rule, and nothing that would add noise. */
const bundle = (overrides = {}) => ({
	employment: { norbital_id: 'emp-1', employee_number: 'NHPMY0023' },
	attendance: MARCH,
	wageDays: MARCH,
	deferral: null,
	timeEntries: [],
	ledger: [],
	...overrides
});

test('a payslip claims the attendance it priced and not the months it only counted', () => {
	// GATHER reads both calendar months the cutoff touches, so the statutory overtime counter can
	// reset on the 1st. Those extra days belong to a neighbouring period: locking them would freeze
	// attendance that no run has settled.
	const claims = claimsForBundle(
		bundle({
			timeEntries: [
				{ norbital_id: 'te-in', work_date: '2026-03-02' },
				{ norbital_id: 'te-edge-start', work_date: '2026-02-21' },
				{ norbital_id: 'te-edge-end', work_date: '2026-03-20' },
				{ norbital_id: 'te-before', work_date: '2026-02-20' },
				{ norbital_id: 'te-after', work_date: '2026-03-21' }
			]
		})
	);
	assert.deepEqual(
		claims.map((claim) => ('time_entry_id' in claim ? claim.time_entry_id : null)),
		['te-in', 'te-edge-start', 'te-edge-end']
	);
	for (const claim of claims) assert.equal(claim.kind, 'TIME_ENTRY');
});

test('a leaver’s wage window widens the claim, because it widened the measurement', () => {
	// A leaver settling in their final period is measured to their exit date rather than to the end
	// of the attendance window. The claim is the union of both spans for exactly that reason.
	const claims = claimsForBundle(
		bundle({
			attendance: { start: '2026-02-21', end: '2026-03-10' },
			wageDays: { start: '2026-02-21', end: '2026-03-20' },
			ledger: [{ norbital_id: 'lr-1', entry_date: '2026-03-15' }]
		})
	);
	assert.deepEqual(claims, [{ kind: 'LEAVE_REQUEST', leave_request_id: 'lr-1' }]);
});

test('a deferred joining period claims nothing, because it consumed nothing', () => {
	// Its money becomes an arrears entry the *next* run prices, and that run has to be able to read
	// this attendance. A claim here would lock the input to a calculation that has not happened.
	assert.deepEqual(
		claimsForBundle(
			bundle({
				deferral: { period: '2026-02' },
				timeEntries: [{ norbital_id: 'te-1', work_date: '2026-03-02' }]
			})
		),
		[]
	);
});

test('the same record is claimed once, whatever derived it twice', () => {
	// The partial unique indexes on the typed source foreign keys would refuse the second row, and
	// the whole run's persist would fail on a duplicate that means nothing.
	assert.deepEqual(
		dedupeClaims([
			{ kind: 'TIME_ENTRY', time_entry_id: 'te-1' },
			{ kind: 'TIME_ENTRY', time_entry_id: 'te-1' },
			{ kind: 'LEAVE_REQUEST', leave_request_id: 'te-1' }
		]),
		[
			{ kind: 'TIME_ENTRY', time_entry_id: 'te-1' },
			{ kind: 'LEAVE_REQUEST', leave_request_id: 'te-1' }
		]
	);
});

test('a settled time entry refuses mutation, and the refusal names the adjustment path', () => {
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

test('a PAID payroll run refuses deletion', () => {
	assert.throws(
		() =>
			payrollRunHooks.delete.perRecord.before.handler({
				existing: { norbital_id: 'run-1', period: '2026-03', lifecycle: 'PAID' }
			}),
		(error) => {
			assert.match(error.message, /2026-03/);
			assert.match(error.message, /PAID/);
			// The reason, not just the rule: deleting it would cascade its settlement claims away and
			// reopen every record behind money that has already been paid.
			assert.match(error.message, /release every attendance, entry and leave record it settled/);
			assert.match(error.message, /adjustment entry/);
			return true;
		}
	);
});

test('a DRAFT payroll run may be deleted, which is the only release the lock has', () => {
	assert.doesNotThrow(() =>
		payrollRunHooks.delete.perRecord.before.handler({
			existing: { norbital_id: 'run-1', period: '2026-03', lifecycle: 'DRAFT' }
		})
	);
});

/**
 * A database double whose surface is exactly the calls `clearRunResults` makes.
 *
 * Narrow on purpose. A broader fake would be a second, silently divergent description of the
 * authoring api, and the one thing this has to be right about is which rows a release removes.
 */
function fakeApi(state, deleted) {
	const find = (collection) => ({
		findMany: ({ where }) =>
			Effect.succeed(
				state[collection].filter((row) => row.payroll_run_id === where.payroll_run_id.eq)
			)
	});
	// A collection is reached as a property, the one way the authoring api offers: `db.<name>.delete`,
	// beside `db.query.<name>.findMany`.
	const remove = (collection) => ({
		delete: (identifiers) => {
			deleted.push([collection, [...identifiers]]);
			state[collection] = state[collection].filter((row) => !identifiers.includes(row.norbital_id));
			return Effect.succeed(undefined);
		}
	});
	return {
		db: {
			query: {
				payslips: find('payslips')
			},
			payslips: remove('payslips')
		}
	};
}

test('rebuilding a draft releases its settlement locks with its payslips', () => {
	const state = {
		payslips: [
			{ norbital_id: 'p-1', payroll_run_id: 'run-1' },
			{ norbital_id: 'p-other', payroll_run_id: 'run-2' }
		]
	};
	const deleted = [];

	Effect.runSync(clearRunResults(fakeApi(state, deleted), 'run-1'));

	// The payslips are all that is deleted. Their source rows go with them by the database's own
	// cascade — `payslip_sources.payslip_id` is `ON DELETE CASCADE` — so a rebuild cannot re-claim
	// against its own stale rows, and there is nothing left for this function to release.
	assert.deepEqual(deleted, [['payslips', ['p-1']]]);
	// Another run's payslips are untouched. This is why the lock is keyed to a run and not a boolean.
	assert.deepEqual(
		state.payslips.map((row) => row.norbital_id),
		['p-other']
	);
});

test('deleting a payroll run releases its settlement locks — the declarations that cascade', () => {
	/**
	 * What this asserts is the *declaration*, and the title says so because the distinction is real:
	 * the two-hop cascade — run → payslips → source rows — is performed by Postgres, and what this
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
	const sources = graph.payslip_sources.payslip_source_payslip;
	const markers = Object.getOwnPropertySymbols(sources).map((symbol) =>
		Reflect.get(sources, symbol)
	);
	assert.ok(
		markers.includes('cascade'),
		'payslip_sources must cascade from payslips, or deleting a run leaves its locks standing'
	);

	// The first hop, asserted beside it so the two are visibly one chain. If one of them ever
	// renders `ON DELETE CASCADE` and the other does not, this is where that shows up.
	const payslips = graph.payslips.payslip_payroll_run;
	assert.ok(
		Object.getOwnPropertySymbols(payslips)
			.map((symbol) => Reflect.get(payslips, symbol))
			.includes('cascade')
	);
});

/**
 * The write itself: a run that priced attendance takes a lock over every record it read.
 *
 * The tests above prove the claim is *derived* correctly and *released* correctly. This one proves
 * it is *taken* — that `persistPayslips` turns those claims into `payslip_sources` rows keyed to
 * the payslip that consumed them. It exists because the live demonstration is currently
 * unreachable: every seeded company whose attendance falls inside a run's window is blocked by a
 * different data gap — a missing public-holiday overtime rule, a calendar with no working days, an
 * unsupported pay cadence, an employment with no terms — so a real run either computes with
 * nothing to consume or refuses before PERSIST. The mechanism is testable regardless of whether
 * the fixtures can reach it.
 */
test('a run takes a settlement lock over every record it consumed', async () => {
	const written = [];
	const api = {
		db: {
			query: {
				payslips: { findMany: () => Effect.succeed([]) }
			},
			payslips: {
				mutate: (rows) =>
					Effect.succeed(
						rows.map((row, index) => ({ ...row, norbital_id: `payslip-${index + 1}` }))
					)
			},
			payslip_lines: { mutate: () => Effect.succeed([]) },
			payslip_sources: {
				mutate: (rows) => {
					written.push(...rows);
					return Effect.succeed(rows);
				}
			}
		}
	};

	const result = await Effect.runPromise(
		persistPayslips({
			api,
			runId: 'run-1',
			period: '2026-03',
			pending: [
				{
					employmentId: 'emp-1',
					currency: 'MYR',
					settlement: {
						lines: [
							{
								nature: 'EARNING',
								amount: 1200,
								quantity: null,
								rate: null,
								component: { kind: 'SCHEDULE', pay_component_id: 'pc-salary' }
							},
							{
								nature: 'DEDUCTION',
								amount: 80,
								quantity: null,
								rate: null,
								component: {
									kind: 'COMPONENT_ENTRY_ONCE',
									pay_component_id: 'pc-allowance',
									component_entry_id: 'ce-1'
								}
							},
							{
								nature: 'DEDUCTION',
								amount: 50,
								quantity: null,
								rate: null,
								component: {
									kind: 'LOAN_INSTALMENT',
									pay_component_id: 'pc-loan',
									agreement_id: 'ag-1',
									sequence: 1
								}
							}
						],
						shortfalls: []
					},
					charges: [],
					claims: [
						{ kind: 'TIME_ENTRY', time_entry_id: 'te-1' },
						{ kind: 'LEAVE_REQUEST', leave_request_id: 'lv-1' }
					]
				}
			]
		})
	);

	// Attendance and leave need source rows because neither naturally produces a payslip line.
	// Component entries and loan instalments are already direct generated foreign keys on the lines.
	assert.equal(result.claimCount, 2);
	assert.deepEqual(
		written.map((row) => [
			row.payslip_id,
			row.source.kind,
			row.source.kind === 'TIME_ENTRY' ? row.source.time_entry_id : row.source.leave_request_id
		]),
		[
			['payslip-1', 'TIME_ENTRY', 'te-1'],
			['payslip-1', 'LEAVE_REQUEST', 'lv-1']
		]
	);
	// The period travels with the lock: two runs of different periods can each hold their own
	// claims, and a release names the payslip rather than sweeping a collection.
	assert.deepEqual([...new Set(written.map((row) => row.period))], ['2026-03']);
});
