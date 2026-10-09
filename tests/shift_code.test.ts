/** The roster board names a day's shift by its code: the rostered one, else the one the person's pattern plans. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shiftCodeOf } from '../src/lib/ui/roster/shift_code.ts';

test('a day with no roster shift shows the shift its pattern plans, by code', () => {
	const shiftOf = shiftCodeOf({
		contracts: [
			{
				id: 'k1',
				facts: {
					contract_terms: [
						{ effective_range: { from: '2026-01-01', to: null }, shift_pattern_id: 'p1' }
					]
				}
			},
			{
				id: 'k2',
				facts: { contract_terms: [{ effective_range: { from: '2026-01-01', to: null } }] }
			}
		],
		definitions: [
			{ id: 'd-day', code: 'D0900' },
			{ id: 'd-rest', code: 'REST' },
			{ id: 'd-night', code: 'N2200' }
		],
		patterns: [
			{
				id: 'p1',
				effective_range: { from: '2026-03-02', to: null },
				pattern: { days: [{ roster_code_id: 'd-day' }, { roster_code_id: 'd-rest' }] }
			}
		]
	});
	assert.equal(shiftOf('k1', '2026-03-02', null), 'D0900');
	assert.equal(shiftOf('k1', '2026-03-03', null), 'REST');
	assert.equal(shiftOf('k1', '2026-03-03', 'd-night'), 'N2200');
	assert.equal(shiftOf('k1', '2026-03-01', null), null);
	assert.equal(shiftOf('k2', '2026-03-02', null), null);
});
