/**
 * The treasury figures, as pure functions over rows a page or automation has read: usage and headroom per bank,
 * maturities, the cost of funds, charge estimates from fee rules, the month-end report, bank cost comparison and
 * a line's warnings. All amounts are USD (the reporting currency); every function takes the day it reports on.
 */
import type { MessageKey } from '@norbital-ai/bolt';
import { BigDecimal } from 'effect';
import {
	ZERO,
	accruedDays,
	addDays,
	addMonths,
	daysBetween,
	decimal,
	interest,
	money,
	monthEnd,
	ratio,
	sum,
	tenorDays,
	text,
	type DayBasis,
	type Rounding
} from './calculations.js';
import { PRODUCTS, family, type Bucket, type Product } from './products.js';

export type Status = 'earmarked' | 'applied' | 'active' | 'settled' | 'cancelled' | 'unclear';
export type Stage = 'drawdown' | 'settlement';

export type FacilityRow = {
	readonly id: string;
	readonly name: string;
	readonly status: 'active' | 'expired';
	readonly limit: string;
	readonly max_tenor_days: number | null;
	readonly day_count_basis: DayBasis;
	readonly interest_rounding: Rounding;
	readonly margin_pct: string | null;
	readonly bank: { readonly code: string } | null;
};
export type LineRow = {
	readonly id: string;
	readonly status: Status;
	readonly product: Product;
	readonly currency: Uppercase<string>;
	readonly amount: string;
	readonly amount_usd: string;
	readonly interest_rate_pct: string | null;
	readonly day_count_basis: DayBasis;
	readonly start_date: string | null;
	readonly due_date: string | null;
	readonly application_date: string | null;
	readonly settlement_date: string | null;
	readonly facility: string | null;
};
export type FeeRow = {
	readonly facility: string;
	readonly fee_type: string;
	readonly product: Product | null;
	readonly stage: Stage;
	readonly method: 'percent' | 'flat';
	readonly currency: string;
	readonly rate_pct: string | null;
	readonly amount: string | null;
	readonly minimum_amount: string | null;
	readonly minimum_currency: string;
	readonly include_in_estimates: boolean;
};
export type FxRow = {
	readonly currency: string;
	readonly rate_date: string;
	readonly usd_per_unit: string;
};

/** The fields a `LineRow` read names; facilities add their bank's code as a layer. */
export const LINE_FIELDS = [
	'status',
	'product',
	'currency',
	'amount',
	'amount_usd',
	'interest_rate_pct',
	'day_count_basis',
	'start_date',
	'due_date',
	'application_date',
	'settlement_date',
	'facility'
] as const;
export const FACILITY_FIELDS = [
	'name',
	'status',
	'limit',
	'max_tenor_days',
	'day_count_basis',
	'interest_rounding',
	'margin_pct'
] as const;

const OPEN: readonly Status[] = ['applied', 'active'];
const usd = (line: LineRow) => decimal(line.amount_usd);
const usesLimit = (line: LineRow) =>
	OPEN.includes(line.status) && PRODUCTS[line.product].uses_limit;
const pct = (part: BigDecimal.BigDecimal, whole: BigDecimal.BigDecimal) => {
	const r = ratio(BigDecimal.multiply(part, decimal(100)), whole);
	return r === null ? null : BigDecimal.toNumberUnsafe(r);
};

/** Amount-weighted average rate (% p.a.) of the lines that carry one. */
export function weightedRate(lines: readonly LineRow[]) {
	const rated = lines.filter((l) => l.interest_rate_pct !== null);
	const weight = sum(rated.map(usd));
	const r = ratio(
		sum(rated.map((l) => BigDecimal.multiply(usd(l), decimal(l.interest_rate_pct ?? 0)))),
		weight
	);
	return r === null ? null : text(r, 4);
}
export function simpleRate(lines: readonly LineRow[]) {
	const rates = lines.flatMap((l) =>
		l.interest_rate_pct === null ? [] : [decimal(l.interest_rate_pct)]
	);
	const r = ratio(sum(rates), decimal(rates.length));
	return r === null ? null : text(r, 4);
}

// ── usage ─────────────────────────────────────────────────────────────────────────────────────

