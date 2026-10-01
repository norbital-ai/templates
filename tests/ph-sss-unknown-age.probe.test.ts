import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory, settingsIdOn } from './fixtures/statutory-world.ts';

// RA 11199 s.9(a) makes age determine compulsory employee coverage. A missing birth date
// cannot justify a zero employee/employer contribution on an otherwise payable wage.
test('PH SSS or HDMF refuses a payable run when compulsory-coverage age is unknown', () => {
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
		/(SSS coverage|HDMF: Pag-IBIG membership coverage).*birth date|birth date.*SSS coverage/i
	);
});

test('PH SSS refuses a missing compensation band for a covered employee', () => {
	assert.throws(
		() =>
			buildStatutory(
				{
					code: 'PH',
					period: '2026-07',
					people: [{ key: 'COVERED', wage: 30_000, age: 30 }]
				},
				(world) => {
					const index = world.statutory_contributions.findIndex(
						(row) => row.settings_id === settingsIdOn('PH', '2026-07-15') && row.code === 'SSS'
					);
					assert.ok(index >= 0);
					const scheme = world.statutory_contributions[index]!;
					const fallback = scheme.rules.at(-1)!;
					assert.match(fallback.refusal ?? '', /No SSS compensation band covers/);
					world.statutory_contributions.splice(index, 1, { ...scheme, rules: [fallback] });
				}
			),
		/No SSS compensation band covers/
	);
});
