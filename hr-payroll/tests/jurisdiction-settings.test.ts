// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The settings lineage: a draft is judged whole, a sealed version is frozen but for a shortened period and one void,
 * sealed versions never overlap, and a successor is a clone of every row under the version.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import settings from '../src/data/collection/jurisdiction_settings/+collection.ts';
import relationships from '../src/data/+relationship.ts';
import { sealWrites } from '../src/lib/settings_version_seal.ts';
import { action, caller, transform } from './helpers/bodies.ts';

const version = (id, from, to, sealed = true) => ({
	id,
	code: 'MY',
	jurisdiction_code: 'MY',
	name: `MY ${from}`,
	sealed_at: sealed ? `${from}T00:00:00.000Z` : null,
	voided_at: null,
	void_reason: null,
	approval_id: null,
	payroll: { currency: 'MYR' },
	facts: [],
	exit_facts: [],
	obligations: [],
	effective_range: { from, to }
});

test('a draft states a currency and a jurisdiction; a create fills its empty declarations', async () => {
	await assert.rejects(
		transform(settings, [{ ...version('x', '2026-01-01', null, false), payroll: {} }]),
		/currency and payroll jurisdiction/
	);
	const { facts, exit_facts, obligations, ...draft } = version('x', '2026-01-01', null, false);
	const [out] = await transform(settings, [draft]);
	assert.deepEqual([out.facts, out.exit_facts, out.obligations], [[], [], []]);
});

test('a sealed version is frozen: only an earlier end and one reasoned void pass, and it never unseals', async () => {
	const sealed = version('v1', '2026-01-01', null);
	const one = (input, tables) => transform(settings, [input], { existing: [sealed], tables });
	await assert.rejects(one({ name: 'Renamed' }), /sealed, so name cannot change/);
	await assert.rejects(
		one({ effective_range: { from: '2025-12-01', to: null } }),
		/effective_range cannot change/
	);
	await one({ effective_range: { from: '2026-01-01', to: '2026-05-31' } });
	await assert.rejects(one({ sealed_at: null }), /never unsealed/);
	const paid = {
		payroll_runs: [
			{ id: 'run', settings_id: 'v1', period: '2026-02', payslips: [{ status: 'PAID' }] }
		]
	};
	await assert.rejects(one({ voided_at: '2026-06-01T00:00:00.000Z' }, paid), /states a reason/);
	await one({ voided_at: '2026-06-01T00:00:00.000Z', void_reason: 'Wrong rate' }, paid);
});

test('sealing ends the predecessor the day before in the same batch; an overlapping seal alone is refused', async () => {
	const before = version('v1', '2026-01-01', null);
	const draft = version('v2', '2026-07-01', null, false);
	const writes = sealWrites(draft, [before, draft], '2026-06-20T00:00:00.000Z');
	assert.deepEqual(writes, [
		{ target: 'v1', set: { effective_range: { from: '2026-01-01', to: '2026-06-30' } } },
		{
			target: 'v2',
			set: {
				effective_range: { from: '2026-07-01', to: null },
				sealed_at: '2026-06-20T00:00:00.000Z'
			}
		}
	]);
	const tables = { jurisdiction_settings: [before] };
	await transform(
		settings,
		writes.map((write) => write.set),
		{ existing: [before, draft], tables }
	);
	await assert.rejects(
		transform(settings, [writes[1].set], { existing: [draft], tables }),
		/Sealed MY versions cannot overlap/
	);
});

test('a new version clones every row under its source into a draft starting later', async () => {
	const source = version('v1', '2026-01-01', null);
	const tables = {
		jurisdiction_settings: [source],
		statutory_contributions: [
			{ id: 's1', revision: 3, settings_id: 'v1', approval_id: null, code: 'EPF', rules: [] }
		],
		leave_catalogue: [{ id: 'l1', revision: 1, settings_id: 'v1', approval_id: null, code: 'AL' }]
	};
	const ctx = caller({ tables });
	await assert.rejects(
		action(settings, 'new_settings_version', { settings_id: 'v1', starts_on: '2026-01-01' }, ctx),
		/starts after/
	);
	await action(
		settings,
		'new_settings_version',
		{ settings_id: 'v1', starts_on: '2026-07-01' },
		ctx
	);
	const [{ callable, input }] = ctx.acts;
	assert.equal(callable, 'jurisdiction_settings.create');
	assert.deepEqual(
		[input.name, input.sealed_at, input.cloned_from_id, input.effective_range],
		['MY from 2026-07-01', null, 'v1', { from: '2026-07-01', to: null }]
	);
	assert.deepEqual(input.statutory_contributions.create, [{ code: 'EPF', rules: [] }]);
	assert.deepEqual(input.leave_catalogue.create, [{ code: 'AL' }]);
});

test('the clone contract accepts every authored column of every family a version owns', async () => {
	const contract = settings.spec.create.input.with;
	for (const family of Object.keys(contract)) {
		const model = (await import(`../src/data/model/${family}/+model.ts`)).default;
		const keys = Object.keys(relationships)
			.filter((key) => key.startsWith(`${family}.`) && key !== `${family}.settings_id`)
			.map((key) => key.split('.')[1]);
		assert.deepEqual(
			[...contract[family].create.columns].sort(),
			[...Object.keys(model.fields), ...keys].sort(),
			family
		);
	}
});
