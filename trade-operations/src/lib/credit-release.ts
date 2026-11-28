import { BigDecimal, Effect } from 'effect';
import { sha256Hex } from './commercial.js';
import { fixedDecimal } from './purchase-listing.js';

export type CreditFormulaKey =
	| 'current_bill'
	| 'invoices_audited'
	| 'invoices_paid'
	| 'refunds_unsettled'
	| 'receipts_unsettled'
	| 'advances_unsettled'
	| 'stock_out_audited'
	| 'stock_out_hooked';

export type CreditAmountKey = Exclude<CreditFormulaKey, 'current_bill'>;
export type CreditBlockReason = 'over_limit' | 'overdue';

/** KIS ICCreditField catalogue names verified on KIS PRD/TEST (FGroupID = 2, 销售出库). */
export const CREDIT_FORMULA_ITEMS = {
	当前单据金额: { key: 'current_bill', sign: 1 },
	当前单据金额合计: { key: 'current_bill', sign: 1 },
	已审核发票金额: { key: 'invoices_audited', sign: 1 },
	已审核的已收款发票金额: { key: 'invoices_paid', sign: -1 },
	已审核未核销的应收退款单金额: { key: 'refunds_unsettled', sign: 1 },
	已审核未核销的收款单金额: { key: 'receipts_unsettled', sign: -1 },
	已审核未核销的预收单金额: { key: 'advances_unsettled', sign: -1 },
	已审核的销售出库单金额: { key: 'stock_out_audited', sign: 1 },
	已钩稽的销售出库单金额: { key: 'stock_out_hooked', sign: -1 }
} as const satisfies Record<string, { readonly key: CreditFormulaKey; readonly sign: 1 | -1 }>;

const CREDIT_CATALOGUE: ReadonlyMap<
	string,
	{ readonly key: CreditFormulaKey; readonly sign: 1 | -1 }
> = new Map(Object.entries(CREDIT_FORMULA_ITEMS));

export type CreditFieldSpec = {
	readonly bit: number;
	readonly caption: string;
	readonly operator: string;
};

export type PlannedCreditItem = {
	readonly key: CreditFormulaKey;
	readonly caption: string;
	readonly bit: number;
	readonly sign: 1 | -1;
};

export type CreditFormulaPlan =
	| { readonly ok: true; readonly items: readonly PlannedCreditItem[] }
	| { readonly ok: false; readonly column: string; readonly reason: string };

/** Decode KIS's ICCreditOption.FMainAmtCustom bitmask against ICCreditField; refuse any unmapped item or sign. */
export function planCreditFormula(
	maskText: string,
	fields: readonly CreditFieldSpec[]
): CreditFormulaPlan {
	const mask = Number(maskText);
	if (
		!/^\d+$/.test(maskText) ||
		!Number.isSafeInteger(mask) ||
		mask < 0 ||
		mask >= 2 ** 31 ||
		fields.length > 64
	)
		return {
			ok: false,
			column: 'ICCreditOption.FMainAmtCustom',
			reason: 'Invalid or oversized native credit formula'
		};
	const items: PlannedCreditItem[] = [];
	const seen = new Set<CreditFormulaKey>();
	for (let bit = 1; bit <= mask && bit <= 0x40000000; bit *= 2) {
		if ((mask & bit) === 0) continue;
		const matching = fields.filter((field) => field.bit === bit);
		const field = matching[0];
		const known = field ? (CREDIT_CATALOGUE.get(field.caption) ?? null) : null;
		if (matching.length !== 1 || !field || !known)
			return {
				ok: false,
				column: 'ICCreditField',
				reason: 'Every selected credit bit requires one known catalogue item'
			};
		const operator = field.operator.trim();
		if (seen.has(known.key) || operator !== (known.sign === 1 ? '+' : '-'))
			return {
				ok: false,
				column: 'ICCreditField',
				reason: 'Duplicate credit item or unsupported native operator'
			};
		seen.add(known.key);
		items.push({ key: known.key, caption: field.caption, bit, sign: known.sign });
	}
	return { ok: true, items };
}

