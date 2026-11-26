/**
 * Project commercial valuation, monthly cashflow, catalog budget reconciliation, and embodied carbon.
 */
import { BigDecimal } from 'effect';
import {
	HUNDRED,
	ZERO,
	clampPct,
	divSafe,
	formatTrimmed,
	moneyStr,
	nonNegative,
	pctOf,
	toDecimal,
	type DecimalLike
} from './decimal.js';
import type { PricedLineInput } from './lines.js';

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

const IN_FORCE = new Set(['active', 'completed']);

/** First upstream, non-variation contract in force: defines project retention & tax terms. */
export const clientContractOf = <
	C extends { readonly direction: string; readonly contract_type: string; readonly status: string }
>(
	contracts: readonly C[]
): C | undefined =>
	contracts.find(
		(c) =>
			c.direction === 'upstream' && c.contract_type !== 'variation_order' && IN_FORCE.has(c.status)
	);

export function computeProjectCommercial(input: {
	readonly contracts: readonly {
		readonly direction: string;
		readonly contract_type: string;
		readonly status: string;
		readonly contract_value: DecimalLike;
		readonly retention_rate: DecimalLike;
		readonly retention_cap_rate: DecimalLike;
		readonly tax_rate: DecimalLike;
	}[];
	readonly tasks: readonly { readonly progress_pct: DecimalLike; readonly status: string }[];
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

	for (const c of input.contracts) {
		if (!IN_FORCE.has(c.status)) continue;
		const val = toDecimal(c.contract_value);
		const isVo = c.contract_type === 'variation_order';
		if (c.direction === 'upstream') {
			if (isVo) upstreamVars = BigDecimal.sum(upstreamVars, val);
			else upstreamBase = BigDecimal.sum(upstreamBase, val);
		} else if (isVo) {
			downstreamVars = BigDecimal.sum(downstreamVars, val);
		} else {
			downstreamBase = BigDecimal.sum(downstreamBase, val);
		}
	}

	const main = clientContractOf(input.contracts);
	const revised = BigDecimal.sum(upstreamBase, upstreamVars);
	const downstream = BigDecimal.sum(downstreamBase, downstreamVars);
	const margin = BigDecimal.subtract(revised, downstream);
	const marginPct = BigDecimal.isPositive(revised)
		? BigDecimal.multiply(divSafe(margin, revised), HUNDRED)
		: ZERO;

	const activeTasks = input.tasks.filter((t) => t.status !== 'cancelled');
	const progressSum = activeTasks.reduce(
		(acc, t) => BigDecimal.sum(acc, clampPct(toDecimal(t.progress_pct))),
		ZERO
	);
	const progressPct = activeTasks.length
		? clampPct(divSafe(progressSum, BigDecimal.fromBigInt(BigInt(activeTasks.length))))
		: ZERO;

	const grossWorkDone = pctOf(nonNegative(revised), progressPct);
	const retentionRate = main ? nonNegative(toDecimal(main.retention_rate)) : ZERO;
	const retentionCapRate = main ? nonNegative(toDecimal(main.retention_cap_rate)) : ZERO;
	const retentionCapAmt = pctOf(nonNegative(revised), retentionCapRate);
	const rawRetention = pctOf(grossWorkDone, retentionRate);
	const retentionHeld = BigDecimal.isPositive(retentionCapRate)
		? BigDecimal.min(rawRetention, retentionCapAmt)
		: rawRetention;
	const netCumulative = BigDecimal.subtract(grossWorkDone, retentionHeld);

	let previousCertified = ZERO;
	let previousValued = ZERO;
	for (const d of input.documents) {
		if (
			d.direction !== 'inflow' ||
			d.status === 'cancelled' ||
			d.status === 'disputed' ||
			(d.doc_type !== 'progress_claim' && d.doc_type !== 'invoice')
		) {
			continue;
		}
		const billed = toDecimal(d.total_amount);
		const certified = d.certified_amount != null ? toDecimal(d.certified_amount) : billed;
		if (d.status === 'certified' || d.status === 'paid') {
			previousCertified = BigDecimal.sum(previousCertified, certified);
			previousValued = BigDecimal.sum(previousValued, certified);
		} else if (d.status === 'issued' || d.status === 'verified') {
			previousValued = BigDecimal.sum(previousValued, billed);
		}
	}

	const claimableNow = nonNegative(BigDecimal.subtract(netCumulative, previousValued));
	const tax = pctOf(claimableNow, main ? nonNegative(toDecimal(main.tax_rate)) : ZERO);

	return {
		original_contract_sum: moneyStr(upstreamBase),
		upstream_variations: moneyStr(upstreamVars),
		revised_contract_sum: moneyStr(revised),
		committed_downstream: moneyStr(downstream),
		downstream_variations: moneyStr(downstreamVars),
		projected_margin: moneyStr(margin),
		projected_margin_pct: formatTrimmed(marginPct, 1),
		overall_progress_pct: formatTrimmed(progressPct, 1),
		gross_work_done: moneyStr(grossWorkDone),
		retention_held: moneyStr(retentionHeld),
		retention_cap_amount: moneyStr(retentionCapAmt),
		net_cumulative_value: moneyStr(netCumulative),
		previous_certified: moneyStr(previousCertified),
		net_claimable_now: moneyStr(claimableNow),
		estimated_tax: moneyStr(tax),
		net_claimable_with_tax: moneyStr(BigDecimal.sum(claimableNow, tax))
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

const PENDING_CASH_STATUSES = new Set(['issued', 'verified', 'certified']);
const toRoundedNum = (d: BigDecimal.BigDecimal) =>
	BigDecimal.toNumberUnsafe(BigDecimal.round(d, { scale: 2 }));

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
	let poCommitted = ZERO;
	let receivedIn = ZERO;
	let pendingIn = ZERO;
	let paidOut = ZERO;
	let pendingOut = ZERO;
	let overdueIn = ZERO;
	let overdueOut = ZERO;
	const buckets = new Map<
		string,
		{ inflow: BigDecimal.BigDecimal; outflow: BigDecimal.BigDecimal }
	>();

	for (const d of docs) {
		if (d.status === 'cancelled' || d.doc_type === 'delivery_order') continue;
		if (d.doc_type === 'purchase_order') {
			if (d.direction === 'outflow' && d.status !== 'draft') {
				poCommitted = BigDecimal.sum(poCommitted, toDecimal(d.total_amount));
			}
			continue;
		}
		const effective =
			d.status === 'certified' || d.status === 'paid'
				? toDecimal(d.net_amount ?? d.certified_amount ?? d.total_amount)
				: toDecimal(d.net_amount ?? d.total_amount);
		const signed =
			d.doc_type === 'credit_note' ? BigDecimal.negate(BigDecimal.abs(effective)) : effective;
		const month = (d.paid_date ?? d.due_date ?? d.issue_date ?? today).slice(0, 7);
		const bucket = buckets.get(month) ?? { inflow: ZERO, outflow: ZERO };
		const isOverdue = Boolean(d.due_date && d.due_date < today && BigDecimal.isPositive(signed));

		if (d.direction === 'inflow') {
			bucket.inflow = BigDecimal.sum(bucket.inflow, signed);
			if (d.status === 'paid') receivedIn = BigDecimal.sum(receivedIn, signed);
			else if (PENDING_CASH_STATUSES.has(d.status)) {
				pendingIn = BigDecimal.sum(pendingIn, signed);
				if (isOverdue) overdueIn = BigDecimal.sum(overdueIn, signed);
			}
		} else {
			bucket.outflow = BigDecimal.sum(bucket.outflow, signed);
			if (d.status === 'paid') paidOut = BigDecimal.sum(paidOut, signed);
			else if (PENDING_CASH_STATUSES.has(d.status)) {
				pendingOut = BigDecimal.sum(pendingOut, signed);
				if (isOverdue) overdueOut = BigDecimal.sum(overdueOut, signed);
			}
		}
		buckets.set(month, bucket);
	}

	let cumulative = ZERO;
	const months: CashflowMonth[] = [...buckets.keys()].sort().map((month) => {
		const b = buckets.get(month) ?? { inflow: ZERO, outflow: ZERO };
		const net = BigDecimal.subtract(b.inflow, b.outflow);
		cumulative = BigDecimal.sum(cumulative, net);
		return {
			month,
			inflow: toRoundedNum(b.inflow),
			outflow: toRoundedNum(b.outflow),
			net: toRoundedNum(net),
			cumulative: toRoundedNum(cumulative)
		};
	});

	return {
		po_committed_outflow: moneyStr(poCommitted),
		received_inflow: moneyStr(receivedIn),
		pending_inflow: moneyStr(pendingIn),
		paid_outflow: moneyStr(paidOut),
		pending_outflow: moneyStr(pendingOut),
		net_realized_cashflow: moneyStr(BigDecimal.subtract(receivedIn, paidOut)),
		net_projected_cashflow: moneyStr(
			BigDecimal.subtract(
				BigDecimal.sum(receivedIn, pendingIn),
				BigDecimal.sum(paidOut, pendingOut)
			)
		),
		overdue_receivables: moneyStr(overdueIn),
		overdue_payables: moneyStr(overdueOut),
		months
	};
}

export type CatalogCashflowRow = {
	readonly code: string;
	readonly name: string;
	readonly source: 'bim_asset' | 'adhoc_catalog';
	readonly unit: string;
	readonly estimated_budget: string;
	readonly so_value: string;
	readonly po_committed: string;
	readonly delivered_value: string;
	readonly invoiced_outflow: string;
	readonly paid_outflow: string;
	readonly budget_variance: string;
	readonly net: string;
};

export function computeCatalogCashflowBreakdown(input: {
	readonly bim_assets: readonly {
		readonly matrix_code?: string | null;
		readonly classification: string;
		readonly unit: string;
		readonly amount: DecimalLike;
		readonly status: string;
	}[];
	readonly adhoc_costs: readonly {
		readonly status: string;
		readonly catalog_code: string | null;
		readonly catalog_name: string | null;
		readonly title: string;
		readonly unit: string;
		readonly amount: DecimalLike;
	}[];
	readonly contracts: readonly {
		readonly direction: string;
		readonly status: string;
		readonly lines?: readonly PricedLineInput[] | null;
	}[];
	readonly documents: readonly {
		readonly doc_type: string;
		readonly direction: string;
		readonly status: string;
		readonly lines?: readonly PricedLineInput[] | null;
	}[];
}): {
	readonly rows: readonly CatalogCashflowRow[];
	readonly total_estimated_budget: string;
	readonly total_adhoc_costs: string;
	readonly total_po_committed: string;
	readonly total_invoiced_outflow: string;
	readonly total_paid_outflow: string;
} {
	type Acc = {
		code: string;
		name: string;
		source: 'bim_asset' | 'adhoc_catalog';
		unit: string;
		estimated: BigDecimal.BigDecimal;
		so: BigDecimal.BigDecimal;
		po: BigDecimal.BigDecimal;
		delivered: BigDecimal.BigDecimal;
		invoicedOut: BigDecimal.BigDecimal;
		paidOut: BigDecimal.BigDecimal;
	};
	const byCode = new Map<string, Acc>();
	const ensure = (
		code: string,
		name: string,
		source: 'bim_asset' | 'adhoc_catalog',
		unit: string
	): Acc => {
		let acc = byCode.get(code);
		if (!acc) {
			acc = {
				code,
				name,
				source,
				unit,
				estimated: ZERO,
				so: ZERO,
				po: ZERO,
				delivered: ZERO,
				invoicedOut: ZERO,
				paidOut: ZERO
			};
			byCode.set(code, acc);
		}
		return acc;
	};

	for (const line of input.bim_assets) {
		if (!line.matrix_code || line.status === 'unmatched') continue;
		const acc = ensure(line.matrix_code, line.classification, 'bim_asset', line.unit);
		acc.estimated = BigDecimal.sum(acc.estimated, toDecimal(line.amount));
	}

	let totalAdhoc = ZERO;
	for (const cost of input.adhoc_costs) {
		if (cost.status === 'cancelled') continue;
		const amt = toDecimal(cost.amount);
		totalAdhoc = BigDecimal.sum(totalAdhoc, amt);
		const acc = ensure(
			cost.catalog_code ?? 'ADHOC',
			cost.catalog_name ?? cost.title,
			'adhoc_catalog',
			cost.unit
		);
		acc.estimated = BigDecimal.sum(acc.estimated, amt);
		if (cost.status === 'incurred') {
			acc.invoicedOut = BigDecimal.sum(acc.invoicedOut, amt);
			acc.paidOut = BigDecimal.sum(acc.paidOut, amt);
		} else if (cost.status === 'approved') {
			acc.po = BigDecimal.sum(acc.po, amt);
		}
	}

	for (const ctr of input.contracts) {
		if (!IN_FORCE.has(ctr.status)) continue;
		for (const line of ctr.lines ?? []) {
			if (!line.code) continue;
			const acc = ensure(line.code, line.description, line.source ?? 'bim_asset', line.unit);
			const amt = toDecimal(line.amount);
			if (ctr.direction === 'upstream') acc.so = BigDecimal.sum(acc.so, amt);
			else acc.po = BigDecimal.sum(acc.po, amt);
		}
	}

	for (const doc of input.documents) {
		if (doc.status === 'cancelled') continue;
		for (const line of doc.lines ?? []) {
			if (!line.code) continue;
			const acc = ensure(line.code, line.description, line.source ?? 'bim_asset', line.unit);
			const raw = toDecimal(line.amount);
			const amt = doc.doc_type === 'credit_note' ? BigDecimal.negate(BigDecimal.abs(raw)) : raw;
			if (doc.doc_type === 'delivery_order') {
				acc.delivered = BigDecimal.sum(acc.delivered, amt);
			} else if (
				doc.direction === 'outflow' &&
				(doc.doc_type === 'invoice' || doc.doc_type === 'credit_note')
			) {
				acc.invoicedOut = BigDecimal.sum(acc.invoicedOut, amt);
				if (doc.status === 'paid') acc.paidOut = BigDecimal.sum(acc.paidOut, amt);
			}
		}
	}

	let totalEstimated = ZERO;
	let totalPo = ZERO;
	let totalInvoiced = ZERO;
	let totalPaid = ZERO;
	const rows: CatalogCashflowRow[] = [...byCode.values()]
		.sort((a, b) => a.code.localeCompare(b.code))
		.map((a) => {
			totalEstimated = BigDecimal.sum(totalEstimated, a.estimated);
			totalPo = BigDecimal.sum(totalPo, a.po);
			totalInvoiced = BigDecimal.sum(totalInvoiced, a.invoicedOut);
			totalPaid = BigDecimal.sum(totalPaid, a.paidOut);
			return {
				code: a.code,
				name: a.name,
				source: a.source,
				unit: a.unit,
				estimated_budget: moneyStr(a.estimated),
				so_value: moneyStr(a.so),
				po_committed: moneyStr(a.po),
				delivered_value: moneyStr(a.delivered),
				invoiced_outflow: moneyStr(a.invoicedOut),
				paid_outflow: moneyStr(a.paidOut),
				budget_variance: moneyStr(BigDecimal.subtract(a.estimated, a.po)),
				net: moneyStr(BigDecimal.subtract(a.so, a.po))
			};
		});

	return {
		rows,
		total_estimated_budget: moneyStr(totalEstimated),
		total_adhoc_costs: moneyStr(totalAdhoc),
		total_po_committed: moneyStr(totalPo),
		total_invoiced_outflow: moneyStr(totalInvoiced),
		total_paid_outflow: moneyStr(totalPaid)
	};
}

export type CarbonRow = {
	readonly code: string;
	readonly name: string;
	readonly source: 'bim_asset' | 'adhoc_catalog';
	readonly discipline: string;
	readonly unit: string;
	readonly quantity: string;
	readonly carbon_factor: string;
	readonly carbon: string;
};

export function computeProjectCarbon(input: {
	readonly bim_assets: readonly {
		readonly matrix_code?: string | null;
		readonly classification: string;
		readonly discipline: string;
		readonly unit: string;
		readonly priced_qty: DecimalLike;
		readonly carbon_factor: DecimalLike;
		readonly carbon: DecimalLike;
		readonly status: string;
	}[];
	readonly adhoc_costs: readonly {
		readonly status: string;
		readonly qty: DecimalLike;
		readonly item: {
			readonly code: string;
			readonly name: string;
			readonly discipline: string;
			readonly unit: string;
			readonly carbon_factor: DecimalLike;
		} | null;
	}[];
}): {
	readonly rows: readonly CarbonRow[];
	readonly model: string;
	readonly other: string;
	readonly total: string;
	readonly uncounted: number;
} {
	type Acc = Omit<CarbonRow, 'quantity' | 'carbon'> & {
		quantity: BigDecimal.BigDecimal;
		carbon: BigDecimal.BigDecimal;
	};
	const byCode = new Map<string, Acc>();
	let model = ZERO;
	let other = ZERO;
	let uncounted = 0;
	const add = (
		line: Omit<CarbonRow, 'quantity' | 'carbon'>,
		qty: DecimalLike,
		carbon: BigDecimal.BigDecimal
	) => {
		const acc = byCode.get(line.code) ?? { ...line, quantity: ZERO, carbon: ZERO };
		acc.quantity = BigDecimal.sum(acc.quantity, toDecimal(qty));
		acc.carbon = BigDecimal.sum(acc.carbon, carbon);
		byCode.set(line.code, acc);
	};

	for (const line of input.bim_assets) {
		const factor = toDecimal(line.carbon_factor);
		if (!line.matrix_code || line.status === 'unmatched' || !BigDecimal.isPositive(factor)) {
			uncounted += 1;
			continue;
		}
		const carbon = toDecimal(line.carbon);
		model = BigDecimal.sum(model, carbon);
		add(
			{
				code: line.matrix_code,
				name: line.classification,
				source: 'bim_asset',
				discipline: line.discipline,
				unit: line.unit,
				carbon_factor: formatTrimmed(factor, 3)
			},
			line.priced_qty,
			carbon
		);
	}

	for (const cost of input.adhoc_costs) {
		if (cost.status === 'cancelled') continue;
		const factor = toDecimal(cost.item?.carbon_factor);
		if (!cost.item || !BigDecimal.isPositive(factor)) {
			uncounted += 1;
			continue;
		}
		const carbon = BigDecimal.multiply(nonNegative(toDecimal(cost.qty)), factor);
		other = BigDecimal.sum(other, carbon);
		add(
			{
				code: cost.item.code,
				name: cost.item.name,
				source: 'adhoc_catalog',
				discipline: cost.item.discipline,
				unit: cost.item.unit,
				carbon_factor: formatTrimmed(factor, 3)
			},
			cost.qty,
			carbon
		);
	}

	return {
		rows: [...byCode.values()]
			.sort((a, b) => BigDecimal.Order(b.carbon, a.carbon))
			.map((r) => ({
				...r,
				quantity: formatTrimmed(r.quantity, 3),
				carbon: formatTrimmed(r.carbon, 2)
			})),
		model: formatTrimmed(model, 2),
		other: formatTrimmed(other, 2),
		total: formatTrimmed(BigDecimal.sum(model, other), 2),
		uncounted
	};
}