export type Usage = {
	readonly bank: string;
	readonly limit: string;
	readonly used: string;
	readonly earmarked: string;
	readonly available: string;
	readonly free_after_earmarks: string;
	readonly used_pct: number | null;
	readonly high: boolean;
};
/** Used is applied plus active; earmarks show apart and count against a bank only once allocated. */
export function utilisation(facilities: readonly FacilityRow[], lines: readonly LineRow[]) {
	const active = facilities.filter((f) => f.status === 'active');
	const bankOf = new Map(active.map((f) => [f.id, f.bank?.code ?? '—']));
	const rows = new Map<
		string,
		{ limit: BigDecimal.BigDecimal; used: BigDecimal.BigDecimal; earmarked: BigDecimal.BigDecimal }
	>();
	const row = (code: string) => {
		const found = rows.get(code) ?? { limit: ZERO, used: ZERO, earmarked: ZERO };
		rows.set(code, found);
		return found;
	};
	for (const f of active)
		row(f.bank?.code ?? '—').limit = BigDecimal.sum(
			row(f.bank?.code ?? '—').limit,
			decimal(f.limit)
		);
	let unallocated = ZERO;
	for (const l of lines) {
		const code = l.facility === null ? undefined : bankOf.get(l.facility);
		if (l.status === 'earmarked' && l.facility === null)
			unallocated = BigDecimal.sum(unallocated, usd(l));
		if (code === undefined) continue;
		if (usesLimit(l)) row(code).used = BigDecimal.sum(row(code).used, usd(l));
		if (l.status === 'earmarked') row(code).earmarked = BigDecimal.sum(row(code).earmarked, usd(l));
	}
	const shape = (
		bank: string,
		r: {
			limit: BigDecimal.BigDecimal;
			used: BigDecimal.BigDecimal;
			earmarked: BigDecimal.BigDecimal;
		}
	): Usage => {
		const used_pct = pct(r.used, r.limit);
		return {
			bank,
			limit: text(r.limit),
			used: text(r.used),
			earmarked: text(r.earmarked),
			available: text(BigDecimal.subtract(r.limit, r.used)),
			free_after_earmarks: text(
				BigDecimal.subtract(BigDecimal.subtract(r.limit, r.used), r.earmarked)
			),
			used_pct,
			high: used_pct !== null && used_pct >= 80
		};
	};
	const banks = [...rows.entries()]
		.filter(([, r]) => !BigDecimal.isZero(r.limit))
		.map(([code, r]) => shape(code, r))
		.sort((a, b) => (b.used_pct ?? 0) - (a.used_pct ?? 0));
	const all = [...rows.values()];
	const total = shape('all', {
		limit: sum(all.map((r) => r.limit)),
		used: sum(all.map((r) => r.used)),
		earmarked: BigDecimal.sum(sum(all.map((r) => r.earmarked)), unallocated)
	});
	return { banks, total, unallocated: text(unallocated) };
}

/** Room left on each active line: limit − used − earmarks already allocated to it, leaving out `except`. */
export function headroom(
	facilities: readonly FacilityRow[],
	lines: readonly LineRow[],
	except?: string
) {
	return facilities
		.filter((f) => f.status === 'active' && BigDecimal.isPositive(decimal(f.limit)))
		.map((f) => {
			const mine = lines.filter((l) => l.facility === f.id && l.id !== except);
			const used = sum(mine.filter(usesLimit).map(usd));
			const earmarked = sum(mine.filter((l) => l.status === 'earmarked').map(usd));
			return {
				facility: f.id,
				bank: f.bank?.code ?? '—',
				name: f.name,
				limit: f.limit,
				used: text(used),
				earmarked: text(earmarked),
				available: text(BigDecimal.subtract(BigDecimal.subtract(decimal(f.limit), used), earmarked))
			};
		});
}

// ── maturities and the cost of funds ─────────────────────────────────────────────────────────

/** Open lines falling due: past due (no settlement advice yet), then within 30, 60 and 90 days. */
export function maturities(lines: readonly LineRow[], as_of: string) {
	const buckets = {
		past: [] as LineRow[],
		d30: [] as LineRow[],
		d60: [] as LineRow[],
		d90: [] as LineRow[]
	};
	for (const l of lines) {
		if (!OPEN.includes(l.status) || l.due_date === null) continue;
		const days = daysBetween(as_of, l.due_date);
		const key =
			days < 0 ? 'past' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : null;
		if (key !== null) buckets[key].push(l);
	}
	return (['past', 'd30', 'd60', 'd90'] as const).map((key) => ({
		key,
		count: buckets[key].length,
		amount: text(sum(buckets[key].map(usd)))
	}));
}

/** Open amount by due month from the as-of month on; earlier and later dues gathered at the ends. */
export function maturityLadder(lines: readonly LineRow[], as_of: string, months = 12) {
	const keys = Array.from({ length: months }, (_, i) => addMonths(as_of, i).slice(0, 7));
	const totals = new Map<string, BigDecimal.BigDecimal>();
	for (const l of lines) {
		if (!OPEN.includes(l.status) || l.due_date === null) continue;
		const month = l.due_date.slice(0, 7);
		const key = month < keys[0]! ? 'earlier' : month > keys[keys.length - 1]! ? 'later' : month;
		totals.set(key, BigDecimal.sum(totals.get(key) ?? ZERO, usd(l)));
	}
	return ['earlier', ...keys, 'later']
		.filter((k) => (k !== 'earlier' && k !== 'later') || totals.has(k))
		.map((month) => ({ month, amount: BigDecimal.toNumberUnsafe(totals.get(month) ?? ZERO) }));
}

/** When a line was open: from its start (application when unknown) until repaid (due date when not recorded). */
const opened = (l: LineRow) => l.start_date ?? l.application_date ?? l.due_date;
const closed = (l: LineRow) => l.settlement_date ?? l.due_date;
const owed = (l: LineRow) =>
	(OPEN.includes(l.status) || l.status === 'settled') && l.due_date !== null;

/** The weighted and simple rate of everything outstanding at each month-end. */
export function costOfFundsTrend(lines: readonly LineRow[], as_of: string, months = 12) {
	return Array.from({ length: months }, (_, i) => monthEnd(addMonths(as_of, i - months + 1))).map(
		(end) => {
			const live = lines.filter((l) => owed(l) && opened(l)! <= end && end < closed(l)!);
			const w = weightedRate(live);
			const s = simpleRate(live);
			return {
				month: end.slice(0, 7),
				weighted: w === null ? null : Number(w),
				simple: s === null ? null : Number(s),
				lines: live.length
			};
		}
	);
}