/** Exact KIS 已用额度; pass `billAmount = null` for customer baseline without a proposed DO. */
export function computeCreditExposure(
	plan: readonly PlannedCreditItem[],
	amounts: Readonly<Record<CreditAmountKey, string>>,
	billAmount: string | null
): string {
	let used = BigDecimal.fromBigInt(0n);
	for (const item of plan) {
		if (item.key === 'current_bill') {
			if (billAmount === null) continue;
			const value = BigDecimal.fromStringUnsafe(billAmount);
			used = item.sign === 1 ? BigDecimal.sum(used, value) : BigDecimal.subtract(used, value);
			continue;
		}
		const value = BigDecimal.fromStringUnsafe(amounts[item.key]);
		used = item.sign === 1 ? BigDecimal.sum(used, value) : BigDecimal.subtract(used, value);
	}
	return fixedDecimal(used, 2);
}

export type OverdueInvoiceItem = {
	readonly bill_no: string;
	readonly basis_date: string;
	readonly amount: string;
};

export type CreditBlockVerdict =
	| { readonly blocked: false }
	| {
			readonly blocked: true;
			readonly reasons: readonly CreditBlockReason[];
			readonly over_limit: string | null;
			readonly overdue_days: number | null;
			readonly oldest_overdue_bill: string | null;
	  };

function isoDayNumber(date: string): number {
	const year = Number(date.slice(0, 4));
	const month = Number(date.slice(5, 7));
	const day = Number(date.slice(8, 10));
	const ms = Date.UTC(year, month - 1, day);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(ms))
		throw new Error(`Invalid ISO date: ${date}`);
	if (new Date(ms).toISOString().slice(0, 10) !== date)
		throw new Error(`Invalid calendar date: ${date}`);
	return ms / 86_400_000;
}

/** Would KIS block this 销售出库 at 审核? Exactly at limit (`used == limit`) or due boundary (`days == 0`) passes. */
export function evaluateCreditBlock(input: {
	readonly controlRange: number;
	readonly limit: string;
	readonly used: string;
	readonly creditDays: number;
	readonly overdueInvoices: readonly OverdueInvoiceItem[];
	readonly today: string;
}): CreditBlockVerdict {
	const amountControl = (input.controlRange & 1) !== 0;
	const termControl = (input.controlRange & 2) !== 0;
	const reasons: CreditBlockReason[] = [];
	let over_limit: string | null = null;
	const used = BigDecimal.fromStringUnsafe(input.used);
	const limit = BigDecimal.fromStringUnsafe(input.limit);
	if (amountControl && BigDecimal.isGreaterThan(used, limit)) {
		reasons.push('over_limit');
		over_limit = fixedDecimal(BigDecimal.subtract(used, limit), 2);
	}
	let overdue_days: number | null = null;
	let oldest_overdue_bill: string | null = null;
	if (termControl) {
		const todayNo = isoDayNumber(input.today);
		for (const inv of input.overdueInvoices) {
			const days = todayNo - isoDayNumber(inv.basis_date) - input.creditDays;
			if (days <= 0) continue;
			if (
				overdue_days === null ||
				days > overdue_days ||
				(days === overdue_days &&
					(oldest_overdue_bill === null || inv.bill_no < oldest_overdue_bill))
			) {
				overdue_days = days;
				oldest_overdue_bill = inv.bill_no;
			}
		}
		if (overdue_days !== null) reasons.push('overdue');
	}
	return reasons.length === 0
		? { blocked: false }
		: { blocked: true, reasons, over_limit, overdue_days, oldest_overdue_bill };
}

export type CreditBillLine = {
	readonly item_id: string;
	readonly quantity: string;
	readonly amount: string;
};

