/**
 * Commercial line normalization, catalog resolution, document totals, and PO/DO/Invoice 3-way matching.
 */
import { BigDecimal, Option, Schema } from 'effect';
import {
	ZERO,
	formatTrimmed,
	moneyStr,
	nonNegative,
	pctOf,
	roundHalf,
	toDecimal,
	type DecimalLike
} from './decimal.js';

export const PricedLineSchema = Schema.Struct({
	source: Schema.optionalKey(Schema.NullOr(Schema.Literals(['bim_asset', 'adhoc_catalog']))),
	code: Schema.String,
	bim_asset_key: Schema.optionalKey(Schema.NullOr(Schema.String)),
	storey: Schema.optionalKey(Schema.NullOr(Schema.String)),
	bim_express_ids: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Number))),
	description: Schema.String,
	unit: Schema.String,
	qty: Schema.String,
	unit_rate: Schema.String,
	amount: Schema.String
});

export type NormalizedPricedLine = typeof PricedLineSchema.Type;

export type PricedLineInput = Omit<NormalizedPricedLine, 'qty' | 'unit_rate' | 'amount'> & {
	readonly qty: DecimalLike;
	readonly unit_rate: DecimalLike;
	readonly amount?: DecimalLike;
};

const decodeLinesOption = Schema.decodeUnknownOption(Schema.Array(PricedLineSchema));

export function decodePricedLines(value: unknown): readonly NormalizedPricedLine[] | null {
	return Array.isArray(value) ? Option.getOrNull(decodeLinesOption(value)) : null;
}

export type ComputedLinesTotal = {
	readonly lines: readonly NormalizedPricedLine[];
	readonly subtotal: string;
	readonly tax_amount: string;
	readonly total_amount: string;
};

export function computeLinesTotals(
	lines: readonly PricedLineInput[] | null | undefined,
	taxRate: DecimalLike
): ComputedLinesTotal {
	let subtotal = ZERO;
	const normalized: NormalizedPricedLine[] = (lines ?? []).map((line) => {
		const qty = toDecimal(line.qty);
		const rate = toDecimal(line.unit_rate);
		const amount = roundHalf(BigDecimal.multiply(qty, rate), 2);
		subtotal = BigDecimal.sum(subtotal, amount);
		return {
			...(line.source != null ? { source: line.source } : {}),
			code: line.code,
			...(line.bim_asset_key != null ? { bim_asset_key: line.bim_asset_key } : {}),
			...(line.storey != null ? { storey: line.storey } : {}),
			...(line.bim_express_ids?.length ? { bim_express_ids: [...line.bim_express_ids] } : {}),
			description: line.description,
			unit: line.unit,
			qty: formatTrimmed(qty, 3),
			unit_rate: moneyStr(rate),
			amount: moneyStr(amount)
		};
	});
	const taxAmount = pctOf(subtotal, nonNegative(toDecimal(taxRate)));
	return {
		lines: normalized,
		subtotal: moneyStr(subtotal),
		tax_amount: moneyStr(taxAmount),
		total_amount: moneyStr(BigDecimal.sum(subtotal, taxAmount))
	};
}

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
	const computed = input.lines?.length ? computeLinesTotals(input.lines, input.tax_rate) : null;
	const subtotalDec = computed
		? toDecimal(computed.subtotal)
		: roundHalf(toDecimal(input.subtotal), 2);
	const taxDec = computed
		? toDecimal(computed.tax_amount)
		: pctOf(subtotalDec, nonNegative(toDecimal(input.tax_rate)));
	const totalDec = BigDecimal.sum(subtotalDec, taxDec);
	const basis = input.certified_amount != null ? toDecimal(input.certified_amount) : totalDec;
	const netDec = BigDecimal.subtract(basis, nonNegative(toDecimal(input.retention_amount)));
	return {
		lines: computed ? computed.lines : null,
		subtotal: moneyStr(subtotalDec),
		tax_amount: moneyStr(taxDec),
		total_amount: moneyStr(totalDec),
		net_amount: moneyStr(netDec)
	};
}

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
		return {
			match_status: 'variance',
			match_notes: `Cumulative ${input.doc_type} exceeds parent commitment by ${moneyStr(BigDecimal.subtract(cumulative, parentAmt))}.`
		};
	}
	if (BigDecimal.equals(cumulative, parentAmt)) {
		return { match_status: 'matched', match_notes: 'Fully matched to parent commitment.' };
	}
	return {
		match_status: 'partial',
		match_notes: `Partially matched (${moneyStr(BigDecimal.subtract(parentAmt, cumulative))} remaining on parent commitment).`
	};
}

