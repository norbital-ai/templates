/**
 * FX hedges, one place for every page, automation and test: pair rates from the official daily rates, how each
 * fixing works out, the position at today's rate, scenarios, proposal schedules and the "how likely" simulation.
 *
 * - A pair is six letters, base then quote (USDSGD: one USD in SGD). The company sells or buys the base currency.
 * - Gain per unit on a fixing: strike − rate when selling, rate − strike when buying; gains are in the quote currency.
 * - Results use the bank's fixing rate a person records; positions and scenarios use a rate for every open fixing.
 * - A person's chosen result on a fixing is kept; everything else is worked out from the deal's terms.
 *
 * Decimals cross as the platform's decimal strings; dates as ISO `YYYY-MM-DD`.
 */
import type { MessageKey, ValueOf } from '@norbital-ai/bolt';
import { BigDecimal, DateTime } from 'effect';
import { daysBetween, decimal, text, ZERO } from './calculations.js';

export const FX_STRUCTURES = [
	'fwd',
	'trf',
	'dci',
	'exko',
	'eko',
	'eko_eki',
	'enh',
	'enh_spot',
	'pivot',
	'acc',
	'other'
] as const;
export const FX_OUTCOMES = [
	'exercised',
	'leveraged',
	'not_exercised',
	'knocked_out',
	'converted',
	'not_converted',
	'ended',
	'target_not_paid'
] as const;
export type FxOutcome = (typeof FX_OUTCOMES)[number];

const FIXING_READ = {
	kind: 'object',
	many: true,
	optional: true,
	fields: {
		fixing_date: { kind: 'date' },
		settlement_date: { kind: 'date', optional: true },
		notional: { kind: 'decimal', scale: 2, optional: true },
		leveraged_notional: { kind: 'decimal', scale: 2, optional: true },
		strike: { kind: 'decimal', scale: 8, optional: true },
		firm: { kind: 'bool', optional: true },
		condition: { kind: 'text', optional: true },
		condition_side: { kind: 'enum', values: ['above', 'below'], optional: true },
		condition_level: { kind: 'decimal', scale: 8, optional: true }
	}
} as const;
/** A deal's terms as a term sheet, confirmation or banker's proposal prints them. */
export const FX_TERMS_READ = {
	bank_code: { kind: 'text', optional: true },
	bank_reference: { kind: 'text', optional: true },
	other_references: { kind: 'text', many: true, optional: true },
	trade_date: { kind: 'date', optional: true },
	structure: { kind: 'enum', values: FX_STRUCTURES, optional: true },
	structure_as_written: { kind: 'text', optional: true },
	pair: { kind: 'text', optional: true },
	side: { kind: 'enum', values: ['sell', 'buy'], optional: true },
	notional_currency: { kind: 'currency', optional: true },
	notional: { kind: 'decimal', scale: 2, optional: true },
	leveraged_notional: { kind: 'decimal', scale: 2, optional: true },
	strike: { kind: 'decimal', scale: 8, optional: true },
	knock_out: { kind: 'decimal', scale: 8, optional: true },
	knock_out_type: { kind: 'enum', values: ['at_expiry', 'continuous'], optional: true },
	knock_in: { kind: 'decimal', scale: 8, optional: true },
	spot_reference: { kind: 'decimal', scale: 8, optional: true },
	forward_reference: { kind: 'decimal', scale: 8, optional: true },
	forward_reference_date: { kind: 'date', optional: true },
	target: { kind: 'decimal', scale: 8, optional: true },
	target_rule: { kind: 'enum', values: ['prorata', 'full', 'none'], optional: true },
	dci_deposit_currency: { kind: 'currency', optional: true },
	dci_deposit_amount: { kind: 'decimal', scale: 2, optional: true },
	dci_yield_pct: { kind: 'decimal', scale: 4, optional: true },
	terms: { kind: 'text', optional: true },
	fixings: FIXING_READ
} as const;
/** What the reader returns for one hedge document. */
export const FX_READ = {
	kind: 'object',
	fields: {
		kind: {
			kind: 'enum',
			values: ['term_sheet', 'confirmation', 'notice', 'letter', 'other'],
			optional: true
		},
		signed: { kind: 'bool', optional: true },
		termination_date: { kind: 'date', optional: true },
		...FX_TERMS_READ,
		uncertain: { kind: 'text', many: true, optional: true }
	}
} as const;
/** What the reader returns for a banker's proposal: one deal per alternative, with a schedule when no dates are listed. */
export const FX_PROPOSAL_READ = {
	kind: 'object',
	fields: {
		alternatives: {
			kind: 'object',
			many: true,
			fields: {
				label: { kind: 'text', optional: true },
				...FX_TERMS_READ,
				frequency: {
					kind: 'enum',
					values: ['weekly', 'fortnightly', 'monthly', 'quarterly'],
					optional: true
				},
				first_fixing: { kind: 'date', optional: true },
				last_fixing: { kind: 'date', optional: true },
				count: { kind: 'int', optional: true }
			}
		},
		uncertain: { kind: 'text', many: true, optional: true }
	}
} as const;
export type FxSide = 'sell' | 'buy';