/** The cost of funds over a period, each line weighted by its amount × the days it was open in it. */
export function periodCost(
	lines: readonly LineRow[],
	banks: ReadonlyMap<string, string>,
	start: string,
	end: string
) {
	const stop = addDays(end, 1);
	type Acc = {
		weight: BigDecimal.BigDecimal;
		rated: BigDecimal.BigDecimal;
		all: BigDecimal.BigDecimal;
		interest: BigDecimal.BigDecimal;
		lines: number;
	};
	const acc = new Map<string, Acc>();
	const add = (key: string, l: LineRow, days: number) => {
		const a = acc.get(key) ?? { weight: ZERO, rated: ZERO, all: ZERO, interest: ZERO, lines: 0 };
		const amountDays = BigDecimal.multiply(usd(l), decimal(days));
		a.lines += 1;
		a.all = BigDecimal.sum(a.all, amountDays);
		if (l.interest_rate_pct !== null) {
			a.weight = BigDecimal.sum(a.weight, amountDays);
			a.rated = BigDecimal.sum(
				a.rated,
				BigDecimal.multiply(amountDays, decimal(l.interest_rate_pct))
			);
			a.interest = BigDecimal.sum(
				a.interest,
				decimal(interest(l.amount_usd, l.interest_rate_pct, days, l.day_count_basis) ?? 0)
			);
		}
		acc.set(key, a);
	};
	for (const l of lines) {
		if (!owed(l)) continue;
		const from = opened(l)! > start ? opened(l)! : start;
		const to = closed(l)! < stop ? closed(l)! : stop;
		const days = daysBetween(from, to);
		if (days <= 0) continue;
		add('all', l, days);
		add(l.facility === null ? '—' : (banks.get(l.facility) ?? '—'), l, days);
	}
	const periodDays = daysBetween(start, end) + 1;
	return [...acc.entries()].map(([bank, a]) => {
		const rate = ratio(a.rated, a.weight);
		return {
			bank,
			rate: rate === null ? null : text(rate, 4),
			interest: text(a.interest),
			average_balance: text(BigDecimal.divideUnsafe(a.all, decimal(periodDays))),
			lines: a.lines
		};
	});
}

// ── charges ───────────────────────────────────────────────────────────────────────────────────

/** USD for one unit of `currency`: the latest rate on or before `on`, else the latest known; null when none. */
export function usdPerUnit(currency: string, on: string, rates: readonly FxRow[]) {
	if (currency === 'USD') return '1';
	const mine = rates
		.filter((r) => r.currency === currency)
		.sort((a, b) => b.rate_date.localeCompare(a.rate_date));
	return (mine.find((r) => r.rate_date <= on) ?? mine[0])?.usd_per_unit ?? null;
}

/** Actual charges retain the conversion agreed when they were recorded. */
export const chargesUsd = (
	charges: readonly { readonly amount: string; readonly fx_rate_to_usd: string }[]
) =>
	text(
		sum(
			charges.map((c) => money(BigDecimal.multiply(decimal(c.amount), decimal(c.fx_rate_to_usd))))
		)
	);

/** One fee rule applied to a USD amount; null when its currency has no rate. */
export function feeAmount(fee: FeeRow, amount_usd: string, on: string, rates: readonly FxRow[]) {
	if (fee.method === 'flat') {
		const fx = usdPerUnit(fee.currency, on, rates);
		if (fx === null) return null;
		return text(money(BigDecimal.multiply(decimal(fee.amount ?? 0), decimal(fx))));
	}
	const value = BigDecimal.divideUnsafe(
		BigDecimal.multiply(decimal(amount_usd), decimal(fee.rate_pct ?? 0)),
		decimal(100)
	);
	const minimumFx = fee.minimum_amount === null ? '1' : usdPerUnit(fee.minimum_currency, on, rates);
	if (minimumFx === null) return null;
	const minimum = BigDecimal.multiply(decimal(fee.minimum_amount ?? 0), decimal(minimumFx));
	return text(money(BigDecimal.max(value, minimum)));
}

/** The rules that apply to a product on a facility: its own, and those for every product. */
export const feesFor = (fees: readonly FeeRow[], facility: string, product: Product) =>
	fees.filter(
		(f) =>
			f.facility === facility &&
			f.include_in_estimates &&
			(f.product === null || f.product === product)
	);

/**
 * A line's estimated charges for each stage that has no actual (advice or typed-in) charge yet. An agreed charge rate
 * replaces the bank's commission rule at the stage that rule is taken.
 */
export function estimateCharges(
	line: LineRow & { readonly charge_rate_pct: string | null },
	fees: readonly FeeRow[],
	actualStages: readonly Stage[],
	rates: readonly FxRow[],
	on: string
) {
	if (line.facility === null || line.status === 'cancelled') return [];
	const rules = feesFor(fees, line.facility, line.product);
	const commissionStage = rules.find((f) => f.fee_type === 'commission')?.stage ?? 'drawdown';
	return (['drawdown', 'settlement'] as const)
		.filter((stage) => !actualStages.includes(stage))
		.flatMap((stage) => [
			...rules
				.filter(
					(f) =>
						f.stage === stage && !(line.charge_rate_pct !== null && f.fee_type === 'commission')
				)
				.map((f) => ({
					stage,
					charge_type: f.fee_type,
					amount: feeAmount(f, line.amount_usd, on, rates)
				})),
			...(line.charge_rate_pct !== null && stage === commissionStage
				? [
						{
							stage,
							charge_type: 'commission',
							amount: text(
								money(
									BigDecimal.divideUnsafe(
										BigDecimal.multiply(usd(line), decimal(line.charge_rate_pct)),
										decimal(100)
									)
								)
							)
						}
					]
				: [])
		]);
}

