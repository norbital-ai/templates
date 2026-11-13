// The engine works out the day and hour rates once per run from the jurisdiction's `conversions`: an allowance the row
// declares `include_in_rate` is wage the rate divides, and a FIXED hour basis divides the month by its own hours. The
// Malaysian pack is the fixture, its conversions varied; expected figures come from the test's inputs and the row's own
// lookup.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import type { JsonObject } from '../../src/lib/payroll_engine/contracts.ts';
import { payBasis } from '../../src/lib/payroll_engine/engine.ts';
import { ownLines, run } from '../amendment_kit.ts';
import { WORK, lawAt, lawWith, pack, workspace } from '../kit.ts';

describe('the day rate', () => {
	it('carries an allowance in the rate, and none outside it', () => {
		const { settings } = lawAt('MY', '2026-07-08');
		const rate = (amount: number, allowances: JsonObject) =>
			payBasis(
				{
					run: {},
					settings,
					subtotals: [],
					allowance: [
						{ code: 'FIXED', lookup: {}, include_in_rate: true },
						{ code: 'TIPS', lookup: {}, include_in_rate: false }
					],
					overtime: [],
					statutory: [],
					leave_catalog: [],
					claim_catalog: [],
					adhoc_catalog: [],
					loan_catalog: [],
					employee: {},
					employment: {
						terms: {
							rate: { amount, unit: 'MONTHLY' },
							normal_hours_per_day: 8,
							normal_hours_per_week: 40,
							normal_days_per_week: 5,
							allowances
						}
					},
					employer: { payment_schedule: { non_working_weekdays: [0, 6] } },
					balance: {},
					entries: {}
				},
				{ from: '2026-06-01', to: '2026-06-30' }
			).day_rate;
		const both = rate(2600, { FIXED: { amount: 260 }, TIPS: { amount: 100 } });
		// the one in the rate is wage like the salary; the one outside changes nothing
		assert.equal(both, rate(2600 + 260, {}));
		assert.ok(both > rate(2600, { TIPS: { amount: 100 } }));
		assert.equal(rate(2600, { TIPS: { amount: 100 } }), rate(2600, {}));
	});
});

describe('the hour rate', () => {
	it.live('on a FIXED basis is the month over its hours, priced by the overtime row', () => {
		const SALARY = 1927;
		const HOURS = 173;
		const base = pack(
			'MY',
			'Asia/Kuala_Lumpur',
			{
				rate: { amount: SALARY, unit: 'MONTHLY' },
				statutory_work_category: 'MANUAL_LABOUR',
				work_classification: 'EA_COVERED',
				residency_status: 'CITIZEN',
				wage_payment_method: 'BANK',
				allowances: {}
			},
			{},
			[{ date: '2026-02-02', shift: WORK, hours: 10, overtime: 2 }],
			[]
		);
		const seed = lawWith(base, { conversions: { hour: { basis: 'FIXED', hours: HOURS } } });
		const { standard_premium } = Schema.decodeUnknownSync(
			Schema.Struct({ standard_premium: Schema.Number })
		)(
			lawAt('MY', '2026-02-25').rows.overtime_catalog.find((row) => row.code === 'OVERTIME')?.lookup
		);
		const cents = (value: number) => Math.round(value * 100) / 100;
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-02');
			// the hour to the cent, its premium to the cent, then the two hours
			assert.equal(
				(yield* ownLines(t, '2026-02'))['OVERTIME/EMPLOYEE'],
				cents(2 * cents(standard_premium * cents(SALARY / HOURS)))
			);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-02-20T02:00:00.000Z' })));
	});
});