export type FxTerms = {
	readonly structure: (typeof FX_STRUCTURES)[number];
	readonly pair: string;
	readonly side: FxSide | null;
	readonly notional_currency: string | null;
	readonly notional: string | null;
	readonly leveraged_notional: string | null;
	readonly strike: string | null;
	readonly knock_out: string | null;
	readonly knock_out_type: 'at_expiry' | 'continuous' | null;
	readonly knock_in: string | null;
	readonly target: string | null;
	readonly target_rule: 'prorata' | 'full' | 'none';
	readonly dci_deposit_currency: string | null;
	readonly dci_deposit_amount: string | null;
	readonly ended_on: string | null;
};
export type FxFixingFacts = {
	readonly id: string;
	readonly fixing_date: string;
	readonly settlement_date: string | null;
	readonly notional: string | null;
	readonly leveraged_notional: string | null;
	readonly strike: string | null;
	readonly firm: boolean;
	readonly condition: string | null;
	readonly condition_side: 'above' | 'below' | null;
	readonly condition_level: string | null;
	readonly fixing_rate: string | null;
	readonly outcome: FxOutcome | null;
	readonly settled_amount: string | null;
};
export type FxRateRow = {
	readonly currency: string;
	readonly rate_date: string;
	readonly usd_per_unit: string;
};

const base = (pair: string) => pair.slice(0, 3);
/** A pair's two currencies, as a currency field holds them. */
export const currencies = (pair: string): Uppercase<string>[] =>
	[pair.slice(0, 3), pair.slice(3, 6)].filter((c): c is Uppercase<string> => c === c.toUpperCase());
const quote = (pair: string) => pair.slice(3, 6);
const dec = (v: string | null) => (v === null ? null : decimal(v));
const max0 = (v: BigDecimal.BigDecimal) => BigDecimal.max(v, ZERO);

// ── official rates ───────────────────────────────────────────────────────────────────────────

/** USD for one unit of `currency` on the latest date on or before `on`; null when none is known that early. */
export function usdOn(currency: string, on: string, rates: readonly FxRateRow[]) {
	if (currency === 'USD') return '1';
	let best: FxRateRow | undefined;
	for (const r of rates)
		if (
			r.currency === currency &&
			r.rate_date <= on &&
			(best === undefined || r.rate_date > best.rate_date)
		)
			best = r;
	return best?.usd_per_unit ?? null;
}
/** One unit of the base in the quote currency on `on`: crossed through USD. */
export function pairRate(pair: string, on: string, rates: readonly FxRateRow[]) {
	const b = usdOn(base(pair), on, rates);
	const q = usdOn(quote(pair), on, rates);
	return b === null || q === null
		? null
		: BigDecimal.toNumberUnsafe(decimal(b)) / BigDecimal.toNumberUnsafe(decimal(q));
}
/** The pair's daily official history, oldest first, as `[date, rate]`. */
export function pairHistory(pair: string, rates: readonly FxRateRow[]) {
	const days = [
		...new Set(
			rates
				.filter((r) => r.currency === base(pair) || r.currency === quote(pair))
				.map((r) => r.rate_date)
		)
	].sort();
	const out: [string, number][] = [];
	for (const day of days) {
		const rate = pairRate(
			pair,
			day,
			rates.filter((r) => r.rate_date === day || r.currency === 'USD')
		);
		if (rate !== null) out.push([day, rate]);
	}
	return out;
}

// ── working out a fixing ──────────────────────────────────────────────────────────────────────

/** Amount in the base currency: as printed, or quote amounts divided by the strike. */
function baseAmount(terms: FxTerms, amount: BigDecimal.BigDecimal, strike: BigDecimal.BigDecimal) {
	if (terms.notional_currency === null || terms.notional_currency === base(terms.pair))
		return amount;
	if (terms.notional_currency === quote(terms.pair)) return BigDecimal.divideUnsafe(amount, strike);
	return null;
}
const perUnitGain = (side: FxSide, strike: BigDecimal.BigDecimal, rate: BigDecimal.BigDecimal) =>
	side === 'sell' ? BigDecimal.subtract(strike, rate) : BigDecimal.subtract(rate, strike);

const WORDS: readonly [RegExp, string][] = [
	[/at or above|above or at/g, 'above'],
	[/at or below|below or at/g, 'below']
];
/** A condition's side and level read from its wording; null when a person must judge it. */
export function parseCondition(condition: string, strike: BigDecimal.BigDecimal) {
	let t = condition.toLowerCase();
	for (const [from, to] of WORDS) t = t.replace(from, to);
	if (/knock|target|between| or /.test(t)) return null;
	const above = /above|over|>/.test(t);
	const below = /below|under|</.test(t);
	if (above === below) return null;
	const k = BigDecimal.toNumberUnsafe(strike);
	const near = (t.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) ?? [])
		.map(Number)
		.filter((n) => Math.abs(n - k) <= k * 0.2)
		.sort((a, b) => Math.abs(a - k) - Math.abs(b - k))[0];
	return {
		side: above ? ('above' as const) : ('below' as const),
		level: near === undefined ? strike : decimal(String(near))
	};
}

// One confirmation can give its two options opposite directions without giving the deal a side.
function fixingSide(dealSide: FxSide | null, condition: string | null): FxSide | null {
	if (dealSide !== null) return dealSide;
	const wording = condition?.toLowerCase() ?? '';
	const buys = wording.includes('ops buys') || wording.includes('ops is the buyer');
	const sells = wording.includes('ops sells') || wording.includes('ops is the seller');
	if (buys === sells) return null;
	return buys ? 'buy' : 'sell';
}

type Step = {
	outcome: FxOutcome;
	amount: BigDecimal.BigDecimal;
	added: BigDecimal.BigDecimal;
	ends: boolean;
};

