import assert from 'node:assert/strict';
import test from 'node:test';
import { assessStatutory, buildStatutory, expectStatutory } from './fixtures/statutory-world.ts';

test('Singapore: incomplete CPF and SHG registration does not waive mandatory liabilities', () => {
	for (const period of ['2025-12', '2026-01', '2026-04', '2026-07', '2027-01']) {
		const book = assessStatutory({
			code: 'SG',
			period,
			people: [
				...(
					[
						['CDAC', 'CHINESE', 'NONE'],
						['ECF', 'EURASIAN', 'NONE'],
						['MBMF', 'MALAY', 'ISLAM'],
						['SINDA', 'INDIAN', 'NONE']
					] as const
				).map(([scheme, race, religion]) => ({
					key: scheme,
					wage: 3000,
					age: 30,
					citizenship: 'CITIZEN',
					race,
					religion,
					registrations: {
						CPF: { kind: 'NOT_REGISTERED' },
						[scheme]: { kind: 'NOT_REGISTERED' }
					}
				}))
			]
		});
		for (const [scheme, amount] of [
			['CDAC', 1],
			['ECF', 9],
			['MBMF', 6.5],
			['SINDA', 7]
		] as const) {
			expectStatutory(book, scheme, 'CPF', 600, 510);
			expectStatutory(book, scheme, scheme, amount, 0);
		}
	}
	const { warnings } = buildStatutory({
		code: 'SG',
		period: '2026-01',
		people: [
			{
				key: 'REGISTRATION-WARNING',
				wage: 3000,
				age: 30,
				citizenship: 'CITIZEN',
				race: 'CHINESE',
				registrations: {
					CPF: { kind: 'NOT_REGISTERED' },
					CDAC: { kind: 'NOT_REGISTERED' }
				}
			}
		]
	});
	for (const scheme of ['CPF', 'CDAC'])
		assert.ok(warnings.some((line) => line.includes(`${scheme}: registration incomplete`)));
});
