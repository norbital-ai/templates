import { assert, describe, it } from '@effect/vitest';
import { companyOn } from '../../src/lib/company.js';
import { factWrites, factsOf } from '../../src/lib/dated_facts.js';

const shape = { fields: ['rate', 'job_title'], record: 'parameters' };
const rows = [
	{ id: 'a', revision: 1, effective_from: '2026-01-01', rate: 10, parameters: { children: 1 } },
	{ id: 'b', revision: 2, effective_from: '2026-03-01', job_title: 'Lead', clears: ['children'] }
];
const owner = { employment_id: 'e' };

describe('dated facts', () => {
	it('lists one fact per value a row sets or takes away, and writes nothing while unchanged', () => {
		const facts = factsOf(rows, shape);
		assert.deepEqual(
			facts.map((fact) => `${fact.from} ${fact.name} ${String(fact.value)}`).toSorted(),
			[
				'2026-01-01 children 1',
				'2026-01-01 rate 10',
				'2026-03-01 children null',
				'2026-03-01 job_title Lead'
			]
		);
		const writes = factWrites(rows, facts, owner, shape);
		assert.deepEqual([writes.create, writes.update, writes.delete, writes.dates], [[], [], [], []]);
	});

	it('stores an edited, a moved, an added and a removed fact on the row of its date', () => {
		const facts = [
			{ name: 'rate', value: 12, from: '2026-01-01' },
			// moved from March to April, where no row stands
			{ name: 'job_title', value: 'Lead', from: '2026-04-01' },
			{ name: 'children', value: 2, from: '2026-04-01' },
			// neither named nor dated: not stored
			{ name: '', value: 1, from: '2026-05-01' }
		];
		const writes = factWrites(rows, facts, owner, shape);
		assert.deepEqual(writes.update, [
			{
				target: { id: 'a', revision: 1 },
				set: { rate: 12, job_title: null, parameters: {}, clears: [] }
			}
		]);
		assert.deepEqual(writes.create, [
			{
				employment_id: 'e',
				effective_from: '2026-04-01',
				job_title: 'Lead',
				parameters: { children: 2 }
			}
		]);
		assert.deepEqual(writes.delete, [{ target: { id: 'b', revision: 2 } }]);
		assert.deepEqual(writes.dates, ['2026-04-01', '2026-01-01', '2026-03-01']);
	});

	it('reads a company parameter key by key, and one named in clears as taken away', () => {
		const changes = [
			{ id: 'a', effective_from: '2026-01-01', statutory_parameters: { x: 1, y: 2 } },
			{ id: 'b', effective_from: '2026-02-01', statutory_parameters: { y: 3 }, clears: ['x'] }
		];
		assert.deepEqual(companyOn(changes, '2026-01-31').statutory_parameters, { x: 1, y: 2 });
		assert.deepEqual(companyOn(changes, '2026-02-01').statutory_parameters, { y: 3 });
	});
});
