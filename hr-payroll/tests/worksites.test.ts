// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * I1 worksites: dated revisions of one establishment per `(company, code)`, the revision in force on a date resolved
 * from any revision a terms row or work day names, and the terms' worksite held to their own company.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import worksites from '../src/data/collection/worksites/+collection.ts';
import terms from '../src/data/collection/employment_terms/+collection.ts';
import { worksiteOn, worksiteFault } from '../src/data/collection/worksites/lib/in-force.ts';
import { transform } from './helpers/bodies.ts';

const range = (start, end = null) => ({ start, end });
const site = (id, code, start, end = null, over = {}) => ({
	id,
	company_id: 'co',
	code,
	name: code,
	region: 'NORTH',
	facts: {},
	effective_range: range(start, end),
	...over
});
const revisions = [
	site('a1', 'A', '2026-01-01', '2026-06-30', { region: 'NORTH' }),
	site('a2', 'A', '2026-07-01', null, { region: 'SOUTH' }),
	site('b1', 'B', '2026-01-01'),
	site('x1', 'A', '2026-01-01', null, { company_id: 'other' })
];

test('revisions of one worksite never overlap: the model keys them by company and code', async () => {
	const model = (await import('../src/data/model/worksites/+model.ts')).default;
	assert.deepEqual(model.noOverlap, [
		{ key: ['company_id', 'code'], period: 'effective_range', name: 'worksites_no_overlap' }
	]);
	assert.equal(model.fields.effective_range.of, 'date');
});

test('the revision in force is picked from any revision the subject names', () => {
	// Naming the first revision still reads the second after the move; another company's A is never read.
	assert.equal(worksiteOn(revisions, 'a1', '2026-06-30')?.region, 'NORTH');
	assert.equal(worksiteOn(revisions, 'a1', '2026-07-01')?.region, 'SOUTH');
	assert.equal(worksiteOn(revisions, 'a2', '2026-03-01')?.id, 'a1');
	assert.equal(worksiteOn(revisions, 'b1', '2026-07-01')?.id, 'b1');
	assert.equal(worksiteOn(revisions, 'a1', '2025-12-31'), null);
	assert.equal(worksiteOn(revisions, 'missing', '2026-03-01'), null);
	assert.equal(
		worksiteFault(revisions, 'x1', 'co', '2026-03-01'),
		'Worksite A belongs to another company.'
	);
	assert.equal(
		worksiteFault(revisions, 'a1', 'co', '2025-12-01'),
		'Worksite A is not in force on 2025-12-01.'
	);
	assert.equal(worksiteFault(revisions, 'a1', 'co', '2026-08-01'), null);
});

const lineage = {
	companies: [{ id: 'co', settings_code: 'TEST' }],
	jurisdiction_settings: [
		{
			id: 'v1',
			code: 'TEST',
			sealed_at: '2025-11-30T00:00:00.000Z',
			voided_at: null,
			approval_id: null,
			effective_range: range('2025-12-01'),
			worksite_facts: [{ key: 'construction', type: 'boolean', label: 'Construction' }],
			// the worksite's region is a key of the wage order
			work_rules: { wages: { by_region: { NORTH: 1000, SOUTH: 900 } } }
		}
	]
};

test('a worksite revision is judged against its lineage worksite_facts', async () => {
	const { id, ...input } = site('n', ' A ', '2026-01-01', null, { facts: undefined });
	const [out] = await transform(worksites, [input], { tables: lineage });
	assert.equal(out.code, 'A');
	assert.deepEqual(out.facts, {});
	await transform(worksites, [{ ...input, facts: { construction: true } }], { tables: lineage });
	await assert.rejects(
		transform(worksites, [{ ...input, facts: { industry: 'X' } }], { tables: lineage }),
		/TEST does not declare the entity fact industry/
	);
	await assert.rejects(
		transform(worksites, [{ ...input, name: '  ' }], { tables: lineage }),
		/needs a name/
	);
	await assert.rejects(
		transform(worksites, [{ ...input, company_id: 'nope' }], { tables: lineage }),
		/must reference a company/
	);
});

test('terms name a worksite of their own company, in force when they start', async () => {
	const tables = {
		employments: [{ id: 'contract', company_id: 'co', effective_range: range('2025-01-01') }],
		companies: lineage.companies,
		jurisdiction_settings: [],
		worksites: revisions
	};
	const write = (worksite_id, start) =>
		transform(
			terms,
			[
				{
					employment_id: 'contract',
					job_title: 'Cook',
					employment_type: 'PERMANENT',
					base_salary: '3000.00',
					allowances: [],
					worksite_id,
					effective_range: range(start)
				}
			],
			{ tables }
		);
	await write('a1', '2026-08-01');
	await write(null, '2026-08-01');
	await assert.rejects(write('x1', '2026-08-01'), /belongs to another company/);
	await assert.rejects(write('a1', '2025-12-01'), /not in force on 2025-12-01/);
	await assert.rejects(write('missing', '2026-08-01'), /does not exist/);
});