// ── month-end ─────────────────────────────────────────────────────────────────────────────────

export type MonthEndLine<Line extends string = string> = {
	readonly drawdown: Line;
	readonly bank_code: string;
	readonly product: Product;
	readonly reference: string | null;
	readonly supplier: string | null;
	readonly currency: Uppercase<string>;
	readonly amount: string;
	readonly fx_rate_to_usd: string;
	readonly amount_usd: string;
	readonly interest_rate_pct: string | null;
	readonly day_count_basis: DayBasis;
	readonly start_date: string | null;
	readonly due_date: string | null;
	readonly tenor_days: number | null;
	readonly accrued_days: number | null;
	readonly accrued_interest: string | null;
	readonly interest_to_maturity: string | null;
	readonly charges: string;
};

/**
 * The month-end report: every line owed at the close of the month (started by then, not yet repaid), revalued at the
 * month-end rate, with its accrued interest, interest to maturity and charges; and the headline figures by product line.
 */
export function monthEndReport<
	L extends LineRow & {
		readonly bank_reference: string | null;
		readonly fx_rate_to_usd: string;
		readonly supplier_name: string | null;
		readonly rounding: Rounding;
		readonly charges_usd: string;
	}
>(month: string, lines: readonly L[], facilities: readonly FacilityRow[], rates: readonly FxRow[]) {
	const end = monthEnd(month);
	const banks = new Map(facilities.map((f) => [f.id, f.bank?.code ?? '—']));
	const rows: MonthEndLine<L['id']>[] = lines
		.filter((l) => {
			const start = l.start_date ?? l.application_date;
			if (!['applied', 'active', 'settled'].includes(l.status) || start === null || start > end)
				return false;
			const repaid = l.settlement_date ?? l.due_date;
			return l.status !== 'settled' || (repaid !== null && repaid > end);
		})
		.map((l) => {
			const fx = usdPerUnit(l.currency, end, rates) ?? l.fx_rate_to_usd;
			const days =
				l.start_date !== null && l.due_date !== null
					? accruedDays(l.start_date, l.due_date, end)
					: null;
			return {
				drawdown: l.id,
				bank_code: l.facility === null ? '—' : (banks.get(l.facility) ?? '—'),
				product: l.product,
				reference: l.bank_reference,
				supplier: l.supplier_name,
				currency: l.currency,
				amount: l.amount,
				fx_rate_to_usd: fx,
				amount_usd: text(money(BigDecimal.multiply(decimal(l.amount), decimal(fx)))),
				interest_rate_pct: l.interest_rate_pct,
				day_count_basis: l.day_count_basis,
				start_date: l.start_date ?? l.application_date,
				due_date: l.due_date,
				tenor_days: tenorDays(l.start_date, l.due_date),
				accrued_days: days,
				accrued_interest: interest(
					l.amount,
					l.interest_rate_pct,
					days,
					l.day_count_basis,
					l.rounding
				),
				interest_to_maturity: interest(
					l.amount,
					l.interest_rate_pct,
					tenorDays(l.start_date, l.due_date),
					l.day_count_basis,
					l.rounding
				),
				charges: l.charges_usd
			};
		})
		.sort(
			(a, b) =>
				a.bank_code.localeCompare(b.bank_code) || (a.due_date ?? '').localeCompare(b.due_date ?? '')
		);
	const by = (bucket: Bucket) =>
		sum(
			rows.filter((r) => PRODUCTS[r.product].bucket === bucket).map((r) => decimal(r.amount_usd))
		);
	const credit_line = sum(
		facilities.filter((f) => f.status === 'active').map((f) => decimal(f.limit))
	);
	const rated = rows.filter((r) => r.interest_rate_pct !== null);
	const rates_ = rated.map((r) => decimal(r.interest_rate_pct ?? 0));
	const weight = sum(rated.map((r) => decimal(r.amount_usd)));
	const tenors = rows.flatMap((r) => (r.tenor_days ? [r.tenor_days] : []));
	const opt = (v: BigDecimal.BigDecimal | null, scale = 2) => (v === null ? null : text(v, scale));
	const utilised = sum([by('borrowings'), by('lc'), by('tb'), by('guarantee')]);
	const accrued = rows.map((r) =>
		r.accrued_interest === null
			? ZERO
			: money(BigDecimal.multiply(decimal(r.accrued_interest), decimal(r.fx_rate_to_usd)))
	);
	return {
		lines: rows,
		figures: {
			credit_line: text(credit_line),
			bank_borrowings: text(by('borrowings')),
			letters_of_credit: text(by('lc')),
			term_bills: text(by('tb')),
			banker_guarantee: text(by('guarantee')),
			total_utilised: text(utilised),
			available: text(BigDecimal.subtract(credit_line, utilised)),
			accrued_interest: text(money(sum(accrued))),
			highest_rate_pct: rates_.length
				? text(
						rates_.reduce((a, b) => BigDecimal.max(a, b)),
						6
					)
				: null,
			lowest_rate_pct: rates_.length
				? text(
						rates_.reduce((a, b) => BigDecimal.min(a, b)),
						6
					)
				: null,
			simple_average_rate_pct: opt(ratio(sum(rates_), decimal(rates_.length)), 6),
			weighted_average_rate_pct: opt(
				ratio(
					sum(
						rated.map((r) =>
							BigDecimal.multiply(decimal(r.amount_usd), decimal(r.interest_rate_pct ?? 0))
						)
					),
					weight
				),
				6
			),
			average_tenor_days: opt(
				ratio(decimal(tenors.reduce((a, b) => a + b, 0)), decimal(tenors.length))
			)
		}
	};
}