/** One fixing at `rate` with `used` of the target already gone; null when it needs a person. */
export function fixingAt(
	terms: FxTerms,
	f: Pick<
		FxFixingFacts,
		| 'notional'
		| 'leveraged_notional'
		| 'strike'
		| 'firm'
		| 'condition'
		| 'condition_side'
		| 'condition_level'
	>,
	rate: BigDecimal.BigDecimal,
	used: BigDecimal.BigDecimal
): Step | null {
	const strike = dec(f.strike ?? terms.strike);
	if (strike === null) return null;
	const usual = dec(f.notional ?? terms.notional) ?? ZERO;
	const leveraged = dec(f.leveraged_notional ?? terms.leveraged_notional);
	const none = (outcome: FxOutcome, ends = false): Step => ({
		outcome,
		amount: ZERO,
		added: ZERO,
		ends
	});
	if (terms.structure === 'dci') {
		const deposit = terms.dci_deposit_currency;
		const converts =
			deposit === base(terms.pair)
				? BigDecimal.isGreaterThan(rate, strike)
				: deposit === quote(terms.pair)
					? BigDecimal.isLessThan(rate, strike)
					: null;
		if (converts === null) return null;
		return {
			outcome: converts ? 'converted' : 'not_converted',
			amount: converts ? (dec(terms.dci_deposit_amount) ?? usual) : ZERO,
			added: ZERO,
			ends: false
		};
	}
	const ko = dec(terms.knock_out);
	if (ko !== null) {
		const knocked = BigDecimal.isGreaterThan(ko, strike)
			? BigDecimal.isGreaterThanOrEqualTo(rate, ko)
			: BigDecimal.isLessThanOrEqualTo(rate, ko);
		if (knocked) return none('knocked_out', terms.knock_out_type === 'continuous');
	}
	const ki = dec(terms.knock_in);
	const text_ = (f.condition ?? '').toLowerCase();
	if (
		!f.firm &&
		terms.structure === 'trf' &&
		ki !== null &&
		ko === null &&
		f.condition_side === null &&
		terms.side !== null
	) {
		const gain = perUnitGain(terms.side, strike, rate);
		if (BigDecimal.isNegative(gain)) {
			const beyond =
				terms.side === 'sell'
					? BigDecimal.isGreaterThanOrEqualTo(rate, ki)
					: BigDecimal.isLessThanOrEqualTo(rate, ki);
			if (!beyond) return none('not_exercised');
			return leveraged === null
				? { outcome: 'exercised', amount: usual, added: ZERO, ends: false }
				: { outcome: 'leveraged', amount: leveraged, added: ZERO, ends: false };
		}
	} else if (!f.firm) {
		const targetOnly =
			terms.structure === 'trf' &&
			terms.target !== null &&
			f.condition_side === null &&
			text_.includes('target') &&
			!/knock|<|>|above|below/.test(text_);
		const koOnly =
			terms.structure !== 'eko_eki' &&
			ko !== null &&
			f.condition_side === null &&
			!/knock-in|knock in/.test(text_) &&
			(text_.includes('knock') ||
				(text_.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) ?? []).some((n) =>
					BigDecimal.equals(decimal(n), ko)
				));
		if (!targetOnly && !koOnly) {
			const parsed =
				f.condition_side === null
					? parseCondition(f.condition ?? '', strike)
					: { side: f.condition_side, level: dec(f.condition_level) ?? strike };
			if (parsed === null) return null;
			const happens =
				parsed.side === 'above'
					? BigDecimal.isGreaterThanOrEqualTo(rate, parsed.level)
					: BigDecimal.isLessThanOrEqualTo(rate, parsed.level);
			if (!happens) return none('not_exercised');
		}
	}
	const side = fixingSide(terms.side, f.condition);
	if (side === null) return null;
	const gain = perUnitGain(side, strike, rate);
	if (BigDecimal.isNegative(gain) && leveraged !== null)
		return { outcome: 'leveraged', amount: leveraged, added: ZERO, ends: false };
	const target = dec(terms.target);
	if (
		target === null ||
		!BigDecimal.isPositive(gain) ||
		BigDecimal.isLessThan(BigDecimal.sum(used, gain), target)
	)
		return {
			outcome: 'exercised',
			amount: usual,
			added: target === null ? ZERO : max0(gain),
			ends: false
		};
	const left = max0(BigDecimal.subtract(target, used));
	if (terms.target_rule === 'full' || BigDecimal.equals(BigDecimal.sum(used, gain), target))
		return { outcome: 'exercised', amount: usual, added: gain, ends: true };
	if (terms.target_rule === 'none') return none('target_not_paid', true);
	const share = BigDecimal.round(BigDecimal.divideUnsafe(BigDecimal.multiply(usual, left), gain), {
		scale: 2,
		mode: 'half-from-zero'
	});
	return { outcome: 'exercised', amount: share, added: left, ends: true };
}

export type FxFixingResult = {
	readonly id: string;
	readonly outcome: FxOutcome | null;
	/** True when the deal's terms decided it, false when a person chose it. */
	readonly auto: boolean;
	/** Amount exchanged, in the deal's amount currency. */
	readonly amount: string | null;
	/** Gain (+) or loss (−) in the quote currency. */
	readonly gain: string | null;
};
const EXCHANGED: readonly FxOutcome[] = ['exercised', 'leveraged'];

