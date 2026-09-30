// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Allowances name one class per code; classification codes are the lineage's declared vocabularies;
 * the title is derived (consumption: `employment-terms-seal.test.ts`).
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import terms from '../src/data/collection/employment_terms/+collection.ts';
import { transform } from './helpers/bodies.ts';
import { VOCABULARY_FIELDS } from '../src/lib/datatypes/payroll_settings.ts';

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

/** A sealed version of lineage TEST over `[from, to]`, declaring these classification codes. */
const version = (id, from, to, vocabularies) => ({
	id,
	code: 'TEST',
	sealed_at: '2025-11-30T00:00:00.000Z',
	voided_at: null,
	approval_id: null,
	effective_range: { from, to },
	terms_facts: [],
	payroll: { vocabularies }
});
const codes = (statutory_work_category, pass_type = []) => ({
	statutory_work_category,
	work_classification: ['EA_COVERED'],
	pass_type,
	tax_residency: ['RESIDENT', 'NON_RESIDENT']
});

test('classification codes are the ones every version the terms reach declares', async () => {
	const tables = (versions) => ({
		employments: [
			{ id: 'contract', company_id: 'co', effective_range: { from: '2025-01-01', to: null } }
		],
		companies: [{ id: 'co', settings_code: 'TEST' }],
		jurisdiction_settings: versions
	});
	const lineage = [
		version('v1', '2025-12-01', '2026-06-30', codes(['NON_MANUAL'])),
		version('v2', '2026-07-01', null, codes(['NON_MANUAL', 'PIECE_RATE'], ['WORK_PERMIT']))
	];
	const write = (from, to, over, versions = lineage) => {
		const { id, ...input } = row('t1', from, to, { work_classification: 'EA_COVERED', ...over });
		return transform(terms, [input], { tables: tables(versions) });
	};
	await write('2026-07-01', null, {
		statutory_work_category: 'PIECE_RATE',
		pass_type: 'WORK_PERMIT'
	});
	// A period reaching v1 is judged by v1 too; one before the lineage by every version.
	await assert.rejects(
		write('2026-06-01', null, { statutory_work_category: 'PIECE_RATE' }),
		/TEST does not declare PIECE_RATE as a statutory_work_category/
	);
	await assert.rejects(
		write('2024-01-01', '2024-12-31', { pass_type: 'WORK_PERMIT' }),
		/TEST does not declare WORK_PERMIT as a pass_type/
	);
	await write('2024-01-01', '2024-12-31', { tax_residency: 'NON_RESIDENT' });
	// An empty optional code is no code; a lineage with no sealed version admits none.
	await write('2026-07-01', null, { pass_type: null, tax_residency: '' });
	await assert.rejects(write('2026-07-01', null, {}, []), /no sealed settings version/);
});

test('every seeded version declares each classification code its lineage compares', () => {
	const root = new URL('../seed/jurisdiction/', import.meta.url);
	const compared =
		/(?:terms\.(statutory_work_category|pass_type|tax_residency)|employment\.(classification))\s*(?:==|!=|in)\s*(\[[^\]]*\]|"[^"]*")/g;
	const strings = (value) =>
		typeof value === 'string'
			? [value]
			: value != null && typeof value === 'object'
				? Object.values(value).flatMap(strings)
				: [];
	for (const lineage of readdirSync(root)) {
		const dir = new URL(`${lineage}/`, root);
		const versions = JSON.parse(readFileSync(new URL('jurisdiction_settings.json', dir), 'utf8'));
		for (const settings of versions)
			for (const field of VOCABULARY_FIELDS)
				assert.ok(
					Array.isArray(settings.payroll.vocabularies?.[field]),
					`${settings.name}: vocabularies.${field}`
				);
		for (const file of readdirSync(dir)) {
			const bytes = readFileSync(new URL(file, dir));
			const text = (file.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8');
			for (const expression of strings(JSON.parse(text)))
				for (const [, terms, employment, operand] of expression.matchAll(compared)) {
					const field = terms ?? 'work_classification';
					assert.ok(employment == null || employment === 'classification');
					for (const [, code] of operand.matchAll(/"([^"]*)"/g))
						if (code !== '')
							for (const settings of versions)
								assert.ok(
									settings.payroll.vocabularies[field].includes(code),
									`${settings.name} (${file}) compares ${field} with undeclared ${code}`
								);
				}
		}
	}
});
