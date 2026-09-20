import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assessStatutory,
	expectStatutory,
	expectStatutorySkipped
} from './fixtures/statutory-world.ts';

// RA 11199 s.9(a); SSS employee coverage guidance; the MPF is part of the same
// covered member's contribution. Initial coverage ends on the 60th birthday.
// https://www.sss.gov.ph/employees/
// https://www.sss.gov.ph/pay-contribution/
for (const period of ['2025-12', '2026-01', '2026-04', '2026-10']) {
	test(`PH ${period}: SSS and MPF use first liability across employers and the exact 60th birthday`, () => {
		const people = ['2023-06-14', '2023-06-15', '2023-06-16'].map((first, index) => ({
			key: `FIRST-${index}`,
			wage: 30_000,
			birth_date: '1963-06-15',
			hire_date: '2025-11-01',
			registrations: { SSS: { kind: 'REGISTERED', first_contribution_due_on: first } }
		}));
		const book = assessStatutory({ code: 'PH', period, people });
		for (const index of [0, 1]) {
			expectStatutory(book, `FIRST-${index}`, 'SSS', 1000, 2000);
			expectStatutory(book, `FIRST-${index}`, 'SSS_MPF', 500, 1000);
		}
		expectStatutorySkipped(book, 'FIRST-2', 'SSS');
		expectStatutorySkipped(book, 'FIRST-2', 'SSS_MPF');
	});

	test(`PH ${period}: MPF cannot charge an employee outside SSS membership`, () => {
		const book = assessStatutory({
			code: 'PH',
			period,
			people: [
				{
					key: 'NO-SSS',
					wage: 30_000,
					registrations: { SSS: { kind: 'NOT_REGISTERED' } }
				}
			]
		});
		expectStatutory(book, 'NO-SSS', 'SSS', 0, 0);
		expectStatutorySkipped(book, 'NO-SSS', 'SSS_MPF');
	});
}

test('PH: SSS requires earlier contribution liability only when age can change coverage', () => {
	const person = {
		key: 'HISTORY',
		wage: 30_000,
		registrations: { SSS: { kind: 'REGISTERED', first_contribution_due_on: null } }
	};
	const young = assessStatutory({
		code: 'PH',
		period: '2026-01',
		people: [{ ...person, age: 59 }]
	});
	expectStatutory(young, 'HISTORY', 'SSS', 1000, 2000);
	assert.throws(
		() =>
			assessStatutory({
				code: 'PH',
				period: '2026-01',
				people: [{ ...person, age: 61 }]
			}),
		/SSS requires the first contribution due date/
	);
});
