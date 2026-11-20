import { describe, expect, it } from '@effect/vitest';
import {
	gainUsd,
	odds,
	play,
	scenarios,
	schedule,
	workOut,
	type FxFixingFacts,
	type FxTerms
} from '../src/lib/fx.js';

/** FX hedge rules with synthetic deals: results from the bank's fixing rates, scenarios, schedules and the odds. */
const terms = (over: Partial<FxTerms> = {}): FxTerms => ({
	structure: 'trf',
	pair: 'USDSGD',
	side: 'sell',
	notional_currency: null,
	notional: '1000000',
	leveraged_notional: null,
	strike: '1.30',
	knock_out: null,
	knock_out_type: null,
	knock_in: null,
	target: null,
	target_rule: 'prorata',
	dci_deposit_currency: null,
	dci_deposit_amount: null,
	ended_on: null,
	...over
});
const fixings = (
	rates: readonly (string | null)[],
	over: Partial<FxFixingFacts> = {}
): FxFixingFacts[] =>
	rates.map((fixing_rate, i) => ({
		id: `f${i + 1}`,
		fixing_date: `2026-0${i + 1}-15`,
		settlement_date: null,
		notional: null,
		leveraged_notional: null,
		strike: null,
		firm: true,
		condition: null,
		condition_side: null,
		condition_level: null,
		fixing_rate,
		outcome: null,
		settled_amount: null,
		...over
	}));
const outcomes = (r: ReturnType<typeof workOut>) => r.results.map((x) => [x.outcome, x.amount]);

describe('working out fixings', () => {
	it('uses each option’s direction when a confirmation has no deal direction', () => {
		const deal = terms({ structure: 'other', side: null, notional: '100000' });
		const rows = fixings(['1.31', '1.31', '1.29', '1.31']).map((f, i) => ({
			...f,
			firm: false,
			condition: [
				'OPS buys a USD call if above 1.30',
				'OPS is the seller if above 1.30',
				'OPS sells a USD call if above 1.30',
				'OPS buys and OPS sells if above 1.30'
			][i] ?? null
		}));
		const realized = (side: FxTerms['side']) =>
			workOut({ ...deal, side }, rows).results.map(({ outcome, gain }) => [outcome, gain]);
		expect(realized(null)).toEqual([
			['exercised', '1000'], ['exercised', '-1000'], ['not_exercised', '0'], [null, null]
		]);
		expect(realized('sell')[0]).toEqual(['exercised', '-1000']);
	});

	it('pays the fixing that reaches a TRF target by its rule, and ends the deal', () => {
		const deal = (target_rule: FxTerms['target_rule']) =>
			workOut(
				terms({ strike: '1.3000', target: '0.0100', target_rule }),
				fixings(['1.2920', '1.2950', '1.2900'])
			);
		expect(outcomes(deal('prorata'))).toEqual([
			['exercised', '1000000'],
			['exercised', '400000'],
			['ended', '0']
		]);
		expect(outcomes(deal('full'))[1]).toEqual(['exercised', '1000000']);
		expect(outcomes(deal('none'))[1]).toEqual(['target_not_paid', '0']);
		expect(deal('prorata')).toMatchObject({ ended: true, target_used: '0.01' });
	});

	it('leaves a knock-in TRF fixing unexercised until the rate is beyond the knock-in', () => {
		const r = workOut(
			terms({
				strike: '1.30',
				knock_in: '1.37',
				notional: '100000',
				leveraged_notional: '200000',
				target: '0.05'
			}),
			fixings(['1.28', '1.33', '1.38', '1.27', '1.20'], {
				firm: false,
				condition: 'Only if the knock-in is reached'
			})
		);
		expect(outcomes(r)).toEqual([
			['exercised', '100000'],
			['not_exercised', '0'],
			['leveraged', '200000'],
			['exercised', '100000'],
			['ended', '0']
		]);
	});

	it('knocks out one fixing at expiry, and every later one when the barrier holds any time', () => {
		const atExpiry = workOut(
			terms({ knock_out: '1.25', knock_out_type: 'at_expiry' }),
			fixings(['1.24', '1.27'])
		);
		expect(outcomes(atExpiry).map(([o]) => o)).toEqual(['knocked_out', 'exercised']);
		const anyTime = workOut(
			terms({ knock_out: '1.25', knock_out_type: 'continuous' }),
			fixings(['1.27', '1.24', '1.29', '1.31'])
		);
		expect(outcomes(anyTime).map(([o]) => o)).toEqual([
			'exercised',
			'knocked_out',
			'ended',
			'ended'
		]);
		const leveraged = workOut(
			terms({ notional: '100000', leveraged_notional: '200000', target: '0.03' }),
			fixings(['1.32', '1.28', '1.29', '1.25'])
		);
		expect(outcomes(leveraged)).toEqual([
			['leveraged', '200000'],
			['exercised', '100000'],
			['exercised', '100000'],
			['ended', '0']
		]);
	});

	it('keeps a result a person chose, and converts a gain to USD on its settlement date', () => {
		const r = workOut(
			terms({
				structure: 'fwd',
				pair: 'USDJPY',
				side: 'buy',
				strike: '153.80',
				notional: '500000'
			}),
			fixings(['156.80'], { outcome: 'exercised' })
		);
		expect(r.results[0]).toMatchObject({ outcome: 'exercised', auto: false, gain: '1500000' });
		const rates = [{ currency: 'JPY', rate_date: '2026-01-14', usd_per_unit: '0.00625' }];
		expect(gainUsd('USDJPY', '1500000', '2026-01-15', rates)).toBe('9375');
	});

	it('reads a condition from its words, and leaves an unclear one to a person', () => {
		const above = workOut(
			terms({ structure: 'enh' }),
			fixings(['1.29', '1.31'], {
				firm: false,
				condition: 'Exercised if the fixing is at or above 1.3000'
			})
		);
		expect(outcomes(above).map(([o]) => o)).toEqual(['not_exercised', 'exercised']);
		const unclear = workOut(
			terms({ structure: 'pivot' }),
			fixings(['1.29'], { firm: false, condition: 'Exercised between 1.25 and 1.35' })
		);
		expect(unclear.results[0]?.outcome).toBeNull();
	});
});

