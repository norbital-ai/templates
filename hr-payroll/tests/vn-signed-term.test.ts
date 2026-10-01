import assert from 'node:assert/strict';
import test from 'node:test';
import { personContext } from '../src/lib/payroll/run/eligibility.ts';
import { buildStatutory } from './fixtures/statutory-world.ts';

// SI Law41/2024 art.2(2), HI Law art.12(1)(c): the foreign worker's signed term,
// not service until an early departure, determines the twelve-month coverage threshold.
// Labour Code arts.20(1)(b),21(1)(d) separately specify the agreed contract duration.
for (const [signedEnd, ground, expectedMonths, openEnded] of [
	['2026-08-31', 'REDUNDANCY', 11, false],
	['2027-09-30', 'REDUNDANCY', 24, false],
	[null, 'REDUNDANCY', 0, true],
	[null, 'END_OF_CONTRACT', 11, false],
	[null, '', 11, false]
] as const)
	test(`VN signed term: ${signedEnd ?? 'legacy'} ${ground || 'uncut'} preserves actual service`, () => {
		const person = personContext({
			employee: null,
			employment: {
				service_start: '2025-10-01',
				exit_date: '2026-08-31',
				exit_ground: ground,
				signed_contract_end: signedEnd
			},
			terms: { employment_type: 'CONTRACT' },
			asOf: '2026-08-31'
		});
		assert.equal(person.employment.contract_months, expectedMonths);
		assert.equal(person.employment.open_ended, openEnded);
		assert.equal(person.employment.service_months, 11);
		assert.equal(person.employment.exit_date, '2026-08-31');
	});

for (const [signedEnd, insured] of [
	['2026-08-31', false],
	['2027-09-30', true]
] as const)
	test(`VN signed term saved input: ${signedEnd} redundancy bills foreign insurance by original duration`, () => {
		const { slips } = buildStatutory(
			{
				code: 'VN',
				period: '2026-08',
				region: 'I',
				people: [
					{
						key: 'SIGNED',
						wage: 60_000_000,
						citizenship: 'FOREIGNER',
						birth_date: '1985-02-10',
						gender: 'MALE',
						pass_type: 'WORK_PERMIT',
						hire_date: '2025-10-01',
						exit_date: '2026-08-31',
						exit_ground: 'REDUNDANCY'
					}
				]
			},
			(world) => {
				world.employments[0]!.signed_contract_end = signedEnd;
				world.employment_terms[0]!.employment_type = 'CONTRACT';
			}
		);
		const slip = slips.get('SIGNED')!;
		const charge = (code: string) => {
			const row = slip.statutory.find((item) => item.scheme_code === code);
			return [row?.employee_amount ?? 0, row?.employer_amount ?? 0];
		};
		assert.deepEqual(charge('SI'), insured ? [4_048_000, 8_855_000] : [0, 0]);
		assert.deepEqual(charge('HI'), insured ? [759_000, 1_518_000] : [0, 0]);
		assert.deepEqual(charge('UI'), [0, 0]);
		assert.equal(
			slip.base.find((row) => row.component_code === 'INSURANCE_EQUIVALENT')?.amount ?? 0,
			insured ? 0 : 10_373_000
		);
	});
