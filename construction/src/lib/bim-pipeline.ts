/**
 * Pure TypeScript BIM IFC takeoff, archetype classification, candidate matrix ranking, and exact
 * `BigDecimal` Costing Matrix pricing pipeline.
 *
 * Designed for both small server-parsed IFCs (<= 8 MiB) and huge browser-streamed multi-storey
 * federated BIM models (e.g., 18-storey HDB + playground + MEP, 50–500+ MiB):
 * 1. Streaming IFC STEP parser (`bim-step-stream.ts`) skips ~95% geometry lines and collapses
 *    100k+ instances into compact unique asset archetypes + `(archetype, storey)` buckets.
 * 2. Tier 1 deterministic matching resolves exact classification-code, IFC-class + keyword, and
 *    unambiguous class-only matrix rules in microseconds.
 * 3. `rankCandidateMatrixRules` & `describeArchetypeForAi` prepare bounded, high-signal batches
 *    for Bolt's System 1 (`ctx.ai.sys_1.decide`) and System 2 (`ctx.ai.sys_2.infer`) classifiers.
 * 4. Exact `BigDecimal` pricing aggregates matched & unmatched buckets per storey with wastage,
 *    non-BIM additional costings, and contingency.
 */
import { BigDecimal } from 'effect';
import {
	computeLinesTotals,
	divSafe,
	formatTrimmed,
	moneyStr,
	pctOf,
	toDecimal,
	type DecimalLike,
	type NormalizedPricedLine,
	type PricedLineInput
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

const ZERO = BigDecimal.fromBigInt(0n);
const HUNDRED = BigDecimal.fromBigInt(100n);
const STREAM_CHUNK_BYTES = 2 * 1024 * 1024;

export type CostMatrixRule = {
	readonly code: string;
	readonly name: string;
	readonly category: 'bim_asset' | 'additional_cost';
	readonly discipline: string;
	readonly trade_specialty: string | null;
	readonly ifc_classes: readonly string[];
	readonly match_keywords: readonly string[];
	readonly unit: string;
	readonly quantity_basis:
		'count' | 'length' | 'area' | 'volume' | 'weight' | 'lump_sum' | 'pct_of_bim';
	readonly currency: string;
	readonly unit_rate: DecimalLike;
	readonly waste_factor_pct: DecimalLike;
	readonly active: boolean;
	readonly notes?: string | null;
};

export type MatchMethod = 'rule' | 'ai_sys1' | 'ai_sys2' | 'override';

export type ArchetypeDecision = {
	readonly matrix_code: string;
	readonly method: 'rule' | 'ai_sys1' | 'ai_sys2';
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
	readonly additional_costs: readonly NormalizedPricedLine[];
	readonly bim_subtotal: string;
	readonly additional_subtotal: string;
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

/**
 * Streams an IFC STEP string or `Uint8Array` in bounded 2 MiB slices directly into a compact
 * bucketed `ExtractedBimModel` (archetypes + per-storey quantity rollups).
 */
export function parseIfcStepToExtracted(input: string | Uint8Array): ExtractedBimModel {
	const parser = createIfcStepStreamParser();
	if (typeof input === 'string') {
		const sliceChars = STREAM_CHUNK_BYTES;
		for (let offset = 0; offset < input.length; offset += sliceChars) {
			parser.push(input.slice(offset, offset + sliceChars));
		}
	} else {
		for (let offset = 0; offset < input.byteLength; offset += STREAM_CHUNK_BYTES) {
			parser.push(input.subarray(offset, offset + STREAM_CHUNK_BYTES));
		}
	}
	return parser.finish();
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
		arch.classification_code ?? '',
		arch.classification_name ?? '',
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
 * Tier 1 deterministic classification of one unique BIM archetype against active currency-matched
 * `cost_matrix` rules.
 *
 * Rules with explicit `match_keywords` require at least one keyword hit (against normalized text
 * so `Fire-Rated` matches `fire rated`). A catch-all class-only rule (no `match_keywords`) matches
 * deterministically ONLY when no keyword-specialized rules compete for that same IFC class; if
 * specialized rules exist for that class and none hit, the archetype is left for Tier 2/3 AI so
 * the model can semantically disambiguate instead of blindly falling into a generic bucket.
 */
export function matchArchetypeDeterministic(
	archetype: BimArchetype,
	rules: readonly CostMatrixRule[]
): ArchetypeDecision | null {
	const bimRules = rules.filter((r) => r.active && r.category === 'bim_asset');
	if (bimRules.length === 0) return null;

	const { raw, normalized } = archetypeHaystack(archetype);
	const clsCode = archetype.classification_code?.trim().toLowerCase() ?? null;

	// Track whether any keyword-specialized rule targets this archetype's exact IFC class
	const hasSpecializedClassRule = bimRules.some((r) => {
		const classes = r.ifc_classes.map((c) => c.trim().toUpperCase()).filter(Boolean);
		const keywords = r.match_keywords.map((k) => k.trim()).filter(Boolean);
		return classes.includes(archetype.ifc_class) && keywords.length > 0;
	});

	let best: { rule: CostMatrixRule; score: number; reason: string } | null = null;
	for (const rule of bimRules) {
		const classes = rule.ifc_classes.map((c) => c.trim().toUpperCase()).filter(Boolean);
		const classMatch = classes.length === 0 || classes.includes(archetype.ifc_class);
		if (!classMatch) continue;

		const keywords = rule.match_keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
		let kwHits = 0;
		const matchedKws: string[] = [];
		for (const kw of keywords) {
			const normKw = kw
				.replace(/[_:/\\-]+/g, ' ')
				.replace(/\s+/g, ' ')
				.trim();
			if (raw.includes(kw) || (normKw.length > 0 && normalized.includes(normKw))) {
				kwHits++;
				if (matchedKws.length < 3) matchedKws.push(kw);
			}
		}

		// Exact Uniclass / Uniformat / CP83 classification code or matrix code match
		const codeHit =
			clsCode !== null &&
			clsCode.length >= 3 &&
			(rule.code.toLowerCase() === clsCode ||
				keywords.some((kw) => kw === clsCode || clsCode.includes(kw)));

		if (keywords.length > 0 && kwHits === 0 && !codeHit) continue;
		if (keywords.length === 0 && classes.length === 0) continue;
		// Defer generic class-only catch-all to AI when specialized keyword rules exist for the class
		if (keywords.length === 0 && hasSpecializedClassRule) continue;

		const score =
			(codeHit ? 30 : 0) +
			(classes.length > 0 ? 10 : 0) +
			kwHits * 5 +
			(keywords.length > 0 ? 2 : 0);
		if (best === null || score > best.score) {
			const reason = codeHit
				? `Matched classification code ${archetype.classification_code} to ${rule.code}`
				: matchedKws.length > 0
					? `Matched ${archetype.ifc_class} + keywords (${matchedKws.join(', ')})`
					: `Matched IFC class ${archetype.ifc_class}`;
			best = { rule, score, reason };
		}
	}

	if (best === null) return null;
	return {
		matrix_code: best.rule.code,
		method: 'rule',
		confidence: best.score >= 17 ? 0.98 : 0.9,
		reason: best.reason
	};
}

/**
 * Selects the top `maxCandidates` active `bim_asset` Costing Matrix rules most relevant to a batch
 * of BIM archetypes, keeping System 1 (`<= 255` choices) and System 2 prompts focused and fast
 * even when a workspace carries hundreds of Costing Matrix items.
 */
export function rankCandidateMatrixRules(
	archetypes: readonly BimArchetype[],
	rules: readonly CostMatrixRule[],
	maxCandidates: number
): readonly CostMatrixRule[] {
	const activeBim = rules.filter((r) => r.active && r.category === 'bim_asset');
	if (activeBim.length <= maxCandidates) return activeBim;

	const batchClasses = new Set(archetypes.map((a) => a.ifc_class));
	const batchDisciplines = new Set(
		archetypes.map((a) =>
			inferDiscipline(
				a.ifc_class,
				`${a.family} ${a.type_name ?? ''} ${a.materials.join(' ')} ${a.sample_names.join(' ')}`
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

/** Builds a compact, information-dense textual description of one BIM archetype for AI classification. */
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
		...(arch.predefined_type ? [`predefined=${arch.predefined_type}`] : []),
		...(arch.classification_code || arch.classification_name
			? [
					`classification="${[arch.classification_code, arch.classification_name].filter(Boolean).join(' ')}"`
				]
			: []),
		...(arch.materials.length > 0 ? [`materials=[${arch.materials.join(', ')}]`] : []),
		...(arch.properties.length > 0 ? [`props=[${arch.properties.join('; ')}]`] : []),
		...(arch.sample_names.length > 0 ? [`samples=[${arch.sample_names.join(' | ')}]`] : []),
		`instances=${arch.total_count}`,
		`measured=[${qtys.join(',')}]`
	];
	return parts.join(', ');
}

function measureBucket(bucket: BimStoreyBucket, basis: CostMatrixRule['quantity_basis']): number {
	switch (basis) {
		case 'length':
			return bucket.length_m + Math.max(0, bucket.element_count - bucket.length_measured_count);
		case 'area':
			return bucket.area_m2 + Math.max(0, bucket.element_count - bucket.area_measured_count);
		case 'volume':
			return bucket.volume_m3 + Math.max(0, bucket.element_count - bucket.volume_measured_count);
		case 'weight':
			return bucket.weight_kg + Math.max(0, bucket.element_count - bucket.weight_measured_count);
		default:
			return bucket.element_count;
	}
}

/**
 * Classifies and prices an `ExtractedBimModel` against the active currency-matched `cost_matrix`,
 * combining Tier 1 deterministic rules with optional Tier 2/3 AI archetype decisions, computing
 * exact `BigDecimal` amounts, wastage, non-BIM additional costings, and contingency.
 */
export function buildBimCostEstimateFromExtracted(input: {
	readonly extracted: ExtractedBimModel;
	readonly matrix: readonly CostMatrixRule[];
	readonly currency: string;
	readonly ai_decisions?: Readonly<Record<string, ArchetypeDecision>>;
	readonly existing_additional_costs?: readonly PricedLineInput[] | null;
	readonly contingency_pct?: DecimalLike;
}): BimCostEstimateResult {
	const targetCurrency = input.currency.trim().toUpperCase();
	const activeCurrencyMatrix = input.matrix.filter(
		(r) => r.active && r.currency.trim().toUpperCase() === targetCurrency
	);
	const ruleByCode = new Map(
		activeCurrencyMatrix.filter((r) => r.category === 'bim_asset').map((r) => [r.code, r] as const)
	);

	// Resolve one decision per unique archetype (deterministic first, then AI decision if valid)
	const archetypeById = new Map(
		input.extracted.archetypes.map((a) => [a.archetype_id, a] as const)
	);
	const decisions = new Map<string, { rule: CostMatrixRule; decision: ArchetypeDecision }>();
	for (const arch of input.extracted.archetypes) {
		const deterministic = matchArchetypeDeterministic(arch, activeCurrencyMatrix);
		if (deterministic !== null) {
			const rule = ruleByCode.get(deterministic.matrix_code);
			if (rule !== undefined) {
				decisions.set(arch.archetype_id, { rule, decision: deterministic });
				continue;
			}
		}
		const ai = input.ai_decisions?.[arch.archetype_id];
		if (ai !== undefined) {
			const rule = ruleByCode.get(ai.matrix_code);
			if (rule !== undefined) {
				decisions.set(arch.archetype_id, { rule, decision: ai });
			}
		}
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
			status: 'matched' | 'unmatched' | 'rate_missing';
			match_method: MatchMethod | null;
			match_confidence: number | null;
			match_reason: string | null;
			express_ids: number[];
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
			if (decision !== null && (decision.method === 'ai_sys1' || decision.method === 'ai_sys2')) {
				aiClassifiedCount += bucket.element_count;
			}
		} else {
			unmatchedCount += bucket.element_count;
		}

		const basis = rule?.quantity_basis ?? 'count';
		const qty = toDecimal(measureBucket(bucket, basis));
		const key = rule
			? `${rule.code}::${bucket.storey}`
			: `UNMATCHED::${arch.ifc_class}::${arch.family}::${bucket.storey}`;

		const rate = rule ? toDecimal(rule.unit_rate) : ZERO;
		const status: 'matched' | 'unmatched' | 'rate_missing' =
			rule === null ? 'unmatched' : BigDecimal.isPositive(rate) ? 'matched' : 'rate_missing';

		const existing = grouped.get(key);
		if (existing !== undefined) {
			existing.element_count += bucket.element_count;
			existing.measured_qty = BigDecimal.sum(existing.measured_qty, qty);
			for (const eid of bucket.sample_express_ids) {
				if (existing.express_ids.length >= 25) break;
				existing.express_ids.push(eid);
			}
			// Keep AI provenance visible if any merged archetype was AI-matched
			if (
				existing.match_method === 'rule' &&
				decision !== null &&
				(decision.method === 'ai_sys1' || decision.method === 'ai_sys2')
			) {
				existing.match_method = decision.method;
				existing.match_confidence = decision.confidence;
				existing.match_reason = decision.reason;
			}
		} else {
			const label = rule ? rule.name : `${arch.type_name ?? arch.family} (Unclassified)`;
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
				status,
				match_method: decision?.method ?? null,
				match_confidence: decision !== null ? Math.round(decision.confidence * 100) / 100 : null,
				match_reason: decision?.reason ?? null,
				express_ids: bucket.sample_express_ids.slice(0, 25)
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
				status: g.status,
				...(g.match_method !== null ? { match_method: g.match_method } : {}),
				...(g.match_confidence !== null ? { match_confidence: g.match_confidence } : {}),
				...(g.match_reason !== null ? { match_reason: g.match_reason } : {}),
				sample_express_ids: g.express_ids
			};
		});

	// Populate additional (non-BIM) costings from existing user edits OR default active additional_cost matrix rules
	const additionalInputs: readonly PricedLineInput[] =
		input.existing_additional_costs && input.existing_additional_costs.length > 0
			? input.existing_additional_costs
			: activeCurrencyMatrix
					.filter((r) => r.category === 'additional_cost')
					.map((r) => {
						if (r.quantity_basis === 'pct_of_bim') {
							const computedPctAmt = pctOf(bimSubtotal, toDecimal(r.unit_rate));
							return {
								code: r.code,
								description: `${r.name} (${formatTrimmed(toDecimal(r.unit_rate), 1)}% of BIM)`,
								unit: 'ls',
								qty: '1',
								unit_rate: moneyStr(computedPctAmt)
							};
						}
						return {
							code: r.code,
							description: r.name,
							unit: r.unit,
							qty: '1',
							unit_rate: moneyStr(toDecimal(r.unit_rate))
						};
					});

	const additionalTotals = computeLinesTotals(additionalInputs, '0');
	const additionalSubtotal = toDecimal(additionalTotals.subtotal);
	const combined = BigDecimal.sum(bimSubtotal, additionalSubtotal);
	const contingencyPct = BigDecimal.max(ZERO, toDecimal(input.contingency_pct ?? '0'));
	const contingencyAmount = pctOf(combined, contingencyPct);
	const totalEstimate = BigDecimal.sum(combined, contingencyAmount);

	return {
		bim_asset_count: input.extracted.total_asset_count,
		archetype_count: input.extracted.archetypes.length,
		classified_asset_count: classifiedCount,
		ai_classified_count: aiClassifiedCount,
		unmatched_asset_count: unmatchedCount,
		bim_assets: bimAssets,
		additional_costs: additionalTotals.lines,
		bim_subtotal: moneyStr(bimSubtotal),
		additional_subtotal: moneyStr(additionalSubtotal),
		contingency_amount: moneyStr(contingencyAmount),
		total_estimate: moneyStr(totalEstimate)
	};
}

/**
 * Classifies every asset in a `ParsedIfcModel` against the quantifiable `cost_matrix`
 * (convenience wrapper over `extractFromParsedModel` + `buildBimCostEstimateFromExtracted`).
 */
export function buildBimCostEstimate(input: {
	readonly parsed: ParsedIfcModel;
	readonly matrix: readonly CostMatrixRule[];
	readonly currency: string;
	readonly ai_decisions?: Readonly<Record<string, ArchetypeDecision>>;
	readonly existing_additional_costs?: readonly PricedLineInput[] | null;
	readonly contingency_pct?: DecimalLike;
}): BimCostEstimateResult {
	return buildBimCostEstimateFromExtracted({
		extracted: extractFromParsedModel(input.parsed),
		matrix: input.matrix,
		currency: input.currency,
		...(input.ai_decisions ? { ai_decisions: input.ai_decisions } : {}),
		...(input.existing_additional_costs !== undefined
			? { existing_additional_costs: input.existing_additional_costs }
			: {}),
		...(input.contingency_pct !== undefined ? { contingency_pct: input.contingency_pct } : {})
	});
}

/** Recomputes totals on a `cost_estimates` row whenever `bim_assets`, `additional_costs`, or `contingency_pct` change. */
export function recomputeCostEstimateTotals(input: {
	readonly bim_assets: readonly BimTakeoffLine[] | null | undefined;
	readonly additional_costs: readonly PricedLineInput[] | null | undefined;
	readonly contingency_pct: DecimalLike;
}): {
	readonly bim_asset_count: number;
	readonly classified_asset_count: number;
	readonly unmatched_asset_count: number;
	readonly bim_assets: readonly BimTakeoffLine[] | null;
	readonly additional_costs: readonly NormalizedPricedLine[] | null;
	readonly bim_subtotal: string;
	readonly additional_subtotal: string;
	readonly contingency_amount: string;
	readonly total_estimate: string;
} {
	let bimAssetCount = 0;
	let classifiedCount = 0;
	let unmatchedCount = 0;
	let bimSubtotal = ZERO;

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
		return {
			...line,
			measured_qty: formatTrimmed(measured, 3),
			waste_factor_pct: formatTrimmed(wastePct, 1),
			priced_qty: formatTrimmed(pricedQty, 3),
			unit_rate: moneyStr(rate),
			amount: moneyStr(amount)
		};
	});

	const hasAdditional = input.additional_costs != null && input.additional_costs.length > 0;
	const addTotals = hasAdditional ? computeLinesTotals(input.additional_costs, '0') : null;
	const additionalSubtotal = addTotals ? toDecimal(addTotals.subtotal) : ZERO;
	const combined = BigDecimal.sum(bimSubtotal, additionalSubtotal);
	const contingencyPct = BigDecimal.max(ZERO, toDecimal(input.contingency_pct));
	const contingencyAmount = pctOf(combined, contingencyPct);
	const totalEstimate = BigDecimal.sum(combined, contingencyAmount);

	return {
		bim_asset_count: bimAssetCount,
		classified_asset_count: classifiedCount,
		unmatched_asset_count: unmatchedCount,
		bim_assets: normalizedBim ?? null,
		additional_costs: addTotals ? addTotals.lines : null,
		bim_subtotal: moneyStr(bimSubtotal),
		additional_subtotal: moneyStr(additionalSubtotal),
		contingency_amount: moneyStr(contingencyAmount),
		total_estimate: moneyStr(totalEstimate)
	};
}
