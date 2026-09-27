// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/** Allowances name one class per code; the title is derived (consumption: `employment-terms-seal.test.ts`). */
import assert from 'node:assert/strict';
import test from 'node:test';
import terms from '../src/data/collection/employment_terms/+collection.ts';
import { transform } from './helpers/bodies.ts';

const row = (id, from, to = null, over = {}) => ({
	id,
	employment_id: 'contract',
	job_title: 'Cook',
	employment_type: 'PERMANENT',
	base_salary: '3000.00',
	allowances: [],
	effective_range: { from, to },
	...over
});
const consumedThrough = (day) => ({
	employments: [{ id: 'contract', effective_range: { from: '2025-01-01', to: null } }],
	work_days: [{ employment_id: 'contract', work_date: day }],
	allowance_catalogue: [
		{ id: 'meal-v1', code: 'MEAL' },
		{ id: 'meal-v2', code: 'MEAL' }
	]
});

test('a terms row is titled by its job and employment type', async () => {
	const { id, ...input } = row('t1', '2025-01-01');
	const [out] = await transform(terms, [input], { tables: consumedThrough('2024-12-31') });
	assert.equal(out.summary, 'Cook · PERMANENT');
});

test('allowances name an allowance class, once per code across versions', async () => {
	const { id, ...input } = row('t1', '2025-01-01');
	const tables = consumedThrough('2024-12-31');
	const withAllowances = (allowances) => transform(terms, [{ ...input, allowances }], { tables });
	await withAllowances([{ catalogue_id: 'meal-v1', amount: 10 }]);
	await assert.rejects(
		withAllowances([{ catalogue_id: 'nope', amount: 10 }]),
		/names no allowance class/
	);
	await assert.rejects(
		withAllowances([
			{ catalogue_id: 'meal-v1', amount: 10 },
			{ catalogue_id: 'meal-v2', amount: 10 }
		]),
		/list allowance MEAL twice/
	);
});