function canonicalDecimal(value: string): string {
	return BigDecimal.format(BigDecimal.normalize(BigDecimal.fromStringUnsafe(value)));
}

/** Order-independent SHA-256 over total + sorted `[item, qty, amount]` tuples; binds approval to DO contents. */
export const creditReleaseContentHash = (total: string, lines: readonly CreditBillLine[]) => {
	const tuples = lines
		.map((line) => [line.item_id, canonicalDecimal(line.quantity), canonicalDecimal(line.amount)])
		.sort((a, b) => {
			const x = JSON.stringify(a);
			const y = JSON.stringify(b);
			return x < y ? -1 : x > y ? 1 : 0;
		});
	return sha256Hex(
		JSON.stringify({ total: fixedDecimal(BigDecimal.fromStringUnsafe(total), 2), lines: tuples })
	);
};

export const ORG_CREDIT_PLAN: readonly PlannedCreditItem[] = [
	{ key: 'current_bill', caption: '当前单据金额', bit: 1, sign: 1 },
	{ key: 'invoices_audited', caption: '已审核发票金额', bit: 2, sign: 1 },
	{ key: 'invoices_paid', caption: '已审核的已收款发票金额', bit: 4, sign: -1 },
	{ key: 'refunds_unsettled', caption: '已审核未核销的应收退款单金额', bit: 64, sign: 1 },
	{ key: 'receipts_unsettled', caption: '已审核未核销的收款单金额', bit: 256, sign: -1 },
	{ key: 'advances_unsettled', caption: '已审核未核销的预收单金额', bit: 1024, sign: -1 },
	{ key: 'stock_out_audited', caption: '已审核的销售出库单金额', bit: 16384, sign: 1 },
	{ key: 'stock_out_hooked', caption: '已钩稽的销售出库单金额', bit: 65536, sign: -1 }
];

export type OrderCreditWarning = {
	readonly held: boolean;
	readonly currency: string;
	readonly creditLimit: string | null;
	readonly creditUsed: string | null;
	readonly currentOver: string | null;
	readonly projectedUsed: string | null;
	readonly projectedOver: string | null;
};

/** Early-warning check for a sales order against the customer's latest Kingdee credit snapshot. */
export function orderCreditAssessment(
	snapshot: {
		readonly currency: string;
		readonly credit_limit: string | null;
		readonly credit_used: string | null;
		readonly credit_hold: boolean;
	} | null,
	orderCurrency: string | null | undefined,
	draftOrderTotal: string | null | undefined
): OrderCreditWarning | null {
	if (!snapshot) return null;
	const zero = BigDecimal.fromBigInt(0n);
	const limit =
		snapshot.credit_limit !== null ? BigDecimal.fromStringUnsafe(snapshot.credit_limit) : null;
	const used =
		snapshot.credit_used !== null ? BigDecimal.fromStringUnsafe(snapshot.credit_used) : null;
	const currentDiff = limit !== null && used !== null ? BigDecimal.subtract(used, limit) : null;
	const currentOver =
		currentDiff !== null && BigDecimal.isGreaterThan(currentDiff, zero)
			? fixedDecimal(currentDiff, 2)
			: null;
	let projectedUsed: string | null = null;
	let projectedOver: string | null = null;
	if (
		limit !== null &&
		used !== null &&
		orderCurrency === snapshot.currency &&
		draftOrderTotal != null &&
		draftOrderTotal !== ''
	) {
		const added = BigDecimal.fromStringUnsafe(draftOrderTotal);
		if (BigDecimal.isGreaterThan(added, zero)) {
			const totalUsed = BigDecimal.sum(used, added);
			const diff = BigDecimal.subtract(totalUsed, limit);
			if (BigDecimal.isGreaterThan(diff, zero)) {
				projectedUsed = fixedDecimal(totalUsed, 2);
				projectedOver = fixedDecimal(diff, 2);
			}
		}
	}
	if (!snapshot.credit_hold && currentOver === null && projectedOver === null) return null;
	return {
		held: snapshot.credit_hold,
		currency: snapshot.currency,
		creditLimit: snapshot.credit_limit,
		creditUsed: snapshot.credit_used,
		currentOver,
		projectedUsed,
		projectedOver
	};
}