describe('scenarios and schedules', () => {
	it('plays every open fixing at one rate, with leverage and a pro-rated target', () => {
		const deal = terms({ notional: '100000', leveraged_notional: '200000' });
		const open = fixings([null, null, null]);
		expect(play(deal, open, () => 1.28, '0', null).usd).toBeCloseTo(4687.5, 2);
		expect(play(deal, open, () => 1.32, '0', null).usd).toBeCloseTo(-9090.91, 2);
		const capped = play({ ...deal, target: '0.05' }, open, () => 1.28, '0', null);
		expect(capped).toMatchObject({ settled: 3, target_reached: true });
		expect(capped.usd).toBeCloseTo(3906.25, 2);
		expect(scenarios(deal, open, 1.3, '0', null).map((s) => s.rate)).toContain(1.3);
	});

	it('works out proposal dates from a schedule, clamped to month ends and capped', () => {
		expect(schedule('monthly', '2026-11-18', '2026-12-15', '2027-05-15', null)).toHaveLength(6);
		expect(schedule('monthly', '2026-11-18', null, null, null)).toEqual([
			'2026-12-18',
			'2027-01-18',
			'2027-02-18',
			'2027-03-18',
			'2027-04-18',
			'2027-05-18',
			'2027-06-18',
			'2027-07-18',
			'2027-08-18',
			'2027-09-18',
			'2027-10-18',
			'2027-11-18'
		]);
		expect(schedule('monthly', '2026-11-18', '2027-01-31', null, 3)).toEqual([
			'2027-01-31',
			'2027-02-28',
			'2027-03-31'
		]);
		expect(schedule('weekly', '2026-11-18', null, null, 100)).toHaveLength(60);
	});

	it('gives the same odds every time for one deal, and says when history is too short', () => {
		const history: [string, number][] = Array.from({ length: 300 }, (_, i) => {
			const d = new Date(Date.UTC(2025, 9, 1) + i * 86400000).toISOString().slice(0, 10);
			return [d, 1.3 * Math.exp(0.004 * Math.sin(i * 1.7) + 0.002 * Math.cos(i * 0.9))];
		});
		const deal = {
			...terms({ structure: 'eko', knock_out: '1.25', knock_out_type: 'continuous' as const }),
			forward_reference: null,
			forward_reference_date: null,
			spot_reference: null,
			dci_yield_pct: null,
			trade_date: null
		};
		const open = fixings([null, null, null]).map((f, i) => ({
			...f,
			fixing_date: `2026-08-${10 + i * 5}`
		}));
		const first = odds(deal, open, history, 1.3, '2026-07-27', '0', null, 'deal-1', { paths: 400 });
		expect(first).toEqual(
			odds(deal, open, history, 1.3, '2026-07-27', '0', null, 'deal-1', { paths: 400 })
		);
		expect(typeof first === 'string' ? first : first.map((o) => o.window)).toEqual([
			'calm',
			'long'
		]);
		expect(odds(deal, open, history.slice(-20), 1.3, '2026-07-27', '0', null, 'deal-1')).toMatch(
			/at least 40/
		);
	});
});
