// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/** An entity's facts, on the company and on its dated revisions, are keys its lineage declares, each value valid. */
import assert from 'node:assert/strict';
import test from 'node:test';
import companies from '../src/data/collection/companies/+collection.ts';
import companyFacts from '../src/data/collection/company_facts/+collection.ts';
import { transform } from './helpers/bodies.ts';

const tables = {
	companies: [{ id: 'entity', settings_code: 'MY' }],
	jurisdiction_settings: [
		{
			id: 'v1',
			code: 'MY',
			sealed_at: '2026-01-01T00:00:00.000Z',
			voided_at: null,
			approval_id: null,
			facts: [{ key: 'hrdf_registered', type: 'boolean' }]
		}
	]
};

test('a company takes only declared, valid facts, and starts with none', async () => {
	const [created] = await transform(companies, [{ settings_code: 'MY', name: 'Co' }], { tables });
	assert.deepEqual(created.facts, {});
	await transform(
		companies,
		[{ settings_code: 'MY', name: 'Co', facts: { hrdf_registered: true } }],
		{ tables }
	);
	await assert.rejects(
		transform(companies, [{ settings_code: 'MY', name: 'Co', facts: { typo: true } }], { tables }),
		/MY does not declare the entity fact typo/
	);
	await assert.rejects(
		transform(companies, [{ settings_code: 'MY', name: 'Co', facts: { hrdf_registered: 'yes' } }], {
			tables
		}),
		/must be a boolean/
	);
});

test('a dated revision is judged against its company’s lineage', async () => {
	const revision = (facts) => ({
		company_id: 'entity',
		facts,
		effective_range: { from: '2026-02-01', to: null }
	});
	await transform(companyFacts, [revision({ hrdf_registered: false })], { tables });
	await assert.rejects(
		transform(companyFacts, [revision({ typo: 1 })], { tables }),
		/does not declare/
	);
	await assert.rejects(
		transform(companyFacts, [{ ...revision({}), company_id: 'unknown' }], { tables }),
		/must reference a company/
	);
});
