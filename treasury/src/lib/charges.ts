import type { AutomationCtx, Id } from '@norbital-ai/bolt';
import { PRODUCT_CODES } from './products.js';

/**
 * The charges a bank advice (or Treasury) gives for one stage of a line. They replace whatever that stage held: the
 * advice is the final word, and a stage holding any actual charge is no longer estimated from the fee rules.
 */
export const CHARGE_TYPES = [
	'commission',
	'cable',
	'swift',
	'cost_of_funds_transfer',
	'processing',
	'tr_extension',
	'penalty',
	'other'
] as const;
export type ChargeType = (typeof CHARGE_TYPES)[number];

/** The figures read from an advice, checked by a person against the PDF before anything is applied. */
export const ADVICE = {
	kind: 'object',
	fields: {
		bank_reference: { kind: 'text', optional: true },
		lc_number: { kind: 'text', optional: true },
		bill_number: { kind: 'text', optional: true },
		product: { kind: 'enum', values: PRODUCT_CODES, optional: true },
		supplier_name: { kind: 'text', optional: true },
		currency: { kind: 'currency', optional: true },
		principal: { kind: 'decimal', scale: 2, optional: true },
		interest_rate_pct: { kind: 'decimal', scale: 6, optional: true },
		interest_amount: { kind: 'decimal', scale: 2, optional: true },
		interest_days: { kind: 'int', optional: true },
		start_date: { kind: 'date', optional: true },
		due_date: { kind: 'date', optional: true },
		total_debited: { kind: 'decimal', scale: 2, optional: true },
		charges: {
			kind: 'object',
			many: true,
			optional: true,
			fields: {
				charge_type: { kind: 'enum', values: CHARGE_TYPES },
				description: { kind: 'text', optional: true },
				amount_usd: { kind: 'decimal', scale: 2 }
			}
		},
		uncertain: { kind: 'text', many: true, optional: true }
	}
} as const;

/** The automation input for a stage's charges, in USD. */
export const CHARGES_INPUT = {
	kind: 'object',
	many: true,
	optional: true,
	fields: {
		charge_type: { kind: 'enum', values: CHARGE_TYPES },
		amount: { kind: 'decimal', scale: 2 },
		description: { kind: 'text', optional: true }
	}
} as const;

/** The child changes that replace one stage's charges on a line with `given` (USD). */
export function replaceStage<
	T extends { readonly id: string; readonly revision: number; readonly stage: string }
>(
	existing: readonly T[],
	stage: 'drawdown' | 'settlement',
	given: readonly {
		readonly charge_type: ChargeType;
		readonly amount: string;
		readonly description?: string | null;
	}[]
) {
	return {
		delete: existing.filter((c) => c.stage === stage),
		create: given.map((c) => ({
			charge_type: c.charge_type,
			stage,
			currency: 'USD' as const,
			amount: c.amount,
			description: c.description ?? null
		}))
	};
}

/** The advice that was read now belongs to the line, applied. */
export function* documentApplied(
	document: Id<'bank_document'>,
	line: Id<'drawdown'> | null,
	doc_type: 'drawdown_advice' | 'settlement_advice',
	ctx: AutomationCtx
) {
	const { bank_document } = yield* ctx.query({
		bank_document: { where: { id: { eq: document } }, fields: ['revision'], limit: 1 }
	});
	return bank_document.rows.map((target) => ({
		target,
		set: { drawdown: line, doc_type, read_status: 'applied' as const }
	}));
}
