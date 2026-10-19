import assert from 'node:assert/strict';
import { layer } from '@effect/vitest';
import { Deferred, Effect, Fiber, Result } from 'effect';
import { DbError } from '@norbital-ai/bolt/engine';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { eachBatched, Refusal } from '../src/lib/payroll_engine/foundation.js';
import { faultWorkspace, ReadFault } from './native_db.js';

const IDS = [
	'b0000000-0000-4000-8000-000000000001',
	'b0000000-0000-4000-8000-000000000002',
	'b0000000-0000-4000-8000-000000000003'
] as const;
const fixture = Effect.fnUntraced(function* () {
	const t = yield* TestWorkspace;
	const fault = yield* ReadFault;
	fault.clear();
	const read = t.as(t.admin).read;
	const entities = (yield* read('entity', { all: true })).rows;
	const ids = IDS.map((id) => {
		const row = entities.find((row) => row.id === id);
		assert.ok(row);
		return row.id;
	});
	const [first, second, third] = ids;
	assert.ok(first && second && third);
	fault.clear();
	t.count.reset();
	return { read, t, fault, first, second, third };
});

layer(
	faultWorkspace({
		seed: {
			entity: IDS.map((id, index) => ({
				id,
				name: `Entity ${index + 1}`,
				settings_code: 'MY',
				pay_cutoff_day: 1,
				effective_range: { from: '2026-01-01', to: null }
			}))
		}
	})
)('batched native host reads', (it) => {
	it.effect(
		'concurrent keyed reads share one backend request and preserve each selection',
		Effect.fnUntraced(function* () {
			const { read, t, fault, first, second } = yield* fixture();
			const answer = yield* Effect.cached(
				read({
					first: { collection: 'entity', where: { id: { eq: first } }, limit: 1 },
					second: { collection: 'entity', where: { id: { eq: second } }, limit: 1 }
				})
			);
			const results = yield* Effect.all(
				[answer.pipe(Effect.map((got) => got.first)), answer.pipe(Effect.map((got) => got.second))],
				{ concurrency: 'unbounded' }
			);
			assert.deepEqual(
				results.map((page) => page.rows.map((row) => row.id)),
				[[IDS[0]], [IDS[1]]]
			);
			assert.equal(fault.calls(), 1);
			assert.equal(t.count.reads, 1);
		})
	);

	it.effect(
		'limited IN reads retain their limits instead of becoming whole reads',
		Effect.fnUntraced(function* () {
			const { read, first, second, third } = yield* fixture();
			const got = yield* read({
				first: { collection: 'entity', where: { id: { in: [first, second] } }, limit: 1 },
				second: { collection: 'entity', where: { id: { in: [second, third] } }, limit: 1 }
			});
			assert.deepEqual(
				[got.first, got.second].map((page) => page.rows.map((row) => row.id)),
				[[IDS[0]], [IDS[1]]]
			);
		})
	);

	it.effect(
		'batched refusals retain the original reason and the first input refusal',
		Effect.fnUntraced(function* () {
			const first = new Refusal({ message: 'first' }),
				second = new Refusal({ message: 'second' });
			const { read, t, fault } = yield* fixture();
			const result = yield* Effect.flip(
				eachBatched([first, second], read, (error) => Effect.fail(error))
			);
			assert.equal(result, first);
			const backend = DbError.make('XX000', first.message);
			fault.arm(backend);
			assert.equal(yield* Effect.flip(t.db.read([])), backend);
			fault.clear();
		})
	);

	it.effect(
		'a later refusal waits for every walk and preserves the first input failure',
		Effect.fnUntraced(function* () {
			const first = new Refusal({ message: 'first' }),
				second = new Refusal({ message: 'second' });
			const release = yield* Deferred.make<void>(),
				ready = yield* Deferred.make<void>(),
				thirdDone = yield* Deferred.make<void>();
			const completed: number[] = [];
			const { read } = yield* fixture();
			let finished = false;
			const result = yield* Effect.forkChild(
				eachBatched(
					[0, 1, 2],
					read,
					Effect.fnUntraced(function* (index) {
						if (index === 0) {
							yield* Deferred.await(release);
							completed.push(index);
							return yield* Effect.fail(first);
						}
						if (index === 1) {
							yield* Deferred.succeed(ready, undefined);
							return yield* Effect.fail(second);
						}
						completed.push(index);
						yield* Deferred.succeed(thirdDone, undefined);
						return index;
					})
				).pipe(
					Effect.result,
					Effect.tap(() =>
						Effect.sync(() => {
							finished = true;
						})
					)
				)
			);
			yield* Deferred.await(ready);
			yield* Deferred.await(thirdDone);
			assert.equal(finished, false);
			yield* Deferred.succeed(release, undefined);
			const checked = yield* Fiber.join(result);
			assert.ok(Result.isFailure(checked));
			assert.equal(checked.failure, first);
			assert.deepEqual(completed, [2, 0]);
		})
	);

	it.effect(
		'a merged backend failure settles every waiter with the same original error',
		Effect.fnUntraced(function* () {
			const backend = DbError.make('XX000', 'backend failure');
			const { read, fault, first, second } = yield* fixture();
			fault.arm(backend);
			const answer = yield* Effect.cached(
				read({
					first: { collection: 'entity', where: { id: { eq: first } }, limit: 1 },
					second: { collection: 'entity', where: { id: { eq: second } }, limit: 1 }
				})
			);
			const outcomes = yield* Effect.all(
				[
					Effect.result(answer.pipe(Effect.map((got) => got.first))),
					Effect.result(answer.pipe(Effect.map((got) => got.second)))
				],
				{ concurrency: 'unbounded' }
			);
			assert.equal(fault.calls(), 1);
			const initial = outcomes[0];
			assert.ok(initial && Result.isFailure(initial));
			for (const outcome of outcomes) {
				assert.ok(Result.isFailure(outcome));
				assert.equal(outcome.failure, initial.failure);
			}
			fault.clear();
		})
	);
});
