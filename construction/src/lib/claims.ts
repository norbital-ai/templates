/**
 * Pure commercial, BOQ, quotation, variation, valuation, and cashflow calculations shared by
 * models, automations, and the project commercial UI.
 * All money and decimal arithmetic uses Effect `BigDecimal` — zero IEEE-754 float math.
 */
import { BigDecimal, Option } from 'effect';

export type DecimalLike = string | number | null | undefined;

const ZERO = BigDecimal.fromBigInt(0n);
const HUNDRED = BigDecimal.fromBigInt(100n);
const DEFAULT_RETENTION_RATE = BigDecimal.fromBigInt(10n);
const DEFAULT_RETENTION_CAP = BigDecimal.fromBigInt(5n);

export function toDecimal(value: DecimalLike): BigDecimal.BigDecimal {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed === '') return ZERO;
		return Option.getOrElse(BigDecimal.fromString(trimmed), () => ZERO);
	}
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Option.getOrElse(BigDecimal.fromNumber(value), () => ZERO);
	}
	return ZERO;
}

/** Converts a decimal string or number to a finite number for non-monetary UI proportions/charts. */
export const toNumber = (value: DecimalLike): number => BigDecimal.toNumberUnsafe(toDecimal(value));

/** Formats a BigDecimal to an exact fixed-scale string (e.g. '12500.00') with half-from-zero rounding. */
export function formatFixed(value: BigDecimal.BigDecimal, scale: number): string {
	const rounded = BigDecimal.round(value, { scale, mode: 'half-from-zero' });
	const raw = BigDecimal.format(rounded);
	if (scale <= 0) return raw;
	const [whole = '0', frac = ''] = raw.split('.');
	return `${whole}.${frac.padEnd(scale, '0').slice(0, scale)}`;
}

/** Formats a BigDecimal to a trimmed decimal string up to `scale` decimal places. */
export function formatTrimmed(value: BigDecimal.BigDecimal, scale: number): string {
	const rounded = BigDecimal.round(value, { scale, mode: 'half-from-zero' });
	return BigDecimal.format(BigDecimal.normalize(rounded));
}

export const moneyStr = (value: BigDecimal.BigDecimal): string => formatFixed(value, 2);

const clampPctDecimal = (value: BigDecimal.BigDecimal): BigDecimal.BigDecimal =>
	BigDecimal.clamp(value, { minimum: ZERO, maximum: HUNDRED });

const nonNegative = (value: BigDecimal.BigDecimal): BigDecimal.BigDecimal =>
	BigDecimal.max(ZERO, value);

const divSafe = (num: BigDecimal.BigDecimal, den: BigDecimal.BigDecimal): BigDecimal.BigDecimal =>
	BigDecimal.isZero(den) ? ZERO : Option.getOrElse(BigDecimal.divide(num, den), () => ZERO);

const pctOf = (
	base: BigDecimal.BigDecimal,
	ratePct: BigDecimal.BigDecimal
): BigDecimal.BigDecimal =>
	BigDecimal.round(divSafe(BigDecimal.multiply(base, ratePct), HUNDRED), {
		scale: 2,
		mode: 'half-from-zero'
	});

export type CostItemInput = {
	readonly contract_qty: DecimalLike;
	readonly unit_rate: DecimalLike;
	readonly completed_qty: DecimalLike;
	readonly progress_pct: DecimalLike;
	readonly claim_basis: 'percentage' | 'measured_qty' | 'milestone' | null | undefined;
};

export type ComputedCostLine = {
	readonly contract_amount: string;
	readonly progress_pct: string;
	readonly completed_qty: string;
	readonly claimable_amount: string;
};

