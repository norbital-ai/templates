// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import claimCatalogue from '../src/data/collection/claim_catalogue/+collection.ts';
import adhocCatalogue from '../src/data/collection/adhoc_catalogue/+collection.ts';
import allowanceCatalogue from '../src/data/collection/allowance_catalogue/+collection.ts';
import leaveCatalogue from '../src/data/collection/leave_catalogue/+collection.ts';
import { runTransform } from './helpers/ctx.ts';

const version = (id: string, sealed: boolean) => ({
	id,
	code: 'PUB',
	name: 'Public fixture',
	sealed_at: sealed ? '2026-01-01T00:00:00.000Z' : null
});
const tables = {
	jurisdiction_settings: [
		version('sealed', true),
		version('draft', false),
		version('next-draft', false)
	],
	statutory_contributions: []
};
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
	['Ad hoc', adhocCatalogue],
	['Allowance', allowanceCatalogue],
	['Leave', leaveCatalogue]
] as const) {
	const mutate = async (input: Record<string, unknown>, existing?: Record<string, unknown>) =>
		(await runTransform(collection, [input], { tables, existing: [existing] }))[0];

	test(`${family} catalogue history cannot be created, changed or moved across a seal`, async () => {
		await assert.rejects(mutate(catalogue), sealed);
		await assert.rejects(mutate({ code: 'CORRECTED' }, catalogue), sealed);
		await assert.rejects(mutate({ settings_id: 'draft' }, catalogue), sealed);
		await assert.rejects(
			mutate({ settings_id: 'sealed' }, { ...catalogue, settings_id: 'draft' }),
			sealed
		);
	});

	test(`${family} catalogue drafts remain editable and movable between draft versions`, async () => {
		const draft = { ...catalogue, settings_id: 'draft' };
		assert.deepEqual(await mutate(draft), draft);
		assert.deepEqual(await mutate({ code: 'CORRECTED' }, draft), { code: 'CORRECTED' });
		assert.deepEqual(await mutate({ settings_id: 'next-draft' }, draft), {
			settings_id: 'next-draft'
		});
	});
}
