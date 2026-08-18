// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The settlement lock: taken when a run persists, released when the run is deleted, and permanent
 * once the run is paid.
 *
 * Four things are exercised here and they are deliberately four different kinds of check, because
 * the lock is enforced in four different places:
 *
 *   1. `claimsForBundle` — what a run claims. Pure arithmetic over one gathered bundle.
 *   2. `sourceLock` — how a claim reads as a refusal. Pure, shared verbatim with the screens.
 *   3. `payroll_runs` `delete.before` — the refusal that makes a PAID run's claims permanent. The
 *      real authored handler, called directly.
 *   4. `clearRunResults` — the rebuild's release. The real function, against a database double whose
 *      whole surface is the three calls that function makes.
 *
 * What is *not* exercised is the cascade itself, because Postgres performs it. What is checked is
 * that the cascade is declared, which is the only thing this workspace controls: see the last test.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';

import { claimsForBundle, dedupeClaims } from './lib/claims.ts';
import { clearRunResults } from './lib/persist.ts';
import payrollRunHooks from './+hooks.ts';
import relationships from '../+relationship.ts';
import {
	sourceLock,
	sourceLockBlocksWrite,
	sourceLockMessage,
	sourceLockI18nKey,
	payrollWindows
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

test('a run claims the attendance it priced and not the months it only counted', () => {
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
		claims.map((claim) => claim.source_record_id),
		['te-in', 'te-edge-start', 'te-edge-end']
	);
	for (const claim of claims) assert.equal(claim.source_collection, 'time_entries');
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
	assert.deepEqual(claims, [{ source_collection: 'leave_requests', source_record_id: 'lr-1' }]);
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
	// The unique index on (source_collection, source_record_id) would refuse the second row, and the
	// whole run's persist would fail on a duplicate that means nothing.
	assert.deepEqual(
		dedupeClaims([
			{ source_collection: 'time_entries', source_record_id: 'te-1' },
			{ source_collection: 'time_entries', source_record_id: 'te-1' },
			{ source_collection: 'leave_requests', source_record_id: 'te-1' }
		]),
		[
			{ source_collection: 'time_entries', source_record_id: 'te-1' },
			{ source_collection: 'leave_requests', source_record_id: 'te-1' }
		]
	);
});

test('a settled time entry refuses mutation, and the refusal names the adjustment path', () => {
	const lock = sourceLock({
		existing: true,
		approvalId: null,
		dates: ['2026-03-02'],
		today: '2026-04-01',
		// No paid window anywhere: this is the regression the stored lock exists for. Under the old
		// date arithmetic alone this record was fully editable.
		windows: [],
		settledBy: { period: '2026-03' }
	});
	assert.equal(lock.kind, 'SETTLED_BY_RUN');
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
	const drafts = payrollWindows([
		{
			period: '2026-03',
			lifecycle: 'DRAFT',
			attendance_from: '2026-02-21',
			attendance_to: '2026-03-20'
		}
	]);
	const shared = {
		existing: true,
		approvalId: null,
		dates: ['2026-03-02'],
		today: '2026-03-25',
		windows: drafts
	};

	// The old behaviour, preserved so the difference is visible: a draft window freezes nothing.
	assert.equal(sourceLock({ ...shared, settledBy: null }).kind, 'DATE_PASSED');
	// The new behaviour: the run wrote payslips citing this record, so the record cannot move.
	assert.equal(sourceLock({ ...shared, settledBy: { period: '2026-03' } }).kind, 'SETTLED_BY_RUN');
});

test('the settlement lock outranks the window, so the refusal can name the run', () => {
	// Both apply. The stored claim wins because it is the only one that knows which run to delete.
	const lock = sourceLock({
		existing: true,
		approvalId: null,
		dates: ['2026-03-02'],
		today: '2026-04-01',
		windows: payrollWindows([
			{
				period: '2026-03',
				lifecycle: 'PAID',
				attendance_from: '2026-02-21',
				attendance_to: '2026-03-20'
			}
		]),
		settledBy: { period: '2026-03' }
	});
	assert.equal(lock.kind, 'SETTLED_BY_RUN');
});

