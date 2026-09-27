import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assessStatutory,
	expectStatutory,
	expectStatutorySkipped
} from './fixtures/statutory-world.ts';

for (const period of ['2025-12', '2026-01', '2027-01'])
	test(`Taiwan ${period} — permanent residence alone cannot charge EI`, () => {
		assert.throws(
			() =>
				assessStatutory({
					code: 'TW',
					period,
					riskClass: '1',
					people: [{ key: 'UNPROVEN-PR', wage: 60_000, citizenship: 'PERMANENT_RESIDENT' }]
				}),
			/eligibility class is required/
		);
		const book = assessStatutory({
			code: 'TW',
			period,
			riskClass: '1',
			people: [
				{
					key: 'OTHER-PR',
					wage: 60_000,
					citizenship: 'PERMANENT_RESIDENT',
					registrations: { EI: { kind: 'NOT_REGISTERED' } }
				}
			]
		});
		expectStatutorySkipped(book, 'OTHER-PR', 'EI');
	});

test('Taiwan 2026 — insured permanent-resident foreign professional owes EI at the published grade', () => {
	const book = assessStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [
			{
				key: 'PRO-PR',
				wage: 60_000,
				citizenship: 'PERMANENT_RESIDENT',
				registrations: {
					EI: {
						kind: 'REGISTERED',
						elections: {
							insured_amount: 45_800,
							eligibility_class: 'FOREIGN_PROFESSIONAL_PR',
							eligibility_document_reference: 'PR-AND-WORK-PROOF'
						}
					}
				}
			}
		]
	});
	expectStatutory(book, 'PRO-PR', 'EI', 92, 321);
});

test('Taiwan 2026 — insured foreign spouse owes EI above the top insured grade', () => {
	const book = assessStatutory({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [
			{
				key: 'FOREIGN-SPOUSE',
				wage: 60_000,
				citizenship: 'FOREIGNER',
				pass_type: 'EMPLOYMENT_PASS',
				registrations: {
					EI: {
						kind: 'REGISTERED',
						elections: {
							insured_amount: 45_800,
							eligibility_class: 'FOREIGN_SPOUSE',
							eligibility_document_reference: 'MARRIAGE-RESIDENCE-WORK-PROOF'
						}
					}
				}
			}
		]
	});
	expectStatutory(book, 'FOREIGN-SPOUSE', 'EI', 92, 321);
});

test('Taiwan 2026 — noncitizen EI registration without eligibility proof refuses', () => {
	assert.throws(
		() =>
			assessStatutory({
				code: 'TW',
				period: '2026-01',
				riskClass: '1',
				people: [
					{
						key: 'UNPROVEN-PR',
						wage: 40_000,
						citizenship: 'PERMANENT_RESIDENT',
						registrations: {
							EI: { kind: 'REGISTERED', elections: { insured_amount: 40_100 } }
						}
					}
				]
			}),
		/eligibility class is required/
	);
});