/** Computes exact decimal strings for contract amount and gross claimable value on a BOQ line. */
export function computeCostLine(input: CostItemInput): ComputedCostLine {
	const contractQty = nonNegative(toDecimal(input.contract_qty));
	const unitRate = toDecimal(input.unit_rate);
	const contractAmount = BigDecimal.round(BigDecimal.multiply(contractQty, unitRate), {
		scale: 2,
		mode: 'half-from-zero'
	});
	const basis = input.claim_basis ?? 'percentage';

	if (basis === 'measured_qty') {
		const completedQty = nonNegative(toDecimal(input.completed_qty));
		const claimableAmount = BigDecimal.round(BigDecimal.multiply(completedQty, unitRate), {
			scale: 2,
			mode: 'half-from-zero'
		});
		const ratio = BigDecimal.isZero(contractQty)
			? ZERO
			: clampPctDecimal(BigDecimal.multiply(divSafe(completedQty, contractQty), HUNDRED));
		return {
			contract_amount: moneyStr(contractAmount),
			progress_pct: formatTrimmed(ratio, 1),
			completed_qty: formatTrimmed(completedQty, 3),
			claimable_amount: moneyStr(claimableAmount)
		};
	}

	if (basis === 'milestone') {
		const rawPct = clampPctDecimal(toDecimal(input.progress_pct));
		const achieved = BigDecimal.isGreaterThanOrEqualTo(rawPct, HUNDRED);
		const pct = achieved ? HUNDRED : ZERO;
		const claimableAmount = achieved ? contractAmount : ZERO;
		const completedQty = achieved ? contractQty : ZERO;
		return {
			contract_amount: moneyStr(contractAmount),
			progress_pct: formatTrimmed(pct, 1),
			completed_qty: formatTrimmed(completedQty, 3),
			claimable_amount: moneyStr(claimableAmount)
		};
	}

	const pct = BigDecimal.round(clampPctDecimal(toDecimal(input.progress_pct)), {
		scale: 1,
		mode: 'half-from-zero'
	});
	const claimableAmount = pctOf(contractAmount, pct);
	const completedQty = BigDecimal.isZero(contractQty)
		? ZERO
		: divSafe(BigDecimal.multiply(contractQty, pct), HUNDRED);
	return {
		contract_amount: moneyStr(contractAmount),
		progress_pct: formatTrimmed(pct, 1),
		completed_qty: formatTrimmed(completedQty, 3),
		claimable_amount: moneyStr(claimableAmount)
	};
}

export type PricedLineInput = {
	readonly code?: string | null;
	readonly description: string;
	readonly unit?: string | null;
	readonly qty: DecimalLike;
	readonly unit_rate: DecimalLike;
	readonly amount?: DecimalLike;
};

export type NormalizedPricedLine = {
	readonly code: string | null;
	readonly description: string;
	readonly unit: string | null;
	readonly qty: string;
	readonly unit_rate: string;
	readonly amount: string;
};

export type ComputedQuoteTotals = {
	readonly lines: readonly NormalizedPricedLine[];
	readonly subtotal: string;
	readonly tax_amount: string;
	readonly total_amount: string;
};

/** Computes exact line amounts, subtotal, tax, and total for a quote or tender revision. */
export function computeQuoteTotals(
	lines: readonly PricedLineInput[] | null | undefined,
	taxRate: DecimalLike
): ComputedQuoteTotals {
	let subtotal = ZERO;
	const normalized: NormalizedPricedLine[] = (lines ?? []).map((line) => {
		const qty = toDecimal(line.qty);
		const rate = toDecimal(line.unit_rate);
		const amount = BigDecimal.round(BigDecimal.multiply(qty, rate), {
			scale: 2,
			mode: 'half-from-zero'
		});
		subtotal = BigDecimal.sum(subtotal, amount);
		return {
			code: line.code ?? null,
			description: line.description,
			unit: line.unit ?? null,
			qty: formatTrimmed(qty, 3),
			unit_rate: moneyStr(rate),
			amount: moneyStr(amount)
		};
	});
	const rate = nonNegative(toDecimal(taxRate));
	const taxAmount = pctOf(subtotal, rate);
	const totalAmount = BigDecimal.sum(subtotal, taxAmount);
	return {
		lines: normalized,
		subtotal: moneyStr(subtotal),
		tax_amount: moneyStr(taxAmount),
		total_amount: moneyStr(totalAmount)
	};
}

/** Sums itemized variation order lines when provided, otherwise preserves explicit cost_impact. */
export function computeChangeOrderImpact(
	lines: readonly PricedLineInput[] | null | undefined,
	fallback: DecimalLike
): {
	readonly lines: readonly NormalizedPricedLine[] | null;
	readonly cost_impact: string;
} {
	if (!lines || lines.length === 0) {
		return { lines: null, cost_impact: moneyStr(toDecimal(fallback)) };
	}
	const computed = computeQuoteTotals(lines, '0');
	return { lines: computed.lines, cost_impact: computed.subtotal };
}

