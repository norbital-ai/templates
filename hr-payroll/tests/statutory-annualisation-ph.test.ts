import test from 'node:test';
import { assessStatutory, expectStatutory } from './fixtures/statutory-world.ts';

// RR 11-2018 s.2.79(B)(5): annual taxable compensation and tax already withheld
// include previous employment. Reconcile on the final payment at termination,
// including refunds, rather than withholding another ordinary monthly amount.
// https://bir-cdn.bir.gov.ph/local/pdf/RR%20No.%2011-2018.pdf
for (const period of ['2025-12', '2026-01', '2026-04', '2026-10']) {
	for (const withheld of [5_000, 10_000]) {
		test(`PH ${period}: final pay reconciles prior-employer income, mandatory deductions and PHP${withheld} withholding`, () => {
			const year = period.slice(0, 4);
			const opening = (base: number, employee: number) => [
				{
					year,
					base,
					employee,
					employer: 0,
					reference: 'SYNTHETIC-2316'
				}
			];
			const book = assessStatutory({
				code: 'PH',
				period,
				people: [
					{
						key: 'FINAL',
						wage: 30_000,
						exit_date: `${period}-${period.endsWith('-04') ? '30' : '31'}`,
						registrations: {
							WTAX: { kind: 'REGISTERED', opening: opening(300_000, withheld) },
							SSS: { kind: 'REGISTERED', opening: opening(0, 10_000) },
							PHIC: { kind: 'REGISTERED', opening: opening(0, 8_000) },
							HDMF: { kind: 'REGISTERED', opening: opening(0, 2_000) }
						}
					}
				]
			});
			// Taxable: 300,000 +30,000 -20,000 -(1,500 +750 +200) =307,550.
			// Annual tax: (307,550 -250,000) *15% =8,632.50.
			expectStatutory(book, 'FINAL', 'WTAX', 8_632.5 - withheld, 0);
		});
	}
}
