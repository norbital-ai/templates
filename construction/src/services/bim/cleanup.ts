/**
 * Automatic BIM cleanup & deduplication service:
 * 27-neighbor spatial duplicate elimination, O(N) MEP port/touch network service propagation,
 * generic proxy/segment/fitting promotion, multi-storey riser splitting, archetype merging,
 * and dimension-aware asset signatures.
 */
import {
	createServiceMatcher,
	defaultContinuityForClass,
	materialDensityOf,
	MEP_NETWORK_CLASSES,
	resolveBimConfig,
	snapSizeBandLabel
} from './config.js';
import {
	classFamily,
	geometricSizeMm,
	linearLengthOf,
	materialFamily,
	near,
	netAreaOf,
	sameShape,
	type ElementMeasure
} from './geometry.js';
import type {
	BimArchetype,
	BimAssetRecord,
	BimCleanupReport,
	BimConfig,
	BimSettingsRow,
	BimStoreyBucket,
	ContinuityMode,
	ExtractedBimModel
} from './schema.js';
import { aggregateResolvedAssets, UPGRADEABLE_GENERIC_CLASSES } from './step-parser.js';

const round = (n: number) => Number(n.toFixed(4));
const GENERIC_CLASSES = new Set(
	'IFCBUILDINGELEMENTPROXY IFCFURNISHINGELEMENT IFCFLOWTERMINAL IFCFLOWSEGMENT IFCFLOWFITTING IFCFLOWCONTROLLER IFCDISTRIBUTIONFLOWELEMENT'.split(
		' '
	)
);
const LINEAR_MEP_CLASSES = new Set(
	'IFCPIPESEGMENT IFCDUCTSEGMENT IFCCABLESEGMENT IFCCABLECARRIERSEGMENT IFCFLOWSEGMENT'.split(' ')
);
const FITTING_FOR_SEGMENT: Readonly<Record<string, string>> = {
	IFCPIPESEGMENT: 'IFCPIPEFITTING',
	IFCDUCTSEGMENT: 'IFCDUCTFITTING',
	IFCCABLESEGMENT: 'IFCCABLEFITTING',
	IFCCABLECARRIERSEGMENT: 'IFCCABLECARRIERFITTING'
};
const SEGMENT_FOR_FITTING: Readonly<Record<string, string>> = Object.fromEntries(
	Object.entries(FITTING_FOR_SEGMENT).map(([seg, fit]) => [fit, seg])
);
const ANCHOR_EQUIPMENT_CLASSES = new Set(
	'IFCBOILER IFCCHILLER IFCCOOLINGTOWER IFCHEATEXCHANGER IFCCONDENSER IFCEVAPORATOR IFCCOMPRESSOR IFCUNITARYEQUIPMENT IFCENERGYCONVERSIONDEVICE IFCPUMP IFCFAN IFCTANK IFCINTERCEPTOR IFCSANITARYTERMINAL IFCFIRESUPPRESSIONTERMINAL IFCAIRTERMINAL IFCELECTRICDISTRIBUTIONBOARD IFCELECTRICDISTRIBUTIONPOINT IFCLIGHTFIXTURE IFCOUTLET IFCSWITCHINGDEVICE IFCFLOWTERMINAL IFCFLOWMOVINGDEVICE IFCFLOWSTORAGEDEVICE IFCVALVE IFCFLOWCONTROLLER'.split(
		' '
	)
);

/** Resolves configured density (kg/m³) strictly from `config.material_densities`. */
const configuredDensityFor = (
	materials: readonly string[],
	layers: readonly string[],
	ifcClass: string,
	config: BimConfig
): number | null =>
	materialDensityOf([...materials, ...layers].map(materialFamily), ifcClass, config);

export function fillFromGeometry(
	extracted: ExtractedBimModel,
	measured: ReadonlyMap<number, ElementMeasure>,
	configInput?: BimSettingsRow | Partial<BimConfig> | null
): ExtractedBimModel {
	const config = resolveBimConfig(configInput);
	const densityByArch = new Map<string, number>();
	const continuityByArch = new Map<string, ContinuityMode>();
	for (const arch of extracted.archetypes) {
		continuityByArch.set(
			arch.archetype_id,
			arch.continuity ?? defaultContinuityForClass(arch.ifc_class)
		);
		const d = configuredDensityFor(arch.materials, arch.material_layers, arch.ifc_class, config);
		if (d !== null) densityByArch.set(arch.archetype_id, d);
	}

	const flags = new Map<
		string,
		{ length: boolean; area: boolean; volume: boolean; weight: boolean }
	>();
	const buckets = extracted.buckets.map((bucket): BimStoreyBucket => {
		let count = 0,
			length = 0,
			area = 0,
			volume = 0;
		const cont = continuityByArch.get(bucket.archetype_id) ?? 'discontiguous';
		for (const id of bucket.element_ids ?? []) {
			const m = measured.get(id);
			if (!m) continue;
			count += 1;
			length += cont === 'contiguous_linear' ? linearLengthOf(m) : m.extents[0];
			area += netAreaOf(m);
			volume += m.volume;
		}
		const density = densityByArch.get(bucket.archetype_id);
		const next: BimStoreyBucket = {
			...bucket,
			...(count > bucket.length_measured_count
				? { length_m: round(length), length_measured_count: count }
				: {}),
			...(count > bucket.area_measured_count
				? { area_m2: round(area), area_measured_count: count }
				: {}),
			...(count > bucket.volume_measured_count
				? { volume_m3: round(volume), volume_measured_count: count }
				: {}),
			...(density !== undefined && count > bucket.weight_measured_count
				? { weight_kg: round(volume * density), weight_measured_count: count }
				: {})
		};
		const f = flags.get(bucket.archetype_id) ?? {
			length: false,
			area: false,
			volume: false,
			weight: false
		};
		flags.set(bucket.archetype_id, {
			length: f.length || next.length_measured_count > 0,
			area: f.area || next.area_measured_count > 0,
			volume: f.volume || next.volume_measured_count > 0,
			weight: f.weight || next.weight_measured_count > 0
		});
		return next;
	});

	return {
		...extracted,
		archetypes: extracted.archetypes.map((a) => {
			const f = flags.get(a.archetype_id);
			return !f
				? a
				: {
						...a,
						has_length: a.has_length || f.length,
						has_area: a.has_area || f.area,
						has_volume: a.has_volume || f.volume,
						has_weight: a.has_weight || f.weight
					};
		}),
		buckets
	};
}

function identity(arch: BimArchetype, config: BimConfig) {
	const continuity = arch.continuity ?? defaultContinuityForClass(arch.ifc_class);
	const sizeBand =
		arch.size_band ?? snapSizeBandLabel(arch.nominal_size_mm ?? null, config.size_bands_mm) ?? '';
	return {
		generic: GENERIC_CLASSES.has(arch.ifc_class.toUpperCase()),
		continuity,
		kind: [
			classFamily(arch.ifc_class),
			continuity,
			arch.predefined_type ?? '',
			arch.operation_type ?? ''
		].join('|'),
		common: [
			(arch.service ?? '').toLowerCase(),
			sizeBand,
			arch.insulated ? 'ins' : '',
			[...new Set([...arch.materials, ...arch.material_layers].map(materialFamily))]
				.sort()
				.join('+'),
			arch.properties
				.filter(
					(p) =>
						!/^(reference|name|mark|tag|isexternal|system name|system type|size|diameter|nominal diameter|outer diameter|inner diameter)=/i.test(
							p
						)
				)
				.map((p) => p.toLowerCase())
				.sort()
				.join('+')
		].join('|')
	};
}

