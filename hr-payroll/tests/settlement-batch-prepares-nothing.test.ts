// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A payroll run's pin of two thousand work days is a batch of `{ id, payslip_id }` writes. Its
 * per-record handler returns before it reads anything prepared, so `prepare` must read nothing
 * for it: re-validating the whole roster was nine reads across the isolate to decide nothing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import workDayHooks from '../src/collections/work_days/+hooks.ts';

const reads = [];
const api = new Proxy(
	{},
	{
		get: (_target, collection) =>
			new Proxy(
				{},
				{
					get: (_inner, method) => () => {
						reads.push(`${String(collection)}.${String(method)}`);
						return Effect.succeed([]);
					}
				}
			)
	}
);

test('a settlement-only batch prepares nothing and reads nothing', async () => {
	const inputs = Array.from({ length: 50 }, (_, index) => ({
		id: `day-${index}`,
		row_version: 1,
		payslip_id: 'slip-1'
	}));
	const prepared = await Effect.runPromise(
		workDayHooks.mutate.prepare({ inputs, api: { db: api } })
	);
	assert.deepEqual(reads, []);
	assert.equal(prepared.holidayByDay.size, 0);
	// The per-record handler takes the same early return, untouched by the empty preparation.
	const out = await Effect.runPromise(
		workDayHooks.mutate.perRecord.before.handler({
			input: inputs[0],
			existing: { id: 'day-0', employment_id: 'emp-1', work_date: '2026-03-10', payslip_id: null },
			prepared,
			api: { db: api },
			recordId: 'day-0'
		})
	);
	assert.deepEqual(out, inputs[0]);
});

test('a batch with one real edit still prepares in full', async () => {
	reads.length = 0;
	const inputs = [
		{ id: 'day-0', row_version: 1, payslip_id: 'slip-1' },
		{ id: 'day-1', shift_definition_id: 'shift-2' }
	];
	await Effect.runPromise(workDayHooks.mutate.prepare({ inputs, api: { db: api } })).catch(
		() => {}
	);
	assert.ok(reads.length > 0, 'the roster validation reads ran');
});