const RELEASE_LOG_RE = /^销售出库 - (\S+) 由 (.+?) 授信通过信用检查$/;
const BILL_NO_RE = /^[A-Za-z0-9._/-]{1,40}$/;

export type ParsedReleaseLog = {
	readonly logId: string;
	readonly billNo: string;
	readonly kisUser: string;
	readonly releasedAt: string;
};

/** Parse a Kingdee `t_Log` `FFunctionID = 'XS100016'` credit-release audit entry. */
export function parseKingdeeReleaseLog(entry: {
	readonly log_id: string;
	readonly description: string;
	readonly logged_at: string;
}): ParsedReleaseLog | null {
	const match = RELEASE_LOG_RE.exec(entry.description.trim());
	if (!match?.[1] || !match[2]) return null;
	const billNo = match[1].trim();
	const kisUser = match[2].trim();
	if (!BILL_NO_RE.test(billNo) || !kisUser || !/^\d+$/.test(entry.log_id)) return null;
	return { logId: entry.log_id, billNo, kisUser, releasedAt: entry.logged_at };
}

/** Advance-payment settlements (`款到` / `预付`) — helps Finance distinguish payment-pending vs credit-limit blocks. */
export function isAdvanceSettlement(name: string | null | undefined): boolean {
	if (!name) return false;
	return name.startsWith('款到') || name.includes('预付');
}

export type OpenCreditRelease<O = string, D = string> = {
	readonly external_code: string;
	readonly delivery_fid: string;
	readonly status: 'blocked' | 'approved';
	readonly bill_amount: string | null;
	readonly credit_limit: string | null;
	readonly credit_days?: number | null;
	readonly credit_used: string | null;
	readonly over_limit: string | null;
	readonly overdue_days: number | null;
	readonly oldest_overdue_bill: string | null;
	readonly block_reasons: readonly CreditBlockReason[] | null;
	readonly source_oper_date: string | null;
	readonly content_hash: string | null;
	readonly approved_content_hash: string | null;
	readonly audit_seen_at: string | null;
	readonly order: O | null;
	readonly delivery: D | null;
	readonly settlement_name: string | null;
	/** True when an approved one-time pass is using a temporary Kingdee ICCreditObject bump awaiting DO audit. */
	readonly temp_bump_active?: boolean;
};

export type BillCreditObservation<O = string, D = string> =
	| { readonly kind: 'gone' }
	| { readonly kind: 'undetectable'; readonly oper_date: string; readonly content_hash: string }
	| {
			readonly kind: 'audited';
			readonly oper_date: string;
			readonly content_hash: string;
			readonly release: ParsedReleaseLog | null;
			readonly org_audit?: {
				readonly fid: string;
				readonly over_limit: boolean;
				readonly credit_limit?: string | null;
				readonly credit_used?: string | null;
				readonly over_limit_amount?: string | null;
			} | null;
	  }
	| {
			readonly kind: 'unaudited';
			readonly oper_date: string;
			readonly content_hash: string;
			readonly bill_amount: string;
			readonly credit_limit: string | null;
			readonly credit_days?: number | null;
			readonly credit_used: string | null;
			readonly verdict: CreditBlockVerdict;
			readonly order: O | null;
			readonly delivery: D | null;
			readonly settlement_name: string | null;
	  };