/** Every fixing of a deal in date order, the target used and whether the terms ended the deal. */
export function workOut(terms: FxTerms, fixings: readonly FxFixingFacts[]) {
	const sorted = [...fixings].sort((a, b) => a.fixing_date.localeCompare(b.fixing_date));
	let used = ZERO;
	let ended = false;
	const results: FxFixingResult[] = [];
	for (const f of sorted) {
		const rate = dec(f.fixing_rate);
		const step = rate === null ? null : fixingAt(terms, f, rate, used);
		const after = terms.ended_on !== null && f.fixing_date > terms.ended_on;
		let outcome: FxOutcome | null;
		let amount: BigDecimal.BigDecimal | null;
		if (f.outcome !== null) {
			outcome = f.outcome;
			amount =
				EXCHANGED.includes(outcome) || outcome === 'target_not_paid'
					? (step?.amount ?? null)
					: ZERO;
			if (
				step !== null &&
				outcome !== 'not_exercised' &&
				outcome !== 'knocked_out' &&
				outcome !== 'ended'
			) {
				used = BigDecimal.sum(used, step.added);
				if (step.ends) ended = true;
			}
			if (outcome === 'knocked_out' && terms.knock_out_type === 'continuous') ended = true;
		} else if (ended || after) {
			outcome = 'ended';
			amount = ZERO;
		} else if (step === null) {
			outcome = null;
			amount = null;
		} else {
			outcome = step.outcome;
			amount = step.amount;
			used = BigDecimal.sum(used, step.added);
			if (step.ends) ended = true;
		}
		const exchanged = dec(f.settled_amount) ?? amount;
		const strike = dec(f.strike ?? terms.strike);
		const side = fixingSide(terms.side, f.condition);
		const gain =
			outcome === null ||
			terms.structure === 'dci' ||
			side === null ||
			rate === null ||
			strike === null
				? null
				: !EXCHANGED.includes(outcome) || exchanged === null
					? ZERO
					: (() => {
							const units = baseAmount(terms, exchanged, strike);
							return units === null
								? null
								: BigDecimal.multiply(perUnitGain(side, strike, rate), units);
						})();
		results.push({
			id: f.id,
			outcome,
			auto: f.outcome === null,
			amount: exchanged === null ? null : text(exchanged),
			gain: gain === null ? null : text(gain, 0)
		});
	}
	return { results, target_used: text(used, 8), ended };
}

/** A gain in the quote currency in USD at the official rate on its settlement date. */
export function gainUsd(pair: string, gain: string, on: string, rates: readonly FxRateRow[]) {
	const q = usdOn(quote(pair), on, rates);
	return q === null ? null : text(BigDecimal.multiply(decimal(gain), decimal(q)), 0);
}

/** Where a deal stands in its life: what people set, else what its fixings say. */
export function fxState(
	status: 'proposal' | 'draft' | 'live',
	worked: { readonly ended: boolean },
	terms: Pick<FxTerms, 'ended_on'>,
	fixings: readonly Pick<FxFixingFacts, 'fixing_date'>[],
	today: string
): 'proposal' | 'draft' | 'live' | 'ended' | 'terminated' {
	if (status !== 'live') return status;
	if (worked.ended || (terms.ended_on !== null && terms.ended_on < today)) return 'terminated';
	return fixings.every((f) => f.fixing_date < today) ? 'ended' : 'live';
}

// ── position, scenarios and points to weigh ───────────────────────────────────────────────────

/** A rate in USD: quote USD as is, base USD divided by the rate, a cross at the official USD per quote unit. */
function toUsd(pair: string, amountQuote: number, rate: number, usdPerQuote: number | null) {
	if (quote(pair) === 'USD') return amountQuote;
	if (base(pair) === 'USD') return amountQuote / rate;
	return usdPerQuote === null ? null : amountQuote * usdPerQuote;
}
const num = (v: string | null) => (v === null ? null : Number(v));

/**
 * Plays every open fixing at the rate `rateOf` gives it, with the same rules as a recorded fixing, from `used` of the
 * target. Fixings flagged in `knocked` were knocked out on the way (an any-time barrier). USD at `usdPerQuote`.
 */
export function play(
	terms: FxTerms,
	open: readonly FxFixingFacts[],
	rateOf: (i: number) => number,
	used: string,
	usdPerQuote: number | null,
	knocked: ReadonlySet<number> = new Set()
) {
	let u = decimal(used);
	let ended = false;
	let usd = 0;
	let settled = 0;
	let reached = false;
	let ko = knocked.size > 0;
	let unknown = false;
	open.forEach((f, i) => {
		if (ended || knocked.has(i)) return;
		const rate = rateOf(i);
		const step = fixingAt(terms, f, decimal(rate.toFixed(8)), u);
		if (step === null || (terms.side === null && terms.structure !== 'dci')) {
			unknown = true;
			return;
		}
		if (step.outcome === 'knocked_out') ko = true;
		if (step.ends) {
			ended = true;
			if (step.outcome !== 'knocked_out') reached = true;
		}
		u = BigDecimal.sum(u, step.added);
		if (!EXCHANGED.includes(step.outcome) || terms.side === null) return;
		settled += 1;
		const strike = Number(f.strike ?? terms.strike);
		const amount = Number(text(step.amount));
		const units =
			terms.notional_currency === null || terms.notional_currency === base(terms.pair)
				? amount
				: terms.notional_currency === quote(terms.pair)
					? amount / strike
					: null;
		if (units === null) return;
		const gain = (terms.side === 'sell' ? strike - rate : rate - strike) * units;
		usd += toUsd(terms.pair, gain, rate, usdPerQuote) ?? 0;
	});
	return {
		usd,
		settled,
		of: open.length,
		knocked_out: ko,
		target_reached: reached,
		ended_early: ended,
		unknown
	};
}

