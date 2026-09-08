import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import claimHooks from '../src/collections/claim_catalogue/+hooks.ts';
import allowanceHooks from '../src/collections/allowance_catalogue/+hooks.ts';
import paymentHooks from '../src/collections/payment_catalogue/+hooks.ts';
import loanHooks from '../src/collections/loan_catalogue/+hooks.ts';

const api = {
	db: {
		jurisdiction_settings: {
			findFirst: ({ where }: { where: { id: { eq: string } } }) =>
				Effect.succeed({
					id: where.id.eq,
					code: 'PUB',
					name: 'Public fixture',
					sealed_at: where.id.eq === 'sealed' ? '2026-01-01T00:00:00.000Z' : null
				})
		}
	}
};
const catalogue = { id: 'catalogue', settings_id: 'sealed', code: 'TRAVEL' };
const sealed = /is sealed, so it cannot be created, changed or deleted/;

for (const [family, hooks] of [
	['Claim', claimHooks],
	['Allowance', allowanceHooks],
	['Payment', paymentHooks],
	['Loan', loanHooks]
] as const) {
	const mutate = (input: Record<string, unknown>, existing?: Record<string, unknown>) =>
		Effect.runSync(hooks.mutate.perRecord.before.handler({ input, existing, api } as never));
	const remove = (existing: Record<string, unknown>) =>
		Effect.runSync(hooks.delete.perRecord.before.handler({ existing, api } as never));

	test(`${family} catalogue history cannot be created, changed, deleted or moved across a seal`, () => {
		assert.throws(() => mutate(catalogue), sealed);
		assert.throws(() => mutate({ code: 'CORRECTED' }, catalogue), sealed);
		assert.throws(() => remove(catalogue), sealed);
		assert.throws(() => mutate({ settings_id: 'draft' }, catalogue), sealed);
		assert.throws(
			() => mutate({ settings_id: 'sealed' }, { ...catalogue, settings_id: 'draft' }),
			sealed
		);
	});

	test(`${family} catalogue drafts remain editable and movable between draft versions`, () => {
		const draft = { ...catalogue, settings_id: 'draft' };
		assert.deepEqual(mutate(draft), draft);
		assert.deepEqual(mutate({ code: 'CORRECTED' }, draft), { code: 'CORRECTED' });
		assert.deepEqual(mutate({ settings_id: 'next-draft' }, draft), {
			settings_id: 'next-draft'
		});
		assert.doesNotThrow(() => remove(draft));
	});
}