/** The month-end report from a read of the lines (with supplier and charges layers), facilities and FX rates. */
export function monthEndFrom<
	L extends LineRow & {
		readonly bank_reference: string | null;
		readonly fx_rate_to_usd: string;
		readonly supplier: { readonly name: string } | null;
		readonly charges: readonly { readonly amount: string; readonly fx_rate_to_usd: string }[];
	}
>(month: string, lines: readonly L[], facilities: readonly FacilityRow[], rates: readonly FxRow[]) {
	const rounding = new Map(facilities.map((f) => [f.id, f.interest_rounding]));
	return monthEndReport(
		month,
		lines.map((l) => ({
			...l,
			supplier_name: l.supplier?.name ?? null,
			rounding:
				(l.facility === null ? undefined : rounding.get(l.facility)) ?? ('nearest_cent' as const),
			charges_usd: chargesUsd(l.charges)
		})),
		facilities,
		rates
	);
}

/** What a month-end read names for its lines. */
export const MONTH_END_LINE_FIELDS = [...LINE_FIELDS, 'bank_reference', 'fx_rate_to_usd'] as const;

// ── bank costs ────────────────────────────────────────────────────────────────────────────────

const RECENT_DAYS = 90;
const compared = (l: LineRow) =>
	l.currency === 'USD' &&
	PRODUCTS[l.product].trade &&
	l.interest_rate_pct !== null &&
	['applied', 'active', 'settled', 'unclear'].includes(l.status);
const startOf = (l: LineRow) => l.start_date ?? l.application_date;

/** The weighted rate on lines started each month, per bank and for all banks: the negotiation heat-map. */
export function rateByMonth(
	lines: readonly LineRow[],
	banks: ReadonlyMap<string, string>,
	as_of: string,
	months = 12
) {
	const keys = Array.from({ length: months }, (_, i) =>
		addMonths(as_of, i - months + 1).slice(0, 7)
	);
	const rated = lines.filter((l) => compared(l) && startOf(l) !== null && startOf(l)! <= as_of);
	const codes = [
		...new Set(rated.flatMap((l) => (l.facility === null ? [] : [banks.get(l.facility) ?? '—'])))
	].sort();
	return [...codes, 'all'].map((bank) => ({
		bank,
		...Object.fromEntries(
			keys.map((month) => {
				const cell = rated.filter(
					(l) =>
						startOf(l)!.slice(0, 7) === month &&
						(bank === 'all' || banks.get(l.facility ?? '') === bank)
				);
				return [month, weightedRate(cell)];
			})
		)
	}));
}

/**
 * For one invoice (amount, tenor, product, supplier), each bank's estimated interest and charges, cheapest eligible
 * first. The rate is the bank's 90-day product rate, last product rate, 90-day trade rate, then last trade rate.
 */
export function compareInvoice(
	input: {
		amount: string;
		tenor: number;
		product: Product;
		eligible: ReadonlySet<string> | null;
		as_of: string;
	},
	facilities: readonly FacilityRow[],
	lines: readonly LineRow[],
	fees: readonly FeeRow[],
	rates: readonly FxRow[]
) {
	const recentFrom = addDays(input.as_of, -RECENT_DAYS);
	const room = new Map(headroom(facilities, lines).map((h) => [h.facility, h.available]));
	const rows = facilities
		.filter((f) => f.status === 'active' && BigDecimal.isPositive(decimal(f.limit)))
		.map((f) => {
			const mine = lines.filter(
				(l) => l.facility === f.id && compared(l) && startOf(l)! <= input.as_of
			);
			const product = mine.filter((l) => family(input.product).includes(l.product));
			const recent = product.filter((l) => startOf(l)! > recentFrom);
			const last = [...product].sort((a, b) => startOf(b)!.localeCompare(startOf(a)!))[0];
			const lastTrade = [...mine].sort((a, b) => startOf(b)!.localeCompare(startOf(a)!))[0];
			const rate =
				weightedRate(recent) ??
				last?.interest_rate_pct ??
				weightedRate(mine.filter((l) => startOf(l)! > recentFrom)) ??
				lastTrade?.interest_rate_pct ??
				null;
			const notes: string[] = [];
			if (input.eligible !== null && !input.eligible.has(f.bank?.code ?? '—'))
				notes.push('supplier');
			if (BigDecimal.isGreaterThan(decimal(input.amount), decimal(room.get(f.id) ?? f.limit)))
				notes.push('room');
			if (f.max_tenor_days !== null && input.tenor > f.max_tenor_days) notes.push('tenor');
			if (rate === null) notes.push('rate');
			const cost = interest(
				input.amount,
				rate,
				input.tenor,
				f.day_count_basis,
				f.interest_rounding
			);
			const priced = feesFor(fees, f.id, input.product).map((fee) =>
				feeAmount(fee, input.amount, input.as_of, rates)
			);
			if (priced.includes(null)) notes.push('fx');
			const charges = priced.includes(null)
				? null
				: sum(priced.flatMap((a) => (a === null ? [] : [decimal(a)])));
			const total =
				cost === null || charges === null ? null : BigDecimal.sum(decimal(cost), charges);
			const allIn =
				total === null || input.tenor <= 0
					? null
					: ratio(
							BigDecimal.multiply(
								total,
								decimal(100 * (f.day_count_basis === 'actual_365' ? 365 : 360))
							),
							BigDecimal.multiply(decimal(input.amount), decimal(input.tenor))
						);
			return {
				facility: f.id,
				bank: f.bank?.code ?? '—',
				rate,
				interest: cost,
				charges: charges === null ? null : text(charges),
				total: total === null ? null : text(total),
				all_in_pct: allIn === null ? null : text(allIn, 4),
				notes,
				ok: notes.length === 0
			};
		});
	return rows.sort(
		(a, b) =>
			Number(!a.ok) - Number(!b.ok) || Number(a.all_in_pct ?? 999) - Number(b.all_in_pct ?? 999)
	);
}

