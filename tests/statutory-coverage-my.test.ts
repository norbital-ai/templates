import assert from 'node:assert/strict';
import test from 'node:test';
import { assessStatutory, expectStatutory } from './fixtures/statutory-world.ts';

const OUT = { kind: 'NOT_REGISTERED' } as const;
const otherSchemes = {
	EPF: OUT,
	EPF_PR: OUT,
	EPF_NON_CITIZEN: OUT,
	PCB: OUT,
	HRDF: OUT,
	SKBBK: OUT
};

// Act 4 First Schedule 12(i); Act 800 First Schedule 9; PERKESO Circular 3/2024.
// The test uses first contribution liability, including earlier employers, rather than payment.
for (const code of ['MY', 'MY-nihon'] as const) {
	test(`${code}: missing liability history is allowed when it cannot change the age category`, () => {
		const cases = [
			{ key: 'SOCSO-54', age: 54, scheme: 'SOCSO', employee: 14.75, employer: 51.65 },
			{ key: 'SOCSO-60', age: 60, scheme: 'SOCSO', employee: 0, employer: 36.9 },
			{ key: 'EIS-56', age: 56, scheme: 'EIS', employee: 5.9, employer: 5.9 },
			{ key: 'EIS-60', age: 60, scheme: 'EIS', employee: 0, employer: 0 }
		];
		const book = assessStatutory({
			code,
			period: '2026-01',
			people: cases.map((row) => ({
				key: row.key,
				age: row.age,
				wage: 3000,
				citizenship: 'CITIZEN',
				registrations: {
					...otherSchemes,
					SOCSO: OUT,
					EIS: OUT,
					[row.scheme]: { kind: 'REGISTERED', first_contribution_due_on: null }
				}
			}))
		});
		for (const row of cases) expectStatutory(book, row.key, row.scheme, row.employee, row.employer);
	});

	for (const period of ['2026-01', '2026-06', '2026-08']) {
		test(`${code} ${period}: certified invalidity pensioners use Second Category independently of general pension status`, () => {
			const cases = [
				{ key: 'INVALIDITY', age: 40, pension: false, invalidity: true, first: '2015-01-01' },
				{ key: 'OTHER-PENSION', age: 40, pension: true, invalidity: false, first: '2015-01-01' },
				{ key: 'INVALIDITY-UNKNOWN-HISTORY', age: 56, pension: true, invalidity: true, first: null }
			];
			const book = assessStatutory({
				code,
				period,
				people: cases.map((row) => ({
					key: row.key,
					age: row.age,
					wage: 3000,
					citizenship: 'CITIZEN',
					receiving_pension: row.pension,
					registrations: {
						...otherSchemes,
						EIS: OUT,
						SOCSO: {
							kind: 'REGISTERED',
							first_contribution_due_on: row.first,
							elections: { certified_invalidity_pension: row.invalidity }
						}
					}
				}))
			});
			for (const row of cases)
				expectStatutory(
					book,
					row.key,
					'SOCSO',
					row.invalidity ? 0 : 14.75,
					row.invalidity ? 36.9 : 51.65
				);
		});

		test(`${code} ${period}: SOCSO first liability on the 55th birthday selects the second category`, () => {
			const people = ['CITIZEN', 'PR', 'FOREIGNER'].flatMap((citizenship) =>
				['2025-01-14', '2025-01-15'].map((first, index) => ({
					key: `${citizenship}-${index}`,
					wage: 3000,
					citizenship,
					birth_date: '1970-01-15',
					hire_date: '2026-01-01',
					registrations: {
						...otherSchemes,
						EIS: OUT,
						SOCSO: { kind: 'REGISTERED', first_contribution_due_on: first }
					}
				}))
			);
			const book = assessStatutory({ code, period, people });
			for (const citizenship of ['CITIZEN', 'PR', 'FOREIGNER']) {
				expectStatutory(book, `${citizenship}-0`, 'SOCSO', 14.75, 51.65);
				expectStatutory(book, `${citizenship}-1`, 'SOCSO', 0, 36.9);
			}
		});

		test(`${code} ${period}: EIS liability before 57 continues across a later employer`, () => {
			const book = assessStatutory({
				code,
				period,
				people: ['2025-01-14', '2025-01-15'].map((first, index) => ({
					key: `EIS-${index}`,
					wage: 3000,
					citizenship: 'CITIZEN',
					birth_date: '1968-01-15',
					hire_date: '2026-01-01',
					registrations: {
						...otherSchemes,
						SOCSO: OUT,
						EIS: { kind: 'REGISTERED', first_contribution_due_on: first }
					}
				}))
			});
			expectStatutory(book, 'EIS-0', 'EIS', 5.9, 5.9);
			expectStatutory(book, 'EIS-1', 'EIS', 0, 0);
		});
	}

	for (const [scheme, birth] of [
		['SOCSO', '1970-01-15'],
		['EIS', '1968-01-15']
	] as const) {
		test(`${code}: ${scheme} requires unknown prior liability history when it changes the category`, () => {
			assert.throws(
				() =>
					assessStatutory({
						code,
						period: '2026-01',
						people: [
							{
								key: 'UNKNOWN-HISTORY',
								wage: 3000,
								citizenship: 'CITIZEN',
								birth_date: birth,
								registrations: {
									...otherSchemes,
									SOCSO: OUT,
									EIS: OUT,
									[scheme]: { kind: 'REGISTERED', first_contribution_due_on: null }
								}
							}
						]
					}),
				/first contribution.*date/i
			);
		});

		test(`${code}: ${scheme} rejects impossible liability dates`, () => {
			for (const first of ['1900-01-01', '2027-01-01', ...(scheme === 'EIS' ? ['2017-12-31'] : [])])
				assert.throws(
					() =>
						assessStatutory({
							code,
							period: '2026-01',
							people: [
								{
									key: 'INVALID-HISTORY',
									wage: 3000,
									citizenship: 'CITIZEN',
									birth_date: birth,
									registrations: {
										...otherSchemes,
										SOCSO: OUT,
										EIS: OUT,
										[scheme]: { kind: 'REGISTERED', first_contribution_due_on: first }
									}
								}
							]
						}),
					/first contribution.*date/i
				);
		});
	}
}