export type ValuationLine = {
	readonly code: string;
	readonly description: string;
	readonly cost_group: string;
	readonly contract_amount: string;
	readonly progress_pct: string;
	readonly gross_value: string;
	readonly retention_exempt: boolean;
};

export type ValuationSummary = {
	readonly original_contract_sum: string;
	readonly approved_variations: string;
	readonly revised_contract_sum: string;
	readonly committed_subcon_cost: string;
	readonly projected_margin: string;
	readonly projected_margin_pct: string;
	readonly gross_work_done: string;
	readonly retention_subject_gross: string;
	readonly retention_held: string;
	readonly retention_cap_amount: string;
	readonly net_cumulative_value: string;
	readonly previous_claimed: string;
	readonly previous_certified: string;
	readonly net_claimable_now: string;
	readonly tax_rate: string;
	readonly estimated_tax: string;
	readonly net_claimable_with_tax: string;
	readonly overall_progress_pct: string;
	readonly lines: readonly ValuationLine[];
};

export function computeProjectValuation(input: {
	readonly contract_value: DecimalLike;
	readonly retention_rate: DecimalLike;
	readonly retention_cap_rate: DecimalLike;
	readonly tax_rate: DecimalLike;
	readonly cost_items: readonly {
		readonly item_code: string | null;
		readonly description: string;
		readonly cost_group: string | null;
		readonly contract_amount: DecimalLike;
		readonly progress_pct: DecimalLike;
		readonly claimable_amount: DecimalLike;
		readonly retention_exempt: boolean | null;
	}[];
	readonly change_orders: readonly {
		readonly status: string;
		readonly cost_impact: DecimalLike;
	}[];
	readonly quotes?: readonly {
		readonly direction: string;
		readonly status: string;
		readonly subtotal: DecimalLike;
		readonly total_amount: DecimalLike;
	}[];
	readonly payment_claims: readonly {
		readonly direction?: string | null;
		readonly status: string;
		readonly claimed_amount: DecimalLike;
		readonly certified_amount: DecimalLike;
	}[];
}): ValuationSummary {
	let boqSum = ZERO;
	let boqWorkDone = ZERO;
	let retentionSubjectBoq = ZERO;

	const lines: ValuationLine[] = input.cost_items.map((item) => {
		const contractAmt = BigDecimal.round(toDecimal(item.contract_amount), {
			scale: 2,
			mode: 'half-from-zero'
		});
		const pct = BigDecimal.round(clampPctDecimal(toDecimal(item.progress_pct)), {
			scale: 1,
			mode: 'half-from-zero'
		});
		const grossVal = BigDecimal.round(toDecimal(item.claimable_amount), {
			scale: 2,
			mode: 'half-from-zero'
		});
		const exempt = item.retention_exempt === true;
		boqSum = BigDecimal.sum(boqSum, contractAmt);
		boqWorkDone = BigDecimal.sum(boqWorkDone, grossVal);
		if (!exempt) retentionSubjectBoq = BigDecimal.sum(retentionSubjectBoq, grossVal);
		return {
			code: item.item_code ?? '—',
			description: item.description,
			cost_group: item.cost_group ?? 'superstructure',
			contract_amount: moneyStr(contractAmt),
			progress_pct: formatTrimmed(pct, 1),
			gross_value: moneyStr(grossVal),
			retention_exempt: exempt
		};
	});

	const originalContractSum = BigDecimal.isPositive(boqSum)
		? boqSum
		: BigDecimal.round(toDecimal(input.contract_value), { scale: 2, mode: 'half-from-zero' });

	let approvedVariations = ZERO;
	for (const vo of input.change_orders) {
		if (vo.status === 'approved') {
			approvedVariations = BigDecimal.sum(approvedVariations, toDecimal(vo.cost_impact));
		}
	}
	const revisedContractSum = BigDecimal.sum(originalContractSum, approvedVariations);

	let committedSubconCost = ZERO;
	for (const q of input.quotes ?? []) {
		if (q.direction === 'subcontractor_quote' && q.status === 'accepted') {
			committedSubconCost = BigDecimal.sum(
				committedSubconCost,
				toDecimal(q.subtotal ?? q.total_amount)
			);
		}
	}
	const projectedMargin = BigDecimal.subtract(revisedContractSum, committedSubconCost);
	const projectedMarginPct = BigDecimal.isPositive(revisedContractSum)
		? BigDecimal.multiply(divSafe(projectedMargin, revisedContractSum), HUNDRED)
		: ZERO;

	const grossWorkDone = BigDecimal.sum(boqWorkDone, approvedVariations);
	const retentionSubjectGross = BigDecimal.sum(
		retentionSubjectBoq,
		nonNegative(approvedVariations)
	);

	const retentionRate =
		input.retention_rate == null
			? DEFAULT_RETENTION_RATE
			: nonNegative(toDecimal(input.retention_rate));
	const retentionCapRate =
		input.retention_cap_rate == null
			? DEFAULT_RETENTION_CAP
			: nonNegative(toDecimal(input.retention_cap_rate));

	const retentionCapAmount = pctOf(nonNegative(revisedContractSum), retentionCapRate);
	const rawRetention = pctOf(nonNegative(retentionSubjectGross), retentionRate);
	const retentionHeld = BigDecimal.isPositive(retentionCapRate)
		? BigDecimal.min(rawRetention, retentionCapAmount)
		: rawRetention;

	const netCumulativeValue = BigDecimal.subtract(grossWorkDone, retentionHeld);

	const clientClaims = input.payment_claims.filter(
		(c) => (c.direction ?? 'inflow') === 'inflow' && c.status !== 'rejected'
	);
	let previousClaimed = ZERO;
	let previousCertified = ZERO;
	let previousValued = ZERO;

	for (const c of clientClaims) {
		const claimed = toDecimal(c.claimed_amount);
		const certified = c.certified_amount != null ? toDecimal(c.certified_amount) : claimed;
		previousClaimed = BigDecimal.sum(previousClaimed, claimed);
		if (c.status === 'certified' || c.status === 'paid') {
			previousCertified = BigDecimal.sum(previousCertified, certified);
			previousValued = BigDecimal.sum(previousValued, certified);
		} else if (c.status === 'submitted') {
			previousValued = BigDecimal.sum(previousValued, claimed);
		}
	}

	const netClaimableNow = nonNegative(BigDecimal.subtract(netCumulativeValue, previousValued));
	const taxRate = nonNegative(toDecimal(input.tax_rate));
	const estimatedTax = pctOf(netClaimableNow, taxRate);
	const netClaimableWithTax = BigDecimal.sum(netClaimableNow, estimatedTax);
	const overallProgressPct = BigDecimal.isPositive(revisedContractSum)
		? clampPctDecimal(BigDecimal.multiply(divSafe(grossWorkDone, revisedContractSum), HUNDRED))
		: ZERO;

	return {
		original_contract_sum: moneyStr(originalContractSum),
		approved_variations: moneyStr(approvedVariations),
		revised_contract_sum: moneyStr(revisedContractSum),
		committed_subcon_cost: moneyStr(committedSubconCost),
		projected_margin: moneyStr(projectedMargin),
		projected_margin_pct: formatTrimmed(projectedMarginPct, 1),
		gross_work_done: moneyStr(grossWorkDone),
		retention_subject_gross: moneyStr(retentionSubjectGross),
		retention_held: moneyStr(retentionHeld),
		retention_cap_amount: moneyStr(retentionCapAmount),
		net_cumulative_value: moneyStr(netCumulativeValue),
		previous_claimed: moneyStr(previousClaimed),
		previous_certified: moneyStr(previousCertified),
		net_claimable_now: moneyStr(netClaimableNow),
		tax_rate: formatTrimmed(taxRate, 2),
		estimated_tax: moneyStr(estimatedTax),
		net_claimable_with_tax: moneyStr(netClaimableWithTax),
		overall_progress_pct: formatTrimmed(overallProgressPct, 1),
		lines
	};
}