/** Per bank: last rate, 90-day rate and its spread to the group, the rate on open lines, margin and headroom. */
export function bankSummary(
	facilities: readonly FacilityRow[],
	lines: readonly LineRow[],
	as_of: string,
	charges: ReturnType<typeof chargesSummary>
) {
	const recentFrom = addDays(as_of, -RECENT_DAYS);
	const rated = lines.filter((l) => compared(l) && startOf(l)! <= as_of);
	const group = weightedRate(rated.filter((l) => startOf(l)! > recentFrom));
	const room = new Map(headroom(facilities, lines).map((h) => [h.facility, h.available]));
	const rows = facilities
		.filter((f) => f.status === 'active')
		.map((f) => {
			const mine = rated.filter((l) => l.facility === f.id);
			const latest = [...mine].sort((a, b) => startOf(b)!.localeCompare(startOf(a)!))[0];
			const recent = weightedRate(mine.filter((l) => startOf(l)! > recentFrom));
			const charge = charges.find((c) => c.bank === f.bank?.code);
			const reference = recent ?? latest?.interest_rate_pct ?? null;
			return {
				facility: f.id,
				bank: f.bank?.code ?? '—',
				latest_rate: latest?.interest_rate_pct ?? null,
				recent_rate: recent,
				spread_bps:
					recent === null || group === null
						? null
						: Math.round((Number(recent) - Number(group)) * 100),
				book_rate: weightedRate(
					lines.filter((l) => l.facility === f.id && OPEN.includes(l.status) && compared(l))
				),
				margin_pct: f.margin_pct,
				available: room.get(f.id) ?? f.limit,
				charges_pct: charge?.pct_of_amount ?? null,
				charges_pa: charge?.pct_per_annum ?? null,
				all_in_pct:
					reference === null || charge?.pct_per_annum == null
						? null
						: text(BigDecimal.sum(decimal(reference), decimal(charge.pct_per_annum)), 4)
			};
		});
	const ranked = [...rows]
		.filter((r) => r.all_in_pct !== null)
		.sort((a, b) => Number(a.all_in_pct) - Number(b.all_in_pct));
	return rows.map((row) => ({
		...row,
		rank: row.all_in_pct === null ? null : ranked.indexOf(row) + 1
	}));
}

