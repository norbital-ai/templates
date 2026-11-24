import { BigDecimal } from 'effect';

export const earliestPurchaseListingDate = '2025-01-01';

export type PurchasePaymentStatus = 'uninvoiced' | 'unpaid' | 'partial' | 'paid';

export const purchaseOrderEntries = {
	kind: 'object',
	fields: {
		order_id: { kind: 'text' },
		entry_id: { kind: 'text' },
		order_number: { kind: 'text' },
		ordered_on: { kind: 'date' },
		supplier_id: { kind: 'text', optional: true },
		supplier_name: { kind: 'text', optional: true },
		product_category: { kind: 'text', optional: true },
		product_spec: { kind: 'text', optional: true },
		quantity: { kind: 'text' },
		currency: { kind: 'text', optional: true },
		unit_price: { kind: 'text', optional: true },
		exchange_rate: { kind: 'text', optional: true },
		amount: { kind: 'text', optional: true },
		amount_base: { kind: 'text', optional: true },
		received_qty: { kind: 'text' },
		last_received_on: { kind: 'date', optional: true },
		invoice_numbers: { kind: 'text', optional: true },
		invoiced_on: { kind: 'date', optional: true },
		invoiced_qty: { kind: 'text', optional: true },
		invoice_amount: { kind: 'text', optional: true },
		duty: { kind: 'text', optional: true },
		vat_amount: { kind: 'text', optional: true },
		net_amount: { kind: 'text', optional: true },
		settlement: { kind: 'text', optional: true },
		due_on: { kind: 'date', optional: true },
		paid_amount: { kind: 'text', optional: true },
		paid_on: { kind: 'date', optional: true },
		payment_status: {
			kind: 'enum',
			values: ['uninvoiced', 'unpaid', 'partial', 'paid'],
			optional: true
		},
		note: { kind: 'text', optional: true }
	},
	many: true
} as const;

export const purchaseExpenseNotice = {
	kind: 'object',
	fields: {
		unattached_rows: { kind: 'int' },
		unattached_amount: { kind: 'text' },
		before_start_rows: { kind: 'int' },
		before_start_amount: { kind: 'text' }
	}
} as const;

export type ExpenseSharePair = {
	readonly expense_id: string;
	readonly expense_entry_id: string;
	readonly kind: 'duty' | 'import_vat';
	readonly amount: string;
	readonly order_id: string;
	readonly entry_id: string;
	readonly weight: string;
};

export type ExpenseLine = {
	readonly expense_id: string;
	readonly expense_entry_id: string;
	readonly group_id: string;
	readonly dated_on: string;
	readonly kind: 'duty' | 'import_vat';
	readonly amount: string;
};

export type HookWeight = {
	readonly group_id: string;
	readonly order_id: string;
	readonly entry_id: string;
	readonly weight: string;
	readonly in_report: boolean;
};

const digitsCache = new Map<string, number>();
export function currencyDigits(currency: string): number {
	const cached = digitsCache.get(currency);
	if (cached !== undefined) return cached;
	const digits =
		new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
			.maximumFractionDigits ?? 2;
	digitsCache.set(currency, digits);
	return digits;
}

