// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A contract: one per person and entity on any date, frozen once anything references it (its departure excepted),
 * closed once, never deleted while referenced; its departure inputs are judged by the law of its last working day and
 * fixed by a paid final payroll.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import employments from '../src/data/collection/employments/+collection.ts';
import { transform } from './helpers/bodies.ts';

const contract = (id, from, to = null, over = {}) => ({
	id,
	employee_id: 'person',
	company_id: 'entity',
	employee_number: 'E1',
	effective_range: { from, to },
	exit_reason: null,
	exit_facts: null,
	comments: null,
	...over
});
const law = (from, to, options) => ({
	id: `law-${from}`,
	code: 'ID',
	sealed_at: `${from}T00:00:00.000Z`,
	voided_at: null,
	approval_id: null,
	effective_range: { from, to },
	exit_facts: [{ key: 'cause', type: 'string', options }]
});
const world = (over = {}) => ({
	companies: [{ id: 'entity', settings_code: 'ID' }],
	jurisdiction_settings: [
		law('2025-01-01', '2025-12-31', ['OLD']),
		law('2026-01-01', null, ['WARNINGS'])
	],
	...over
});

test('one contract per person and entity on a day: a rehire starts the day after the last day of work', async () => {
	const previous = contract('a', '2025-01-01', '2026-05-31');
	const tables = world({ employments: [previous] });
	const { id, ...onLastDay } = contract('b', '2026-05-31');
	await assert.rejects(
		transform(employments, [onLastDay], { tables }),
		/already has an active employment contract/
	);
	await transform(
		employments,
		[{ ...onLastDay, effective_range: { from: '2026-06-01', to: null } }],
		{ tables }
	);
	await transform(employments, [{ ...onLastDay, company_id: 'elsewhere' }], { tables });
});

test('a first contract carries its first terms and their title derived', async () => {
	const { id, ...hire } = contract('a', '2026-01-01');
	const [out] = await transform(employments, [
		{ ...hire, employment_terms: { create: [{ job_title: 'Cook', employment_type: 'PERMANENT' }] } }
	]);
	assert.deepEqual(out.employment_terms.create[0], {
		job_title: 'Cook',
		employment_type: 'PERMANENT',
		summary: 'Cook · PERMANENT' // `allowances` is the model's `default: []`, filled at the write
	});
});

test('a first contract’s nested terms record only the inputs its lineage declares', async () => {
	const { id, ...hire } = contract('a', '2026-01-01');
	const tables = world({
		jurisdiction_settings: [
			{
				...law('2026-01-01', null, ['WARNINGS']),
				terms_facts: [{ key: 'worksite_state', type: 'string', options: ['JOHOR'] }]
			}
		]
	});
	const hireWith = (facts) =>
		transform(
			employments,
			[{ ...hire, employment_terms: { create: [{ job_title: 'Cook', facts }] } }],
			{ tables }
		);
	await hireWith({ worksite_state: 'JOHOR' });
	await assert.rejects(hireWith({ worksite_state: 'SABAH' }), /must be one of: JOHOR/);
	await assert.rejects(hireWith({ typo: true }), /does not declare the entity fact typo/);
});

test('a referenced contract takes only its departure; a closed one never reopens; neither is deleted', async () => {
	const open = contract('a', '2025-01-01');
	const tables = world({
		employments: [open],
		employment_terms: [{ employment_id: 'a', approval_id: null }]
	});
	const one = (input, row = open) => transform(employments, [input], { existing: [row], tables });
	await assert.rejects(one({ employee_number: 'E2' }), /sealed by employment terms/);
	await one({
		effective_range: { from: '2025-01-01', to: '2026-03-31' },
		exit_reason: 'RESIGNATION'
	});
	const closed = { ...open, effective_range: { from: '2025-01-01', to: '2026-03-31' } };
	await one({ comments: 'Left on good terms' }, closed);
	await assert.rejects(
		one({ effective_range: { from: '2025-01-01', to: null } }, closed),
		/cannot be reopened/
	);
	await assert.rejects(one({ $delete: true }), /sealed by employment terms/);
	await transform(employments, [{ $delete: true }], {
		existing: [open],
		tables: world({ employments: [open] })
	});
});

test('departure inputs follow the law of the last working day and are fixed by a paid final payroll', async () => {
	const left = contract('a', '2020-01-01', '2025-12-31');
	const one = (input, tables = world({ employments: [left] })) =>
		transform(employments, [input], { existing: [left], tables });
	await one({ exit_facts: { cause: 'OLD' } });
	await assert.rejects(one({ exit_facts: { cause: 'WARNINGS' } }), /must be one of: OLD/);
	await assert.rejects(
		one({ exit_facts: { typo: 'x' } }),
		/does not declare the departure input typo/
	);
	const paid = world({
		employments: [left],
		payslips: [{ employment_id: 'a', status: 'PAID', terms_through: '2025-12-31' }]
	});
	await assert.rejects(one({ exit_reason: 'DISMISSAL' }, paid), /fixed by paid final payroll/);
});
