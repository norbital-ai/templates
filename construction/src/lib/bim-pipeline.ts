/**
 * Pure TypeScript BIM takeoff candidate ranking and exact `BigDecimal` Item Matrix pricing.
 *
 * 1. The browser streams the IFC (`bim-step-stream.ts`) into unique asset archetypes and `(archetype, storey)` buckets,
 *    measures every element from its geometry, merges archetypes that are one asset (`bim-geometry.ts`) and pictures
 *    each one from four angles (`ifc-viewer/ifc_geometry_pass.ts`); the takeoff is stored on the project.
 * 2. `rankCandidateMatrixRules` & `describeArchetypeForAi` prepare bounded candidate catalogs (with
 *    `unknown_unseen_catalog` always offered first) for System 1 (`analyze_bim_file`).
 * 3. Exact `BigDecimal` pricing aggregates matched and unmatched buckets per storey with wastage and contingency.
 */
import { BigDecimal, Schema } from 'effect';
import {
	divSafe,
	formatTrimmed,
	moneyStr,
	pctOf,
	toDecimal,
	type DecimalLike
} from './commercial.js';
import {
	ASSET_CLASSES,
	createIfcStepStreamParser,
	extractFromParsedModel,
	type BimArchetype,
	type BimAssetRecord,
	type BimStoreyBucket,
	type ExtractedBimModel,
	type IfcStreamStats,
	type ParsedIfcModel
} from './bim-step-stream.js';

export {
	ASSET_CLASSES,
	createIfcStepStreamParser,
	extractFromParsedModel,
	type BimArchetype,
	type BimAssetRecord,
	type BimStoreyBucket,
	type ExtractedBimModel,
	type IfcStreamStats,
	type ParsedIfcModel
};

/** A stored takeoff as the page writes it and the pricing automation reads it back. */
export const ExtractedBimModelSchema = Schema.Struct({
	schema: Schema.String,
	project_name: Schema.NullOr(Schema.String),
	storeys: Schema.Array(Schema.String),
	total_asset_count: Schema.Number,
	archetypes: Schema.Array(
		Schema.Struct({
			archetype_id: Schema.String,
			representative_express_id: Schema.Number,
			representative_part_ids: Schema.Array(Schema.Number),
			ifc_class: Schema.String,
			family: Schema.String,
			type_name: Schema.NullOr(Schema.String),
			object_type: Schema.NullOr(Schema.String),
			predefined_type: Schema.NullOr(Schema.String),
			operation_type: Schema.NullOr(Schema.String),
			classification_code: Schema.NullOr(Schema.String),
			classification_name: Schema.NullOr(Schema.String),
			materials: Schema.Array(Schema.String),
			material_layers: Schema.Array(Schema.String),
			layer_count: Schema.Number,
			properties: Schema.Array(Schema.String),
			sample_names: Schema.Array(Schema.String),
			total_count: Schema.Number,
			has_length: Schema.Boolean,
			has_area: Schema.Boolean,
			has_volume: Schema.Boolean,
			has_weight: Schema.Boolean,
			visual_file: Schema.optionalKey(Schema.String),
			signature: Schema.optionalKey(Schema.String)
		})
	),
	buckets: Schema.Array(
		Schema.Struct({
			archetype_id: Schema.String,
			storey: Schema.String,
			element_count: Schema.Number,
			length_m: Schema.Number,
			length_measured_count: Schema.Number,
			area_m2: Schema.Number,
			area_measured_count: Schema.Number,
			volume_m3: Schema.Number,
			volume_measured_count: Schema.Number,
			weight_kg: Schema.Number,
			weight_measured_count: Schema.Number,
			sample_express_ids: Schema.Array(Schema.Number),
			element_ids: Schema.optionalKey(Schema.Array(Schema.Number))
		})
	),
	assemblies: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(Schema.Number)))
});

const ZERO = BigDecimal.fromBigInt(0n);
const HUNDRED = BigDecimal.fromBigInt(100n);