/** Exact half-up fixed-scale decimal formatting without IEEE-754 float conversion or Intl churn. */
export function fixedDecimal(value: BigDecimal.BigDecimal, scale: number): string {
	const rounded = BigDecimal.round(value, { scale, mode: 'half-from-zero' });
	if (rounded.value === 0n) return scale === 0 ? '0' : `0.${'0'.repeat(scale)}`;
	const negative = rounded.value < 0n;
	const abs = negative ? -rounded.value : rounded.value;
	let digits = abs.toString();
	if (rounded.scale < scale) digits += '0'.repeat(scale - rounded.scale);
	else if (rounded.scale > scale) digits = digits.slice(0, -(rounded.scale - scale)) || '0';
	if (scale === 0) return `${negative ? '-' : ''}${digits}`;
	const padded = digits.padStart(scale + 1, '0');
	return `${negative ? '-' : ''}${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

/**
 * Partition hooked expense-invoice lines (`005` customs duty, `002` import VAT) into exactly one
 * bucket each: allocated PO-line shares, unattached (no positive receipt weight), or before-start
 * (positive weights fall outside the report window).
 */
export function summarizeExpenses(
	lines: readonly ExpenseLine[],
	weights: readonly HookWeight[],
	reportKeys: ReadonlySet<string>,
	scale = 2
) {
	const weightsByGroup = new Map<string, HookWeight[]>();
	for (const item of weights) {
		if (!BigDecimal.isPositive(BigDecimal.fromStringUnsafe(item.weight))) continue;
		const list = weightsByGroup.get(item.group_id);
		if (list) list.push(item);
		else weightsByGroup.set(item.group_id, [item]);
	}
	const pairs: ExpenseSharePair[] = [];
	let unattachedRows = 0;
	let unattachedAmount = BigDecimal.fromBigInt(0n);
	let beforeStartRows = 0;
	let beforeStartAmount = BigDecimal.fromBigInt(0n);
	for (const line of lines) {
		const groupWeights = weightsByGroup.get(line.group_id);
		const datedInWindow = line.dated_on >= earliestPurchaseListingDate;
		if (!groupWeights || groupWeights.length === 0) {
			if (datedInWindow) {
				unattachedRows++;
				unattachedAmount = BigDecimal.sum(
					unattachedAmount,
					BigDecimal.fromStringUnsafe(line.amount)
				);
			}
			continue;
		}
		if (!groupWeights.some((item) => item.in_report)) {
			if (datedInWindow) {
				beforeStartRows++;
				beforeStartAmount = BigDecimal.sum(
					beforeStartAmount,
					BigDecimal.fromStringUnsafe(line.amount)
				);
			}
			continue;
		}
		for (const item of groupWeights)
			pairs.push({
				expense_id: line.expense_id,
				expense_entry_id: line.expense_entry_id,
				kind: line.kind,
				amount: line.amount,
				order_id: item.order_id,
				entry_id: item.entry_id,
				weight: item.weight
			});
	}
	const shares = allocateExpenses(pairs, scale);
	const off = sharesOffReport(pairs, shares, reportKeys);
	return {
		shares,
		notice: {
			unattached_rows: unattachedRows,
			unattached_amount: fixedDecimal(unattachedAmount, scale),
			before_start_rows: beforeStartRows + off.rows,
			before_start_amount: fixedDecimal(BigDecimal.sum(beforeStartAmount, off.amount), scale)
		}
	};
}

/**
 * Share each expense-invoice line (`005` customs duty or `002` import VAT) over the PO lines its
 * hook group reaches, weighted by positive net receipt amount. Each share rounds half-up to minor
 * units; the last PO line (by order id, then entry id) takes the remainder so shares add back to
 * the charge exactly.
 */
export function allocateExpenses(
	pairs: readonly ExpenseSharePair[],
	scale = 2
): Map<string, { duty: string | null; import_vat: string | null }> {
	const byExpense = new Map<string, ExpenseSharePair[]>();
	for (const pair of pairs) {
		const key = `${pair.expense_id}/${pair.expense_entry_id}`;
		const list = byExpense.get(key);
		if (list) list.push(pair);
		else byExpense.set(key, [pair]);
	}
	const compareId = (a: string, b: string) => {
		const ai = BigInt(a);
		const bi = BigInt(b);
		return ai < bi ? -1 : ai > bi ? 1 : 0;
	};
	const totals = new Map<
		string,
		{ duty: BigDecimal.BigDecimal | null; import_vat: BigDecimal.BigDecimal | null }
	>();
	for (const group of byExpense.values()) {
		// A PO line whose returns outweigh its receipts nets to <= 0 and takes no expense share.
		const ordered = group
			.filter((pair) => BigDecimal.isPositive(BigDecimal.fromStringUnsafe(pair.weight)))
			.sort((a, b) => compareId(a.order_id, b.order_id) || compareId(a.entry_id, b.entry_id));
		if (ordered.length === 0) continue;
		const first = ordered[0];
		if (!first) continue;
		const charge = BigDecimal.round(BigDecimal.fromStringUnsafe(first.amount), {
			scale,
			mode: 'half-from-zero'
		});
		const totalWeight = BigDecimal.sumAll(
			ordered.map((pair) => BigDecimal.fromStringUnsafe(pair.weight))
		);
		let given = BigDecimal.fromBigInt(0n);
		ordered.forEach((pair, index) => {
			const share =
				index === ordered.length - 1
					? BigDecimal.subtract(charge, given)
					: BigDecimal.round(
							BigDecimal.divideUnsafe(
								BigDecimal.multiply(charge, BigDecimal.fromStringUnsafe(pair.weight)),
								totalWeight
							),
							{ scale, mode: 'half-from-zero' }
						);
			given = BigDecimal.sum(given, share);
			const key = `${pair.order_id}/${pair.entry_id}`;
			const current = totals.get(key) ?? { duty: null, import_vat: null };
			current[pair.kind] = BigDecimal.sum(current[pair.kind] ?? BigDecimal.fromBigInt(0n), share);
			totals.set(key, current);
		});
	}
	return new Map(
		[...totals].map(([key, value]) => [
			key,
			{
				duty: value.duty === null ? null : fixedDecimal(value.duty, scale),
				import_vat: value.import_vat === null ? null : fixedDecimal(value.import_vat, scale)
			}
		])
	);
}

/**
 * Count distinct expense lines and total allocated amount that landed on PO lines outside
 * `reportKeys` (e.g. pre-start or cancelled POs inside a shared hook group), so every cent falls
 * into exactly one bucket: rows, unattached or before-start.
 */
export function sharesOffReport(
	pairs: readonly ExpenseSharePair[],
	shares: ReadonlyMap<string, { duty: string | null; import_vat: string | null }>,
	reportKeys: ReadonlySet<string>
): { readonly rows: number; readonly amount: BigDecimal.BigDecimal } {
	const expenseLines = new Set<string>();
	const offKeys = new Set<string>();
	for (const pair of pairs) {
		const key = `${pair.order_id}/${pair.entry_id}`;
		if (reportKeys.has(key) || !BigDecimal.isPositive(BigDecimal.fromStringUnsafe(pair.weight)))
			continue;
		expenseLines.add(`${pair.expense_id}/${pair.expense_entry_id}`);
		offKeys.add(key);
	}
	let amount = BigDecimal.fromBigInt(0n);
	for (const key of offKeys) {
		const share = shares.get(key);
		if (share?.duty) amount = BigDecimal.sum(amount, BigDecimal.fromStringUnsafe(share.duty));
		if (share?.import_vat)
			amount = BigDecimal.sum(amount, BigDecimal.fromStringUnsafe(share.import_vat));
	}
	return { rows: expenseLines.size, amount };
}

/** True when `part` covers strictly less of `whole` by size (zero covers less of any non-zero whole). */
function coversLess(part: string | null, whole: string | null): boolean {
	if (part === null || whole === null) return false;
	const p = BigDecimal.fromStringUnsafe(part);
	const w = BigDecimal.fromStringUnsafe(whole);
	if (BigDecimal.isZero(w)) return false;
	if (BigDecimal.isZero(p)) return true;
	if (BigDecimal.isNegative(p) !== BigDecimal.isNegative(w)) return false;
	return BigDecimal.isLessThan(BigDecimal.abs(p), BigDecimal.abs(w));
}

const statusByCode: Readonly<Record<number, PurchasePaymentStatus>> = {
	0: 'unpaid',
	1: 'partial',
	2: 'paid'
};

/**
 * Payment status of one PO line: uninvoiced when no purchase invoice exists; otherwise derived from
 * its invoices' payable states, downgraded from `paid` to `partial` if less than the ordered
 * quantity has been invoiced.
 */
export function purchasePaymentStatus(
	invoiceLines: number,
	statusMin: number | null,
	statusMax: number | null,
	invoicedQty: string | null,
	orderedQty: string | null
): PurchasePaymentStatus | null {
	if (invoiceLines === 0) return 'uninvoiced';
	if (statusMin === null || statusMax === null) return null;
	const status = statusMin === statusMax ? (statusByCode[statusMin] ?? null) : 'partial';
	return status === 'paid' && coversLess(invoicedQty, orderedQty) ? 'partial' : status;
}
