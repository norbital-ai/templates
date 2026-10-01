// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * I3 dated person facts and I6 prior history: writes are judged against the declarations of the person's lineages;
 * the run resolves the revision in force (an employment row beating the personal row, `change_effect` applied) and
 * reads prior periods clipped to a window. Jurisdiction-free fixtures: lineages `XA` and `XB`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import personFacts from '../src/data/collection/person_facts/+collection.ts';
import history from '../src/data/collection/employment_history/+collection.ts';
import { transform } from './helpers/bodies.ts';
import { externalHistory, resolvePersonFacts } from '../src/lib/person-facts.ts';

const range = (from, to = null) => ({ from, to });
const tables = {
	employments: [
		{ id: 'job-a', employee_id: 'person', company_id: 'co-a' },
		{ id: 'job-b', employee_id: 'person', company_id: 'co-b' },
		{ id: 'job-other', employee_id: 'other', company_id: 'co-a' }
	],
	companies: [
		{ id: 'co-a', settings_code: 'XA' },
		{ id: 'co-b', settings_code: 'XB' }
	],
	jurisdiction_settings: [
		{
			code: 'XA',
			sealed_at: '2026-01-01T00:00:00.000Z',
			person_facts: [
				{ key: 'dependants', type: 'number', integer: true, minimum: 0 },
				{ key: 'employer_ref', type: 'string', scope: 'EMPLOYMENT' }
			],
			history_kinds: [
				{
					code: 'PRIOR_EMPLOYER',
					facts: [
						{ key: 'ytd_gross', type: 'number', minimum: 0 },
						{ key: 'ytd_tax', type: 'number', minimum: 0 }
					]
				}
			]
		},
		{
			code: 'XB',
			sealed_at: '2026-01-01T00:00:00.000Z',
			person_facts: [{ key: 'pensioner', type: 'boolean' }],
			history_kinds: [{ code: 'INSURED', facts: [] }]
		},
		// a voided version declares nothing
		{
			code: 'XA',
			sealed_at: '2026-01-01T00:00:00.000Z',
			voided_at: '2026-02-01T00:00:00.000Z',
			person_facts: [{ key: 'voided_key', type: 'boolean' }],
			history_kinds: []
		}
	]
};
const fact = (over = {}) => ({
	employee_id: 'person',
	employment_id: null,
	facts: {},
	effective_range: range('2026-01-01'),
	...over
});

test('a personal fact is admitted by any lineage of the person, an employment fact by its own', async () => {
	const [out] = await transform(personFacts, [fact({ facts: { dependants: 2 } })], { tables });
	assert.equal(out.summary, 'dependants · from 2026-01-01');
	await transform(personFacts, [fact({ facts: { pensioner: true } })], { tables });
	await transform(personFacts, [fact({ employment_id: 'job-a', facts: { employer_ref: 'E1' } })], {
		tables
	});
	for (const [over, refusal] of [
		[{ facts: { dependants: -1 } }, /at least 0/],
		[{ facts: { dependants: 1.5 } }, /whole number/],
		[{ facts: { voided_key: true } }, /does not declare/],
		[{ facts: { employer_ref: 'E1' } }, /requires a named employment/],
		[{ employment_id: 'job-b', facts: { dependants: 1 } }, /XB does not declare/],
		[{ employment_id: 'job-other' }, /must belong to this employee profile/],
		[{ effective_range: range('2026-02-01', '2026-01-31') }, /ordered inclusive/],
		[{ employee_id: 'nobody', facts: { dependants: 1 } }, /Record an employment first/]
	])
		await assert.rejects(transform(personFacts, [fact(over)], { tables }), refusal);
});

test('a person fact never moves person or employment', async () => {
	const stored = { id: 'f1', ...fact({ employment_id: 'job-a' }) };
	await assert.rejects(
		transform(personFacts, [{ employee_id: 'other' }], { existing: [stored], tables }),
		/cannot move to another person/
	);
	const [out] = await transform(personFacts, [{ facts: { dependants: 3 } }], {
		existing: [stored],
		tables
	});
	assert.equal(out.summary, 'dependants · from 2026-01-01');
});

test('the employment row overrides the personal row key by key on its dates', () => {
	const fields = [
		{ key: 'dependants', type: 'number' },
		{ key: 'pensioner', type: 'boolean', default_value: false }
	];
	const rows = [
		{
			employment_id: null,
			facts: { dependants: 2, pensioner: true },
			effective_range: range('2026-01-01')
		},
		{
			employment_id: 'job-a',
			facts: { dependants: 4 },
			effective_range: range('2026-03-01', '2026-03-31')
		},
		{ employment_id: 'job-b', facts: { dependants: 9 }, effective_range: range('2026-01-01') }
	];
	const on = (asOf) =>
		resolvePersonFacts(fields, rows, { asOf, employmentId: 'job-a', scope: 'P' }).facts;
	assert.deepEqual(on('2026-02-15'), { dependants: 2, pensioner: true });
	assert.deepEqual(on('2026-03-15'), { dependants: 4, pensioner: true });
	assert.deepEqual(on('2026-04-01'), { dependants: 2, pensioner: true });
	// before any row: the declared default, and nothing recorded
	const before = resolvePersonFacts(fields, rows, {
		asOf: '2025-12-31',
		employmentId: 'job-a',
		scope: 'P'
	});
	assert.deepEqual(before.fact_keys, []);
	assert.equal(before.facts.pensioner, false);
	assert.throws(
		() =>
			resolvePersonFacts([{ key: 'status', type: 'string', required: true }], [], {
				asOf: '2026-01-01',
				employmentId: 'job-a',
				scope: 'P'
			}),
		/required before calculation/
	);
});

