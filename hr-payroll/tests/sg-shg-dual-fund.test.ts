import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assessStatutory,
	expectStatutory,
	expectStatutorySkipped
} from './fixtures/statutory-world.ts';

test('Singapore: a documented Indian-Chinese dual-fund election charges both SINDA and CDAC', () => {
	for (const period of ['2025-12', '2026-01', '2026-04', '2026-07', '2027-01']) {
		const book = assessStatutory({
			code: 'SG',
			period,
			people: [
				{ key: 'DEFAULT', wage: 3000, age: 30, citizenship: 'CITIZEN', race: 'INDIAN' },
				{
					key: 'DUAL',
					wage: 3000,
					age: 30,
					citizenship: 'CITIZEN',
					race: 'INDIAN',
					registrations: {
						CDAC: {
							kind: 'REGISTERED',
							elections: {
								shg_dual_cdac: true,
								shg_secondary_race: 'CHINESE',
								shg_instruction_reference: 'NRIC-AND-FUND-INSTRUCTION'
							}
						}
					}
				}
			]
		});
		expectStatutory(book, 'DEFAULT', 'SINDA', 7, 0);
		expectStatutorySkipped(book, 'DEFAULT', 'CDAC');
		expectStatutory(book, 'DUAL', 'SINDA', 7, 0);
		expectStatutory(book, 'DUAL', 'CDAC', 1, 0);
	}
});

test('Singapore: a dual-fund instruction needs secondary-race and notification evidence', () => {
	const person = {
		key: 'DUAL',
		wage: 3000,
		age: 30,
		citizenship: 'CITIZEN' as const,
		race: 'INDIAN' as const
	};
	for (const elections of [
		{ shg_dual_cdac: true, shg_instruction_reference: 'FUND-INSTRUCTION' },
		{ shg_dual_cdac: true, shg_secondary_race: 'CHINESE' },
		{
			shg_dual_cdac: true,
			shg_secondary_race: 'MALAY',
			shg_instruction_reference: 'FUND-INSTRUCTION'
		}
	]) {
		assert.throws(() =>
			assessStatutory({
				code: 'SG',
				period: '2026-01',
				people: [{ ...person, registrations: { CDAC: { kind: 'REGISTERED', elections } } }]
			})
		);
	}
});
