/**
 * Pure commercial, contract, PO/DO/Invoice/Claim, 3-way match, valuation, and project cashflow
 * calculations shared by models, automations, and UI.
 * All monetary and decimal arithmetic uses Effect `BigDecimal` — zero IEEE-754 float math.
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

/** Converts a decimal string or number to a finite number for non-monetary UI charts/ratios. */
export const toNumber = (value: DecimalLike): number => BigDecimal.toNumberUnsafe(toDecimal(value));

/** Formats a BigDecimal to an exact fixed-scale string (e.g. '12500.00') with half-from-zero rounding. */
function formatFixed(value: BigDecimal.BigDecimal, scale: number): string {
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

const nonNegative = (value: BigDecimal.BigDecimal): BigDecimal.BigDecimal =>
	BigDecimal.max(ZERO, value);

const clampPct = (value: BigDecimal.BigDecimal): BigDecimal.BigDecimal =>
	BigDecimal.clamp(value, { minimum: ZERO, maximum: HUNDRED });

export const divSafe = (
	num: BigDecimal.BigDecimal,
	den: BigDecimal.BigDecimal
): BigDecimal.BigDecimal =>
	BigDecimal.isZero(den) ? ZERO : Option.getOrElse(BigDecimal.divide(num, den), () => ZERO);

export const pctOf = (
	base: BigDecimal.BigDecimal,
	ratePct: BigDecimal.BigDecimal
): BigDecimal.BigDecimal =>
	BigDecimal.round(divSafe(BigDecimal.multiply(base, ratePct), HUNDRED), {
		scale: 2,
		mode: 'half-from-zero'
	});

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

export type ComputedLinesTotal = {
	readonly lines: readonly NormalizedPricedLine[];
	readonly subtotal: string;
	readonly tax_amount: string;
	readonly total_amount: string;
};

/** Computes exact line amounts, subtotal, tax, and gross total for contracts, POs, DOs, invoices, and additional costs. */
export function computeLinesTotals(
	lines: readonly PricedLineInput[] | null | undefined,
	taxRate: DecimalLike
): ComputedLinesTotal {
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

/** Computes commercial document totals (PO, DO, Invoice, Progress Claim, Credit Note). */
export function computeDocumentTotals(input: {
	readonly lines: readonly PricedLineInput[] | null | undefined;
	readonly subtotal: DecimalLike;
	readonly tax_rate: DecimalLike;
	readonly retention_amount: DecimalLike;
	readonly certified_amount: DecimalLike;
}): {
	readonly lines: readonly NormalizedPricedLine[] | null;
	readonly subtotal: string;
	readonly tax_amount: string;
	readonly total_amount: string;
	readonly net_amount: string;
} {
	const hasLines = input.lines != null && input.lines.length > 0;
	const computed = hasLines ? computeLinesTotals(input.lines, input.tax_rate) : null;
	const subtotalDec = computed
		? toDecimal(computed.subtotal)
		: BigDecimal.round(toDecimal(input.subtotal), { scale: 2, mode: 'half-from-zero' });
	const taxRate = nonNegative(toDecimal(input.tax_rate));
	const taxDec = computed ? toDecimal(computed.tax_amount) : pctOf(subtotalDec, taxRate);
	const totalDec = BigDecimal.sum(subtotalDec, taxDec);
	const retentionDec = nonNegative(toDecimal(input.retention_amount));
	const basis = input.certified_amount != null ? toDecimal(input.certified_amount) : totalDec;
	const netDec = BigDecimal.subtract(basis, retentionDec);
	return {
		lines: computed ? computed.lines : null,
		subtotal: moneyStr(subtotalDec),
		tax_amount: moneyStr(taxDec),
		total_amount: moneyStr(totalDec),
		net_amount: moneyStr(netDec)
	};
}

/** Evaluates 3-way match status between an invoice/DO and its parent PO or DO amount. */
export function evaluateThreeWayMatch(input: {
	readonly doc_type: string;
	readonly total_amount: DecimalLike;
	readonly parent_total: DecimalLike;
	readonly sibling_total: DecimalLike;
}): {
	readonly match_status: 'unmatched' | 'partial' | 'matched' | 'variance';
	readonly match_notes: string;
} {
	if (input.parent_total == null) {
		return { match_status: 'unmatched', match_notes: 'Not linked to a parent PO or DO.' };
	}
	const parentAmt = toDecimal(input.parent_total);
	const cumulative = BigDecimal.sum(toDecimal(input.sibling_total), toDecimal(input.total_amount));
	if (BigDecimal.isGreaterThan(cumulative, parentAmt)) {
		const diff = moneyStr(BigDecimal.subtract(cumulative, parentAmt));
		return {
			match_status: 'variance',
			match_notes: `Cumulative ${input.doc_type} exceeds parent commitment by ${diff}.`
		};
	}
	if (BigDecimal.equals(cumulative, parentAmt)) {
		return {
			match_status: 'matched',
			match_notes: 'Fully matched to parent commitment.'
		};
	}
	const remaining = moneyStr(BigDecimal.subtract(parentAmt, cumulative));
	return {
		match_status: 'partial',
		match_notes: `Partially matched (${remaining} remaining on parent commitment).`
	};
}

export type CommercialSummary = {
	readonly original_contract_sum: string;
	readonly upstream_variations: string;
	readonly revised_contract_sum: string;
	readonly committed_downstream: string;
	readonly downstream_variations: string;
	readonly projected_margin: string;
	readonly projected_margin_pct: string;
	readonly overall_progress_pct: string;
	readonly gross_work_done: string;
	readonly retention_held: string;
	readonly retention_cap_amount: string;
	readonly net_cumulative_value: string;
	readonly previous_certified: string;
	readonly net_claimable_now: string;
	readonly estimated_tax: string;
	readonly net_claimable_with_tax: string;
};

/** Computes project commercial totals & claimable valuation from contracts, task progress, and claims. */
export function computeProjectCommercial(input: {
	readonly contract_value: DecimalLike;
	readonly retention_rate: DecimalLike;
	readonly retention_cap_rate: DecimalLike;
	readonly tax_rate: DecimalLike;
	readonly contracts: readonly {
		readonly direction: string;
		readonly contract_type: string;
		readonly status: string;
		readonly contract_value: DecimalLike;
	}[];
	readonly tasks: readonly {
		readonly progress_pct: DecimalLike;
		readonly status: string;
	}[];
	readonly documents: readonly {
		readonly doc_type: string;
		readonly direction: string;
		readonly status: string;
		readonly total_amount: DecimalLike;
		readonly certified_amount: DecimalLike;
		readonly net_amount: DecimalLike;
	}[];
}): CommercialSummary {
	let upstreamBase = ZERO;
	let upstreamVars = ZERO;
	let downstreamBase = ZERO;
	let downstreamVars = ZERO;

	const activeStatuses = new Set(['active', 'completed']);
	for (const c of input.contracts) {
		if (!activeStatuses.has(c.status)) continue;
		const val = toDecimal(c.contract_value);
		if (c.direction === 'upstream') {
			if (c.contract_type === 'variation_order') upstreamVars = BigDecimal.sum(upstreamVars, val);
			else upstreamBase = BigDecimal.sum(upstreamBase, val);
		} else {
			if (c.contract_type === 'variation_order')
				downstreamVars = BigDecimal.sum(downstreamVars, val);
			else downstreamBase = BigDecimal.sum(downstreamBase, val);
		}
	}

	const originalContractSum = BigDecimal.isPositive(upstreamBase)
		? upstreamBase
		: BigDecimal.round(toDecimal(input.contract_value), { scale: 2, mode: 'half-from-zero' });
	const revisedContractSum = BigDecimal.sum(originalContractSum, upstreamVars);
	const committedDownstream = BigDecimal.sum(downstreamBase, downstreamVars);
	const projectedMargin = BigDecimal.subtract(revisedContractSum, committedDownstream);
	const projectedMarginPct = BigDecimal.isPositive(revisedContractSum)
		? BigDecimal.multiply(divSafe(projectedMargin, revisedContractSum), HUNDRED)
		: ZERO;

	// Weighted/average physical progress across non-cancelled tasks
	const activeTasks = input.tasks.filter((t) => t.status !== 'cancelled');
	let progressSum = ZERO;
	for (const t of activeTasks) {
		progressSum = BigDecimal.sum(progressSum, clampPct(toDecimal(t.progress_pct)));
	}
	const overallProgressPct =
		activeTasks.length > 0
			? clampPct(divSafe(progressSum, BigDecimal.fromBigInt(BigInt(activeTasks.length))))
			: ZERO;

	const grossWorkDone = pctOf(nonNegative(revisedContractSum), overallProgressPct);
	const retentionRate =
		input.retention_rate == null
			? DEFAULT_RETENTION_RATE
			: nonNegative(toDecimal(input.retention_rate));
	const retentionCapRate =
		input.retention_cap_rate == null
			? DEFAULT_RETENTION_CAP
			: nonNegative(toDecimal(input.retention_cap_rate));
	const retentionCapAmount = pctOf(nonNegative(revisedContractSum), retentionCapRate);
	const rawRetention = pctOf(grossWorkDone, retentionRate);
	const retentionHeld = BigDecimal.isPositive(retentionCapRate)
		? BigDecimal.min(rawRetention, retentionCapAmount)
		: rawRetention;
	const netCumulativeValue = BigDecimal.subtract(grossWorkDone, retentionHeld);

	// Inflow claims & invoices already certified/submitted
	let previousCertified = ZERO;
	let previousValued = ZERO;
	for (const d of input.documents) {
		if (d.direction !== 'inflow' || d.status === 'cancelled' || d.status === 'disputed') continue;
		if (d.doc_type !== 'progress_claim' && d.doc_type !== 'invoice') continue;
		const billed = toDecimal(d.total_amount);
		const certified = d.certified_amount != null ? toDecimal(d.certified_amount) : billed;
		if (d.status === 'certified' || d.status === 'paid') {
			previousCertified = BigDecimal.sum(previousCertified, certified);
			previousValued = BigDecimal.sum(previousValued, certified);
		} else if (d.status === 'issued' || d.status === 'verified') {
			previousValued = BigDecimal.sum(previousValued, billed);
		}
	}

	const netClaimableNow = nonNegative(BigDecimal.subtract(netCumulativeValue, previousValued));
	const taxRate = nonNegative(toDecimal(input.tax_rate));
	const estimatedTax = pctOf(netClaimableNow, taxRate);
	const netClaimableWithTax = BigDecimal.sum(netClaimableNow, estimatedTax);

	return {
		original_contract_sum: moneyStr(originalContractSum),
		upstream_variations: moneyStr(upstreamVars),
		revised_contract_sum: moneyStr(revisedContractSum),
		committed_downstream: moneyStr(committedDownstream),
		downstream_variations: moneyStr(downstreamVars),
		projected_margin: moneyStr(projectedMargin),
		projected_margin_pct: formatTrimmed(projectedMarginPct, 1),
		overall_progress_pct: formatTrimmed(overallProgressPct, 1),
		gross_work_done: moneyStr(grossWorkDone),
		retention_held: moneyStr(retentionHeld),
		retention_cap_amount: moneyStr(retentionCapAmount),
		net_cumulative_value: moneyStr(netCumulativeValue),
		previous_certified: moneyStr(previousCertified),
		net_claimable_now: moneyStr(netClaimableNow),
		estimated_tax: moneyStr(estimatedTax),
		net_claimable_with_tax: moneyStr(netClaimableWithTax)
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
	readonly po_committed_outflow: string;
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

/**
 * Computes realized & projected project cashflow across Invoices, Progress Claims, Credit Notes,
 * and tracks open PO commitments separately (DOs & POs do not double-count billed invoice cashflow).
 */
export function computeProjectCashflow(
	docs: readonly {
		readonly doc_type: string;
		readonly direction: string;
		readonly status: string;
		readonly total_amount: DecimalLike;
		readonly certified_amount: DecimalLike;
		readonly net_amount: DecimalLike;
		readonly issue_date: string | null;
		readonly due_date: string | null;
		readonly paid_date: string | null;
	}[],
	today: string
): CashflowSummary {
	let poCommittedOutflow = ZERO;
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

	for (const d of docs) {
		if (d.status === 'cancelled') continue;
		const effective =
			d.status === 'certified' || d.status === 'paid'
				? toDecimal(d.net_amount ?? d.certified_amount ?? d.total_amount)
				: toDecimal(d.net_amount ?? d.total_amount);

		if (d.doc_type === 'purchase_order') {
			if (d.direction === 'outflow' && d.status !== 'draft') {
				poCommittedOutflow = BigDecimal.sum(poCommittedOutflow, toDecimal(d.total_amount));
			}
			continue;
		}
		if (d.doc_type === 'delivery_order') continue;

		const signed =
			d.doc_type === 'credit_note' ? BigDecimal.negate(BigDecimal.abs(effective)) : effective;
		const effectiveDate = d.paid_date ?? d.due_date ?? d.issue_date;
		const month = effectiveDate ? effectiveDate.slice(0, 7) : today.slice(0, 7);
		const bucket = buckets.get(month) ?? { inflow: ZERO, outflow: ZERO };

		if (d.direction === 'inflow') {
			bucket.inflow = BigDecimal.sum(bucket.inflow, signed);
			if (d.status === 'paid') {
				receivedInflow = BigDecimal.sum(receivedInflow, signed);
			} else if (d.status === 'issued' || d.status === 'verified' || d.status === 'certified') {
				pendingInflow = BigDecimal.sum(pendingInflow, signed);
				if (d.due_date && d.due_date < today && BigDecimal.isPositive(signed)) {
					overdueReceivables = BigDecimal.sum(overdueReceivables, signed);
				}
			}
		} else {
			bucket.outflow = BigDecimal.sum(bucket.outflow, signed);
			if (d.status === 'paid') {
				paidOutflow = BigDecimal.sum(paidOutflow, signed);
			} else if (d.status === 'issued' || d.status === 'verified' || d.status === 'certified') {
				pendingOutflow = BigDecimal.sum(pendingOutflow, signed);
				if (d.due_date && d.due_date < today && BigDecimal.isPositive(signed)) {
					overduePayables = BigDecimal.sum(overduePayables, signed);
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
		po_committed_outflow: moneyStr(poCommittedOutflow),
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
