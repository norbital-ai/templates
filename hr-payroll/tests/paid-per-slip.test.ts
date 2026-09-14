// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Payment is a fact of the payslip, not of the run.
 *
 * A run used to move DRAFT → PAID as a block, so "pay everyone or nobody" was the only gesture
 * there was: one person held back for a correction held back the whole company's payment record.
 * `payslips.status` is the authority now; a run carries no state of its own, and its progress is
 * read from the slips it holds.
 *
 * The slip is otherwise still immutable engine output. `status` and `paid_at` are its only doors:
 * `DRAFT ↔ ON_HOLD`, then either to `PAID` with the day it happened, which is terminal.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import payslipHooks from '../src/collections/payslips/+hooks.ts';
import { refusalMessage } from './fixtures/memory-payroll-api.ts';

const RUN = { id: 'run-feb', company_id: 'co-1', period: '2026-02' };
const EARLIER = { id: 'run-jan', company_id: 'co-1', period: '2026-01' };

/** A world of runs and slips, answering only the queries these hooks make. */
function world(runs, slips) {
	const match = (row, where = {}) =>
		Object.entries(where).every(([column, condition]) => {
			const value = row[column];
			if ('eq' in condition) return value === condition.eq;
			if ('ne' in condition) return value !== condition.ne;
			if ('lt' in condition) return value < condition.lt;
			if ('in' in condition) return condition.in.includes(value);
			if ('isNull' in condition) return condition.isNull === (value == null);
			if ('isNotNull' in condition) return condition.isNotNull === (value != null);
			return true;
		});
	const table = (rows) => ({
		findMany: ({ where }) => Effect.succeed(rows.filter((row) => match(row, where))),
		findFirst: ({ where }) => Effect.succeed(rows.find((row) => match(row, where)) ?? null)
	});
	const empty = table([]);
	return {
		api: {
			db: {
				payroll_runs: table(runs),
				payslips: table(slips),
				work_days: empty,
				claim_requests: empty,
				payment_requests: empty,
				allowance_requests: empty,
				leave_entries: empty,
				loan_repayments: empty
			}
		}
	};
}

const pay = (api, existing, paid_at = '2026-02-28') =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* payslipHooks.mutate.perRecord.before.handler({
				input: { id: existing.id, status: 'PAID', paid_at },
				existing,
				api
			});
		})
	);

const hold = (api, existing, status) =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* payslipHooks.mutate.perRecord.before.handler({
				input: { id: existing.id, status },
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

const slip = (id, run, employment, overrides = {}) => ({
	id,
	payroll_run_id: run.id,
	employment_id: employment,
	status: 'DRAFT',
	paid_at: null,
	...overrides
});

test('one person is paid while a colleague is held, and nothing about the run moves', async () => {
	const slips = [slip('slip-a', RUN, 'emp-a'), slip('slip-b', RUN, 'emp-b')];
	const { api } = world([RUN], slips);
	await pay(api, slips[0]);
	// The hook is a validator: it hands the caller's write back, and the store records it. The
	// colleague is untouched by it.
	assert.equal(slips[1].status, 'DRAFT');
	assert.equal(slips[1].paid_at, null);
	await pay(api, slips[1]);
});

test('a person’s own earlier period is paid first, and a colleague’s is not their problem', async () => {
	const slips = [
		slip('jan-a', EARLIER, 'emp-a'),
		slip('jan-b', EARLIER, 'emp-b', { status: 'PAID', paid_at: '2026-01-31' }),
		slip('feb-a', RUN, 'emp-a'),
		slip('feb-b', RUN, 'emp-b')
	];
	const { api } = world([EARLIER, RUN], slips);
	assert.match(
		await refusalOf(() => pay(api, slips[2])),
		/2026-01 pay is still unpaid/,
		'this person’s own January is owed first'
	);
	// The colleague's January *is* paid, so their February is not held by anybody else's.
	await pay(api, slips[3]);
});

test('paid is a door that opens once and never closes', async () => {
	const paid = slip('slip-a', RUN, 'emp-a', { status: 'PAID', paid_at: '2026-02-28' });
	const { api } = world([RUN], [paid]);
	assert.match(
		await refusalOf(() => hold(api, paid, 'DRAFT')),
		/already paid/,
		'a paid slip cannot be un-paid'
	);
	assert.match(await refusalOf(() => pay(api, paid)), /already paid/);
	assert.match(
		await refusalOf(() => pay(api, slip('slip-b', RUN, 'emp-a'), null)),
		/needs the day it was paid/,
		'paid without a day is not a payment'
	);
});

test('hold is a reviewed slip kept back, released back to draft, and still payable', async () => {
	const held = slip('slip-a', RUN, 'emp-a');
	const { api } = world([RUN], [held]);
	await hold(api, held, 'ON_HOLD');
	await hold(api, { ...held, status: 'ON_HOLD' }, 'DRAFT');
	await pay(api, { ...held, status: 'ON_HOLD' });
});

test('paid_at travels only with PAID', async () => {
	const draft = slip('slip-a', RUN, 'emp-a');
	const { api } = world([RUN], [draft]);
	assert.match(
		await refusalOf(() =>
			Effect.runPromise(
				Effect.gen(function* () {
					return yield* payslipHooks.mutate.perRecord.before.handler({
						input: { id: draft.id, status: 'ON_HOLD', paid_at: '2026-02-28' },
						existing: draft,
						api
					});
				})
			)
		),
		/records the day it was paid only when it is paid/,
		'a day alone is not a state change'
	);
});

test('every other column is still engine output', async () => {
	const draft = slip('slip-a', RUN, 'emp-a');
	const { api } = world([RUN], [draft]);
	assert.match(
		await refusalOf(() =>
			Effect.runPromise(
				Effect.gen(function* () {
					return yield* payslipHooks.mutate.perRecord.before.handler({
						input: { id: draft.id, net: 1 },
						existing: draft,
						api
					});
				})
			)
		),
		/engine output and cannot be edited/
	);
});

test('a slip is created by its run, never standing alone', async () => {
	const { api } = world([RUN], []);
	assert.match(
		await refusalOf(() =>
			Effect.runPromise(
				Effect.gen(function* () {
					return yield* payslipHooks.mutate.perRecord.before.handler({
						input: { id: 'slip-new' },
						parent: undefined,
						api
					});
				})
			)
		),
		/must be created by its payroll run/
	);
});

test('a paid slip cannot be deleted, whatever its run reports', () => {
	const remove = (api, existing) => {
		try {
			Effect.runSync(payslipHooks.delete.perRecord.before.handler({ existing, api }));
			return '';
		} catch (error) {
			return refusalMessage(error);
		}
	};
	assert.match(
		remove(
			world([RUN], []).api,
			slip('slip-a', RUN, 'emp-a', { status: 'PAID', paid_at: '2026-02-28' })
		),
		/has been paid and cannot be deleted/
	);
	// An unpaid slip still leaves with its draft recalculation.
	assert.equal(remove(world([RUN], []).api, slip('slip-a', RUN, 'emp-a')), '');
});
