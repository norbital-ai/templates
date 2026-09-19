import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import claimCatalogue from '../src/collections/claim_catalogue/+collection.ts';
import allowanceCatalogue from '../src/collections/allowance_catalogue/+collection.ts';
import loanCatalogue from '../src/collections/loan_catalogue/+collection.ts';
import { transformOne } from './helpers/transform.ts';

const db = {
	jurisdiction_settings: {
		findMany: ({ where }: { where: { id: { in: readonly string[] } } }) =>
			Effect.succeed(
				where.id.in.map((id) => ({
					id,
					code: 'PUB',
					name: 'Public fixture',
					sealed_at: id === 'sealed' ? '2026-01-01T00:00:00.000Z' : null
				}))
			)
	},
	statutory_contributions: { findMany: () => Effect.succeed([]) }
};
// A loan row must also recover (NET/SUBTRACT); the other families ignore the two columns.
const catalogue = {
	id: 'catalogue',
	settings_id: 'sealed',
	code: 'TRAVEL',
	destination: 'NET',
	direction: 'SUBTRACT'
};
const sealed = /is sealed, so it cannot be created, changed or deleted/;

for (const [family, collection] of [
	['Claim', claimCatalogue],
	['Allowance', allowanceCatalogue],
	['Loan', loanCatalogue]
] as const) {
	const mutate = (input: Record<string, unknown>, existing?: Record<string, unknown>) =>
		transformOne(collection, input, existing, db);

	test(`${family} catalogue history cannot be created, changed or moved across a seal`, () => {
		assert.throws(() => mutate(catalogue), sealed);
		assert.throws(() => mutate({ code: 'CORRECTED' }, catalogue), sealed);
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
	});
}