/** Recorded charges plus missing-stage estimates on USD trade lines, over twelve complete calendar months to date. */
export function chargesSummary(
	lines: readonly (LineRow & {
		readonly charge_rate_pct: string | null;
		readonly charges: readonly {
			readonly amount: string;
			readonly fx_rate_to_usd: string;
			readonly charge_type: string;
			readonly stage: Stage;
		}[];
	})[],
	banks: ReadonlyMap<string, string>,
	fees: readonly FeeRow[],
	rates: readonly FxRow[],
	as_of: string
) {
	const since = addMonths(as_of, -11);
	const acc = new Map<
		string,
		{
			lines: number;
			financed: BigDecimal.BigDecimal;
			recorded: BigDecimal.BigDecimal;
			estimated: BigDecimal.BigDecimal;
			complete: boolean;
			byType: Map<string, BigDecimal.BigDecimal>;
			tenorWeighted: BigDecimal.BigDecimal;
		}
	>();
	for (const l of lines) {
		const start = startOf(l);
		if (
			l.currency !== 'USD' ||
			!PRODUCTS[l.product].trade ||
			l.charges.length === 0 ||
			start === null ||
			start < since ||
			start > as_of ||
			l.facility === null
		)
			continue;
		const estimates = estimateCharges(
			l,
			fees,
			l.charges.map((c) => c.stage),
			rates,
			start
		);
		for (const bank of [banks.get(l.facility) ?? '—', 'all']) {
			const a = acc.get(bank) ?? {
				lines: 0,
				financed: ZERO,
				recorded: ZERO,
				estimated: ZERO,
				complete: true,
				byType: new Map<string, BigDecimal.BigDecimal>(),
				tenorWeighted: ZERO
			};
			a.lines += 1;
			a.financed = BigDecimal.sum(a.financed, usd(l));
			a.recorded = BigDecimal.sum(a.recorded, decimal(chargesUsd(l.charges)));
			a.complete &&= !estimates.some((e) => e.amount === null);
			a.estimated = BigDecimal.sum(
				a.estimated,
				sum(estimates.flatMap((e) => (e.amount === null ? [] : [decimal(e.amount)])))
			);
			for (const c of l.charges)
				a.byType.set(
					c.charge_type,
					BigDecimal.sum(a.byType.get(c.charge_type) ?? ZERO, decimal(chargesUsd([c])))
				);
			const tenor = tenorDays(l.start_date, l.due_date);
			if (tenor)
				a.tenorWeighted = BigDecimal.sum(
					a.tenorWeighted,
					BigDecimal.multiply(usd(l), decimal(tenor))
				);
			acc.set(bank, a);
		}
	}
	return [...acc.entries()]
		.map(([bank, a]) => {
			const charges = BigDecimal.sum(a.recorded, a.estimated);
			const ofAmount = a.complete
				? ratio(BigDecimal.multiply(charges, decimal(100)), a.financed)
				: null;
			const tenor = ratio(a.tenorWeighted, a.financed);
			const perAnnum =
				ofAmount === null || tenor === null || BigDecimal.isZero(tenor)
					? null
					: ratio(BigDecimal.multiply(ofAmount, decimal(360)), tenor);
			return {
				bank,
				lines: a.lines,
				financed: text(a.financed),
				recorded: text(a.recorded),
				estimated: a.complete ? text(a.estimated) : null,
				charges: a.complete ? text(charges) : null,
				per_line: a.complete ? text(BigDecimal.divideUnsafe(charges, decimal(a.lines))) : null,
				by_type: Object.fromEntries([...a.byType].map(([type, amount]) => [type, text(amount)])),
				pct_of_amount: ofAmount === null ? null : text(ofAmount, 4),
				pct_per_annum: perAnnum === null ? null : text(perAnnum, 4),
				average_tenor_days: tenor === null ? null : text(tenor, 0)
			};
		})
		.sort(
			(a, b) =>
				Number(a.bank === 'all') - Number(b.bank === 'all') ||
				Number(a.pct_of_amount ?? 999) - Number(b.pct_of_amount ?? 999)
		);
}

/** The same exported columns for live lines and frozen month-end rows. */
export function monthEndExportRow(l: {
	readonly bank_code: string;
	readonly product: string | null;
	readonly reference: string | null;
	readonly supplier: string | null;
	readonly currency: string;
	readonly amount: string;
	readonly fx_rate_to_usd: string;
	readonly amount_usd: string | null;
	readonly interest_rate_pct: string | null;
	readonly day_count_basis: string;
	readonly start_date: string | null;
	readonly due_date: string | null;
	readonly tenor_days: number | null;
	readonly accrued_days: number | null;
	readonly accrued_interest: string | null;
	readonly interest_to_maturity: string | null;
	readonly charges: string | null;
}) {
	const fx = decimal(l.fx_rate_to_usd);
	const convertedCharges = BigDecimal.isPositive(fx) ? ratio(decimal(l.charges ?? 0), fx) : null;
	return {
		bank: l.bank_code,
		product: l.product,
		reference: l.reference,
		supplier: l.supplier,
		currency: l.currency,
		amount: l.amount,
		fx_rate_to_usd: l.fx_rate_to_usd,
		amount_usd: l.amount_usd,
		rate_pct: l.interest_rate_pct,
		day_count_basis: l.day_count_basis,
		start_date: l.start_date,
		due_date: l.due_date,
		tenor_days: l.tenor_days,
		accrued_days: l.accrued_days,
		accrued_interest: l.accrued_interest,
		accrued_interest_usd:
			l.accrued_interest === null || !BigDecimal.isPositive(fx)
				? null
				: text(money(BigDecimal.multiply(decimal(l.accrued_interest), fx))),
		interest_to_maturity: l.interest_to_maturity,
		charges_usd: l.charges,
		// Unknown interest must not become a seemingly complete payable total.
		total_payable:
			l.interest_to_maturity === null || convertedCharges === null
				? null
				: text(money(sum([decimal(l.amount), decimal(l.interest_to_maturity), convertedCharges])))
	};
}

// ── a line's warnings ─────────────────────────────────────────────────────────────────────────

export type Warning = {
	readonly key: MessageKey;
	readonly values: Readonly<Record<string, string | number>>;
};

/**
 * What to look at on an open line; never blocking. The facility limit (with and without earmarks), 80% usage, the
 * bank's supplier list and supplier caps, the tenor against the bank's maximum and the latest date it finances to,
 * a product the bank does not offer, an LC close to expiry, and a foreign currency without a rate.
 */