/** DCI at expiry: interest earned less the cost of conversion, in the deposit currency. */
export function dciResult(terms: FxTerms, rate: number, yieldPct: number, days: number) {
	const deposit = Number(terms.dci_deposit_amount ?? terms.notional ?? 0);
	const strike = Number(terms.strike ?? 0);
	const interest = (deposit * yieldPct * days) / 36500;
	const inBase = terms.dci_deposit_currency === base(terms.pair);
	const converts = inBase ? rate > strike : rate < strike;
	const cost = !converts
		? 0
		: inBase
			? deposit * (1 - strike / rate)
			: deposit * (1 - rate / strike);
	return { converts, result: interest - cost };
}

const roundRate = (rate: number) =>
	rate >= 1000
		? Math.round(rate)
		: rate >= 50
			? Math.round(rate * 100) / 100
			: Math.round(rate * 10000) / 10000;

/** Every open fixing at one rate: today's spot ±2/4/6%, the strike, the knock-out and any rates typed in. */
export function scenarios(
	terms: FxTerms,
	open: readonly FxFixingFacts[],
	spot: number,
	used: string,
	usdPerQuote: number | null,
	extra: readonly number[] = []
) {
	const rates = new Set<number>(
		[-6, -4, -2, 0, 2, 4, 6].map((p) => roundRate(spot * (1 + p / 100)))
	);
	for (const r of [num(terms.strike), num(terms.knock_out), ...extra])
		if (r !== null && r > 0) rates.add(r);
	return [...rates]
		.sort((a, b) => a - b)
		.map((rate) => ({
			rate,
			vs_today_pct: (rate / spot - 1) * 100,
			...play(terms, open, () => rate, used, usdPerQuote)
		}));
}

/** Each open fixing valued at today's rate; only firm fixings count towards the deal's total. */
export function position(
	terms: FxTerms,
	open: readonly FxFixingFacts[],
	spot: number,
	usdPerQuote: number | null
) {
	const fixings = open.map((f) => {
		const strike = num(f.strike ?? terms.strike);
		if (strike === null || terms.side === null || terms.structure === 'dci')
			return { id: f.id, gain: null, usd: null, leveraged: false, firm: f.firm };
		const gain = terms.side === 'sell' ? strike - spot : spot - strike;
		const lev = gain < 0 && (f.leveraged_notional ?? terms.leveraged_notional) !== null;
		const amount = Number(
			(lev ? (f.leveraged_notional ?? terms.leveraged_notional) : (f.notional ?? terms.notional)) ??
				0
		);
		const units =
			terms.notional_currency === null || terms.notional_currency === base(terms.pair)
				? amount
				: amount / strike;
		return {
			id: f.id,
			gain,
			usd: toUsd(terms.pair, gain * units, spot, usdPerQuote),
			leveraged: lev,
			firm: f.firm
		};
	});
	const firm = fixings.filter((f) => f.firm && f.usd !== null);
	const total = firm.length === 0 ? null : firm.reduce((s, f) => s + (f.usd ?? 0), 0);
	const ko = num(terms.knock_out);
	const strike = num(terms.strike);
	const koDistancePct = ko === null ? null : (Math.abs(ko - spot) / spot) * 100;
	const pastKo =
		ko === null ? false : (strike === null ? ko > spot : ko > strike) ? spot >= ko : spot <= ko;
	const known = fixings.filter((f) => f.gain !== null);
	const money =
		known.length === 0
			? null
			: known.every((f) => (f.gain ?? 0) > 0)
				? 'in'
				: known.every((f) => (f.gain ?? 0) <= 0)
					? 'out'
					: 'mixed';
	return { fixings, total_usd: total, ko_distance_pct: koDistancePct, past_ko: pastKo, money };
}

// ── proposal schedules ────────────────────────────────────────────────────────────────────────

export type Frequency = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly';
const at = (date: string) => DateTime.makeUnsafe(`${date}T00:00:00Z`);
const iso = (d: DateTime.DateTime) => DateTime.formatIsoDateUtc(d);
/** Dates from `first` (else one step after today) every step, to `last`, else `count` (12 if none), never past 60. */
export function schedule(
	frequency: Frequency,
	today: string,
	first: string | null,
	last: string | null,
	count: number | null
) {
	const months = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 0;
	const days = frequency === 'weekly' ? 7 : frequency === 'fortnightly' ? 14 : 0;
	const step = (from: string, n: number) =>
		iso(
			months > 0
				? DateTime.add(at(from), { months: months * n })
				: DateTime.add(at(from), { days: days * n })
		);
	const start = first ?? step(today, 1);
	const limit = last === null ? Math.min(count ?? 12, 60) : 60;
	const out: string[] = [];
	for (let n = 0; out.length < limit; n++) {
		const d = step(start, n);
		if (last !== null && d > last) break;
		out.push(d);
	}
	return out;
}

// ── how likely ────────────────────────────────────────────────────────────────────────────────