export type MatrixItem = {
	readonly code: string;
	readonly name: string;
	readonly category: 'bim_asset' | 'additional_cost';
	readonly discipline: string;
	readonly trade_specialty: string | null;
	readonly ifc_classes: readonly string[];
	readonly match_keywords: readonly string[];
	readonly unit: string;
	readonly quantity_basis:
		'count' | 'length' | 'area' | 'volume' | 'weight' | 'lump_sum' | 'pct_of_bim' | 'derived';
	/** For `derived`: the item whose priced quantity this one follows, the units per its unit, and what it stands in for. */
	readonly derived_from?: string | null;
	readonly ratio?: DecimalLike | null;
	readonly stands_in_for?: string | null;
	readonly currency: string;
	readonly unit_rate: DecimalLike;
	readonly waste_factor_pct: DecimalLike;
	/** Embodied carbon per one `unit`, in kgCO2e. */
	readonly carbon_factor: DecimalLike;
	readonly active: boolean;
	readonly notes?: string | null;
};

export type MatchMethod = 'rule' | 'ai_sys1' | 'ai_sys2' | 'override';

export const UNKNOWN_CATALOG_CHOICE = 'unknown_unseen_catalog' as const;

export type ArchetypeDecision = {
	readonly matrix_code: string | null;
	readonly method: MatchMethod;
	readonly confidence: number;
	readonly reason: string;
};

export type BimTakeoffLine = {
	readonly asset_key: string;
	readonly ifc_class: string;
	readonly classification: string;
	readonly discipline: string;
	readonly storey: string;
	readonly element_count: number;
	readonly measured_qty: string;
	readonly unit: string;
	readonly quantity_basis: string;
	readonly matrix_code?: string | null;
	readonly unit_rate: string;
	readonly waste_factor_pct: string;
	readonly priced_qty: string;
	readonly amount: string;
	/** kgCO2e per unit, copied from the matrix item. */
	readonly carbon_factor: string;
	/** `priced_qty` × `carbon_factor`, in kgCO2e. */
	readonly carbon: string;
	readonly status: 'matched' | 'unmatched' | 'rate_missing' | 'override';
	readonly match_method?: MatchMethod | null;
	readonly match_confidence?: number | null;
	readonly match_reason?: string | null;
	readonly sample_express_ids?: readonly number[] | null;
};

export type BimCostEstimateResult = {
	readonly bim_asset_count: number;
	readonly archetype_count: number;
	readonly classified_asset_count: number;
	readonly ai_classified_count: number;
	readonly unmatched_asset_count: number;
	readonly bim_assets: readonly BimTakeoffLine[];
	readonly bim_subtotal: string;
	readonly contingency_amount: string;
	readonly total_estimate: string;
};

export function inferDiscipline(ifcClass: string, text: string): string {
	const u = `${ifcClass} ${text}`.toUpperCase();
	if (
		u.includes('FLOW') ||
		u.includes('ELECTRIC') ||
		u.includes('LIGHT') ||
		u.includes('RECEPTACLE') ||
		u.includes('SWITCH') ||
		u.includes('PANEL') ||
		u.includes('PIPE') ||
		u.includes('DUCT') ||
		u.includes('CABLE') ||
		u.includes('SMOKE') ||
		u.includes('SPRINKLER') ||
		u.includes('FIRESUPPRESSION') ||
		u.includes('ALARM') ||
		u.includes('SENSOR') ||
		u.includes('VALVE') ||
		u.includes('PUMP') ||
		u.includes('FAN') ||
		u.includes('CHILLER') ||
		u.includes('HVAC') ||
		u.includes('ACMV') ||
		u.includes('SANITARY') ||
		u.includes('DISTRIBUTION') ||
		u.includes('TRANSPORT') ||
		u.includes('LIFT') ||
		u.includes('ELEVATOR')
	) {
		return 'mep';
	}
	if (
		u.includes('COLUMN') ||
		u.includes('BEAM') ||
		u.includes('FOOTING') ||
		u.includes('PILE') ||
		u.includes('SLAB') ||
		u.includes('REINFORC') ||
		u.includes('SHEAR') ||
		u.includes('PRECAST')
	) {
		return 'structural';
	}
	if (
		u.includes('SITE') ||
		u.includes('CIVIL') ||
		u.includes('GEOGRAPHIC') ||
		u.includes('PAVEMENT') ||
		u.includes('KERB') ||
		u.includes('ROAD') ||
		u.includes('EARTH') ||
		u.includes('PLAYGROUND') ||
		u.includes('LANDSCAP') ||
		u.includes('EPDM') ||
		u.includes('DRAIN')
	) {
		return 'civil';
	}
	return 'architecture';
}