export function lineWarnings(
	line: LineRow & {
		readonly supplier: string | null;
		readonly fx_rate_to_usd: string;
		readonly lc_expiry_date: string | null;
		readonly latest_due_date: string | null;
	},
	context: {
		readonly facility: FacilityRow | null;
		readonly offered: readonly Product[];
		readonly lines: readonly LineRow[];
		readonly eligible_banks: readonly string[] | null;
		readonly supplier_caps: readonly {
			readonly name: string;
			readonly limit: string;
			readonly used: string;
		}[];
		readonly today: string;
	}
): Warning[] {
	const out: Warning[] = [];
	const f = context.facility;
	if (!['earmarked', 'applied', 'active'].includes(line.status)) return out;
	if (f === null)
		return line.status === 'earmarked' ? [{ key: 'warning.unallocated', values: {} }] : [];
	const others = context.lines.filter((l) => l.facility === f.id && l.id !== line.id);
	const used = BigDecimal.sum(sum(others.filter(usesLimit).map(usd)), usd(line));
	const withEarmarks = BigDecimal.sum(
		used,
		sum(others.filter((l) => l.status === 'earmarked').map(usd))
	);
	const limit = decimal(f.limit);
	if (BigDecimal.isGreaterThan(used, limit))
		out.push({
			key: 'warning.over_limit',
			values: { bank: f.bank?.code ?? '—', used: text(used), limit: f.limit }
		});
	else if (BigDecimal.isGreaterThan(withEarmarks, limit))
		out.push({
			key: 'warning.over_with_earmarks',
			values: { bank: f.bank?.code ?? '—', used: text(withEarmarks) }
		});
	else {
		const p = pct(used, limit);
		if (p !== null && p >= 80)
			out.push({
				key: 'warning.high_usage',
				values: { bank: f.bank?.code ?? '—', pct: Math.round(p) }
			});
	}
	if (line.supplier !== null && PRODUCTS[line.product].trade) {
		if (
			context.eligible_banks !== null &&
			context.eligible_banks.length > 0 &&
			!context.eligible_banks.includes(f.bank?.code ?? '—')
		)
			out.push({ key: 'warning.supplier_not_accepted', values: { bank: f.bank?.code ?? '—' } });
		for (const cap of context.supplier_caps)
			if (
				BigDecimal.isGreaterThan(BigDecimal.sum(decimal(cap.used), usd(line)), decimal(cap.limit))
			)
				out.push({ key: 'warning.over_cap', values: { cap: cap.name, limit: cap.limit } });
	}
	const tenor = tenorDays(line.start_date, line.due_date);
	if (tenor !== null && tenor <= 0) out.push({ key: 'warning.due_before_start', values: {} });
	else if (tenor !== null && f.max_tenor_days !== null && tenor > f.max_tenor_days)
		out.push({
			key: 'warning.tenor_over',
			values: { tenor, bank: f.bank?.code ?? '—', max: f.max_tenor_days }
		});
	if (
		line.latest_due_date !== null &&
		line.due_date !== null &&
		line.due_date > line.latest_due_date
	)
		out.push({ key: 'warning.after_latest_due', values: { latest: line.latest_due_date } });
	if (context.offered.length > 0 && !context.offered.includes(line.product))
		out.push({ key: 'warning.product_not_offered', values: { bank: f.bank?.code ?? '—' } });
	if (
		line.product === 'lc' &&
		line.lc_expiry_date !== null &&
		daysBetween(context.today, line.lc_expiry_date) <= 14
	)
		out.push({ key: 'warning.lc_expiry', values: { date: line.lc_expiry_date } });
	if (line.currency !== 'USD' && BigDecimal.equals(decimal(line.fx_rate_to_usd), decimal(1)))
		out.push({ key: 'warning.no_fx', values: { currency: line.currency } });
	return out;
}

// ── bank advices ──────────────────────────────────────────────────────────────────────────────

export type Advice = {
	readonly principal: string | null;
	readonly interest_rate_pct: string | null;
	readonly interest_amount: string | null;
	readonly interest_days: number | null;
	readonly start_date: string | null;
	readonly due_date: string | null;
	readonly total_debited: string | null;
	readonly charges: readonly { readonly amount_usd: string }[];
};
/**
 * The arithmetic on an advice, checked by the workspace and not by the reader: days = due − start, interest =
 * amount × rate × days ÷ basis with the bank's rounding, and total debited = principal + interest (+ charges).
 * Each answer is ok or not, with the figures to show.
 */
export function adviceChecks(advice: Advice, basis: DayBasis, rounding: Rounding) {
	const out: { ok: boolean; key: MessageKey; values: Record<string, string | number> }[] = [];
	let days = advice.interest_days;
	if (advice.start_date !== null && advice.due_date !== null) {
		const actual = daysBetween(advice.start_date, advice.due_date);
		if (days !== null)
			out.push({ ok: actual === days, key: 'check.days', values: { actual, printed: days } });
		days = days ?? actual;
	}
	const expected = interest(advice.principal, advice.interest_rate_pct, days, basis, rounding);
	if (expected !== null && advice.interest_amount !== null)
		out.push({
			ok: BigDecimal.equals(decimal(expected), decimal(advice.interest_amount)),
			key: 'check.interest',
			values: { expected, printed: advice.interest_amount }
		});
	if (advice.total_debited !== null && advice.principal !== null) {
		const base = BigDecimal.sum(decimal(advice.principal), decimal(advice.interest_amount ?? 0));
		const full = BigDecimal.sum(base, sum(advice.charges.map((c) => decimal(c.amount_usd))));
		const total = decimal(advice.total_debited);
		out.push({
			ok: BigDecimal.equals(total, full) || BigDecimal.equals(total, base),
			key: 'check.total',
			values: { total: advice.total_debited, expected: text(full) }
		});
	}
	return out;
}