export type ReconcileAction<O = string, D = string> =
	| { readonly op: 'none' }
	| { readonly op: 'close'; readonly status: 'withdrawn' | 'cleared' | 'superseded' }
	| {
			readonly op: 'release';
			readonly status: 'released' | 'bypassed';
			readonly released_by: string;
			readonly released_at: string;
			readonly release_log_key: string;
			readonly content_hash: string;
			readonly source_oper_date: string;
	  }
	| { readonly op: 'mark_audit_seen'; readonly audit_seen_at: string }
	| { readonly op: 'clear_audit_seen' }
	| {
			readonly op: 'refresh';
			readonly bill_amount: string;
			readonly credit_limit: string | null;
			readonly credit_used: string | null;
			readonly over_limit: string | null;
			readonly overdue_days: number | null;
			readonly oldest_overdue_bill: string | null;
			readonly block_reasons: readonly CreditBlockReason[];
			readonly source_oper_date: string;
			readonly content_hash: string;
			readonly order: O | null;
			readonly delivery: D | null;
			readonly settlement_name: string | null;
			readonly audit_seen_at: null;
	  }
	| { readonly op: 'supersede_and_reopen' }
	| { readonly op: 'open_blocked' }
	| {
			readonly op: 'open_bypass';
			readonly released_by: string;
			readonly released_at: string;
			readonly release_log_key: string;
	  };

function sameReasons(
	a: readonly CreditBlockReason[] | null,
	b: readonly CreditBlockReason[]
): boolean {
	if (!a || a.length !== b.length) return false;
	return a.every((item, index) => item === b[index]);
}

function sameDecimalOrNull(a: string | null, b: string | null): boolean {
	if (a === null || b === null) return a === b;
	return BigDecimal.equals(BigDecimal.fromStringUnsafe(a), BigDecimal.fromStringUnsafe(b));
}