export function assetSignature(
	arch: BimArchetype,
	m: ElementMeasure | null | undefined,
	configInput?: BimSettingsRow | Partial<BimConfig> | null
): string {
	const config = resolveBimConfig(configInput);
	const who = identity(arch, config);
	const stepM = Math.max(0.005, config.size_band_step_mm / 1000);
	const quantMm = (metres: number) =>
		Math.round(metres / stepM) * Math.round(config.size_band_step_mm);

	if (who.continuity === 'contiguous_linear') {
		const sec =
			arch.size_band ??
			snapSizeBandLabel(
				arch.nominal_size_mm ?? (m ? geometricSizeMm(m, 'contiguous_linear') : null),
				config.size_bands_mm
			) ??
			(m ? `${quantMm(m.extents[1])}x${quantMm(m.extents[2])}` : '');
		return ['LIN', classFamily(arch.ifc_class), who.common, sec].join('|');
	}
	if (who.continuity === 'contiguous_planar') {
		const thick =
			arch.size_band ??
			snapSizeBandLabel(
				arch.nominal_size_mm ?? (m ? geometricSizeMm(m, 'contiguous_planar') : null),
				config.size_bands_mm
			) ??
			(m ? `${quantMm(m.extents[2])}mm` : '');
		return ['PLN', classFamily(arch.ifc_class), who.common, thick].join('|');
	}
	return [
		'DSC',
		who.generic && !arch.service ? 'GENERIC' : who.kind,
		who.common,
		m ? m.extents.map(quantMm).join('x') : ''
	].join('|');
}

export function mergeIdenticalArchetypes(
	extracted: ExtractedBimModel,
	measures: ReadonlyMap<string, ElementMeasure>,
	configInput?: BimSettingsRow | Partial<BimConfig> | null
): ExtractedBimModel {
	const config = resolveBimConfig(configInput);
	const tolRatio = config.shape_tolerance_pct / 100;
	const into = new Map<string, string>();
	const kept: {
		id: string;
		arch: BimArchetype;
		who: ReturnType<typeof identity>;
		m: ElementMeasure;
	}[] = [];

	for (const a of extracted.archetypes) {
		const m = measures.get(a.archetype_id);
		if (!m) continue;
		const who = identity(a, config);
		const same = kept.find((k) => {
			if (k.who.common !== who.common || k.who.continuity !== who.continuity) return false;
			if (k.who.kind !== who.kind && !k.who.generic && !who.generic) return false;
			if (
				a.max_riser_mm != null &&
				k.arch.max_riser_mm != null &&
				Math.abs(a.max_riser_mm - k.arch.max_riser_mm) > 3
			)
				return false;
			if (
				a.min_tread_mm != null &&
				k.arch.min_tread_mm != null &&
				Math.abs(a.min_tread_mm - k.arch.min_tread_mm) > 5
			)
				return false;
			if (
				a.max_slope_pct != null &&
				k.arch.max_slope_pct != null &&
				Math.abs(a.max_slope_pct - k.arch.max_slope_pct) > 0.3
			)
				return false;
			if (who.continuity === 'contiguous_linear') {
				return (
					near(k.m.extents[1], m.extents[1], 0.005, tolRatio) &&
					near(k.m.extents[2], m.extents[2], 0.005, tolRatio)
				);
			}
			if (who.continuity === 'contiguous_planar')
				return near(k.m.extents[2], m.extents[2], 0.01, tolRatio);
			return sameShape(k.m, m, tolRatio);
		});
		if (!same) kept.push({ id: a.archetype_id, arch: a, who, m });
		else into.set(a.archetype_id, same.id);
	}
	if (into.size === 0) return extracted;

	const archetypes = new Map(extracted.archetypes.map((a) => [a.archetype_id, a] as const));
	const minOpt = (a?: number | null, b?: number | null) =>
		a != null && b != null ? Math.min(a, b) : (a ?? b ?? null);
	const maxOpt = (a?: number | null, b?: number | null) =>
		a != null && b != null ? Math.max(a, b) : (a ?? b ?? null);

	for (const [dup, keep] of into) {
		const d = archetypes.get(dup),
			k = archetypes.get(keep);
		if (!d || !k) continue;
		const mW = minOpt(k.min_width_mm, d.min_width_mm);
		const mH = minOpt(k.min_height_mm, d.min_height_mm);
		const mT = minOpt(k.min_thickness_mm, d.min_thickness_mm);
		const xT = maxOpt(k.max_thickness_mm, d.max_thickness_mm);
		const xR = maxOpt(k.max_riser_mm, d.max_riser_mm);
		const mTr = minOpt(k.min_tread_mm, d.min_tread_mm);
		const xS = maxOpt(k.max_slope_pct, d.max_slope_pct);
		const nearMap = new Map<string, number>();
		for (const n of [...(k.nearby_archetypes ?? []), ...(d.nearby_archetypes ?? [])]) {
			const target = into.get(n.archetype_id) ?? n.archetype_id;
			if (target === keep) continue;
			const prev = nearMap.get(target);
			if (prev === undefined || n.min_dist_m < prev) nearMap.set(target, n.min_dist_m);
		}
		const mergedNear = [...nearMap.entries()]
			.sort((a, b) => a[1] - b[1])
			.slice(0, 8)
			.map(([archetype_id, min_dist_m]) => ({ archetype_id, min_dist_m }));
		archetypes.set(keep, {
			...k,
			...(mW !== null ? { min_width_mm: mW } : {}),
			...(mH !== null ? { min_height_mm: mH } : {}),
			...(mT !== null ? { min_thickness_mm: mT } : {}),
			...(xT !== null ? { max_thickness_mm: xT } : {}),
			...(xR !== null ? { max_riser_mm: xR } : {}),
			...(mTr !== null ? { min_tread_mm: mTr } : {}),
			...(xS !== null ? { max_slope_pct: xS } : {}),
			...(k.has_sgpset || d.has_sgpset ? { has_sgpset: true } : {}),
			...(k.dim_outlier_ids?.length || d.dim_outlier_ids?.length
				? {
						dim_outlier_ids: [
							...new Set([...(k.dim_outlier_ids ?? []), ...(d.dim_outlier_ids ?? [])])
						].slice(0, 12)
					}
				: {}),
			...(mergedNear.length > 0 ? { nearby_archetypes: mergedNear } : {}),
			total_count: k.total_count + d.total_count,
			sample_names: [...new Set([...k.sample_names, ...d.sample_names])].slice(0, 3),
			has_length: k.has_length || d.has_length,
			has_area: k.has_area || d.has_area,
			has_volume: k.has_volume || d.has_volume,
			has_weight: k.has_weight || d.has_weight
		});
		archetypes.delete(dup);
	}
	for (const [id, arch] of archetypes) {
		if (!arch.nearby_archetypes?.length) continue;
		const remapped = new Map<string, number>();
		for (const n of arch.nearby_archetypes) {
			const target = into.get(n.archetype_id) ?? n.archetype_id;
			if (target === id || !archetypes.has(target)) continue;
			const prev = remapped.get(target);
			if (prev === undefined || n.min_dist_m < prev) remapped.set(target, n.min_dist_m);
		}
		archetypes.set(id, {
			...arch,
			nearby_archetypes: [...remapped.entries()]
				.sort((a, b) => a[1] - b[1])
				.slice(0, 8)
				.map(([archetype_id, min_dist_m]) => ({ archetype_id, min_dist_m }))
		});
	}

	const buckets = new Map<string, BimStoreyBucket>();
	for (const b of extracted.buckets) {
		const archetype_id = into.get(b.archetype_id) ?? b.archetype_id;
		const key = `${archetype_id}::${b.storey}`;
		const h = buckets.get(key);
		buckets.set(
			key,
			!h
				? { ...b, archetype_id }
				: {
						...h,
						element_count: h.element_count + b.element_count,
						length_m: round(h.length_m + b.length_m),
						length_measured_count: h.length_measured_count + b.length_measured_count,
						area_m2: round(h.area_m2 + b.area_m2),
						area_measured_count: h.area_measured_count + b.area_measured_count,
						volume_m3: round(h.volume_m3 + b.volume_m3),
						volume_measured_count: h.volume_measured_count + b.volume_measured_count,
						weight_kg: round(h.weight_kg + b.weight_kg),
						weight_measured_count: h.weight_measured_count + b.weight_measured_count,
						sample_express_ids: [...h.sample_express_ids, ...b.sample_express_ids].slice(0, 10),
						element_ids: [...(h.element_ids ?? []), ...(b.element_ids ?? [])]
					}
		);
	}
	return { ...extracted, archetypes: [...archetypes.values()], buckets: [...buckets.values()] };
}

