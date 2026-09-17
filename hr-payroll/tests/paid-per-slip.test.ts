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
import payslips from '../src/collections/payslips/+collection.ts';
import { payrollRunCascadeGrants } from '../src/lib/policy_grants.ts';
import { transform } from './helpers/transform.ts';
import { refusalMessage } from './fixtures/memory-payroll-api.ts';

const RUN = { id: 'run-feb', company_id: 'co-1', period: '2026-02' };
const EARLIER = { id: 'run-jan', company_id: 'co-1', period: '2026-01' };

/** A world of runs and slips, answering only the queries the transform makes, nested run included. */
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
	const table = (rows, nest = (row) => row) => ({
		findMany: ({ where }) => Effect.succeed(rows.filter((row) => match(row, where)).map(nest)),
		findFirst: ({ where }) => Effect.succeed(rows.find((row) => match(row, where)))
	});
	return {
		api: {
			payroll_runs: table(runs),
			payslips: table(slips, (row) => ({
				...row,
				payslip_payroll_run: runs.find((run) => run.id === row.payroll_run_id) ?? null
			}))
		}
	};
}

const write = (db, existing, input) =>
	transform(payslips, [input], { existing: [existing], db }).then((payloads) => payloads[0]);
const pay = (api, existing, paid_at = '2026-02-28') =>
	write(api, existing, { status: 'PAID', paid_at });
const hold = (api, existing, status) => write(api, existing, { status });

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
	// The transform is a validator: it hands the caller's write back, and the store records it.
	// The colleague is untouched by it.
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
		await refusalOf(() => write(api, draft, { status: 'ON_HOLD', paid_at: '2026-02-28' })),
		/records the day it was paid only when it is paid/,
		'a day alone is not a state change'
	);
});

test('every other column is still engine output: the update input is the payment state alone', () => {
	assert.deepEqual(Object.keys(payslips.update.input.columns), ['status', 'paid_at']);
});

test('a slip is created by its run, never standing alone', async () => {
	assert.equal(payslips.create, undefined, 'no create input: a slip is born under its run');
	const { api } = world([RUN], []);
	assert.match(
		await refusalOf(() => write(api, undefined, { status: 'ON_HOLD' })),
		/must be created by its payroll run/
	);
});

test('a paid slip cannot be deleted, whatever its run reports', () => {
	const authorize = payrollRunCascadeGrants().payslips.delete.authorize;
	assert.equal(
		authorize({ record: slip('slip-a', RUN, 'emp-a', { status: 'PAID', paid_at: '2026-02-28' }) }),
		false
	);
	// An unpaid slip still leaves with its draft recalculation.
	assert.equal(authorize({ record: slip('slip-a', RUN, 'emp-a') }), true);
});
