// What a no-pay day takes is the salary over the divisor the law's `conversions` name: a day rate rounded first or the
// amount rounded once, the contract's own working days, the roster's working days, or the day's own rate. Malaysia's law
// pack is the fixture, its `conversions` varied per test; every expectation is computed from the test's own inputs.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import { run, slip } from '../amendment_kit.ts';
import {
	ENTITY,
	REST,
	WORK,
	lawWith,
	leaveCreate,
	pack,
	uuid,
	wholeDays,
	workspace
} from '../kit.ts';

const EMPLOYMENT = idOf('employment', uuid(6));
const NOW = '2026-06-20T02:00:00.000Z';
type Seed = ReturnType<typeof pack>;
const terms = (amount: number, unit = 'MONTHLY', days = 5) => ({
	rate: { amount, unit },
	normal_days_per_week: days,
	normal_hours_per_week: 8 * days,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
});
const malaysia = (
	agreed: ReturnType<typeof terms>,
	conversions: { readonly [key: string]: Seed[string][number][string] } = {},
	days: Parameters<typeof pack>[4] = []
): Seed => {
	const seed = lawWith(pack('MY', 'Asia/Kuala_Lumpur', agreed, {}, days, []), { conversions });
	return {
		...seed,
		employment: (seed.employment ?? []).map((row) => ({
			...row,
			effective_range: { from: '2026-01-01', to: null }
		})),
		contract_terms: (seed.contract_terms ?? []).map((row) => ({
			...row,
			effective_from: '2026-01-01'
		})),
		statutory_parameters: (seed.statutory_parameters ?? []).map((row) => ({
			...row,
			effective_from: '2026-01-01'
		}))
	};
};
/** June's payslip after these whole days of no-pay leave: the NPL line and the checkpoints. */
const june = (seed: Seed, dates: readonly string[]) =>
	Effect.gen(function* () {
		const t = yield* TestWorkspace;
		yield* (yield* t.as(t.admin)).act({
			'leave_catalog_entry.create': [
				leaveCreate({
					entity_id: ENTITY,
					employment_id: EMPLOYMENT,
					catalog_code: 'NPL',
					days: wholeDays(...dates)
				})
			]
		});
		yield* run(t, '2026-06');
		const { breakdown } = yield* slip(t, '2026-06');
		const npl = breakdown.lines.find((line) => line.code === 'NPL');
		assert.equal(npl?.direction, 'DEDUCT');
		const at = (code: string) => breakdown.checkpoints.find((row) => row.code === code)?.value;
		return { npl: npl?.amount, basic: at('BASIC'), paid: at('PAID_BASIC') };
	}).pipe(Effect.provide(workspace({ seed, now: NOW })));
const cents = (value: number) => Math.round(value * 100) / 100;
const THREE = ['2026-06-10', '2026-06-11', '2026-06-12'];

describe('a no-pay day on a day-rate basis', () => {
	// a day is monthly × 12 ÷ (52 × 5): 1,004.9538… on 21,774
	const SALARY = 21_774;
	const day = (SALARY * 12) / 260;
	const rounding = (day_rate?: string) => ({
		proration: 'DAY_RATE',
		rounding: { mode: 'HALF_UP', scale: 2, ...(day_rate === undefined ? {} : { day_rate }) }
	});
	it.live('rounds the day rate first, then takes the days', () =>
		Effect.gen(function* () {
			const { npl } = yield* june(malaysia(terms(SALARY), rounding()), THREE);
			assert.equal(npl, cents(3 * cents(day)));
		})
	);
	it.live('with `day_rate` AMOUNT rounds what the days take, not the rate', () =>
		Effect.gen(function* () {
			const { npl } = yield* june(malaysia(terms(SALARY), rounding('AMOUNT')), THREE);
			assert.equal(npl, cents(3 * day));
			assert.notEqual(cents(3 * day), cents(3 * cents(day)));
		})
	);
});

describe('a no-pay day on working days', () => {
	const WORKING = { proration: 'WORKING_DAYS' };
	it.live('counts the contract’s days, not the company’s', () =>
		Effect.gen(function* () {
			// June has 26 days to work on a six-day week; the company keeps a five-day calendar
			const { npl, paid } = yield* june(malaysia(terms(5200, 'MONTHLY', 6), WORKING), [
				'2026-06-10'
			]);
			assert.equal(npl, 5200 / 26);
			assert.equal(paid, 5200 - 5200 / 26);
		})
	);
	it.live('counts the roster’s working days', () =>
		Effect.gen(function* () {
			// every weekday rostered and clocked, bar two the roster turns into rest days: 20 to work
			const rested = ['2026-06-11', '2026-06-12'];
			const days = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}`)
				.filter((date) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()))
				.map((date) =>
					rested.includes(date) ? { date, shift: REST, hours: 1 } : { date, shift: WORK, hours: 8 }
				);
			const { npl, paid } = yield* june(malaysia(terms(4400), WORKING, days), ['2026-06-10']);
			assert.equal(npl, 4400 / 20);
			assert.equal(paid, 4400 - 4400 / 20);
		})
	);
});

describe('a no-pay day on a daily rate', () => {
	it.live('takes the day at the rate, and the month pays its working days', () =>
		Effect.gen(function* () {
			const rate = 200;
			const { npl, basic, paid } = yield* june(malaysia(terms(rate, 'DAILY')), ['2026-06-10']);
			// June's 22 weekdays at the rate, less the day's line
			assert.equal(npl, rate);
			assert.equal(basic, rate * 22);
			assert.equal(paid, rate * 21);
		})
	);
});