export function dropDuplicates(
	extracted: ExtractedBimModel,
	measured: ReadonlyMap<number, ElementMeasure>,
	configInput?: BimSettingsRow | Partial<BimConfig> | null
): {
	readonly extracted: ExtractedBimModel;
	readonly duplicates: number;
	readonly droppedIds: ReadonlySet<number>;
} {
	const config = resolveBimConfig(configInput);
	if (!config.auto_deduplicate) return { extracted, duplicates: 0, droppedIds: new Set() };
	const cell = Math.max(0.005, config.duplicate_center_tol_m);
	const tolSq = cell * cell;
	const tolRatio = config.shape_tolerance_pct / 100;
	const familyOf = new Map(
		extracted.archetypes.map((a) => [a.archetype_id, classFamily(a.ifc_class)] as const)
	);
	const grid = new Map<string, ElementMeasure[]>();
	const droppedIds = new Set<number>();
	let duplicates = 0;

	const isDup = (fam: string, m: ElementMeasure): boolean => {
		const gx = Math.floor(m.center[0] / cell),
			gy = Math.floor(m.center[1] / cell),
			gz = Math.floor(m.center[2] / cell);
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				for (let dz = -1; dz <= 1; dz++) {
					for (const other of grid.get(`${fam}|${gx + dx}|${gy + dy}|${gz + dz}`) ?? []) {
						const ddx = other.center[0] - m.center[0],
							ddy = other.center[1] - m.center[1],
							ddz = other.center[2] - m.center[2];
						if (ddx * ddx + ddy * ddy + ddz * ddz <= tolSq && sameShape(other, m, tolRatio))
							return true;
					}
				}
			}
		}
		const key = `${fam}|${gx}|${gy}|${gz}`;
		const list = grid.get(key);
		if (list) list.push(m);
		else grid.set(key, [m]);
		return false;
	};

	const buckets = extracted.buckets.map((bucket): BimStoreyBucket => {
		const ids = bucket.element_ids ?? [];
		const fam = familyOf.get(bucket.archetype_id) ?? 'UNKNOWN';
		const keep: number[] = [];
		for (const id of ids) {
			const m = measured.get(id);
			if (!m || !isDup(fam, m)) keep.push(id);
			else droppedIds.add(id);
		}
		const lost = ids.length - keep.length;
		if (lost === 0) return bucket;
		duplicates += lost;
		const keptSet = new Set(keep);
		return {
			...bucket,
			element_ids: keep,
			element_count: bucket.element_count - lost,
			sample_express_ids: bucket.sample_express_ids.filter((id) => keptSet.has(id)),
			length_m: 0,
			length_measured_count: 0,
			area_m2: 0,
			area_measured_count: 0,
			volume_m3: 0,
			volume_measured_count: 0,
			weight_kg: 0,
			weight_measured_count: 0
		};
	});

	return {
		extracted: {
			...extracted,
			total_asset_count: extracted.total_asset_count - duplicates,
			buckets: buckets.filter((b) => b.element_count > 0),
			archetypes: extracted.archetypes.map((a) => ({
				...a,
				total_count: buckets
					.filter((b) => b.archetype_id === a.archetype_id)
					.reduce((n, b) => n + b.element_count, 0)
			}))
		},
		duplicates,
		droppedIds
	};
}

/** Matches an anchor element's IFC class & metadata strictly against configured `service_aliases`. */
function inferAnchorService(
	elem: BimAssetRecord,
	matchService: (text: string) => string | null
): string | null {
	if (elem.service !== null) return elem.service;
	const text = [
		elem.ifc_class.replace(/^IFC/i, ''),
		elem.system_type,
		elem.system_name,
		elem.type_name,
		elem.family,
		elem.object_type,
		elem.name,
		elem.classification_name
	]
		.filter(Boolean)
		.join(' ');
	return matchService(text);
}

/** Derives linear IFC4 class from configured service name & aliases (works for any custom user service). */
function inferLinearClassFromService(service: string | null, config: BimConfig): string | null {
	if (!service) return null;
	const bag = `${service} ${(config.service_aliases[service] ?? []).join(' ')}`.toLowerCase();
	if (/\b(duct|ventilation|supply air|return air|exhaust air)\b/.test(bag)) return 'IFCDUCTSEGMENT';
	if (/\b(cable|conduit|electric|electrical|power|elv|telecom|data)\b/.test(bag))
		return 'IFCCABLESEGMENT';
	return 'IFCPIPESEGMENT';
}

const boundsTouch = (
	aMin: readonly [number, number, number],
	aMax: readonly [number, number, number],
	bMin: readonly [number, number, number],
	bMax: readonly [number, number, number],
	gap: number
): boolean =>
	aMin[0] - gap <= bMax[0] &&
	aMax[0] + gap >= bMin[0] &&
	aMin[1] - gap <= bMax[1] &&
	aMax[1] + gap >= bMin[1] &&
	aMin[2] - gap <= bMax[2] &&
	aMax[2] + gap >= bMin[2];

