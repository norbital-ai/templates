import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import hooks from '../src/collections/suspicion_reviews/+hooks.js';

type Hook = (context: unknown) => unknown;

const beforeMutate =
	(
		hooks as unknown as {
			readonly mutate?: {
				readonly perRecord?: { readonly before?: { readonly handler: Hook } };
			};
		}
	).mutate?.perRecord?.before?.handler ??
	(() => {
		throw new Error('suspicion_reviews mutate.before hook is missing');
	});

const settle = async (value: unknown): Promise<unknown> =>
	Effect.isEffect(value)
		? Effect.runPromise(value as Effect.Effect<unknown, unknown, never>)
		: value;

test('the immutable review ledger accepts its initial automated create', async () => {
	const input = {
		job_assignment_id: '019f6f10-3000-7000-8000-000000000001',
		basis_hash: 'basis-hash',
		basis: '{}',
		suspicious: false,
		reason: 'No suspicion found.',
		evidence_id: null,
		model: 'openrouter/deepseek/deepseek-v4-flash-vision-exp',
		reviewed_at: '2026-08-28T00:00:00.000Z',
		source_key: 'suspicion-review:assignment:basis-hash'
	};

	assert.deepEqual(await settle(beforeMutate({ input, existing: undefined })), input);
});

test('the immutable review ledger refuses edits after creation', () => {
	assert.throws(
		() =>
			beforeMutate({
				input: { reason: 'Rewritten' },
				existing: { id: '019f6f10-4000-7000-8000-000000000001', reason: 'Original' }
			}),
		{
			_tag: 'Bolt.Authored.Refusal',
			message: 'Automated suspicion reviews cannot be changed after inference.'
		}
	);
});