/** A small seeded generator, so a deal shows the same figures every time it is opened. */
function seeded(seed: string) {
	let h = 1779033703 ^ seed.length;
	for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
	let a = h >>> 0;
	// ponytail: mulberry32, enough for 3,000 bootstrap paths; swap for a vetted PRNG if the method is ever audited
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
/** Weekdays after `today` up to and including `last`. */
export function businessDays(today: string, last: string) {
	const out: string[] = [];
	for (
		let d = DateTime.add(at(today), { days: 1 });
		iso(d) <= last;
		d = DateTime.add(d, { days: 1 })
	) {
		const w = DateTime.toPartsUtc(d).weekDay;
		if (w !== 0 && w !== 6) out.push(iso(d));
	}
	return out;
}
const percentile = (sorted: readonly number[], p: number) =>
	sorted[Math.round(p * (sorted.length - 1))] ?? 0;

export type Odds = {
	readonly window: 'calm' | 'long';
	readonly days: number;
	readonly vol_pct: number;
	readonly p_knock_out: number | null;
	readonly p_target: number | null;
	readonly p_pays: number;
	readonly typical: number;
	readonly bad: number;
	readonly p_convert: number | null;
};

/**
 * Bootstrap paths from the pair's own past daily moves (the last 63 and 252 business days, trend removed, moves of 10%
 * or more dropped as data errors), centred on the bank's quoted forward when there is one, else today's rate. Each
 * path plays the open fixings with the deal's own rules. `towards` tilts the drift to a person's view instead.
 */
export function odds(
	terms: FxTerms & {
		readonly forward_reference: string | null;
		readonly forward_reference_date: string | null;
		readonly spot_reference: string | null;
		readonly dci_yield_pct: string | null;
		readonly trade_date: string | null;
	},
	open: readonly FxFixingFacts[],
	history: readonly [string, number][],
	spot: number,
	today: string,
	used: string,
	usdPerQuote: number | null,
	seed: string,
	options: {
		readonly paths?: number;
		readonly windows?: readonly ('calm' | 'long')[];
		readonly towards?: { readonly rate: number; readonly by: string | null };
	} = {}
): Odds[] | string {
	const last = open.at(-1)?.fixing_date;
	if (last === undefined) return 'No fixings left to simulate.';
	if (terms.structure !== 'dci' && terms.side === null)
		return 'The deal has no side: say whether the company sells or buys.';
	const grid = businessDays(today, last);
	if (grid.length === 0) return 'No business days left before the last fixing.';
	const at_ = open.map((f) =>
		Math.max(
			0,
			grid.findIndex((d) => d >= f.fixing_date)
		)
	);
	const paths = options.paths ?? 3000;
	const out: Odds[] = [];
	for (const window of options.windows ?? (['calm', 'long'] as const)) {
		const size = window === 'calm' ? 63 : 252;
		const recent = history.filter(([d]) => d <= today).slice(-(size + 1));
		const moves: number[] = [];
		let previous: number | undefined;
		for (const [, rate] of recent) {
			const m = previous === undefined ? null : Math.log(rate / previous);
			if (m !== null && Math.abs(m) < 0.1) moves.push(m);
			previous = rate;
		}
		if (moves.length < 40) continue;
		const mean = moves.reduce((s, m) => s + m, 0) / moves.length;
		const centred = moves.map((m) => m - mean);
		const sd = Math.sqrt(centred.reduce((s, m) => s + m * m, 0) / (centred.length - 1));
		const n = grid.length;
		let drift = 0;
		let driftDays = n;
		const towards = options.towards;
		if (towards !== undefined) {
			const by = towards.by;
			driftDays = Math.max(1, by === null ? n : grid.filter((d) => d <= by).length);
			drift = Math.log(towards.rate / spot) / driftDays;
		} else if (terms.forward_reference !== null) {
			const toDate = terms.forward_reference_date ?? last;
			const days = toDate > today ? businessDays(today, toDate).length : n;
			drift =
				Math.log(Number(terms.forward_reference) / Number(terms.spot_reference ?? spot)) /
				Math.max(1, days);
		}
		const random = seeded(`${seed}-${window}-${options.towards === undefined ? 'plain' : 'view'}`);
		const results: number[] = [];
		let ko = 0;
		let target = 0;
		let converted = 0;
		const koLevel = num(terms.knock_out);
		const koAbove = koLevel !== null && koLevel > Number(terms.strike ?? spot);
		for (let p = 0; p < paths; p++) {
			const level: number[] = [];
			let log = Math.log(spot);
			for (let d = 0; d < n; d++) {
				log += (centred[Math.floor(random() * centred.length)] ?? 0) + (d < driftDays ? drift : 0);
				level.push(Math.exp(log));
			}
			if (terms.structure === 'dci') {
				const rate = level.at(-1) ?? spot;
				const days = Math.max(1, daysBetween(terms.trade_date ?? today, last));
				const r = dciResult(terms, rate, Number(terms.dci_yield_pct ?? 0), days);
				if (r.converts) converted += 1;
				const deposit = terms.dci_deposit_currency ?? base(terms.pair);
				results.push(
					deposit === 'USD'
						? r.result
						: base(terms.pair) === 'USD'
							? r.result / rate
							: r.result * (quote(terms.pair) === 'USD' ? rate : (usdPerQuote ?? 0))
				);
				continue;
			}
			const knocked = new Set<number>();
			if (koLevel !== null && terms.knock_out_type === 'continuous') {
				let from = 0;
				let hit = -1;
				at_.forEach((to, i) => {
					if (hit >= 0) return;
					const seg = level.slice(from, to + 1);
					if (seg.some((v) => (koAbove ? v >= koLevel : v <= koLevel))) hit = i;
					from = to + 1;
				});
				if (hit >= 0) for (let i = hit; i < open.length; i++) knocked.add(i);
			}
			const r = play(terms, open, (i) => level[at_[i] ?? 0] ?? spot, used, usdPerQuote, knocked);
			if (r.knocked_out) ko += 1;
			if (r.target_reached) target += 1;
			results.push(r.usd);
		}
		const sorted = [...results].sort((a, b) => a - b);
		out.push({
			window,
			days: moves.length,
			vol_pct: sd * Math.sqrt(252) * 100,
			p_knock_out: koLevel === null || terms.structure === 'dci' ? null : ko / paths,
			p_target: terms.target === null ? null : target / paths,
			p_pays: sorted.filter((v) => v < 0).length / paths,
			typical: percentile(sorted, 0.5),
			bad: percentile(sorted, 0.05),
			p_convert: terms.structure === 'dci' ? converted / paths : null
		});
	}
	return out.length === 0
		? 'Not enough rate history for this pair yet: at least 40 business days.'
		: out;
}

/** The ▲ points a treasurer weighs before trading, from the odds (high ends) and today's rate. */
export function pointsToWeigh(
	terms: FxTerms,
	open: readonly FxFixingFacts[],
	spot: number,
	odds_: readonly Odds[],
	remainingUsd: number | null,
	today: string
) {
	const high = (pick: (o: Odds) => number | null) => Math.max(...odds_.map((o) => pick(o) ?? 0));
	const out: {
		readonly warn: boolean;
		readonly key: MessageKey;
		readonly values: Record<string, string | number>;
	}[] = [];
	if (terms.knock_out !== null && terms.structure !== 'dci')
		out.push({
			warn: high((o) => o.p_knock_out) > 0.3,
			key: 'fx.point.knock_out',
			values: { pct: Math.round(high((o) => o.p_knock_out) * 100) }
		});
	if (odds_.length > 0)
		out.push({
			warn: high((o) => o.p_pays) > 0.4,
			key: 'fx.point.pays',
			values: { pct: Math.round(high((o) => o.p_pays) * 100) }
		});
	const bad = Math.min(...odds_.map((o) => o.bad));
	if (odds_.length > 0 && remainingUsd !== null)
		out.push({
			warn: bad < -0.1 * remainingUsd,
			key: 'fx.point.bad',
			values: { usd: Math.round(bad) }
		});
	const ko = num(terms.knock_out);
	if (ko !== null)
		out.push({
			warn: (Math.abs(ko - spot) / spot) * 100 < 3,
			key: 'fx.point.ko_distance',
			values: { pct: ((Math.abs(ko - spot) / spot) * 100).toFixed(1) }
		});
	if (terms.structure === 'dci')
		out.push({
			warn: high((o) => o.p_convert) > 0.4,
			key: 'fx.point.convert',
			values: { pct: Math.round(high((o) => o.p_convert) * 100) }
		});
	const lev = Math.max(
		0,
		...open.map(
			(f) =>
				Number(f.leveraged_notional ?? terms.leveraged_notional ?? 0) /
				Number(f.notional ?? terms.notional ?? 1)
		)
	);
	out.push(
		lev > 1
			? { warn: true, key: 'fx.point.leverage', values: { times: lev.toFixed(1) } }
			: { warn: false, key: 'fx.point.no_leverage', values: {} }
	);
	const strike = num(terms.strike);
	if (strike !== null && terms.side !== null) {
		const better = (strike / spot - 1) * 100 * (terms.side === 'buy' ? -1 : 1);
		out.push({
			warn: better <= 0,
			key: better > 0 ? 'fx.point.strike_better' : 'fx.point.strike_worse',
			values: { pct: Math.abs(better).toFixed(2) }
		});
	}
	const conditional = open.filter((f) => !f.firm).length;
	if (conditional > 0)
		out.push({ warn: true, key: 'fx.point.conditional', values: { n: conditional } });
	if (terms.knock_in !== null) out.push({ warn: true, key: 'fx.point.knock_in', values: {} });
	const last = open.at(-1)?.fixing_date;
	if (last !== undefined && daysBetween(today, last) > 12 * 30.5)
		out.push({
			warn: true,
			key: 'fx.point.term',
			values: { months: Math.round(daysBetween(today, last) / 30.5) }
		});
	return out;
}

// ── from a reading to a deal ──────────────────────────────────────────────────────────────────

type TermsRead = ValueOf<{ readonly kind: 'object'; readonly fields: typeof FX_TERMS_READ }>;
/** A deal's terms and fixings as a reading gives them: pair as six capitals, firm unless printed otherwise. */
export function dealFrom(read: TermsRead) {
	const pair = (read.pair ?? '').toUpperCase().replace(/[^A-Z]/g, '');
	return {
		pair: pair.length === 6 ? pair : null,
		terms: {
			bank_reference: read.bank_reference ?? null,
			trade_date: read.trade_date ?? null,
			structure: read.structure ?? ('other' as const),
			structure_as_written: read.structure_as_written ?? null,
			side: read.side ?? null,
			notional_currency: read.notional_currency ?? null,
			notional: read.notional ?? null,
			leveraged_notional: read.leveraged_notional ?? null,
			strike: read.strike ?? null,
			knock_out: read.knock_out ?? null,
			knock_out_type: read.knock_out_type ?? null,
			knock_in: read.knock_in ?? null,
			spot_reference: read.spot_reference ?? null,
			forward_reference: read.forward_reference ?? null,
			forward_reference_date: read.forward_reference_date ?? null,
			target: read.target ?? null,
			target_rule: read.target_rule ?? ('prorata' as const),
			dci_deposit_currency: read.dci_deposit_currency ?? null,
			dci_deposit_amount: read.dci_deposit_amount ?? null,
			dci_yield_pct: read.dci_yield_pct ?? null,
			terms: read.terms ?? null
		},
		fixings: [...(read.fixings ?? [])]
			.sort((a, b) => a.fixing_date.localeCompare(b.fixing_date))
			.map((f) => ({
				fixing_date: f.fixing_date,
				settlement_date: f.settlement_date ?? null,
				notional: f.notional ?? null,
				leveraged_notional: f.leveraged_notional ?? null,
				strike: f.strike ?? null,
				firm: f.firm ?? true,
				condition: f.condition ?? null,
				condition_side: f.condition_side ?? null,
				condition_level: f.condition_level ?? null
			}))
	};
}
/** Letters and digits only, for matching references however a bank punctuates them. */
export const refKey = (value: string | null | undefined) =>
	(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ── one deal as a page shows it ───────────────────────────────────────────────────────────────

export type FxDealRow = FxTerms & {
	readonly id: string;
	readonly status: 'proposal' | 'draft' | 'live';
	readonly trade_date: string | null;
	readonly spot_reference: string | null;
	readonly forward_reference: string | null;
	readonly forward_reference_date: string | null;
	readonly dci_yield_pct: string | null;
	readonly fixings: readonly FxFixingFacts[];
};
/** A deal worked out, its state, the fixings still open and where it stands at today's official rate. */
export function dealView(deal: FxDealRow, rates: readonly FxRateRow[], today: string) {
	const worked = workOut(deal, deal.fixings);
	const result = new Map(worked.results.map((r) => [r.id, r]));
	const sorted = [...deal.fixings].sort((a, b) => a.fixing_date.localeCompare(b.fixing_date));
	const open = sorted.filter(
		(f) => f.fixing_date >= today && (result.get(f.id)?.outcome ?? null) === null
	);
	const needsRate = sorted.filter(
		(f) => f.fixing_date < today && (result.get(f.id)?.outcome ?? null) === null
	);
	const spot = pairRate(deal.pair, today, rates);
	const q = usdOn(quote(deal.pair), today, rates);
	const usdPerQuote = q === null ? null : Number(q);
	const target = num(deal.target);
	return {
		worked,
		result,
		open,
		needsRate,
		spot,
		usdPerQuote,
		state: fxState(deal.status, worked, deal, deal.fixings, today),
		position: spot === null ? null : position(deal, open, spot, usdPerQuote),
		target_used_pct:
			target === null || target === 0 ? null : (Number(worked.target_used) / target) * 100,
		last: sorted.at(-1)?.fixing_date ?? null
	};
}
/** The watch-list lines for a live deal: barriers close or crossed, target nearly used, out of the money, ending soon. */
export function watch(deal: FxDealRow, view: ReturnType<typeof dealView>, today: string) {
	const out: {
		readonly warn: boolean;
		readonly key: MessageKey;
		readonly values: Record<string, string | number>;
	}[] = [];
	const p = view.position;
	if (p !== null && p.ko_distance_pct !== null && (p.past_ko || p.ko_distance_pct < 3))
		out.push({
			warn: true,
			key: p.past_ko ? 'fx.watch.past_ko' : 'fx.watch.ko',
			values: { pct: p.ko_distance_pct.toFixed(1) }
		});
	if (view.target_used_pct !== null && view.target_used_pct >= 75)
		out.push({
			warn: true,
			key: 'fx.watch.target',
			values: { pct: view.target_used_pct.toFixed(0) }
		});
	if (p?.money === 'out') out.push({ warn: true, key: 'fx.watch.out', values: {} });
	const strike = num(deal.strike);
	if (
		deal.structure === 'dci' &&
		view.spot !== null &&
		strike !== null &&
		Math.abs(view.spot - strike) / view.spot < 0.01
	)
		out.push({ warn: true, key: 'fx.watch.dci', values: {} });
	if (view.last !== null && view.last >= today && daysBetween(today, view.last) <= 30)
		out.push({
			warn: false,
			key: 'fx.watch.last',
			values: { days: daysBetween(today, view.last) }
		});
	return out;
}

/** The read every hedging page shares: each deal with its fixings and bank, and the official rates. */
export const FX_DEAL_READ = {
	fx_deal: {
		fields: [
			'status',
			'bank_reference',
			'structure',
			'pair',
			'side',
			'trade_date',
			'notional_currency',
			'notional',
			'leveraged_notional',
			'strike',
			'knock_out',
			'knock_out_type',
			'knock_in',
			'spot_reference',
			'forward_reference',
			'forward_reference_date',
			'target',
			'target_rule',
			'dci_deposit_currency',
			'dci_deposit_amount',
			'dci_yield_pct',
			'ended_on'
		],
		bank: { fields: ['code'] },
		fixings: {
			fields: [
				'fixing_date',
				'settlement_date',
				'notional',
				'leveraged_notional',
				'strike',
				'firm',
				'condition',
				'condition_side',
				'condition_level',
				'fixing_rate',
				'outcome',
				'settled_amount'
			]
		},
		limit: 1000
	},
	fx_rate: {
		fields: ['currency', 'rate_date', 'usd_per_unit'],
		order_by: { rate_date: 'asc' },
		limit: 10000
	}
} as const;
