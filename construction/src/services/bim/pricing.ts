/**
 * Pure BIM candidate catalog ranking and exact Effect `BigDecimal` Item Matrix pricing & BOQ totals.
 */
import { BigDecimal } from 'effect';
import {
	HUNDRED,
	ONE,
	ZERO,
	divSafe,
	formatTrimmed,
	moneyStr,
	nonNegative,
	pctOf,
	roundHalf,
	toDecimal,
	type DecimalLike
} from '../commercial/decimal.js';
import type {
	ArchetypeDecision,
	BimArchetype,
	BimCostEstimateResult,
	BimSettingsRow,
	BimStoreyBucket,
	BimTakeoffLine,
	ExtractedBimModel,
	MatchMethod,
	MatrixItem,
	ParsedIfcModel
} from './schema.js';
import { extractFromParsedModel } from './step-parser.js';

const MEP_RE =
	/FLOW|ELECTRIC|LIGHT|RECEPTACLE|SWITCH|PANEL|PIPE|DUCT|CABLE|SMOKE|SPRINKLER|FIRESUPPRESSION|ALARM|SENSOR|VALVE|PUMP|FAN|CHILLER|BOILER|HVAC|HYDRONIC|ACMV|SANITARY|NATURAL_GAS|DOMESTIC_|DISTRIBUTION|TRANSPORT|LIFT|ELEVATOR/;
const STRUCT_RE = /COLUMN|BEAM|FOOTING|PILE|SLAB|REINFORC|SHEAR|PRECAST/;
const CIVIL_RE = /SITE|CIVIL|GEOGRAPHIC|PAVEMENT|KERB|ROAD|EARTH|PLAYGROUND|LANDSCAP|EPDM|DRAIN/;

export function inferDiscipline(ifcClass: string, text: string): string {
	const u = `${ifcClass} ${text}`.toUpperCase();
	if (MEP_RE.test(u)) return 'mep';
	if (STRUCT_RE.test(u)) return 'structural';
	if (CIVIL_RE.test(u)) return 'civil';
	return 'architecture';
}