/** Builds O(N) port + spatial MEP network and computes service votes & connected anchor equipment. */
function buildMepNetwork(
	keptElements: readonly BimAssetRecord[],
	byId: ReadonlyMap<number, BimAssetRecord>,
	topologyEdges: readonly (readonly [number, number])[],
	measured: ReadonlyMap<number, ElementMeasure>,
	config: BimConfig,
	matchService: (text: string) => string | null
) {
	const adjacency = new Map<number, Set<number>>();
	const portEdges: [number, number][] = [];
	const spatialEdges: [number, number][] = [];
	const addEdge = (a: number, b: number, out: [number, number][]) => {
		if (a === b || !byId.has(a) || !byId.has(b)) return;
		let sa = adjacency.get(a);
		if (!sa) {
			sa = new Set();
			adjacency.set(a, sa);
		}
		if (!sa.has(b)) {
			sa.add(b);
			let sb = adjacency.get(b);
			if (!sb) {
				sb = new Set();
				adjacency.set(b, sb);
			}
			sb.add(a);
			out.push([a, b]);
		}
	};

	for (const [a, b] of topologyEdges) addEdge(a, b, portEdges);

	const gap = config.connection_gap_tol_m;
	const cell = Math.max(0.75, gap * 15);
	const grid = new Map<string, number[]>();
	for (const elem of keptElements) {
		const cls = elem.ifc_class.toUpperCase();
		if (!MEP_NETWORK_CLASSES.has(cls) && cls !== 'IFCBUILDINGELEMENTPROXY') continue;
		const m = measured.get(elem.express_id);
		if (!m?.worldMin || !m.worldMax || (cls === 'IFCBUILDINGELEMENTPROXY' && m.extents[0] > 25))
			continue;
		const x0 = Math.floor((m.worldMin[0] - gap) / cell),
			x1 = Math.floor((m.worldMax[0] + gap) / cell);
		const y0 = Math.floor((m.worldMin[1] - gap) / cell),
			y1 = Math.floor((m.worldMax[1] + gap) / cell);
		const z0 = Math.floor((m.worldMin[2] - gap) / cell),
			z1 = Math.floor((m.worldMax[2] + gap) / cell);
		if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 1000) continue;
		for (let x = x0; x <= x1; x++) {
			for (let y = y0; y <= y1; y++) {
				for (let z = z0; z <= z1; z++) {
					const k = `${x}|${y}|${z}`;
					const bucket = grid.get(k);
					if (bucket) bucket.push(elem.express_id);
					else grid.set(k, [elem.express_id]);
				}
			}
		}
	}

	for (const bucket of grid.values()) {
		const n = Math.min(bucket.length, 48);
		for (let i = 0; i < n; i++) {
			const idA = bucket[i];
			if (idA === undefined) continue;
			const mA = measured.get(idA);
			if (!mA?.worldMin || !mA.worldMax) continue;
			for (let j = i + 1; j < n; j++) {
				const idB = bucket[j];
				if (idB === undefined) continue;
				const mB = measured.get(idB);
				if (
					mB?.worldMin &&
					mB.worldMax &&
					boundsTouch(mA.worldMin, mA.worldMax, mB.worldMin, mB.worldMax, gap)
				) {
					addEdge(idA, idB, spatialEdges);
				}
			}
		}
	}

	// Union-Find preventing accidental crossing bleed between differing explicit services
	const uf = new Map<number, number>();
	const find = (x: number): number => {
		let r = x;
		for (let p = uf.get(r); p !== undefined && p !== r; p = uf.get(r)) r = p;
		for (let c = x; c !== r;) {
			const next = uf.get(c) ?? r;
			uf.set(c, r);
			c = next;
		}
		return r;
	};
	const initialService = new Map<number, string>();
	const rootService = new Map<number, string>();
	for (const elem of keptElements) {
		const svc = inferAnchorService(elem, matchService);
		if (svc) {
			initialService.set(elem.express_id, svc);
			rootService.set(elem.express_id, svc);
		}
	}
	const tryUnion = (a: number, b: number) => {
		const ra = find(a),
			rb = find(b);
		if (ra === rb) return;
		const sa = rootService.get(ra),
			sb = rootService.get(rb);
		if (sa && sb && sa !== sb) return;
		uf.set(ra, rb);
		if (sa && !sb) rootService.set(rb, sa);
	};
	for (const [a, b] of portEdges) tryUnion(a, b);
	for (const [a, b] of spatialEdges) tryUnion(a, b);

	const compVotes = new Map<number, Map<string, number>>();
	const compEquipment = new Map<number, Set<string>>();
	const compLinearVotes = new Map<number, Map<string, number>>();
	for (const elem of keptElements) {
		if (!adjacency.has(elem.express_id)) continue;
		const root = find(elem.express_id);
		const svc = initialService.get(elem.express_id);
		if (svc) {
			let votes = compVotes.get(root);
			if (!votes) {
				votes = new Map();
				compVotes.set(root, votes);
			}
			const w =
				elem.system_type || elem.system_name
					? 3
					: ANCHOR_EQUIPMENT_CLASSES.has(elem.ifc_class)
						? 2
						: 1;
			votes.set(svc, (votes.get(svc) ?? 0) + w);
		}
		if (LINEAR_MEP_CLASSES.has(elem.ifc_class) && elem.ifc_class !== 'IFCFLOWSEGMENT') {
			let cv = compLinearVotes.get(root);
			if (!cv) {
				cv = new Map();
				compLinearVotes.set(root, cv);
			}
			cv.set(elem.ifc_class, (cv.get(elem.ifc_class) ?? 0) + 1);
		}
		if (ANCHOR_EQUIPMENT_CLASSES.has(elem.ifc_class)) {
			let eq = compEquipment.get(root);
			if (!eq) {
				eq = new Set();
				compEquipment.set(root, eq);
			}
			if (eq.size < 4) eq.add(`${elem.ifc_class}:${elem.type_name ?? elem.family}`);
		}
	}

	const compService = new Map<number, string>();
	for (const [root, votes] of compVotes) {
		let bestSvc: string | null = null,
			bestScore = 0;
		for (const [svc, score] of votes) {
			if (score > bestScore) {
				bestScore = score;
				bestSvc = svc;
			}
		}
		if (bestSvc) compService.set(root, bestSvc);
	}
	const compLinearClass = new Map<number, string>();
	for (const [root, votes] of compLinearVotes) {
		let bestCls: string | null = null,
			bestScore = 0;
		for (const [cls, score] of votes) {
			if (score > bestScore) {
				bestScore = score;
				bestCls = cls;
			}
		}
		if (bestCls) compLinearClass.set(root, bestCls);
	}
	return { adjacency, find, compService, compEquipment, compLinearClass };
}

const HORIZONTAL_STRUCTURAL_CLASSES = new Set(
	'IFCSLAB IFCSLABSTANDARDCASE IFCSLABELEMENTEDCASE IFCROOF IFCBEAM IFCBEAMSTANDARDCASE IFCCOVERING IFCFOOTING'.split(
		' '
	)
);
const VERTICAL_REFERENCE_CLASSES = new Set(
	'IFCDOOR IFCDOORSTANDARDCASE IFCCOLUMN IFCCOLUMNSTANDARDCASE IFCWALL IFCWALLSTANDARDCASE'.split(
		' '
	)
);
const RAMP_CLASSES = new Set(['IFCRAMP', 'IFCRAMPFLIGHT']);
const OPENING_ELEMENT_CLASSES = new Set([
	'IFCDOOR',
	'IFCDOORSTANDARDCASE',
	'IFCWINDOW',
	'IFCWINDOWSTANDARDCASE'
]);

/** Auto-detects whether mesh coordinates are Y-up (Three.js / web-ifc = 1) or Z-up (ISO IFC / analytical = 2). */
function detectUpAxis(
	elements: readonly BimAssetRecord[],
	measured: ReadonlyMap<number, ElementMeasure>,
	elevations: Readonly<Record<string, number>> | undefined
): 1 | 2 {
	const elevs = elevations ?? {};
	const distinctElevs = new Set(Object.values(elevs));
	if (distinctElevs.size >= 2) {
		let errY = 0,
			errZ = 0,
			votes = 0;
		for (const el of elements) {
			const elev = elevs[el.storey];
			const m = measured.get(el.express_id);
			if (elev === undefined || !m?.worldMin) continue;
			errY += Math.abs(m.worldMin[1] - elev);
			errZ += Math.abs(m.worldMin[2] - elev);
			votes++;
			if (votes >= 200) break;
		}
		if (votes >= 3) return errY <= errZ ? 1 : 2;
	}
	let yTaller = 0,
		zTaller = 0;
	for (const el of elements) {
		if (!VERTICAL_REFERENCE_CLASSES.has(el.ifc_class.toUpperCase())) continue;
		const m = measured.get(el.express_id);
		if (!m?.worldMin || !m.worldMax) continue;
		const dy = m.worldMax[1] - m.worldMin[1];
		const dz = m.worldMax[2] - m.worldMin[2];
		if (dy > dz * 1.15) yTaller++;
		else if (dz > dy * 1.15) zTaller++;
		if (yTaller + zTaller >= 100) break;
	}
	if (yTaller + zTaller > 0) return yTaller >= zTaller ? 1 : 2;
	return 1;
}

/** Identifies elements whose IFC Qto repeats one parent-total value identically across multiple differently-sized 3D meshes. */
function detectDuplicatedParentQtos(
	elements: readonly BimAssetRecord[],
	measured: ReadonlyMap<number, ElementMeasure>
): { readonly dupVolumeIds: ReadonlySet<number>; readonly dupAreaIds: ReadonlySet<number> } {
	const dupVolumeIds = new Set<number>();
	const dupAreaIds = new Set<number>();
	const volGroups = new Map<
		string,
		{ readonly id: number; readonly ifc: number; readonly mesh: number }[]
	>();
	const areaGroups = new Map<
		string,
		{ readonly id: number; readonly ifc: number; readonly mesh: number }[]
	>();

	for (const el of elements) {
		const m = measured.get(el.express_id);
		if (!m) continue;
		const baseKey = `${el.ifc_class}|${el.type_id ?? el.family}`;
		if (el.volume_m3 !== null && el.volume_m3 > 1e-4 && m.volume > 1e-4) {
			const k = `${baseKey}|${el.volume_m3.toFixed(3)}`;
			const arr = volGroups.get(k);
			if (arr) arr.push({ id: el.express_id, ifc: el.volume_m3, mesh: m.volume });
			else volGroups.set(k, [{ id: el.express_id, ifc: el.volume_m3, mesh: m.volume }]);
		}
		const meshArea = netAreaOf(m);
		if (el.area_m2 !== null && el.area_m2 > 1e-4 && meshArea > 1e-4) {
			const k = `${baseKey}|${el.area_m2.toFixed(3)}`;
			const arr = areaGroups.get(k);
			if (arr) arr.push({ id: el.express_id, ifc: el.area_m2, mesh: meshArea });
			else areaGroups.set(k, [{ id: el.express_id, ifc: el.area_m2, mesh: meshArea }]);
		}
	}

	const scan = (
		groups: Map<string, { readonly id: number; readonly ifc: number; readonly mesh: number }[]>,
		out: Set<number>
	) => {
		for (const entries of groups.values()) {
			if (entries.length < 2) continue;
			let minMesh = Infinity,
				maxMesh = 0,
				oversized = 0;
			for (const e of entries) {
				if (e.mesh < minMesh) minMesh = e.mesh;
				if (e.mesh > maxMesh) maxMesh = e.mesh;
				if (e.ifc > e.mesh * 1.2) oversized++;
			}
			if (oversized >= 2 && minMesh > 0 && maxMesh / minMesh > 1.35) {
				for (const e of entries) out.add(e.id);
			}
		}
	};
	scan(volGroups, dupVolumeIds);
	scan(areaGroups, dupAreaIds);
	return { dupVolumeIds, dupAreaIds };
}

