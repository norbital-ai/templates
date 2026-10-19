import assert from 'node:assert/strict';
import { layer } from '@effect/vitest';
import { Effect, Result } from 'effect';
import { DbError } from '@norbital-ai/bolt/engine';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import {
	entityMembers,
	primeEntities,
	versionLookup
} from '../src/lib/payroll_engine/behaviour_runner.ts';
import { faultWorkspace, ReadFault } from './native_db.ts';

const IDS = [
	'e0000000-0000-4000-8000-000000000001',
	'e0000000-0000-4000-8000-000000000002'
] as const;
const fixture = Effect.fnUntraced(function* () {
	const t = yield* TestWorkspace;
	const fault = yield* ReadFault;
	fault.clear();
	const read = t.as(t.admin).read;
	const entities = (yield* read('entity', { all: true })).rows;
	const ids = IDS.map((id) => {
		const entity = entities.find((row) => row.id === id);
		assert.ok(entity);
		return entity.id;
	});
	const [first, second] = ids;
	assert.ok(first && second);
	fault.clear();
	t.count.reset();
	return { read, t, fault, first, second };
});

layer(
	faultWorkspace({
		seed: {
			entity: IDS.map((id, index) => ({
				id,
				name: `Entity ${index + 1}`,
				settings_code: 'SG',
				pay_cutoff_day: 1,
				effective_range: { from: '2020-01-01', to: null }
			}))
		}
	})
)('native entity lookup', (it) => {
	it.effect(
		'concurrent entity lookups share a batch and keep one snapshot per reader',
		Effect.fnUntraced(function* () {
			const { read, t, fault, first, second } = yield* fixture();
			const lookup = yield* versionLookup(read);
			assert.deepEqual(
				yield* Effect.all(
					[first, first, second].map((id) => lookup(id, '2026-10-13')),
					{ concurrency: 'unbounded' }
				),
				[null, null, null]
			);
			assert.equal(fault.calls(), 1);
			assert.equal(t.count.reads, 1);
			yield* lookup(first, '2026-10-14');
			yield* lookup(second, '2026-10-14');
			assert.equal(t.count.reads, 1);
		})
	);

	it.effect(
		'prefetched entities prime the reader without another lookup',
		Effect.fnUntraced(function* () {
			const { read, t, first, second } = yield* fixture();
			const lookup = yield* versionLookup(read);
			const got = yield* read(entityMembers({ id: { in: [first, second] } }));
			yield* primeEntities(lookup, got);
			assert.deepEqual(
				yield* Effect.all(
					[first, second].map((id) => lookup(id, '2026-10-13')),
					{ concurrency: 'unbounded' }
				),
				[null, null]
			);
			assert.equal(t.count.reads, 1);
		})
	);

	it.effect(
		'a failed entity batch settles and caches every failed lookup',
		Effect.fnUntraced(function* () {
			const { read, fault, first, second } = yield* fixture();
			const lookup = yield* versionLookup(read);
			fault.arm(DbError.make('XX000', 'Backend unavailable'));
			const outcomes = yield* Effect.all(
				[first, second].map((id) => Effect.result(lookup(id, '2026-10-13'))),
				{ concurrency: 'unbounded' }
			);
			assert.equal(fault.calls(), 1);
			for (const outcome of outcomes) assert.ok(Result.isFailure(outcome));
			for (const id of [first, second])
				assert.ok(Result.isFailure(yield* Effect.result(lookup(id, '2026-10-14'))));
			assert.equal(fault.calls(), 1);
			fault.clear();
		})
	);
});