const normalizeText = (parts: readonly (string | null | undefined)[]) =>
	parts
		.filter((p): p is string => Boolean(p))
		.join(' ')
		.toLowerCase()
		.replace(/[_:/\\-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const tokenize = (text: string) =>
	new Set(text.split(/[^a-z0-9]+/).filter((part) => part.length >= 2));

function archetypeTokens(arch: BimArchetype): Set<string> {
	return tokenize(
		normalizeText([
			arch.ifc_class,
			arch.original_ifc_class,
			arch.continuity,
			arch.service,
			arch.size_band,
			...(arch.connected_equipment ?? []),
			arch.family,
			arch.type_name,
			arch.object_type,
			arch.predefined_type,
			arch.operation_type,
			arch.classification_code,
			arch.classification_name,
			...arch.material_layers,
			...arch.materials,
			...arch.properties,
			...arch.sample_names
		])
	);
}

/** Class-first candidate ranker for System 1 bounded choice selection. */
export function rankCandidateMatrixRules(
	archetypes: readonly BimArchetype[],
	rules: readonly MatrixItem[],
	maxCandidates: number
): readonly MatrixItem[] {
	const activeBim = rules.filter(
		(r) => r.active && r.category === 'bim_asset' && r.quantity_basis !== 'derived'
	);
	if (activeBim.length === 0) return [];
	if (archetypes.length === 0) return activeBim.slice(0, Math.max(1, maxCandidates));

	const canonicalClasses = new Set<string>();
	const originalClasses = new Set<string>();
	const batchServices = new Set<string>();
	const batchSizes: number[] = [];
	const batchContinuities = new Set<string>();
	const batchDisciplines = new Set<string>();
	const batchTokens = new Set<string>();
	let anyInsulated = false,
		anyUninsulated = false,
		hasProxy = false;

	for (const a of archetypes) {
		const cls = a.ifc_class.trim().toUpperCase();
		canonicalClasses.add(cls);
		if (cls === 'IFCBUILDINGELEMENTPROXY') hasProxy = true;
		if (a.original_ifc_class) originalClasses.add(a.original_ifc_class.trim().toUpperCase());
		if (a.service) batchServices.add(a.service.trim().toLowerCase());
		if (a.nominal_size_mm != null && Number.isFinite(a.nominal_size_mm) && a.nominal_size_mm > 0)
			batchSizes.push(a.nominal_size_mm);
		if (a.continuity) batchContinuities.add(a.continuity);
		if (a.insulated) anyInsulated = true;
		else anyUninsulated = true;
		batchDisciplines.add(
			inferDiscipline(
				a.ifc_class,
				`${a.service ?? ''} ${a.family} ${a.type_name ?? ''} ${a.operation_type ?? ''} ${a.materials.join(' ')} ${a.sample_names.join(' ')}`
			)
		);
		for (const tok of archetypeTokens(a)) batchTokens.add(tok);
	}

	return activeBim
		.map((rule) => {
			let score = 0;
			const ruleClasses = rule.ifc_classes.map((c) => c.trim().toUpperCase());
			if (ruleClasses.some((c) => canonicalClasses.has(c))) score += 50;
			else if (ruleClasses.some((c) => originalClasses.has(c))) score += 35;
			else if (ruleClasses.length > 0 && !hasProxy) score -= 25;

			if (batchDisciplines.has(rule.discipline)) score += 6;
			const ruleServices = (rule.system_services ?? [])
				.map((s) => s.trim().toLowerCase())
				.filter(Boolean);
			if (ruleServices.length > 0 && batchServices.size > 0) {
				score += ruleServices.some((s) => batchServices.has(s)) ? 32 : -28;
			}
			const minSz = rule.min_size_mm ?? null,
				maxSz = rule.max_size_mm ?? null;
			if ((minSz != null || maxSz != null) && batchSizes.length > 0) {
				score += batchSizes.some(
					(sz) => (minSz == null || sz >= minSz - 0.5) && (maxSz == null || sz <= maxSz + 0.5)
				)
					? 22
					: -22;
			}
			if (rule.insulated === 'insulated') score += anyInsulated ? 12 : -14;
			else if (rule.insulated === 'uninsulated') score += anyUninsulated ? 12 : -14;
			if (rule.topology_mode && rule.topology_mode !== 'auto' && batchContinuities.size > 0) {
				score += batchContinuities.has(rule.topology_mode) ? 12 : -10;
			}
			for (const tok of tokenize(
				normalizeText([
					rule.code,
					rule.name,
					rule.discipline,
					rule.trade_specialty,
					...ruleServices,
					...rule.match_keywords,
					rule.notes
				])
			)) {
				if (batchTokens.has(tok)) score += 3;
			}
			return { rule, score };
		})
		.sort((a, b) => b.score - a.score || a.rule.code.localeCompare(b.rule.code))
		.slice(0, Math.max(1, maxCandidates))
		.map((e) => e.rule);
}

export function describeArchetypeForAi(arch: BimArchetype): string {
	const qtys = [
		'count',
		...(arch.has_length ? ['length(m)'] : []),
		...(arch.has_area ? ['area(m2)'] : []),
		...(arch.has_volume ? ['volume(m3)'] : []),
		...(arch.has_weight ? ['weight(kg)'] : [])
	];
	return [
		arch.original_ifc_class && arch.original_ifc_class !== arch.ifc_class
			? `class=${arch.ifc_class} (cleaned from ${arch.original_ifc_class})`
			: `class=${arch.ifc_class}`,
		...(arch.continuity ? [`continuity=${arch.continuity}`] : []),
		...(arch.service ? [`service=${arch.service}`] : []),
		...(arch.size_band || arch.nominal_size_mm != null
			? [`size=${arch.size_band ?? `${Math.round(arch.nominal_size_mm ?? 0)}mm`}`]
			: []),
		...(arch.insulated ? ['insulated=yes'] : []),
		...(arch.connected_equipment?.length
			? [`connected_to=[${arch.connected_equipment.join(' | ')}]`]
			: []),
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
	].join(', ');
}

function priceLineCalc(
	measured: BigDecimal.BigDecimal,
	wasteRaw: DecimalLike,
	rateRaw: DecimalLike,
	carbonFactorRaw: DecimalLike
) {
	const waste = nonNegative(toDecimal(wasteRaw));
	const pricedQty = BigDecimal.multiply(measured, BigDecimal.sum(ONE, divSafe(waste, HUNDRED)));
	const rate = toDecimal(rateRaw);
	const amount = roundHalf(BigDecimal.multiply(pricedQty, rate), 2);
	const carbonFactor = nonNegative(toDecimal(carbonFactorRaw));
	const carbon = BigDecimal.multiply(pricedQty, carbonFactor);
	return { waste, pricedQty, rate, amount, carbonFactor, carbon };
}

const bucketQty = (b: BimStoreyBucket, basis: MatrixItem['quantity_basis']): [number, number] =>
	basis === 'length'
		? [b.length_m, b.length_measured_count]
		: basis === 'area'
			? [b.area_m2, b.area_measured_count]
			: basis === 'volume'
				? [b.volume_m3, b.volume_measured_count]
				: basis === 'weight'
					? [b.weight_kg, b.weight_measured_count]
					: [b.element_count, b.element_count];

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
	const archetypeById = new Map(
		input.extracted.archetypes.map((a) => [a.archetype_id, a] as const)
	);

	type GroupAcc = {
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
		warnings: string[];
		express_ids: number[];
		unmeasured: number;
	};
	const grouped = new Map<string, GroupAcc>();
	let classifiedCount = 0,
		aiClassifiedCount = 0,
		unmatchedCount = 0;

	for (const bucket of input.extracted.buckets) {
		const arch = archetypeById.get(bucket.archetype_id);
		if (!arch) continue;
		const decision = input.ai_decisions?.[arch.archetype_id] ?? null;
		const rule = decision?.matrix_code ? (ruleByCode.get(decision.matrix_code) ?? null) : null;

		if (rule) {
			classifiedCount += bucket.element_count;
			if (decision?.method === 'ai_sys1') aiClassifiedCount += bucket.element_count;
		} else {
			unmatchedCount += bucket.element_count;
		}

		const basis = rule?.quantity_basis ?? 'count';
		const [rawQty, measuredCount] = bucketQty(bucket, basis);
		const qty = toDecimal(rawQty);
		const unmeasured = bucket.element_count - measuredCount;
		const key = rule
			? `${rule.code}::${bucket.storey}`
			: `UNMATCHED::${arch.archetype_id}::${bucket.storey}`;
		const existing = grouped.get(key);

		if (existing) {
			existing.element_count += bucket.element_count;
			existing.unmeasured += unmeasured;
			existing.measured_qty = BigDecimal.sum(existing.measured_qty, qty);
			if (bucket.quantity_warning && !existing.warnings.includes(bucket.quantity_warning))
				existing.warnings.push(bucket.quantity_warning);
			for (const eid of bucket.sample_express_ids) {
				if (existing.express_ids.length >= 25) break;
				existing.express_ids.push(eid);
			}
		} else {
			const serviceSuffix =
				!rule && arch.service
					? ` · ${arch.service}${arch.size_band ? ` (${arch.size_band})` : ''}`
					: '';
			grouped.set(key, {
				ifc_class: arch.ifc_class,
				classification: rule
					? rule.name
					: `${arch.type_name ?? arch.family}${serviceSuffix} (${decision ? 'Unknown / Unseen Catalog' : 'Unclassified'})`,
				discipline: rule
					? rule.discipline
					: inferDiscipline(
							arch.ifc_class,
							`${arch.service ?? ''} ${arch.family} ${arch.type_name ?? ''} ${arch.materials.join(' ')}`
						),
				storey: bucket.storey,
				element_count: bucket.element_count,
				measured_qty: qty,
				unit: rule ? rule.unit : 'ea',
				quantity_basis: basis,
				matrix_code: rule?.code ?? null,
				unit_rate: rule?.unit_rate ?? '0',
				waste_factor_pct: rule?.waste_factor_pct ?? '0',
				carbon_factor: rule?.carbon_factor ?? '0',
				status: !rule
					? 'unmatched'
					: BigDecimal.isPositive(toDecimal(rule.unit_rate))
						? 'matched'
						: 'rate_missing',
				match_method: decision?.method ?? null,
				match_confidence: decision ? Math.round(decision.confidence * 100) / 100 : null,
				match_reason: decision?.reason ?? null,
				warnings: bucket.quantity_warning ? [bucket.quantity_warning] : [],
				express_ids: bucket.sample_express_ids.slice(0, 25),
				unmeasured
			});
		}
	}

	const storeys = [...new Set([...grouped.values()].map((g) => g.storey))];
	for (const rule of activeCurrencyMatrix) {
		if (rule.category !== 'bim_asset' || rule.quantity_basis !== 'derived' || !rule.derived_from)
			continue;
		const ratio = toDecimal(rule.ratio ?? '0');
		if (!BigDecimal.isPositive(ratio)) continue;
		for (const storey of storeys) {
			const source = grouped.get(`${rule.derived_from}::${storey}`);
			if (!source || !BigDecimal.isPositive(source.measured_qty)) continue;
			const modelled = rule.stands_in_for
				? grouped.get(`${rule.stands_in_for}::${storey}`)
				: undefined;
			if (modelled && BigDecimal.isPositive(modelled.measured_qty)) continue;
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
				status: BigDecimal.isPositive(toDecimal(rule.unit_rate)) ? 'matched' : 'rate_missing',
				match_method: 'rule',
				match_confidence: null,
				match_reason: `Derived: ${formatTrimmed(ratio, 4)} ${rule.unit} per ${source.unit} of ${rule.derived_from}${rule.stands_in_for ? ` (${rule.stands_in_for} is not modelled on this storey)` : ''}.`,
				warnings: [],
				express_ids: [],
				unmeasured: 0
			});
		}
	}

	let bimSubtotal = ZERO;
	const bimAssets: BimTakeoffLine[] = [...grouped.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([assetKey, g]) => {
			const c = priceLineCalc(g.measured_qty, g.waste_factor_pct, g.unit_rate, g.carbon_factor);
			bimSubtotal = BigDecimal.sum(bimSubtotal, c.amount);
			const reasons = [
				g.match_reason,
				g.unmeasured > 0
					? `${g.unmeasured} of ${g.element_count} elements have no measurable ${g.quantity_basis}; they are not priced.`
					: null,
				...g.warnings
			].filter((s): s is string => Boolean(s));
			return {
				asset_key: assetKey,
				ifc_class: g.ifc_class,
				classification: g.classification,
				discipline: g.discipline,
				storey: g.storey,
				element_count: g.element_count,
				measured_qty: formatTrimmed(g.measured_qty, 3),
				unit: g.unit,
				quantity_basis: g.quantity_basis,
				matrix_code: g.matrix_code,
				unit_rate: moneyStr(c.rate),
				waste_factor_pct: formatTrimmed(c.waste, 1),
				priced_qty: formatTrimmed(c.pricedQty, 3),
				amount: moneyStr(c.amount),
				carbon_factor: formatTrimmed(c.carbonFactor, 3),
				carbon: formatTrimmed(c.carbon, 2),
				status: g.status,
				...(g.match_method ? { match_method: g.match_method } : {}),
				...(g.match_confidence !== null ? { match_confidence: g.match_confidence } : {}),
				...(reasons.length > 0 ? { match_reason: reasons.join(' · ') } : {}),
				sample_express_ids: g.express_ids
			};
		});

	const contingencyAmount = pctOf(
		bimSubtotal,
		nonNegative(toDecimal(input.contingency_pct ?? '0'))
	);
	return {
		bim_asset_count: input.extracted.total_asset_count,
		archetype_count: input.extracted.archetypes.length,
		classified_asset_count: classifiedCount,
		ai_classified_count: aiClassifiedCount,
		unmatched_asset_count: unmatchedCount,
		bim_assets: bimAssets,
		bim_subtotal: moneyStr(bimSubtotal),
		contingency_amount: moneyStr(contingencyAmount),
		total_estimate: moneyStr(BigDecimal.sum(bimSubtotal, contingencyAmount))
	};
}