test('a pending approval still answers first, because it is the platform’s lock and not ours', () => {
	const lock = sourceLock({
		existing: true,
		approvalId: '019efa4b-b947-755a-990e-53c8da7b855f',
		dates: ['2026-03-02'],
		today: '2026-04-01',
		windows: [],
		settledBy: { period: '2026-03' }
	});
	assert.equal(lock.kind, 'PENDING_APPROVAL');
	// And the hooks leave it alone: a pending write is a 409 the platform raises, not a refusal.
	assert.equal(sourceLockBlocksWrite(lock), false);
});

test('a PAID payroll run refuses deletion', () => {
	assert.throws(
		() =>
			payrollRunHooks.delete.before.handler({
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
		payrollRunHooks.delete.before.handler({
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
	return {
		db: {
			query: {
				payroll_settlements: find('payroll_settlements'),
				payslips: find('payslips')
			},
			delete: (collection, identifiers) => {
				deleted.push([collection, [...identifiers]]);
				state[collection] = state[collection].filter(
					(row) => !identifiers.includes(row.norbital_id)
				);
				return Effect.succeed(undefined);
			}
		}
	};
}

test('rebuilding a draft releases its settlement locks before its payslips', () => {
	const state = {
		payroll_settlements: [
			{ norbital_id: 's-1', payroll_run_id: 'run-1' },
			{ norbital_id: 's-2', payroll_run_id: 'run-1' },
			{ norbital_id: 's-other', payroll_run_id: 'run-2' }
		],
		payslips: [
			{ norbital_id: 'p-1', payroll_run_id: 'run-1' },
			{ norbital_id: 'p-other', payroll_run_id: 'run-2' }
		]
	};
	const deleted = [];

	Effect.runSync(clearRunResults(fakeApi(state, deleted), 'run-1'));

	// Locks first. The unique index on (source_collection, source_record_id) means a rebuild that
	// re-claimed a record it still held would be refused by the database — the release is what makes
	// the rebuild idempotent rather than self-blocking.
	assert.deepEqual(deleted, [
		['payroll_settlements', ['s-1', 's-2']],
		['payslips', ['p-1']]
	]);
	// Another run's claims are untouched. This is why the lock is keyed to a run and not a boolean.
	assert.deepEqual(
		state.payroll_settlements.map((row) => row.norbital_id),
		['s-other']
	);
});

test('deleting a payroll run releases its settlement locks — the declaration, not the cascade', () => {
	/**
	 * What this asserts is the *declaration*, and the title says so because the distinction is real:
	 * `cascade()` sets a non-enumerable symbol that has exactly one occurrence in the bolt package —
	 * its own definition — and the migration lineage emits no `ON DELETE` clause for any relation in
	 * this workspace. So no cascade runs today, for settlements or for the `payslips` relation that
	 * carries the identical declaration.
	 *
	 * It is still worth pinning. The declaration is the whole of what this workspace controls, it is
	 * the release the design chose, and it is one symbol away from working. The alternative — a hook
	 * looping over `api.db.<collection>.delete(identifiers)` — would have been wrong in a way no
	 * happy-path test catches, because that call takes `identifiers[0]` and drops the rest: the
	 * release would free one claim out of several hundred and report success.
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
	const relationship = graph.payroll_settlements.settlement_payroll_run;
	const markers = Object.getOwnPropertySymbols(relationship).map((symbol) =>
		Reflect.get(relationship, symbol)
	);
	assert.ok(
		markers.includes('cascade'),
		'payroll_settlements must cascade from payroll_runs, or a deleted run leaves its locks standing'
	);

	// The sibling declaration, asserted beside it so the two are visibly the same statement. If one
	// of them ever renders `ON DELETE CASCADE` and the other does not, this is where that shows up.
	const payslips = graph.payslips.payslip_payroll_run;
	assert.ok(
		Object.getOwnPropertySymbols(payslips)
			.map((symbol) => Reflect.get(payslips, symbol))
			.includes('cascade')
	);
});