/**
 * Parses an ISO-10303-21 IFC STEP text into structured building/MEP assets using the streaming
 * zero-regex STEP scanner.
 */
export function parseIfcStep(text: string): ParsedIfcModel {
	const parser = createIfcStepStreamParser();
	parser.push(text);
	return parser.finishFull();
}

function normalizeSearchText(parts: readonly (string | null | undefined)[]): string {
	return parts
		.filter((p): p is string => p != null && p.length > 0)
		.join(' ')
		.toLowerCase()
		.replace(/[_:/\\-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function tokenize(text: string): Set<string> {
	const tokens = new Set<string>();
	for (const part of text.split(/[^a-z0-9]+/)) {
		if (part.length >= 2) tokens.add(part);
	}
	return tokens;
}

function archetypeHaystack(arch: BimArchetype): {
	readonly raw: string;
	readonly normalized: string;
} {
	const parts = [
		arch.ifc_class,
		arch.family,
		arch.type_name ?? '',
		arch.object_type ?? '',
		arch.predefined_type ?? '',
		arch.operation_type ?? '',
		arch.classification_code ?? '',
		arch.classification_name ?? '',
		...arch.material_layers,
		...arch.materials,
		...arch.properties,
		...arch.sample_names
	];
	return {
		raw: parts.join(' ').toLowerCase(),
		normalized: normalizeSearchText(parts)
	};
}

/**
 * Selects the top `maxCandidates` active `bim_asset` Item Matrix rules most relevant to one or
 * more BIM archetypes, keeping System 1 (`<= 255` choices) focused and fast even when a
 * workspace carries hundreds of Item Matrix items.
 */
export function rankCandidateMatrixRules(
	archetypes: readonly BimArchetype[],
	rules: readonly MatrixItem[],
	maxCandidates: number
): readonly MatrixItem[] {
	// a derived item is never what an element is: it follows another item's quantity
	const activeBim = rules.filter(
		(r) => r.active && r.category === 'bim_asset' && r.quantity_basis !== 'derived'
	);
	if (activeBim.length <= maxCandidates) return activeBim;

	const batchClasses = new Set(archetypes.map((a) => a.ifc_class));
	const batchDisciplines = new Set(
		archetypes.map((a) =>
			inferDiscipline(
				a.ifc_class,
				`${a.family} ${a.type_name ?? ''} ${a.operation_type ?? ''} ${a.materials.join(' ')} ${a.sample_names.join(' ')}`
			)
		)
	);
	const batchTokens = new Set<string>();
	for (const a of archetypes) {
		for (const tok of tokenize(archetypeHaystack(a).normalized)) {
			batchTokens.add(tok);
		}
	}

	const scored = activeBim.map((rule) => {
		let score = 0;
		const ruleClasses = rule.ifc_classes.map((c) => c.trim().toUpperCase());
		for (const c of ruleClasses) {
			if (batchClasses.has(c)) score += 20;
		}
		if (batchDisciplines.has(rule.discipline)) score += 6;
		const ruleText = normalizeSearchText([
			rule.code,
			rule.name,
			rule.discipline,
			rule.trade_specialty ?? '',
			...rule.match_keywords,
			rule.notes ?? ''
		]);
		for (const tok of tokenize(ruleText)) {
			if (batchTokens.has(tok)) score += 3;
		}
		return { rule, score };
	});

	scored.sort((a, b) => b.score - a.score || a.rule.code.localeCompare(b.rule.code));
	return scored.slice(0, maxCandidates).map((entry) => entry.rule);
}

/** Builds a compact, information-dense textual description of one BIM archetype for System 1. */
export function describeArchetypeForAi(arch: BimArchetype): string {
	const qtys: string[] = ['count'];
	if (arch.has_length) qtys.push('length(m)');
	if (arch.has_area) qtys.push('area(m2)');
	if (arch.has_volume) qtys.push('volume(m3)');
	if (arch.has_weight) qtys.push('weight(kg)');

	const parts: string[] = [
		`class=${arch.ifc_class}`,
		`family="${arch.family}"`,
		...(arch.type_name && arch.type_name !== arch.family ? [`type="${arch.type_name}"`] : []),
		...(arch.object_type && arch.object_type !== arch.family && arch.object_type !== arch.type_name
			? [`object_type="${arch.object_type}"`]
			: []),
		...(arch.operation_type ? [`operation=${arch.operation_type}`] : []),
		...(arch.predefined_type ? [`predefined=${arch.predefined_type}`] : []),
		...(arch.classification_code || arch.classification_name
			? [
					`classification="${[arch.classification_code, arch.classification_name].filter(Boolean).join(' ')}"`
				]
			: []),
		...(arch.material_layers.length > 0
			? [`layers(${arch.layer_count})=[${arch.material_layers.join(' | ')}]`]
			: arch.materials.length > 0
				? [`materials=[${arch.materials.join(', ')}]`]
				: []),
		...(arch.properties.length > 0 ? [`props=[${arch.properties.join('; ')}]`] : []),
		...(arch.sample_names.length > 0 ? [`samples=[${arch.sample_names.join(' | ')}]`] : []),
		`instances=${arch.total_count}`,
		`measured=[${qtys.join(',')}]`
	];
	return parts.join(', ');
}

/** A bucket's quantity on an item's basis: what was measured, never a stand-in for an element without one. */
function measureBucket(bucket: BimStoreyBucket, basis: MatrixItem['quantity_basis']): number {
	switch (basis) {
		case 'length':
			return bucket.length_m;
		case 'area':
			return bucket.area_m2;
		case 'volume':
			return bucket.volume_m3;
		case 'weight':
			return bucket.weight_kg;
		default:
			return bucket.element_count;
	}
}

/** How many of a bucket's elements the basis measured. */
function measuredOf(bucket: BimStoreyBucket, basis: MatrixItem['quantity_basis']): number {
	switch (basis) {
		case 'length':
			return bucket.length_measured_count;
		case 'area':
			return bucket.area_measured_count;
		case 'volume':
			return bucket.volume_measured_count;
		case 'weight':
			return bucket.weight_measured_count;
		default:
			return bucket.element_count;
	}
}

/**
 * Prices an `ExtractedBimModel` against the active currency-matched `item_matrix` using
 * System 1 archetype decisions (no Tier 1 keyword rule bypass), computing exact `BigDecimal`
 * amounts, wastage, and contingency for the project's single BIM cost estimate.
 */
export function buildBimCostEstimateFromExtracted(input: {
	readonly extracted: ExtractedBimModel;
	readonly matrix: readonly MatrixItem[];
	readonly currency: string;
	readonly ai_decisions?: Readonly<Record<string, ArchetypeDecision>>;
	readonly contingency_pct?: DecimalLike;
}): BimCostEstimateResult {
	const targetCurrency = input.currency.trim().toUpperCase();
	const activeCurrencyMatrix = input.matrix.filter(
		(r) => r.active && r.currency.trim().toUpperCase() === targetCurrency
	);
	const ruleByCode = new Map(
		activeCurrencyMatrix.filter((r) => r.category === 'bim_asset').map((r) => [r.code, r] as const)
	);

	// Resolve one System 1 decision per unique archetype (matched catalog rule or explicit unknown_unseen_catalog)
	const archetypeById = new Map(
		input.extracted.archetypes.map((a) => [a.archetype_id, a] as const)
	);
	const decisions = new Map<string, { rule: MatrixItem | null; decision: ArchetypeDecision }>();
	for (const arch of input.extracted.archetypes) {
		const ai = input.ai_decisions?.[arch.archetype_id];
		if (ai === undefined) continue;
		const rule = ai.matrix_code !== null ? (ruleByCode.get(ai.matrix_code) ?? null) : null;
		decisions.set(arch.archetype_id, { rule, decision: ai });
	}

	const grouped = new Map<
		string,
		{
			ifc_class: string;
			classification: string;
			discipline: string;
			storey: string;
			element_count: number;
			measured_qty: BigDecimal.BigDecimal;
			unit: string;
			quantity_basis: string;
			matrix_code: string | null;
			unit_rate: DecimalLike;
			waste_factor_pct: DecimalLike;
			carbon_factor: DecimalLike;
			status: 'matched' | 'unmatched' | 'rate_missing';
			match_method: MatchMethod | null;
			match_confidence: number | null;
			match_reason: string | null;
			express_ids: number[];
			unmeasured: number;
		}
	>();

	let classifiedCount = 0;
	let aiClassifiedCount = 0;
	let unmatchedCount = 0;

	for (const bucket of input.extracted.buckets) {
		const arch = archetypeById.get(bucket.archetype_id);
		if (arch === undefined) continue;

		const resolved = decisions.get(arch.archetype_id);
		const rule = resolved?.rule ?? null;
		const decision = resolved?.decision ?? null;

		if (rule !== null) {
			classifiedCount += bucket.element_count;
			if (decision !== null && decision.method === 'ai_sys1') {
				aiClassifiedCount += bucket.element_count;
			}
		} else {
			unmatchedCount += bucket.element_count;
		}

		const basis = rule?.quantity_basis ?? 'count';
		const qty = toDecimal(measureBucket(bucket, basis));
		const unmeasured = bucket.element_count - measuredOf(bucket, basis);
		const key = rule
			? `${rule.code}::${bucket.storey}`
			: `UNMATCHED::${arch.archetype_id}::${bucket.storey}`;

		const rate = rule ? toDecimal(rule.unit_rate) : ZERO;
		const status: 'matched' | 'unmatched' | 'rate_missing' =
			rule === null ? 'unmatched' : BigDecimal.isPositive(rate) ? 'matched' : 'rate_missing';

		const existing = grouped.get(key);
		if (existing !== undefined) {
			existing.element_count += bucket.element_count;
			existing.unmeasured += unmeasured;
			existing.measured_qty = BigDecimal.sum(existing.measured_qty, qty);
			for (const eid of bucket.sample_express_ids) {
				if (existing.express_ids.length >= 25) break;
				existing.express_ids.push(eid);
			}
		} else {
			const label = rule
				? rule.name
				: `${arch.type_name ?? arch.family} (${decision !== null ? 'Unknown / Unseen Catalog' : 'Unclassified'})`;
			grouped.set(key, {
				ifc_class: arch.ifc_class,
				classification: label,
				discipline: rule
					? rule.discipline
					: inferDiscipline(
							arch.ifc_class,
							`${arch.family} ${arch.type_name ?? ''} ${arch.materials.join(' ')}`
						),
				storey: bucket.storey,
				element_count: bucket.element_count,
				measured_qty: qty,
				unit: rule ? rule.unit : 'ea',
				quantity_basis: basis,
				matrix_code: rule ? rule.code : null,
				unit_rate: rule ? rule.unit_rate : '0',
				waste_factor_pct: rule ? rule.waste_factor_pct : '0',
				carbon_factor: rule ? rule.carbon_factor : '0',
				status,
				match_method: decision?.method ?? null,
				match_confidence: decision !== null ? Math.round(decision.confidence * 100) / 100 : null,
				match_reason: decision?.reason ?? null,
				express_ids: bucket.sample_express_ids.slice(0, 25),
				unmeasured
			});
		}
	}

	// what the model does not carry, from what it does, storey by storey: unmodelled rebar from priced concrete, say;
	// on a storey where the model carries the item it stands in for, nothing is derived so nothing counts twice
	const storeys = [...new Set([...grouped.values()].map((g) => g.storey))];
	for (const rule of activeCurrencyMatrix) {
		if (rule.category !== 'bim_asset' || rule.quantity_basis !== 'derived' || !rule.derived_from)
			continue;
		const ratio = toDecimal(rule.ratio ?? '0');
		if (!BigDecimal.isPositive(ratio)) continue;
		for (const storey of storeys) {
			const source = grouped.get(`${rule.derived_from}::${storey}`);
			if (source === undefined || !BigDecimal.isPositive(source.measured_qty)) continue;
			const modelled = rule.stands_in_for
				? grouped.get(`${rule.stands_in_for}::${storey}`)
				: undefined;
			if (modelled !== undefined && BigDecimal.isPositive(modelled.measured_qty)) continue;
			const rate = toDecimal(rule.unit_rate);
			grouped.set(`${rule.code}::${storey}`, {
				ifc_class: '',
				classification: rule.name,
				discipline: rule.discipline,
				storey,
				element_count: 0,
				measured_qty: BigDecimal.multiply(source.measured_qty, ratio),
				unit: rule.unit,
				quantity_basis: 'derived',
				matrix_code: rule.code,
				unit_rate: rule.unit_rate,
				waste_factor_pct: rule.waste_factor_pct,
				carbon_factor: rule.carbon_factor,
				status: BigDecimal.isPositive(rate) ? 'matched' : 'rate_missing',
				match_method: 'rule',
				match_confidence: null,
				match_reason: `Derived: ${formatTrimmed(ratio, 4)} ${rule.unit} per ${source.unit} of ${rule.derived_from}${rule.stands_in_for ? ` (${rule.stands_in_for} is not modelled on this storey)` : ''}.`,
				express_ids: [],
				unmeasured: 0
			});
		}
	}

	let bimSubtotal = ZERO;
	const bimAssets: BimTakeoffLine[] = [...grouped.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([assetKey, g]) => {
			const measuredDec = g.measured_qty;
			const wastePct = BigDecimal.max(ZERO, toDecimal(g.waste_factor_pct));
			const multiplier = BigDecimal.sum(BigDecimal.fromBigInt(1n), divSafe(wastePct, HUNDRED));
			const pricedQtyDec = BigDecimal.multiply(measuredDec, multiplier);
			const rateDec = toDecimal(g.unit_rate);
			const amountDec = BigDecimal.round(BigDecimal.multiply(pricedQtyDec, rateDec), {
				scale: 2,
				mode: 'half-from-zero'
			});
			bimSubtotal = BigDecimal.sum(bimSubtotal, amountDec);
			const carbonFactor = BigDecimal.max(ZERO, toDecimal(g.carbon_factor));
			const carbon = BigDecimal.multiply(pricedQtyDec, carbonFactor);
			return {
				asset_key: assetKey,
				ifc_class: g.ifc_class,
				classification: g.classification,
				discipline: g.discipline,
				storey: g.storey,
				element_count: g.element_count,
				measured_qty: formatTrimmed(measuredDec, 3),
				unit: g.unit,
				quantity_basis: g.quantity_basis,
				matrix_code: g.matrix_code,
				unit_rate: moneyStr(rateDec),
				waste_factor_pct: formatTrimmed(wastePct, 1),
				priced_qty: formatTrimmed(pricedQtyDec, 3),
				amount: moneyStr(amountDec),
				carbon_factor: formatTrimmed(carbonFactor, 3),
				carbon: formatTrimmed(carbon, 2),
				status: g.status,
				...(g.match_method !== null ? { match_method: g.match_method } : {}),
				...(g.match_confidence !== null ? { match_confidence: g.match_confidence } : {}),
				...(g.match_reason !== null || g.unmeasured > 0
					? {
							match_reason: [
								g.match_reason,
								g.unmeasured > 0
									? `${g.unmeasured} of ${g.element_count} elements have no measurable ${g.quantity_basis}; they are not priced.`
									: null
							]
								.filter(Boolean)
								.join(' ')
						}
					: {}),
				sample_express_ids: g.express_ids
			};
		});

	const contingencyPct = BigDecimal.max(ZERO, toDecimal(input.contingency_pct ?? '0'));
	const contingencyAmount = pctOf(bimSubtotal, contingencyPct);
	const totalEstimate = BigDecimal.sum(bimSubtotal, contingencyAmount);

	return {
		bim_asset_count: input.extracted.total_asset_count,
		archetype_count: input.extracted.archetypes.length,
		classified_asset_count: classifiedCount,
		ai_classified_count: aiClassifiedCount,
		unmatched_asset_count: unmatchedCount,
		bim_assets: bimAssets,
		bim_subtotal: moneyStr(bimSubtotal),
		contingency_amount: moneyStr(contingencyAmount),
		total_estimate: moneyStr(totalEstimate)
	};
}

/**
 * Classifies every asset in a `ParsedIfcModel` against the quantifiable `item_matrix`
 * (convenience wrapper over `extractFromParsedModel` + `buildBimCostEstimateFromExtracted`).
 */
export function buildBimCostEstimate(input: {
	readonly parsed: ParsedIfcModel;
	readonly matrix: readonly MatrixItem[];
	readonly currency: string;
	readonly ai_decisions?: Readonly<Record<string, ArchetypeDecision>>;
	readonly contingency_pct?: DecimalLike;
}): BimCostEstimateResult {
	return buildBimCostEstimateFromExtracted({
		extracted: extractFromParsedModel(input.parsed),
		matrix: input.matrix,
		currency: input.currency,
		...(input.ai_decisions ? { ai_decisions: input.ai_decisions } : {}),
		...(input.contingency_pct !== undefined ? { contingency_pct: input.contingency_pct } : {})
	});
}

/** Recomputes money and embodied-carbon totals on a `cost_estimates` row whenever `bim_assets` or `contingency_pct` change. */
export function recomputeCostEstimateTotals(input: {
	readonly bim_assets: readonly BimTakeoffLine[] | null | undefined;
	readonly contingency_pct: DecimalLike;
}): {
	readonly bim_asset_count: number;
	readonly classified_asset_count: number;
	readonly unmatched_asset_count: number;
	readonly bim_assets: readonly BimTakeoffLine[] | null;
	readonly bim_subtotal: string;
	readonly contingency_amount: string;
	readonly total_estimate: string;
	readonly carbon_total: string;
} {
	let bimAssetCount = 0;
	let classifiedCount = 0;
	let unmatchedCount = 0;
	let bimSubtotal = ZERO;
	let carbonTotal = ZERO;

	const normalizedBim = input.bim_assets?.map((line) => {
		bimAssetCount += line.element_count;
		if (line.status === 'unmatched' || line.status === 'rate_missing') {
			unmatchedCount += line.element_count;
		} else {
			classifiedCount += line.element_count;
		}
		const measured = toDecimal(line.measured_qty);
		const wastePct = BigDecimal.max(ZERO, toDecimal(line.waste_factor_pct));
		const pricedQty = BigDecimal.multiply(
			measured,
			BigDecimal.sum(BigDecimal.fromBigInt(1n), divSafe(wastePct, HUNDRED))
		);
		const rate = toDecimal(line.unit_rate);
		const amount = BigDecimal.round(BigDecimal.multiply(pricedQty, rate), {
			scale: 2,
			mode: 'half-from-zero'
		});
		bimSubtotal = BigDecimal.sum(bimSubtotal, amount);
		const carbonFactor = BigDecimal.max(ZERO, toDecimal(line.carbon_factor));
		const carbon = BigDecimal.multiply(pricedQty, carbonFactor);
		carbonTotal = BigDecimal.sum(carbonTotal, carbon);
		return {
			...line,
			measured_qty: formatTrimmed(measured, 3),
			waste_factor_pct: formatTrimmed(wastePct, 1),
			priced_qty: formatTrimmed(pricedQty, 3),
			unit_rate: moneyStr(rate),
			amount: moneyStr(amount),
			carbon_factor: formatTrimmed(carbonFactor, 3),
			carbon: formatTrimmed(carbon, 2)
		};
	});

	const contingencyPct = BigDecimal.max(ZERO, toDecimal(input.contingency_pct));
	const contingencyAmount = pctOf(bimSubtotal, contingencyPct);
	const totalEstimate = BigDecimal.sum(bimSubtotal, contingencyAmount);

	return {
		bim_asset_count: bimAssetCount,
		classified_asset_count: classifiedCount,
		unmatched_asset_count: unmatchedCount,
		bim_assets: normalizedBim ?? null,
		bim_subtotal: moneyStr(bimSubtotal),
		contingency_amount: moneyStr(contingencyAmount),
		total_estimate: moneyStr(totalEstimate),
		carbon_total: formatTrimmed(carbonTotal, 2)
	};
}
