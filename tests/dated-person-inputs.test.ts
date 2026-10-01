// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A person context resolves its dated inputs on its own rule date: the worksite revision the terms
 * (or the day) name, the person's fact revision (an employment's row over the personal one), and the
 * version's tables that `table()` reads. The run binds them to the company and employee rows it
 * hands every caller (`DATED`); nothing names a jurisdiction.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DATED,
	evaluatePersonNumber,
	isEligible,
	personContext
} from '../src/lib/payroll/run/eligibility.ts';
import { referenceTables } from '../src/lib/expressions/functions/tables.ts';
import { resolvePersonFacts } from '../src/lib/person-facts.ts';
import { worksiteOn } from '../src/data/collection/worksites/lib/in-force.ts';

const SITES = [
	{
		id: 'w1',
		company_id: 'c',
		code: 'NORTH',
		region: 'R1',
		facts: { industry: 'A' },
		effective_range: { from: '2025-01-01', to: '2025-12-31' }
	},
	{
		id: 'w2',
		company_id: 'c',
		code: 'NORTH',
		region: 'R1',
		facts: { industry: 'B' },
		effective_range: { from: '2026-01-01', to: null }
	},
	{
		id: 'w3',
		company_id: 'c',
		code: 'SOUTH',
		region: 'R2',
		facts: {},
		effective_range: { from: '2025-01-01', to: null }
	}
];
const FLOOR = { name: 'FLOOR', keys: ['code'], columns: [{ key: 'hourly', type: 'number' }] };
const lookup = referenceTables(
	[FLOOR],
	[
		{
			table: 'FLOOR',
			code: 'R1',
			effective_range: { from: '2025-01-01', to: '2025-12-31' },
			values: { hourly: 10 }
		},
		{
			table: 'FLOOR',
			code: 'R1',
			effective_range: { from: '2026-01-01', to: null },
			values: { hourly: 11 }
		},
		{
			table: 'FLOOR',
			code: 'R2',
			effective_range: { from: '2025-01-01', to: null },
			values: { hourly: 9 }
		}
	]
);
const FACTS = [{ key: 'standing', type: 'string', default_value: 'NONE' }];
const PERSON_ROWS = [
	{
		employment_id: null,
		facts: { standing: 'A' },
		effective_range: { from: '2025-01-01', to: null }
	},
	{
		employment_id: 'e1',
		facts: { standing: 'B' },
		effective_range: { from: '2026-01-01', to: null }
	}
];

const company = {
	region: 'X',
	[DATED]: {
		tables: (asOf) => lookup(asOf),
		worksite: (id, asOf) => {
			const revision = worksiteOn(SITES, id, asOf);
			if (revision == null) throw new Error(`no revision on ${asOf}`);
			return revision;
		}
	}
};
const employee = {
	date_of_birth: '1990-01-01',
	[DATED]: {
		facts: (asOf, employmentId) =>
			resolvePersonFacts(FACTS, PERSON_ROWS, { asOf, employmentId: employmentId ?? '', scope: 'P' })
	}
};
const on = (asOf, extra = {}) =>
	personContext({
		employee,
		employment: { id: 'e1', service_start: '2024-01-01', exit_ground: 'G1' },
		terms: { worksite_id: 'w1' },
		company,
		asOf,
		...extra
	});

test('a person context reads the worksite revision, person facts and tables in force on its date', () => {
	const before = on('2025-06-30');
	assert.deepEqual(before.worksite, { code: 'NORTH', region: 'R1', facts: { industry: 'A' } });
	assert.deepEqual(before.employee.facts, { standing: 'A' });
	assert.equal(before.employment.exit_ground, 'G1');
	assert.equal(evaluatePersonNumber("table('FLOOR', worksite.region).hourly", before), 10);
	const after = on('2026-02-01');
	// the revision of the named worksite's code in force, and the employment's own fact row
	assert.equal(after.worksite.facts.industry, 'B');
	assert.deepEqual(after.employee.facts, { standing: 'B' });
	assert.equal(evaluatePersonNumber("table('FLOOR', worksite.region).hourly", after), 11);
	assert.ok(isEligible("employee.facts.standing == 'B' && worksite.facts.industry == 'B'", after));
});

test('a work day that names its own worksite reads that one; no worksite reads blanks', () => {
	const away = on('2026-02-01', { worksiteId: 'w3' });
	assert.deepEqual(away.worksite, { code: 'SOUTH', region: 'R2', facts: {} });
	assert.equal(evaluatePersonNumber("table('FLOOR', worksite.region).hourly", away), 9);
	const none = on('2026-02-01', { terms: {} });
	assert.deepEqual(none.worksite, { code: '', region: '', facts: {} });
	const bare = personContext({
		employee: null,
		employment: { service_start: '' },
		terms: null,
		asOf: '2026-02-01'
	});
	assert.deepEqual(bare.employee.facts, {});
	assert.throws(
		() => evaluatePersonNumber("table('FLOOR', 'R1').hourly", bare),
		/no reference tables/
	);
});