export type CatalogItemRef = {
	readonly code: string;
	readonly name: string;
	readonly category: 'bim_asset' | 'additional_cost';
	readonly unit: string;
	readonly currency: string;
	readonly unit_rate: string;
	readonly active: boolean;
};

export type BimTakeoffBucketRef = {
	readonly asset_key: string;
	readonly classification: string;
	readonly storey: string;
	readonly matrix_code?: string | null | undefined;
	readonly unit: string;
	readonly measured_qty: string;
	readonly unit_rate: string;
	readonly sample_express_ids?: readonly number[] | null | undefined;
};

export type ResolveCatalogLinesResult =
	| { readonly ok: true; readonly lines: readonly NormalizedPricedLine[] }
	| { readonly ok: false; readonly missingCode: string };

/**
 * Validates and normalizes commercial line items against the Item Matrix catalog and optional BIM
 * takeoff buckets so no free-text codes or units enter commercial records.
 */
export function resolveCatalogLines(input: {
	readonly lines: readonly PricedLineInput[];
	readonly matrixByCode: ReadonlyMap<string, CatalogItemRef>;
	readonly bimBuckets?: readonly BimTakeoffBucketRef[] | null | undefined;
}): ResolveCatalogLinesResult {
	const bimByKey = new Map((input.bimBuckets ?? []).map((b) => [b.asset_key, b] as const));
	const normalized: NormalizedPricedLine[] = [];

	for (const raw of input.lines) {
		const codeKey = (raw.code ?? '').trim();
		const catalog = codeKey ? input.matrixByCode.get(codeKey) : undefined;
		if (!catalog) return { ok: false, missingCode: codeKey || '(empty)' };

		const bimBucket = raw.bim_asset_key?.trim()
			? bimByKey.get(raw.bim_asset_key.trim())
			: undefined;
		const source: 'bim_asset' | 'adhoc_catalog' =
			catalog.category === 'bim_asset' ? 'bim_asset' : 'adhoc_catalog';
		const storey = bimBucket?.storey ?? raw.storey ?? null;
		const bimAssetKey = bimBucket?.asset_key ?? raw.bim_asset_key ?? null;
		const bimExpressIds = bimBucket?.sample_express_ids?.length
			? [...bimBucket.sample_express_ids]
			: raw.bim_express_ids?.length
				? [...raw.bim_express_ids]
				: null;
		const description = bimBucket
			? `${bimBucket.classification} (${bimBucket.storey})`
			: storey != null && source === 'bim_asset'
				? `${catalog.name} (${storey})`
				: catalog.name;
		const qty = toDecimal(raw.qty);
		const rate = toDecimal(raw.unit_rate);
		normalized.push({
			source,
			code: catalog.code,
			...(bimAssetKey !== null ? { bim_asset_key: bimAssetKey } : {}),
			...(storey !== null ? { storey } : {}),
			...(bimExpressIds !== null ? { bim_express_ids: bimExpressIds } : {}),
			description,
			unit: catalog.unit,
			qty: formatTrimmed(qty, 3),
			unit_rate: moneyStr(rate),
			amount: moneyStr(roundHalf(BigDecimal.multiply(qty, rate), 2))
		});
	}
	return { ok: true, lines: normalized };
}