export function buildBimCostEstimate(input: {
	readonly parsed: ParsedIfcModel;
	readonly matrix: readonly MatrixItem[];
	readonly currency: string;
	readonly ai_decisions?: Readonly<Record<string, ArchetypeDecision>>;
	readonly contingency_pct?: DecimalLike;
	readonly config?: BimSettingsRow | null;
}): BimCostEstimateResult {
	return buildBimCostEstimateFromExtracted({
		extracted: extractFromParsedModel(input.parsed, input.config),
		matrix: input.matrix,
		currency: input.currency,
		...(input.ai_decisions ? { ai_decisions: input.ai_decisions } : {}),
		...(input.contingency_pct !== undefined ? { contingency_pct: input.contingency_pct } : {})
	});
}

export function recomputeCostEstimateTotals(input: {
	readonly bim_assets: readonly BimTakeoffLine[] | null | undefined;
	readonly contingency_pct: DecimalLike;
}) {
	let bimAssetCount = 0,
		classifiedCount = 0,
		unmatchedCount = 0;
	let bimSubtotal = ZERO,
		carbonTotal = ZERO;

	const normalizedBim = input.bim_assets?.map((line) => {
		bimAssetCount += line.element_count;
		if (line.status === 'unmatched' || line.status === 'rate_missing')
			unmatchedCount += line.element_count;
		else classifiedCount += line.element_count;
		const measured = toDecimal(line.measured_qty);
		const c = priceLineCalc(measured, line.waste_factor_pct, line.unit_rate, line.carbon_factor);
		bimSubtotal = BigDecimal.sum(bimSubtotal, c.amount);
		carbonTotal = BigDecimal.sum(carbonTotal, c.carbon);
		return {
			...line,
			measured_qty: formatTrimmed(measured, 3),
			waste_factor_pct: formatTrimmed(c.waste, 1),
			priced_qty: formatTrimmed(c.pricedQty, 3),
			unit_rate: moneyStr(c.rate),
			amount: moneyStr(c.amount),
			carbon_factor: formatTrimmed(c.carbonFactor, 3),
			carbon: formatTrimmed(c.carbon, 2)
		};
	});

	const contingencyAmount = pctOf(bimSubtotal, nonNegative(toDecimal(input.contingency_pct)));
	return {
		bim_asset_count: bimAssetCount,
		classified_asset_count: classifiedCount,
		unmatched_asset_count: unmatchedCount,
		bim_assets: normalizedBim ?? null,
		bim_subtotal: moneyStr(bimSubtotal),
		contingency_amount: moneyStr(contingencyAmount),
		total_estimate: moneyStr(BigDecimal.sum(bimSubtotal, contingencyAmount)),
		carbon_total: formatTrimmed(carbonTotal, 2)
	};
}