const aabbGapM = (
	aMin: readonly [number, number, number],
	aMax: readonly [number, number, number],
	bMin: readonly [number, number, number],
	bMax: readonly [number, number, number]
): number => {
	const dx = Math.max(0, aMin[0] - bMax[0], bMin[0] - aMax[0]);
	const dy = Math.max(0, aMin[1] - bMax[1], bMin[1] - aMax[1]);
	const dz = Math.max(0, aMin[2] - bMax[2], bMin[2] - aMax[2]);
	return Math.hypot(dx, dy, dz);
};

/**
 * Computes O(N) wide-aperture 3D spatial neighborhood for every archetype (architectural, structural,
 * furniture, and MEP): nearest neighbor element IDs around each representative (for wide-aperture 3D
 * context rendering) plus minimum 3D clearance distances to neighboring archetypes (for spatial SOP linting).
 */
function computeSpatialNeighborhoods(
	archetypes: readonly BimArchetype[],
	buckets: readonly BimStoreyBucket[],
	measured: ReadonlyMap<number, ElementMeasure>,
	radiusM = 2.5
): {
	readonly contextIdsByArch: ReadonlyMap<string, readonly number[]>;
	readonly nearbyByArch: ReadonlyMap<
		string,
		readonly { readonly archetype_id: string; readonly min_dist_m: number }[]
	>;
} {
	const cell = Math.max(1.0, radiusM);
	const grid = new Map<string, number[]>();
	const elemToArch = new Map<number, string>();
	const allIds: number[] = [];

	for (const b of buckets) {
		for (const id of b.element_ids?.length ? b.element_ids : b.sample_express_ids) {
			if (elemToArch.has(id)) continue;
			const m = measured.get(id);
			if (!m?.worldMin || !m.worldMax) continue;
			elemToArch.set(id, b.archetype_id);
			allIds.push(id);
			const x0 = Math.floor(m.worldMin[0] / cell),
				x1 = Math.floor(m.worldMax[0] / cell);
			const y0 = Math.floor(m.worldMin[1] / cell),
				y1 = Math.floor(m.worldMax[1] / cell);
			const z0 = Math.floor(m.worldMin[2] / cell),
				z1 = Math.floor(m.worldMax[2] / cell);
			if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 27) {
				const cx = Math.floor(m.center[0] / cell),
					cy = Math.floor(m.center[1] / cell),
					cz = Math.floor(m.center[2] / cell);
				const k = `${cx}|${cy}|${cz}`;
				const list = grid.get(k);
				if (list) list.push(id);
				else grid.set(k, [id]);
				continue;
			}
			for (let x = x0; x <= x1; x++) {
				for (let y = y0; y <= y1; y++) {
					for (let z = z0; z <= z1; z++) {
						const k = `${x}|${y}|${z}`;
						const list = grid.get(k);
						if (list) list.push(id);
						else grid.set(k, [id]);
					}
				}
			}
		}
	}

	const collectNear = (id: number, cap: number): { id: number; dist: number }[] => {
		const m = measured.get(id);
		if (!m?.worldMin || !m.worldMax) return [];
		const x0 = Math.floor((m.worldMin[0] - radiusM) / cell),
			x1 = Math.floor((m.worldMax[0] + radiusM) / cell);
		const y0 = Math.floor((m.worldMin[1] - radiusM) / cell),
			y1 = Math.floor((m.worldMax[1] + radiusM) / cell);
		const z0 = Math.floor((m.worldMin[2] - radiusM) / cell),
			z1 = Math.floor((m.worldMax[2] + radiusM) / cell);
		const seen = new Set<number>([id]);
		const hits: { id: number; dist: number }[] = [];
		const spanLimit = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 27;
		const rx0 = spanLimit ? Math.floor(m.center[0] / cell) - 1 : x0;
		const rx1 = spanLimit ? Math.floor(m.center[0] / cell) + 1 : x1;
		const ry0 = spanLimit ? Math.floor(m.center[1] / cell) - 1 : y0;
		const ry1 = spanLimit ? Math.floor(m.center[1] / cell) + 1 : y1;
		const rz0 = spanLimit ? Math.floor(m.center[2] / cell) - 1 : z0;
		const rz1 = spanLimit ? Math.floor(m.center[2] / cell) + 1 : z1;
		for (let x = rx0; x <= rx1; x++) {
			for (let y = ry0; y <= ry1; y++) {
				for (let z = rz0; z <= rz1; z++) {
					const bucket = grid.get(`${x}|${y}|${z}`);
					if (!bucket) continue;
					const lim = Math.min(bucket.length, 32);
					for (let i = 0; i < lim; i++) {
						const otherId = bucket[i];
						if (otherId === undefined || seen.has(otherId)) continue;
						seen.add(otherId);
						const om = measured.get(otherId);
						if (!om?.worldMin || !om.worldMax) continue;
						const dist = aabbGapM(m.worldMin, m.worldMax, om.worldMin, om.worldMax);
						if (dist <= radiusM) hits.push({ id: otherId, dist });
					}
				}
			}
		}
		hits.sort((a, b) => a.dist - b.dist);
		return hits.slice(0, cap);
	};

	const contextIdsByArch = new Map<string, readonly number[]>();
	const nearbyMapByArch = new Map<string, Map<string, number>>();
	const recordNear = (srcArch: string, dstArch: string, dist: number) => {
		if (srcArch === dstArch) return;
		let m = nearbyMapByArch.get(srcArch);
		if (!m) {
			m = new Map();
			nearbyMapByArch.set(srcArch, m);
		}
		const prev = m.get(dstArch);
		if (prev === undefined || dist < prev) m.set(dstArch, dist);
	};

	for (const a of archetypes) {
		const nearRep = collectNear(a.representative_express_id, 16);
		if (nearRep.length > 0)
			contextIdsByArch.set(
				a.archetype_id,
				nearRep.map((h) => h.id)
			);
		for (const h of nearRep) {
			const otherArch = elemToArch.get(h.id);
			if (otherArch) recordNear(a.archetype_id, otherArch, h.dist);
		}
	}

	// Sample up to 2 instances per archetype (rep + 1) so spatial proximity stays O(A) and <40 ms on 3,500+ element models
	const sampledPerArch = new Map<string, number>();
	for (const id of allIds) {
		const archId = elemToArch.get(id);
		if (!archId) continue;
		const cnt = sampledPerArch.get(archId) ?? 0;
		if (cnt >= 2) continue;
		sampledPerArch.set(archId, cnt + 1);
		for (const h of collectNear(id, 10)) {
			const otherArch = elemToArch.get(h.id);
			if (otherArch) recordNear(archId, otherArch, h.dist);
		}
	}

	const nearbyByArch = new Map<
		string,
		readonly { readonly archetype_id: string; readonly min_dist_m: number }[]
	>();
	for (const [archId, map] of nearbyMapByArch) {
		nearbyByArch.set(
			archId,
			[...map.entries()]
				.sort((a, b) => a[1] - b[1])
				.slice(0, 8)
				.map(([otherId, dist]) => ({
					archetype_id: otherId,
					min_dist_m: Math.round(dist * 100) / 100
				}))
		);
	}
	return { contextIdsByArch, nearbyByArch };
}

