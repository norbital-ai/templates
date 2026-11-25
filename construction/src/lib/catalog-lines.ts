import { BigDecimal } from 'effect';
import {
	formatTrimmed,
	moneyStr,
	toDecimal,
	type NormalizedPricedLine,
	type PricedLineInput
} from './commercial.js';

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
 * Validates and normalizes commercial line items (SO, PO, VO, DO, Invoice, Claim) against the
 * Costing Matrix catalog and optional project BIM takeoff buckets so no free-text codes or units
 * can enter commercial records.
 */
export function resolveCatalogLines(input: {
	readonly lines: readonly PricedLineInput[];
	readonly matrixByCode: ReadonlyMap<string, CatalogItemRef>;
	readonly bimBuckets?: readonly BimTakeoffBucketRef[] | null | undefined;
}): ResolveCatalogLinesResult {
	const bimByKey = new Map<string, BimTakeoffBucketRef>();
	for (const b of input.bimBuckets ?? []) {
		bimByKey.set(b.asset_key, b);
	}

	const normalized: NormalizedPricedLine[] = [];
	for (const raw of input.lines) {
		const codeKey = (raw.code ?? '').trim();
		const catalog = codeKey.length > 0 ? input.matrixByCode.get(codeKey) : undefined;
		if (catalog === undefined) {
			return { ok: false, missingCode: codeKey || '(empty)' };
		}

		const bimBucket =
			raw.bim_asset_key != null && raw.bim_asset_key.trim().length > 0
				? bimByKey.get(raw.bim_asset_key.trim())
				: undefined;

		const source: 'bim_asset' | 'adhoc_catalog' =
			catalog.category === 'bim_asset' ? 'bim_asset' : 'adhoc_catalog';
		const storey = bimBucket?.storey ?? raw.storey ?? null;
		const bimAssetKey = bimBucket?.asset_key ?? raw.bim_asset_key ?? null;
		const bimExpressIds =
			bimBucket?.sample_express_ids && bimBucket.sample_express_ids.length > 0
				? [...bimBucket.sample_express_ids]
				: raw.bim_express_ids && raw.bim_express_ids.length > 0
					? [...raw.bim_express_ids]
					: null;

		const canonicalDesc =
			bimBucket !== undefined
				? `${bimBucket.classification} (${bimBucket.storey})`
				: storey != null && source === 'bim_asset'
					? `${catalog.name} (${storey})`
					: catalog.name;

		const qty = toDecimal(raw.qty);
		const rate = toDecimal(raw.unit_rate);
		const amount = BigDecimal.round(BigDecimal.multiply(qty, rate), {
			scale: 2,
			mode: 'half-from-zero'
		});

		normalized.push({
			source,
			code: catalog.code,
			...(bimAssetKey !== null ? { bim_asset_key: bimAssetKey } : {}),
			...(storey !== null ? { storey } : {}),
			...(bimExpressIds !== null ? { bim_express_ids: bimExpressIds } : {}),
			description: canonicalDesc,
			unit: catalog.unit,
			qty: formatTrimmed(qty, 3),
			unit_rate: moneyStr(rate),
			amount: moneyStr(amount)
		});
	}

	return { ok: true, lines: normalized };
}