/** Exhaustive reconciliation of one DO's open credit-release row against Kingdee's current state. */
export function reconcileCreditRelease<O = string, D = string>(
	open: OpenCreditRelease<O, D> | null,
	observation: BillCreditObservation<O, D>,
	observedAt: string
): ReconcileAction<O, D> {
	if (observation.kind === 'gone')
		return open ? { op: 'close', status: 'withdrawn' } : { op: 'none' };

	if (observation.kind === 'undetectable') {
		if (
			open?.status === 'approved' &&
			(open.source_oper_date !== observation.oper_date ||
				open.approved_content_hash !== observation.content_hash)
		)
			return { op: 'close', status: 'superseded' };
		return { op: 'none' };
	}

	if (observation.kind === 'audited') {
		const release = observation.release;
		if (release) {
			if (!open)
				return {
					op: 'open_bypass',
					released_by: release.kisUser,
					released_at: release.releasedAt,
					release_log_key: release.logId
				};
			const validApproval =
				open.status === 'approved' &&
				open.approved_content_hash !== null &&
				open.approved_content_hash === observation.content_hash;
			return {
				op: 'release',
				status: validApproval ? 'released' : 'bypassed',
				released_by: release.kisUser,
				released_at: release.releasedAt,
				release_log_key: release.logId,
				content_hash: observation.content_hash,
				source_oper_date: observation.oper_date
			};
		}
		if (observation.org_audit) {
			const releaseKey = `org:${observation.org_audit.fid}:${observation.oper_date.toLowerCase()}`;
			if (!open) {
				return observation.org_audit.over_limit
					? {
							op: 'open_bypass',
							released_by: 'kingdee-audit',
							released_at: observedAt,
							release_log_key: releaseKey
						}
					: { op: 'none' };
			}
			const validApproval =
				open.status === 'approved' &&
				open.approved_content_hash !== null &&
				open.approved_content_hash === observation.content_hash;
			if (validApproval)
				return {
					op: 'release',
					status: 'released',
					released_by: 'kingdee-audit',
					released_at: observedAt,
					release_log_key: releaseKey,
					content_hash: observation.content_hash,
					source_oper_date: observation.oper_date
				};
			if (observation.org_audit.over_limit)
				return {
					op: 'release',
					status: 'bypassed',
					released_by: 'kingdee-audit',
					released_at: observedAt,
					release_log_key: releaseKey,
					content_hash: observation.content_hash,
					source_oper_date: observation.oper_date
				};
			return { op: 'close', status: 'cleared' };
		}
		if (!open) return { op: 'none' };
		if (open.status === 'approved' && open.temp_bump_active) {
			const validApproval =
				open.approved_content_hash !== null &&
				open.approved_content_hash === observation.content_hash;
			return validApproval
				? {
						op: 'release',
						status: 'released',
						released_by: 'trade-ops-temp-bump',
						released_at: observedAt,
						release_log_key: `temp-bump:${open.delivery_fid}:${observation.oper_date.toLowerCase()}`,
						content_hash: observation.content_hash,
						source_oper_date: observation.oper_date
					}
				: { op: 'close', status: 'superseded' };
		}
		if (open.audit_seen_at === null) return { op: 'mark_audit_seen', audit_seen_at: observedAt };
		return { op: 'close', status: 'cleared' };
	}

	// observation.kind === 'unaudited'
	if (!open) return observation.verdict.blocked ? { op: 'open_blocked' } : { op: 'none' };

	if (open.status === 'approved') {
		const edited =
			open.source_oper_date !== observation.oper_date ||
			(open.approved_content_hash !== null &&
				open.approved_content_hash !== observation.content_hash);
		if (edited)
			return observation.verdict.blocked
				? { op: 'supersede_and_reopen' }
				: { op: 'close', status: 'superseded' };
		// While an approved temporary credit bump is active, passing credit control is expected until warehouse audits the DO.
		if (!observation.verdict.blocked)
			return open.temp_bump_active ? { op: 'none' } : { op: 'close', status: 'cleared' };
		return open.audit_seen_at !== null ? { op: 'clear_audit_seen' } : { op: 'none' };
	}

	// open.status === 'blocked'
	if (!observation.verdict.blocked) return { op: 'close', status: 'cleared' };
	const changed =
		!sameDecimalOrNull(open.bill_amount, observation.bill_amount) ||
		!sameDecimalOrNull(open.credit_limit, observation.credit_limit) ||
		!sameDecimalOrNull(open.credit_used, observation.credit_used) ||
		!sameDecimalOrNull(open.over_limit, observation.verdict.over_limit) ||
		open.overdue_days !== observation.verdict.overdue_days ||
		open.oldest_overdue_bill !== observation.verdict.oldest_overdue_bill ||
		!sameReasons(open.block_reasons, observation.verdict.reasons) ||
		open.source_oper_date !== observation.oper_date ||
		open.content_hash !== observation.content_hash ||
		open.order !== observation.order ||
		open.delivery !== observation.delivery ||
		open.settlement_name !== observation.settlement_name ||
		open.audit_seen_at !== null;
	if (!changed) return { op: 'none' };
	return {
		op: 'refresh',
		bill_amount: observation.bill_amount,
		credit_limit: observation.credit_limit,
		credit_used: observation.credit_used,
		over_limit: observation.verdict.over_limit,
		overdue_days: observation.verdict.overdue_days,
		oldest_overdue_bill: observation.verdict.oldest_overdue_bill,
		block_reasons: observation.verdict.reasons,
		source_oper_date: observation.oper_date,
		content_hash: observation.content_hash,
		order: observation.order,
		delivery: observation.delivery,
		settlement_name: observation.settlement_name,
		audit_seen_at: null
	};
}

export const sumLineAmounts = (lines: readonly CreditBillLine[]): string =>
	fixedDecimal(BigDecimal.sumAll(lines.map((line) => BigDecimal.fromStringUnsafe(line.amount))), 2);

export const hashBillLines = Effect.fnUntraced(function* (lines: readonly CreditBillLine[]) {
	const total = sumLineAmounts(lines);
	const contentHash = yield* creditReleaseContentHash(total, lines);
	return { total, contentHash };
});