function splitMultiStoreyBuckets(
	buckets: readonly BimStoreyBucket[],
	elements: readonly BimAssetRecord[],
	measured: ReadonlyMap<number, ElementMeasure>,
	elevations: Readonly<Record<string, number>> | undefined,
	upAxis: 1 | 2
): { readonly buckets: BimStoreyBucket[]; readonly splits: number } {
	const elevEntries = Object.entries(elevations ?? {}).sort((a, b) => a[1] - b[1]);
	if (elevEntries.length < 2) return { buckets: [...buckets], splits: 0 };

	const elemToArch = new Map<number, string>();
	for (const b of buckets)
		for (const eid of b.element_ids ?? []) elemToArch.set(eid, b.archetype_id);
	const bucketMap = new Map<string, BimStoreyBucket>(
		buckets.map((b) => [`${b.archetype_id}::${b.storey}`, b])
	);
	let splits = 0;

	for (const elem of elements) {
		if (
			elem.continuity === 'discontiguous' ||
			HORIZONTAL_STRUCTURAL_CLASSES.has(elem.ifc_class.toUpperCase())
		)
			continue;
		const m = measured.get(elem.express_id);
		if (!m?.worldMin || !m.worldMax || m.worldMax[upAxis] - m.worldMin[upAxis] < 1.0) continue;
		const zMin = m.worldMin[upAxis],
			zMax = m.worldMax[upAxis];
		const spans: { storey: string; overlap: number }[] = [];
		for (let i = 0; i < elevEntries.length; i++) {
			const entry = elevEntries[i];
			if (!entry) continue;
			const [name, zLow] = entry;
			const zHigh = elevEntries[i + 1]?.[1] ?? Infinity;
			const ov = Math.min(zMax, zHigh) - Math.max(zMin, zLow);
			if (ov > 0.3) spans.push({ storey: name, overlap: ov });
		}
		if (spans.length < 2) continue;
		const archId = elemToArch.get(elem.express_id);
		const homeKey = archId ? `${archId}::${elem.storey}` : null;
		const home = homeKey ? bucketMap.get(homeKey) : undefined;
		const sumOv = spans.reduce((s, x) => s + x.overlap, 0);
		if (!archId || !homeKey || !home || sumOv <= 0) continue;

		const elLen = elem.length_m ?? 0,
			elArea = elem.area_m2 ?? 0,
			elVol = elem.volume_m3 ?? 0,
			elWt = elem.weight_kg ?? 0;
		bucketMap.set(homeKey, {
			...home,
			length_m: round(Math.max(0, home.length_m - elLen)),
			area_m2: round(Math.max(0, home.area_m2 - elArea)),
			volume_m3: round(Math.max(0, home.volume_m3 - elVol)),
			weight_kg: round(Math.max(0, home.weight_kg - elWt))
		});

		for (const span of spans) {
			const f = span.overlap / sumOv;
			const addLen = elLen * f,
				addArea = elArea * f,
				addVol = elVol * f,
				addWt = elWt * f;
			const key = `${archId}::${span.storey}`;
			const t = bucketMap.get(key);
			const inc = (v: number) => (v > 0 && span.storey !== elem.storey ? 1 : 0);
			bucketMap.set(
				key,
				t
					? {
							...t,
							length_m: round(t.length_m + addLen),
							length_measured_count: t.length_measured_count + inc(addLen),
							area_m2: round(t.area_m2 + addArea),
							area_measured_count: t.area_measured_count + inc(addArea),
							volume_m3: round(t.volume_m3 + addVol),
							volume_measured_count: t.volume_measured_count + inc(addVol),
							weight_kg: round(t.weight_kg + addWt),
							weight_measured_count: t.weight_measured_count + inc(addWt)
						}
					: {
							archetype_id: archId,
							storey: span.storey,
							element_count: 0,
							length_m: round(addLen),
							length_measured_count: addLen > 0 ? 1 : 0,
							area_m2: round(addArea),
							area_measured_count: addArea > 0 ? 1 : 0,
							volume_m3: round(addVol),
							volume_measured_count: addVol > 0 ? 1 : 0,
							weight_kg: round(addWt),
							weight_measured_count: addWt > 0 ? 1 : 0,
							sample_express_ids: [elem.express_id],
							element_ids: []
						}
			);
		}
		splits += 1;
	}
	return { buckets: [...bucketMap.values()], splits };
}

