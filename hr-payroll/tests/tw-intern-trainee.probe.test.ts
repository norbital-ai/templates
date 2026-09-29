import assert from 'node:assert/strict';
import test from 'node:test';
import { assessStatutory, buildStatutory } from './fixtures/statutory-world.ts';

// Minimum Wage Act §5 and LSA §2 turn on the employment relationship, not the INTERN label.
// https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030028&flno=5
// https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=2
for (const [period, floor] of [
	['2025-12', 28_590],
	['2026-01', 29_500]
] as const)
	test(`Taiwan ${period} — an employed intern is paid the monthly minimum`, () => {
		const { slips } = buildStatutory({
			code: 'TW',
			period,
			riskClass: '1',
			people: [{ key: 'EMPLOYED-INTERN', wage: 20_000, employment_type: 'INTERN' }]
		});
		assert.equal(slips.get('EMPLOYED-INTERN')?.gross, floor);
	});

// BLI reserves the subminimum LI grades for an insured at a registered vocational-training unit.
// This employment record has no such class or unit evidence; INTERN alone must not unlock it.
// https://www.bli.gov.tw/0007801.html
// https://www.bli.gov.tw/0106037.html
test('Taiwan 2026 — INTERN alone cannot declare a vocational-trainee LI grade', () => {
	for (const elections of [
		{ insured_amount: 13_500 },
		{ insured_amount: 13_500, notification_reference: 'CLAIMED-TRAINING-UNIT-NOTICE' }
	])
		assert.throws(
			() =>
				assessStatutory({
					code: 'TW',
					period: '2026-01',
					riskClass: '1',
					people: [
						{
							key: 'NO-TRAINEE-CLASS',
							wage: 20_000,
							employment_type: 'INTERN',
							registrations: { LI: { kind: 'REGISTERED', elections } }
						}
					]
				}),
			/below the full-time minimum/i
		);
});
