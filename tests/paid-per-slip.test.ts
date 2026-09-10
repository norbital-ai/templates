// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Payment is a fact of the payslip, not of the run.
 *
 * A run used to move DRAFT → PAID as a block, so "pay everyone or nobody" was the only gesture
 * there was: one person held back for a correction held back the whole company's payment record.
 * `payslips.paid_at` is the authority now and `payroll_runs.lifecycle` is a reading of it — PAID
 * when every slip of the run carries a payment, DRAFT while any does not, which is the
 * conservative answer and keeps every existing settlement lock closed on a half-paid run.
 *
 * The slip is otherwise still immutable engine output. `paid_at` is its one door: it opens once,
 * from empty, and never closes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import payslipHooks from '../src/collections/payslips/+hooks.ts';
import { promoteRunIfFullyPaid } from '../src/collections/payroll_runs/lib/paid.ts';
import { refusalMessage } from './fixtures/memory-payroll-api.ts';

const RUN = { id: 'run-feb', company_id: 'co-1', period: '2026-02' };
const EARLIER = { id: 'run-jan', company_id: 'co-1', period: '2026-01' };

/** A world of runs and slips, answering only the queries these hooks make. */
function world(runs, slips) {
	const written = [];
	const match = (row, where = {}) =>
		Object.entries(where).every(([column, condition]) => {
			const value = row[column];
			if ('eq' in condition) return value === condition.eq;
			if ('lt' in condition) return value < condition.lt;
			if ('in' in condition) return condition.in.includes(value);
			if ('isNull' in condition) return condition.isNull === (value == null);
			if ('isNotNull' in condition) return condition.isNotNull === (value != null);
			return true;
		});
	const table = (rows) => ({
		findMany: ({ where }) => Effect.succeed(rows.filter((row) => match(row, where))),
		findFirst: ({ where }) => Effect.succeed(rows.find((row) => match(row, where)) ?? null),
		mutate: (values) =>
			Effect.sync(() => {
				written.push(...values);
				for (const value of values)
					Object.assign(rows.find((row) => row.id === value.id) ?? {}, value);
			})
	});
	return { api: { db: { payroll_runs: table(runs), payslips: table(slips) } }, written };
}

const pay = (api, existing, paid_at = '2026-02-28') =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* payslipHooks.mutate.perRecord.before.handler({
				input: { id: existing.id, paid_at },
				existing,
				api
			});
		})
	);

const refusalOf = async (run) => {
	try {
		await run();
		return '';
	} catch (error) {
		return refusalMessage(error);
	}
};

test('a run is PAID only when every slip it holds is', async () => {
	const lifecycleOf = async (slips) => {
		const runs = [{ ...RUN, lifecycle: 'DRAFT' }];
		const { api } = world(
			runs,
			slips.map((paid_at, index) => ({
				id: `slip-${index}`,
				payroll_run_id: RUN.id,
				paid_at
			}))
		);
		await Effect.runPromise(promoteRunIfFullyPaid(api, RUN.id));
		return runs[0].lifecycle;
	};
	assert.equal(await lifecycleOf([]), 'DRAFT', 'nothing to pay is not paid');
	assert.equal(await lifecycleOf(['2026-02-28']), 'PAID');
	assert.equal(
		await lifecycleOf(['2026-02-28', null]),
		'DRAFT',
		'half paid reads DRAFT, which keeps every lock closed'
	);
});

test('one person is paid while a colleague is held, and the run stays DRAFT', async () => {
	const slips = [
		{ id: 'slip-a', payroll_run_id: RUN.id, employment_id: 'emp-a', paid_at: null },
		{ id: 'slip-b', payroll_run_id: RUN.id, employment_id: 'emp-b', paid_at: null }
	];
	const runs = [{ ...RUN, lifecycle: 'DRAFT' }];
	const { api, written } = world(runs, slips);
	await pay(api, slips[0]);
	slips[0].paid_at = '2026-02-28';
	await Effect.runPromise(promoteRunIfFullyPaid(api, RUN.id));
	assert.equal(runs[0].lifecycle, 'DRAFT', 'the colleague is still unpaid');
	assert.deepEqual(written, []);

	await pay(api, slips[1]);
	slips[1].paid_at = '2026-02-28';
	await Effect.runPromise(promoteRunIfFullyPaid(api, RUN.id));
	assert.equal(runs[0].lifecycle, 'PAID');
});

test('a person’s own earlier period is paid first, and a colleague’s is not their problem', async () => {
	const slips = [
		{ id: 'jan-a', payroll_run_id: EARLIER.id, employment_id: 'emp-a', paid_at: null },
		{ id: 'jan-b', payroll_run_id: EARLIER.id, employment_id: 'emp-b', paid_at: '2026-01-31' },
		{ id: 'feb-a', payroll_run_id: RUN.id, employment_id: 'emp-a', paid_at: null },
		{ id: 'feb-b', payroll_run_id: RUN.id, employment_id: 'emp-b', paid_at: null }
	];
	const { api } = world(
		[
			{ ...EARLIER, lifecycle: 'DRAFT' },
			{ ...RUN, lifecycle: 'DRAFT' }
		],
		slips
	);
	assert.match(
		await refusalOf(() => pay(api, slips[2])),
		/2026-01 pay is still unpaid/,
		'this person’s own January is owed first'
	);
	// The colleague's January *is* paid, so their February is not held by anybody else's.
	await pay(api, slips[3]);
});

test('paid is a door that opens once and never closes', async () => {
	const paid = {
		id: 'slip-a',
		payroll_run_id: RUN.id,
		employment_id: 'emp-a',
		paid_at: '2026-02-28'
	};
	const { api } = world([{ ...RUN, lifecycle: 'PAID' }], [paid]);
	assert.match(await refusalOf(() => pay(api, paid)), /already paid/);
	assert.match(
		await refusalOf(() => pay(api, { ...paid, paid_at: null }, null)),
		/needs the day it was paid/
	);
});

test('every other column is still engine output', async () => {
	const slip = { id: 'slip-a', payroll_run_id: RUN.id, employment_id: 'emp-a', paid_at: null };
	const { api } = world([{ ...RUN, lifecycle: 'DRAFT' }], [slip]);
	assert.match(
		await refusalOf(() =>
			Effect.runPromise(
				Effect.gen(function* () {
					return yield* payslipHooks.mutate.perRecord.before.handler({
						input: { id: slip.id, net: 1 },
						existing: slip,
						api
					});
				})
			)
		),
		/engine output and cannot be edited/
	);
});

test('a paid slip cannot be deleted, whatever its run reports', () => {
	assert.match(
		refusalMessage(
			(() => {
				try {
					payslipHooks.delete.perRecord.before.handler({
						existing: { id: 'slip-a', paid_at: '2026-02-28' }
					});
					return new Error('');
				} catch (error) {
					return error;
				}
			})()
		),
		/has been paid and cannot be deleted/
	);
	// An unpaid slip still leaves with its draft recalculation.
	payslipHooks.delete.perRecord.before.handler({ existing: { id: 'slip-a', paid_at: null } });
});