export function cleanupAndMeasure(
	extracted: ExtractedBimModel,
	measured: ReadonlyMap<number, ElementMeasure>,
	configInput?: BimSettingsRow | Partial<BimConfig> | null
): {
	readonly extracted: ExtractedBimModel;
	readonly duplicates: number;
	readonly cleanup: BimCleanupReport;
} {
	const config = resolveBimConfig(configInput);
	const dedup = dropDuplicates(extracted, measured, config);
	const sourceElements = extracted.elements;

	if (!sourceElements?.length) {
		const filled = fillFromGeometry(dedup.extracted, measured, config);
		const reps = new Map(
			filled.archetypes.flatMap((a) => {
				const m = measured.get(a.representative_express_id);
				return m ? [[a.archetype_id, m] as const] : [];
			})
		);
		const merged = mergeIdenticalArchetypes(filled, reps, config);
		const cleanup: BimCleanupReport = {
			upgraded_classes: extracted.cleanup?.upgraded_classes ?? 0,
			propagated_services: 0,
			split_mixed_archetypes: 0,
			multi_storey_splits: 0,
			dropped_duplicates: dedup.duplicates,
			variance_warnings: 0,
			...(dedup.droppedIds.size > 0 ? { dropped_duplicate_ids: [...dedup.droppedIds] } : {})
		};
		return {
			extracted: {
				...merged,
				...(extracted.crs_name !== undefined ? { crs_name: extracted.crs_name } : {}),
				...(extracted.sgpset_count !== undefined ? { sgpset_count: extracted.sgpset_count } : {}),
				cleanup,
				archetypes: merged.archetypes.map((a) => ({
					...a,
					signature: assetSignature(a, reps.get(a.archetype_id), config)
				}))
			},
			duplicates: dedup.duplicates,
			cleanup
		};
	}

	const matchService = createServiceMatcher(config);
	const keptElements = sourceElements.filter((e) => !dedup.droppedIds.has(e.express_id));
	const upAxis = detectUpAxis(keptElements, measured, extracted.storey_elevations);
	const { dupVolumeIds, dupAreaIds } = detectDuplicatedParentQtos(keptElements, measured);
	const byId = new Map(keptElements.map((e) => [e.express_id, e] as const));
	const { adjacency, find, compService, compEquipment, compLinearClass } = buildMepNetwork(
		keptElements,
		byId,
		extracted.topology_edges ?? [],
		measured,
		config,
		matchService
	);

	let upgradedClasses = extracted.cleanup?.upgraded_classes ?? 0;
	let propagatedServices = 0;
	let varianceWarnings = 0;
	const elementVariance = new Map<number, string>();
	const elementNeighbors = new Map<number, number[]>();
	const elementEquipment = new Map<number, readonly string[]>();

	const cleanedElements: BimAssetRecord[] = keptElements.map((elem) => {
		const m = measured.get(elem.express_id);
		const neighbors = adjacency.get(elem.express_id);
		const root = neighbors ? find(elem.express_id) : null;
		const netSvc = root !== null ? (compService.get(root) ?? null) : null;
		const eqList = root !== null ? [...(compEquipment.get(root) ?? [])] : [];
		if (neighbors?.size) elementNeighbors.set(elem.express_id, [...neighbors].slice(0, 12));
		if (eqList.length > 0) elementEquipment.set(elem.express_id, eqList);

		let service = elem.service;
		const notes: string[] = elem.cleanup_note ? [elem.cleanup_note] : [];
		if (
			service === null &&
			netSvc !== null &&
			(MEP_NETWORK_CLASSES.has(elem.ifc_class) || elem.ifc_class === 'IFCBUILDINGELEMENTPROXY')
		) {
			service = netSvc;
			propagatedServices += 1;
			notes.push(
				eqList.length > 0
					? `Service '${netSvc}' propagated from connected network (${eqList.slice(0, 2).join(', ')})`
					: `Service '${netSvc}' propagated from contiguous MEP network`
			);
		} else if (service === null && elem.ifc_class === 'IFCBUILDINGELEMENTPROXY') {
			const directSvc = matchService(
				[elem.type_name, elem.family, elem.name, elem.object_type].filter(Boolean).join(' ')
			);
			if (directSvc !== null) {
				service = directSvc;
				propagatedServices += 1;
				notes.push(`Service '${directSvc}' tagged on proxy from configured service aliases`);
			}
		}

		let ifcClass = elem.ifc_class,
			originalClass = elem.original_ifc_class,
			continuity = elem.continuity;
		if (config.auto_reclassify_generic && UPGRADEABLE_GENERIC_CLASSES.has(ifcClass)) {
			if (
				ifcClass === 'IFCBUILDINGELEMENTPROXY' &&
				neighbors &&
				m &&
				m.extents[1] > 1e-4 &&
				m.extents[0] >= m.extents[1] * 2
			) {
				let targetClass: string | null = null;
				let anchorId: number | null = null;
				for (const nid of neighbors) {
					const nb = byId.get(nid);
					if (nb && LINEAR_MEP_CLASSES.has(nb.ifc_class) && nb.ifc_class !== 'IFCFLOWSEGMENT') {
						targetClass = nb.ifc_class;
						anchorId = nid;
						break;
					}
				}
				if (targetClass === null && root !== null) {
					targetClass = compLinearClass.get(root) ?? null;
				}
				if (targetClass !== null) {
					originalClass ??= ifcClass;
					ifcClass = targetClass;
					continuity = 'contiguous_linear';
					if (service === null && netSvc !== null) {
						service = netSvc;
						propagatedServices += 1;
					}
					upgradedClasses += 1;
					notes.push(
						anchorId !== null
							? `Promoted proxy → ${ifcClass} (contiguous inline with #${anchorId})`
							: `Promoted proxy → ${ifcClass} (connected linear MEP network)`
					);
				}
			} else if (ifcClass === 'IFCFLOWSEGMENT') {
				let target: string | null = null;
				for (const nid of neighbors ?? []) {
					const fit = SEGMENT_FOR_FITTING[byId.get(nid)?.ifc_class ?? ''];
					if (fit) {
						target = fit;
						break;
					}
				}
				target ??= inferLinearClassFromService(service, config);
				if (target) {
					originalClass ??= ifcClass;
					ifcClass = target;
					continuity = 'contiguous_linear';
					upgradedClasses += 1;
					notes.push(
						`Upgraded IFCFLOWSEGMENT → ${target} from ${service ? `service '${service}'` : 'connected fittings'}`
					);
				}
			} else if (ifcClass === 'IFCFLOWFITTING' && neighbors) {
				for (const nid of neighbors) {
					const nb = byId.get(nid);
					const fit = nb ? FITTING_FOR_SEGMENT[nb.ifc_class] : undefined;
					if (fit && nb) {
						originalClass ??= ifcClass;
						ifcClass = fit;
						continuity = 'discontiguous';
						upgradedClasses += 1;
						notes.push(`Upgraded IFCFLOWFITTING → ${fit} from connected ${nb.ifc_class}`);
						break;
					}
				}
			}
		}

		let nominalSizeMm = elem.nominal_size_mm;
		let lengthM = elem.length_m,
			areaM2 = elem.area_m2,
			volumeM3 = elem.volume_m3,
			weightKg = elem.weight_kg;
		let measuredHeightMm = elem.height_mm ?? null;
		let measuredSlopePct = elem.slope_pct ?? null;
		if (m) {
			if (m.worldMin && m.worldMax) {
				const upMm = Math.round((m.worldMax[upAxis] - m.worldMin[upAxis]) * 10000) / 10;
				const horizAxisB: 1 | 2 = upAxis === 1 ? 2 : 1;
				const horizMaxMm = Math.max(
					Math.round((m.worldMax[0] - m.worldMin[0]) * 10000) / 10,
					Math.round((m.worldMax[horizAxisB] - m.worldMin[horizAxisB]) * 10000) / 10
				);
				if (ifcClass === 'IFCRAILING' && measuredHeightMm === null && upMm > 5)
					measuredHeightMm = upMm;
				if (
					RAMP_CLASSES.has(ifcClass) &&
					measuredSlopePct === null &&
					upMm > 5 &&
					horizMaxMm > 50
				) {
					measuredSlopePct = Math.round((upMm / horizMaxMm) * 1000) / 10;
				}
			}
			const geoSize = geometricSizeMm(m, continuity);
			if (geoSize !== null) {
				if (nominalSizeMm === null) nominalSizeMm = geoSize;
				else if (
					elem.size_label === null &&
					Math.abs(nominalSizeMm - geoSize) / Math.max(nominalSizeMm, geoSize) > 0.25
				) {
					notes.push(`Size normalized ${nominalSizeMm}mm → ${geoSize}mm from mesh`);
					nominalSizeMm = geoSize;
				}
			}
			const checkVar = (kind: string, ifcVal: number, meshVal: number) => {
				if (ifcVal <= 0 || meshVal <= 0) return;
				const pct = (Math.abs(ifcVal - meshVal) / Math.max(ifcVal, meshVal)) * 100;
				if (pct > config.variance_flag_pct) {
					varianceWarnings += 1;
					elementVariance.set(
						elem.express_id,
						`IFC ${kind} (${ifcVal.toFixed(2)}) diverges ${Math.round(pct)}% from mesh (${meshVal.toFixed(2)})`
					);
				}
			};
			const meshLen = continuity === 'contiguous_linear' ? linearLengthOf(m) : m.extents[0];
			const meshArea = netAreaOf(m);
			const density = configuredDensityFor(elem.materials, elem.material_layers, ifcClass, config);
			const meshWeight = density !== null ? m.volume * density : null;

			if (lengthM === null && meshLen > 0) lengthM = meshLen;
			else if (lengthM !== null && continuity === 'contiguous_linear')
				checkVar('length', lengthM, meshLen);
			if (dupAreaIds.has(elem.express_id) && meshArea > 0) {
				notes.push(
					`Replaced duplicated parent-total Qto area (${areaM2?.toFixed(2)}) with 3D mesh (${meshArea.toFixed(2)} m²)`
				);
				areaM2 = meshArea;
			} else if (areaM2 === null && meshArea > 0) areaM2 = meshArea;
			else if (areaM2 !== null && continuity === 'contiguous_planar')
				checkVar('area', areaM2, meshArea);
			if (dupVolumeIds.has(elem.express_id) && m.volume > 0) {
				notes.push(
					`Replaced duplicated parent-total Qto volume (${volumeM3?.toFixed(2)}) with 3D mesh (${m.volume.toFixed(2)} m³)`
				);
				volumeM3 = m.volume;
			} else if (volumeM3 === null && m.volume > 0) volumeM3 = m.volume;
			else if (volumeM3 !== null && continuity !== 'discontiguous')
				checkVar('volume', volumeM3, m.volume);
			if (weightKg === null && meshWeight !== null && meshWeight > 0) weightKg = meshWeight;
		}

		return {
			...elem,
			ifc_class: ifcClass,
			original_ifc_class: originalClass,
			continuity,
			service,
			nominal_size_mm: nominalSizeMm,
			length_m: lengthM,
			area_m2: areaM2,
			volume_m3: volumeM3,
			weight_kg: weightKg,
			...(measuredHeightMm !== null ? { height_mm: measuredHeightMm } : {}),
			...(measuredSlopePct !== null ? { slope_pct: measuredSlopePct } : {}),
			cleanup_note: notes.length > 0 ? notes.join('; ') : null
		};
	});

	const reaggregated = aggregateResolvedAssets(
		extracted.schema,
		extracted.project_name,
		extracted.storeys,
		cleanedElements,
		config,
		extracted.storey_elevations
	);
	const splitMixed = Math.max(0, reaggregated.archetypes.length - extracted.archetypes.length);
	const { buckets: splitBuckets, splits: multiStoreySplits } = config.auto_split_multi_storey
		? splitMultiStoreyBuckets(
				reaggregated.buckets,
				cleanedElements,
				measured,
				extracted.storey_elevations,
				upAxis
			)
		: { buckets: [...reaggregated.buckets], splits: 0 };

	const buckets = splitBuckets.map((b) => {
		const warn = (b.element_ids ?? []).map((id) => elementVariance.get(id)).find(Boolean);
		return warn ? { ...b, quantity_warning: warn } : b;
	});

	const horizAxisB: 1 | 2 = upAxis === 1 ? 2 : 1;
	const archDims = new Map<
		string,
		{
			minW: number | null;
			minWId: number | null;
			minH: number | null;
			minHId: number | null;
			minT: number | null;
			minTId: number | null;
			maxT: number | null;
			maxTId: number | null;
			maxSlope: number | null;
			maxSlopeId: number | null;
			maxRiser: number | null;
			maxRiserId: number | null;
			minTread: number | null;
			minTreadId: number | null;
		}
	>();
	const elemById = new Map(cleanedElements.map((e) => [e.express_id, e] as const));
	const archClassById = new Map(
		reaggregated.archetypes.map((a) => [a.archetype_id, a.ifc_class.toUpperCase()] as const)
	);
	for (const b of buckets) {
		const cls = archClassById.get(b.archetype_id) ?? '';
		for (const id of b.element_ids?.length ? b.element_ids : b.sample_express_ids) {
			const m = measured.get(id);
			const el = elemById.get(id);
			if (!m) continue;
			const upMm =
				m.worldMin && m.worldMax
					? Math.round((m.worldMax[upAxis] - m.worldMin[upAxis]) * 10000) / 10
					: null;
			const hxMm =
				m.worldMin && m.worldMax ? Math.round((m.worldMax[0] - m.worldMin[0]) * 10000) / 10 : null;
			const hyMm =
				m.worldMin && m.worldMax
					? Math.round((m.worldMax[horizAxisB] - m.worldMin[horizAxisB]) * 10000) / 10
					: null;
			const horizMaxMm = hxMm !== null && hyMm !== null ? Math.max(hxMm, hyMm) : null;
			const e0 = Math.round(m.extents[0] * 10000) / 10;
			const e1 = Math.round(m.extents[1] * 10000) / 10;
			const e2 = Math.round(m.extents[2] * 10000) / 10;
			const hMm = upMm !== null && upMm > 5 ? upMm : e0;
			const wMm =
				upMm !== null && Math.abs(e0 - upMm) < Math.max(50, upMm * 0.12)
					? e1
					: horizMaxMm !== null && horizMaxMm > 5
						? Math.min(e0, horizMaxMm)
						: e1;
			const tMm = e2 > 1 ? e2 : null;
			const slopePct =
				RAMP_CLASSES.has(cls) && upMm !== null && horizMaxMm !== null && horizMaxMm > 50
					? Math.round((upMm / horizMaxMm) * 1000) / 10
					: null;
			let cur = archDims.get(b.archetype_id);
			if (!cur) {
				cur = {
					minW: null,
					minWId: null,
					minH: null,
					minHId: null,
					minT: null,
					minTId: null,
					maxT: null,
					maxTId: null,
					maxSlope: null,
					maxSlopeId: null,
					maxRiser: null,
					maxRiserId: null,
					minTread: null,
					minTreadId: null
				};
				archDims.set(b.archetype_id, cur);
			}
			if (wMm > 1 && (cur.minW === null || wMm < cur.minW)) {
				cur.minW = wMm;
				cur.minWId = id;
			}
			if (hMm > 1 && (cur.minH === null || hMm < cur.minH)) {
				cur.minH = hMm;
				cur.minHId = id;
			}
			if (tMm !== null) {
				if (cur.minT === null || tMm < cur.minT) {
					cur.minT = tMm;
					cur.minTId = id;
				}
				if (cur.maxT === null || tMm > cur.maxT) {
					cur.maxT = tMm;
					cur.maxTId = id;
				}
			}
			if (slopePct !== null && slopePct > 0 && (cur.maxSlope === null || slopePct > cur.maxSlope)) {
				cur.maxSlope = slopePct;
				cur.maxSlopeId = id;
			}
			if (
				el?.riser_mm != null &&
				el.riser_mm > 0 &&
				(cur.maxRiser === null || el.riser_mm > cur.maxRiser)
			) {
				cur.maxRiser = el.riser_mm;
				cur.maxRiserId = id;
			}
			if (
				el?.tread_mm != null &&
				el.tread_mm > 0 &&
				(cur.minTread === null || el.tread_mm < cur.minTread)
			) {
				cur.minTread = el.tread_mm;
				cur.minTreadId = id;
			}
		}
	}

	const { contextIdsByArch, nearbyByArch } = computeSpatialNeighborhoods(
		reaggregated.archetypes,
		buckets,
		measured
	);

	const enrichedArchetypes: BimArchetype[] = reaggregated.archetypes.map((a) => {
		const eq = elementEquipment.get(a.representative_express_id);
		const mepNbs = elementNeighbors.get(a.representative_express_id) ?? [];
		const spatialNbs = contextIdsByArch.get(a.archetype_id) ?? [];
		const mergedNbs = [...new Set([...mepNbs, ...spatialNbs])].slice(0, 16);
		const nearby = nearbyByArch.get(a.archetype_id);
		const d = archDims.get(a.archetype_id);
		const isOpening = OPENING_ELEMENT_CLASSES.has(a.ifc_class.toUpperCase());
		// Prefer explicit IFC OverallHeight/Width on openings only when consistent with vertical mesh height (guards swapped Revit exports)
		const ifcH = a.min_height_mm ?? null;
		const ifcW = a.min_width_mm ?? null;
		const useExplicitOpen =
			isOpening &&
			ifcH !== null &&
			ifcW !== null &&
			(d?.minH == null || Math.abs(ifcH - d.minH) <= Math.max(250, d.minH * 0.25));
		const minW = useExplicitOpen ? ifcW : (d?.minW ?? ifcW);
		const minH = useExplicitOpen ? ifcH : (d?.minH ?? ifcH);
		const minT = a.min_thickness_mm ?? d?.minT ?? null;
		const maxT = a.max_thickness_mm ?? d?.maxT ?? null;
		const maxSlope = a.max_slope_pct ?? d?.maxSlope ?? null;
		const dimOutliers = d
			? [
					...new Set(
						[
							d.minWId,
							d.minHId,
							d.minTId,
							d.maxTId,
							d.maxSlopeId,
							d.maxRiserId,
							d.minTreadId
						].filter((x): x is number => x !== null)
					)
				]
			: [];
		return {
			...a,
			...(minW !== null ? { min_width_mm: minW } : {}),
			...(minH !== null ? { min_height_mm: minH } : {}),
			...(minT !== null ? { min_thickness_mm: minT } : {}),
			...(maxT !== null ? { max_thickness_mm: maxT } : {}),
			...(maxSlope !== null ? { max_slope_pct: maxSlope } : {}),
			...(dimOutliers.length > 0 ? { dim_outlier_ids: dimOutliers } : {}),
			...(eq?.length ? { connected_equipment: eq } : {}),
			...(mergedNbs.length ? { context_neighbor_ids: mergedNbs } : {}),
			...(nearby?.length ? { nearby_archetypes: nearby } : {})
		};
	});

	const reps = new Map(
		enrichedArchetypes.flatMap((a) => {
			const m = measured.get(a.representative_express_id);
			return m ? [[a.archetype_id, m] as const] : [];
		})
	);
	const merged = mergeIdenticalArchetypes(
		{ ...reaggregated, archetypes: enrichedArchetypes, buckets },
		reps,
		config
	);
	const cleanup: BimCleanupReport = {
		upgraded_classes: upgradedClasses,
		propagated_services: propagatedServices,
		split_mixed_archetypes: splitMixed,
		multi_storey_splits: multiStoreySplits,
		dropped_duplicates: dedup.duplicates,
		variance_warnings: varianceWarnings,
		...(dedup.droppedIds.size > 0 ? { dropped_duplicate_ids: [...dedup.droppedIds] } : {})
	};
	return {
		extracted: {
			...merged,
			...(extracted.crs_name !== undefined ? { crs_name: extracted.crs_name } : {}),
			...(extracted.sgpset_count !== undefined ? { sgpset_count: extracted.sgpset_count } : {}),
			cleanup,
			archetypes: merged.archetypes.map((a) => ({
				...a,
				signature: assetSignature(a, reps.get(a.archetype_id), config)
			}))
		},
		duplicates: dedup.duplicates,
		cleanup
	};
}