export type CashflowMonth = {
	readonly month: string;
	readonly inflow: number;
	readonly outflow: number;
	readonly net: number;
	readonly cumulative: number;
};

export type CashflowSummary = {
	readonly received_inflow: string;
	readonly pending_inflow: string;
	readonly paid_outflow: string;
	readonly pending_outflow: string;
	readonly net_realized_cashflow: string;
	readonly net_projected_cashflow: string;
	readonly overdue_receivables: string;
	readonly overdue_payables: string;
	readonly months: readonly CashflowMonth[];
};

/** Computes realized & projected project cashflow and monthly inflow/outflow buckets using BigDecimal. */
export function computeProjectCashflow(
	claims: readonly {
		readonly direction: string | null;
		readonly status: string;
		readonly claimed_amount: DecimalLike;
		readonly certified_amount: DecimalLike;
		readonly valuation_date: string | null;
		readonly due_date: string | null;
		readonly paid_date: string | null;
	}[],
	today: string
): CashflowSummary {
	let receivedInflow = ZERO;
	let pendingInflow = ZERO;
	let paidOutflow = ZERO;
	let pendingOutflow = ZERO;
	let overdueReceivables = ZERO;
	let overduePayables = ZERO;

	const buckets = new Map<
		string,
		{ inflow: BigDecimal.BigDecimal; outflow: BigDecimal.BigDecimal }
	>();

	for (const c of claims) {
		if (c.status === 'rejected') continue;
		const dir = c.direction ?? 'inflow';
		const amount =
			c.status === 'certified' || c.status === 'paid'
				? toDecimal(c.certified_amount ?? c.claimed_amount)
				: toDecimal(c.claimed_amount);
		const effectiveDate = c.paid_date ?? c.due_date ?? c.valuation_date;
		const month = effectiveDate ? effectiveDate.slice(0, 7) : today.slice(0, 7);
		const bucket = buckets.get(month) ?? { inflow: ZERO, outflow: ZERO };

		if (dir === 'inflow') {
			bucket.inflow = BigDecimal.sum(bucket.inflow, amount);
			if (c.status === 'paid') {
				receivedInflow = BigDecimal.sum(receivedInflow, amount);
			} else if (c.status === 'submitted' || c.status === 'certified') {
				pendingInflow = BigDecimal.sum(pendingInflow, amount);
				if (c.due_date && c.due_date < today) {
					overdueReceivables = BigDecimal.sum(overdueReceivables, amount);
				}
			}
		} else {
			bucket.outflow = BigDecimal.sum(bucket.outflow, amount);
			if (c.status === 'paid') {
				paidOutflow = BigDecimal.sum(paidOutflow, amount);
			} else if (c.status === 'submitted' || c.status === 'certified') {
				pendingOutflow = BigDecimal.sum(pendingOutflow, amount);
				if (c.due_date && c.due_date < today) {
					overduePayables = BigDecimal.sum(overduePayables, amount);
				}
			}
		}
		buckets.set(month, bucket);
	}

	const sortedMonths = [...buckets.keys()].sort();
	let cumulative = ZERO;
	const months: CashflowMonth[] = sortedMonths.map((month) => {
		const b = buckets.get(month) ?? { inflow: ZERO, outflow: ZERO };
		const net = BigDecimal.subtract(b.inflow, b.outflow);
		cumulative = BigDecimal.sum(cumulative, net);
		return {
			month,
			inflow: BigDecimal.toNumberUnsafe(BigDecimal.round(b.inflow, { scale: 2 })),
			outflow: BigDecimal.toNumberUnsafe(BigDecimal.round(b.outflow, { scale: 2 })),
			net: BigDecimal.toNumberUnsafe(BigDecimal.round(net, { scale: 2 })),
			cumulative: BigDecimal.toNumberUnsafe(BigDecimal.round(cumulative, { scale: 2 }))
		};
	});

	const netRealized = BigDecimal.subtract(receivedInflow, paidOutflow);
	const netProjected = BigDecimal.subtract(
		BigDecimal.sum(receivedInflow, pendingInflow),
		BigDecimal.sum(paidOutflow, pendingOutflow)
	);

	return {
		received_inflow: moneyStr(receivedInflow),
		pending_inflow: moneyStr(pendingInflow),
		paid_outflow: moneyStr(paidOutflow),
		pending_outflow: moneyStr(pendingOutflow),
		net_realized_cashflow: moneyStr(netRealized),
		net_projected_cashflow: moneyStr(netProjected),
		overdue_receivables: moneyStr(overdueReceivables),
		overdue_payables: moneyStr(overduePayables),
		months
	};
}