test('change_effect defers a declared change', () => {
	const rows = [
		{ employment_id: null, facts: { n: 3 }, effective_range: range('2025-01-01', '2026-03-14') },
		{ employment_id: null, facts: { n: 1 }, effective_range: range('2026-03-15', '2026-05-09') },
		{ employment_id: null, facts: { n: 2 }, effective_range: range('2026-05-10') }
	];
	const n = (change_effect, asOf) =>
		resolvePersonFacts([{ key: 'n', type: 'number', change_effect }], rows, {
			asOf,
			employmentId: 'job-a',
			scope: 'P'
		}).facts.n;
	assert.equal(n(undefined, '2026-03-20'), 1);
	// from the next first: March still reads the old value, April the new
	assert.equal(n('MONTH_START', '2026-03-20'), 3);
	assert.equal(n('MONTH_START', '2026-04-01'), 1);
	// the whole event month: 1 March already reads the change of 15 March
	assert.equal(n('EVENT_MONTH', '2026-03-01'), 1);
	// the 1 January standing governs the year
	assert.equal(n('YEAR_START', '2026-12-31'), 3);
	// a reduction waits for the next January; the later increase (1 → 2) is judged against 3: still a reduction
	assert.equal(n('NEXT_YEAR_JANUARY', '2026-03-20'), 3);
	assert.equal(n('NEXT_YEAR_JANUARY', '2026-06-01'), 3);
	assert.equal(n('NEXT_YEAR_JANUARY', '2027-01-01'), 2);
});

test('a history period names a declared kind and carries its declared facts', async () => {
	const period = (over = {}) => ({
		employee_id: 'person',
		kind: 'PRIOR_EMPLOYER',
		effective_range: range('2026-01-01', '2026-02-28'),
		facts: { ytd_gross: 12000, ytd_tax: 800 },
		...over
	});
	const [out] = await transform(history, [period()], { tables });
	assert.equal(out.summary, 'PRIOR_EMPLOYER · 2026-01-01 – 2026-02-28');
	const [insured] = await transform(
		history,
		[period({ kind: 'INSURED', facts: undefined, effective_range: range('2020-01-01') })],
		{ tables }
	);
	assert.deepEqual(insured.facts, {});
	assert.equal(insured.summary, 'INSURED · 2020-01-01 – open');
	for (const [over, refusal] of [
		[{ kind: 'MILITARY' }, /does not declare the history kind MILITARY/],
		[{ facts: { ytd_gross: -1 } }, /at least 0/],
		[{ facts: { other: 1 } }, /does not declare/],
		[{ kind: 'INSURED' }, /does not declare/],
		[{ employee_id: 'nobody' }, /Record an employment first/],
		[{ effective_range: range('2026-03-01', '2026-02-01') }, /ordered inclusive/]
	])
		await assert.rejects(transform(history, [period(over)], { tables }), refusal);
	const stored = { id: 'h1', ...period() };
	await assert.rejects(
		transform(history, [{ kind: 'INSURED' }], { existing: [stored], tables }),
		/cannot change kind/
	);
});

test('history.external clips each period of a kind to the window', () => {
	const rows = [
		{ kind: 'INSURED', effective_range: range('2024-07-01', '2025-06-30'), facts: { class: 'A' } },
		{ kind: 'INSURED', effective_range: range('2025-10-01'), facts: {} },
		{ kind: 'PRIOR_EMPLOYER', effective_range: range('2025-01-01', '2025-12-31'), facts: {} },
		{ kind: 'INSURED', effective_range: range('2023-01-01', '2023-12-31'), facts: {} }
	];
	const found = externalHistory(rows, 'INSURED', { start: '2025-01-01', end: '2025-12-31' });
	// 1 Jan – 30 Jun 2025 is 181 days; 1 Oct – 31 Dec is 92; the 2023 period is outside
	assert.deepEqual(
		found.map((row) => [row.start, row.end, row.days]),
		[
			['2025-01-01', '2025-06-30', 181],
			['2025-10-01', '2025-12-31', 92]
		]
	);
	assert.equal(found[0].facts.class, 'A');
	assert.equal(
		found.reduce((total, row) => total + row.days, 0),
		273
	);
});
