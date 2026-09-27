import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory } from './fixtures/statutory-world.ts';

// RA 11199 s.9(a) makes age determine compulsory employee coverage. A missing birth date
// cannot justify a zero employee/employer contribution on an otherwise payable wage.
test('PH SSS refuses a payable run when compulsory-coverage age is unknown', () => {
	assert.throws(
		() =>
			buildStatutory(
				{
					code: 'PH',
					period: '2026-07',
					people: [{ key: 'UNKNOWN-AGE', wage: 30000 }]
				},
				(world) => {
					world.employees[0]!.date_of_birth = '';
				}
			),
		/SSS coverage.*birth date|birth date.*SSS coverage/i
	);
});
