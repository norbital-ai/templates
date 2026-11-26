/**
 * Runtime-configurable BIM takeoff, cleanup, metrology, and classification settings
 * backed by workspace `bim_settings` rows.
 *
 * When a `bim_settings` row supplies `material_densities` or `service_aliases`, those maps are used
 * authoritatively (never force-merged back over deleted entries).
 */
import type { BimConfig, BimSettingsRow, ContinuityMode } from './schema.js';

export const DEFAULT_MATERIAL_DENSITIES: Readonly<Record<string, number>> = {
	steel: 7850,
	'stainless steel': 7930,
	'galvanised steel': 7850,
	copper: 8960,
	aluminium: 2700
};

export const DEFAULT_SERVICE_ALIASES: Readonly<Record<string, readonly string[]>> = {
	chilled_water: [
		'chilled water',
		'chw',
		'chws',
		'chwr',
		'condenser water',
		'cws',
		'cwr',
		'chiller',
		'cooling tower'
	],
	hydronic_hvac: [
		'hydronic',
		'heating',
		'boiler',
		'radiator',
		'space heater',
		'fcu',
		'ahu',
		'refrigerant',
		'vrf',
		'vrv',
		'acmv',
		'hvac'
	],
	ventilation_duct: [
		'supply air',
		'return air',
		'exhaust air',
		'fresh air',
		'airterminal',
		'duct',
		'diffuser',
		'grille',
		'fan',
		'ventilation'
	],
	domestic_cold_water: [
		'domestic cold',
		'cold water',
		'potable',
		'dcw',
		'cw supply',
		'water supply'
	],
	domestic_hot_water: ['domestic hot', 'hot water', 'dhw', 'hw supply', 'water heater'],
	sanitary_dwv: [
		'sanitary',
		'waste',
		'soil',
		'sewer',
		'vent',
		'dwv',
		'toilet',
		'urinal',
		'sink',
		'lavatory',
		'tub',
		'shower',
		'floor trap'
	],
	storm_drain: [
		'storm drain',
		'storm water',
		'stormwater',
		'rainwater',
		'rwdp',
		'roof drain',
		'surface drain',
		'storm'
	],
	fire_protection: [
		'fire',
		'sprinkler',
		'hose reel',
		'wet riser',
		'dry riser',
		'hydrant',
		'smoke',
		'alarm'
	],
	natural_gas: ['natural gas', 'town gas', 'lpg', 'gas supply', 'fuel gas'],
	electrical_power: [
		'electrical',
		'electric',
		'power',
		'conduit',
		'emt',
		'cablesegment',
		'cablecarrier',
		'cable',
		'trunking',
		'panelboard',
		'switchboard',
		'receptacle',
		'outlet',
		'switchingdevice',
		'socket',
		'lighting',
		'lightfixture',
		'luminaire',
		'downlight'
	],
	elv_comms: ['elv', 'data', 'telecom', 'cctv', 'security', 'audio', 'av', 'bms', 'nurse call']
};

export const DEFAULT_SIZE_BANDS_MM: readonly number[] = [20, 32, 50, 80, 100, 150, 200, 300, 500];
export const DEFAULT_EXCLUDE_IFC_CLASSES: readonly string[] = ['IFCSPACE', 'IFCOPENINGELEMENT'];

export const DEFAULT_BIM_CONFIG: BimConfig = {
	min_confidence: 0.7,
	duplicate_center_tol_m: 0.05,
	shape_tolerance_pct: 3,
	size_band_step_mm: 25,
	connection_gap_tol_m: 0.05,
	variance_flag_pct: 15,
	auto_reclassify_generic: true,
	auto_split_multi_storey: true,
	auto_deduplicate: true,
	exclude_ifc_classes: [...DEFAULT_EXCLUDE_IFC_CLASSES],
	size_bands_mm: [...DEFAULT_SIZE_BANDS_MM],
	material_densities: { ...DEFAULT_MATERIAL_DENSITIES },
	service_aliases: Object.fromEntries(
		Object.entries(DEFAULT_SERVICE_ALIASES).map(([k, v]) => [k, [...v]])
	),
	extra_property_keys: [],
	max_visual_archetypes: 200,
	max_proposals: 30,
	max_candidates: 80
};

const numOr = (
	value: string | number | null | undefined,
	fallback: number,
	min: number,
	max: number
): number => {
	const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
	return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Resolves a workspace `bim_settings` row (or partial override) against safe defaults. */
export function resolveBimConfig(row?: BimSettingsRow | Partial<BimConfig> | null): BimConfig {
	if (row == null) return DEFAULT_BIM_CONFIG;
	const parsedBands = Array.isArray(row.size_bands_mm)
		? row.size_bands_mm
				.map((v) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN))
				.filter((n) => Number.isFinite(n) && n > 0)
		: [];

	const densities: Record<string, number> = isPlainRecord(row.material_densities)
		? Object.fromEntries(
				Object.entries(row.material_densities)
					.map(
						([k, rawV]) =>
							[k.trim().toLowerCase(), typeof rawV === 'number' ? rawV : Number(rawV)] as const
					)
					.filter(([k, v]) => k.length > 0 && Number.isFinite(v) && v > 0)
			)
		: { ...DEFAULT_MATERIAL_DENSITIES };

	const aliases: Record<string, string[]> = isPlainRecord(row.service_aliases)
		? Object.fromEntries(
				Object.entries(row.service_aliases)
					.map(
						([k, rawList]) =>
							[
								k.trim().toLowerCase().replace(/\s+/g, '_'),
								Array.isArray(rawList)
									? rawList
											.filter((s): s is string => typeof s === 'string')
											.map((s) => s.trim().toLowerCase())
											.filter(Boolean)
									: []
							] as const
					)
					.filter(([k, list]) => k.length > 0 && list.length > 0)
			)
		: Object.fromEntries(Object.entries(DEFAULT_SERVICE_ALIASES).map(([k, v]) => [k, [...v]]));

	return {
		min_confidence: numOr(row.min_confidence, DEFAULT_BIM_CONFIG.min_confidence, 0.1, 0.99),
		duplicate_center_tol_m: numOr(
			row.duplicate_center_tol_m,
			DEFAULT_BIM_CONFIG.duplicate_center_tol_m,
			0.005,
			1
		),
		shape_tolerance_pct: numOr(
			row.shape_tolerance_pct,
			DEFAULT_BIM_CONFIG.shape_tolerance_pct,
			0.5,
			25
		),
		size_band_step_mm: numOr(row.size_band_step_mm, DEFAULT_BIM_CONFIG.size_band_step_mm, 5, 500),
		connection_gap_tol_m: numOr(
			row.connection_gap_tol_m,
			DEFAULT_BIM_CONFIG.connection_gap_tol_m,
			0.005,
			0.5
		),
		variance_flag_pct: numOr(row.variance_flag_pct, DEFAULT_BIM_CONFIG.variance_flag_pct, 1, 100),
		auto_reclassify_generic:
			row.auto_reclassify_generic ?? DEFAULT_BIM_CONFIG.auto_reclassify_generic,
		auto_split_multi_storey:
			row.auto_split_multi_storey ?? DEFAULT_BIM_CONFIG.auto_split_multi_storey,
		auto_deduplicate: row.auto_deduplicate ?? DEFAULT_BIM_CONFIG.auto_deduplicate,
		exclude_ifc_classes:
			row.exclude_ifc_classes != null
				? row.exclude_ifc_classes.map((c) => c.trim().toUpperCase()).filter(Boolean)
				: [...DEFAULT_EXCLUDE_IFC_CLASSES],
		size_bands_mm:
			parsedBands.length > 0
				? [...new Set(parsedBands)].sort((a, b) => a - b)
				: [...DEFAULT_SIZE_BANDS_MM],
		material_densities: densities,
		service_aliases: aliases,
		extra_property_keys: (row.extra_property_keys ?? [])
			.map((k) => k.toLowerCase().replace(/[^a-z0-9]/g, ''))
			.filter(Boolean),
		max_visual_archetypes: Math.round(
			numOr(row.max_visual_archetypes, DEFAULT_BIM_CONFIG.max_visual_archetypes, 1, 2000)
		),
		max_proposals: Math.round(numOr(row.max_proposals, DEFAULT_BIM_CONFIG.max_proposals, 0, 200)),
		max_candidates: Math.round(
			numOr(row.max_candidates, DEFAULT_BIM_CONFIG.max_candidates, 10, 250)
		)
	};
}

export type ServiceMatcher = (text: string) => string | null;

export function createServiceMatcher(config: BimConfig): ServiceMatcher {
	const ranked = Object.entries(config.service_aliases)
		.flatMap(([service, phrases]) =>
			phrases
				.map((p) => p.trim().toLowerCase())
				.filter(Boolean)
				.map((phrase) => ({ service, phrase }))
		)
		.sort((a, b) => b.phrase.length - a.phrase.length);

	return (raw: string): string | null => {
		const s = raw.trim().toLowerCase();
		if (!s) return null;
		const direct = s.replace(/[\s-]+/g, '_');
		if (config.service_aliases[direct] !== undefined) return direct;
		return ranked.find(({ phrase }) => s.includes(phrase))?.service ?? null;
	};
}

export function snapSizeBandLabel(sizeMm: number | null, bands: readonly number[]): string | null {
	if (sizeMm === null || !Number.isFinite(sizeMm) || sizeMm <= 0) return null;
	if (bands.length === 0) return `${Math.round(sizeMm)}mm`;
	let prev = 0;
	for (const upper of bands) {
		if (sizeMm <= upper) return prev === 0 ? `<=${upper}mm` : `${prev + 1}-${upper}mm`;
		prev = upper;
	}
	return `>${prev}mm`;
}

/** ISO 16739 IFC linear element classes. */
export const LINEAR_IFC_CLASSES = new Set(
	'IFCPIPESEGMENT IFCDUCTSEGMENT IFCCABLESEGMENT IFCCABLECARRIERSEGMENT IFCFLOWSEGMENT IFCBEAM IFCBEAMSTANDARDCASE IFCMEMBER IFCMEMBERSTANDARDCASE IFCRAILING IFCREINFORCINGBAR IFCTENDON IFCKERB'.split(
		' '
	)
);

/** ISO 16739 IFC planar element classes. */
export const PLANAR_IFC_CLASSES = new Set(
	'IFCWALL IFCWALLSTANDARDCASE IFCWALLELEMENTEDCASE IFCSLAB IFCSLABSTANDARDCASE IFCSLABELEMENTEDCASE IFCCOVERING IFCROOF IFCCURTAINWALL IFCPLATE IFCPLATESTANDARDCASE IFCPAVEMENT IFCSURFACEFEATURE IFCREINFORCINGMESH'.split(
		' '
	)
);

/** ISO 16739 IFC MEP distribution network classes. */
export const MEP_NETWORK_CLASSES = new Set(
	'IFCFLOWSEGMENT IFCPIPESEGMENT IFCDUCTSEGMENT IFCCABLESEGMENT IFCCABLECARRIERSEGMENT IFCFLOWFITTING IFCPIPEFITTING IFCDUCTFITTING IFCCABLEFITTING IFCCABLECARRIERFITTING IFCFLOWCONTROLLER IFCVALVE IFCDISTRIBUTIONCONTROLELEMENT IFCDISTRIBUTIONFLOWELEMENT IFCFLOWMOVINGDEVICE IFCPUMP IFCFAN IFCFLOWTERMINAL IFCSANITARYTERMINAL IFCFIRESUPPRESSIONTERMINAL IFCAIRTERMINAL IFCLIGHTFIXTURE IFCOUTLET IFCSWITCHINGDEVICE IFCELECTRICDISTRIBUTIONBOARD IFCELECTRICDISTRIBUTIONPOINT IFCELECTRICAPPLIANCE IFCENERGYCONVERSIONDEVICE IFCCHILLER IFCBOILER IFCCOMPRESSOR IFCCONDENSER IFCEVAPORATOR IFCHEATEXCHANGER IFCCOOLINGTOWER IFCUNITARYEQUIPMENT IFCFLOWSTORAGEDEVICE IFCTANK IFCFLOWTREATMENTDEVICE IFCINTERCEPTOR IFCSENSOR IFCALARM IFCACTUATOR IFCCONTROLLER'.split(
		' '
	)
);

export function defaultContinuityForClass(ifcClass: string): ContinuityMode {
	const upper = ifcClass.toUpperCase();
	if (LINEAR_IFC_CLASSES.has(upper)) return 'contiguous_linear';
	if (PLANAR_IFC_CLASSES.has(upper)) return 'contiguous_planar';
	return 'discontiguous';
}

/** Looks up configured density (kg/m³) strictly from `config.material_densities`. */
export function materialDensityOf(
	materials: readonly string[],
	ifcClass: string,
	config: BimConfig
): number | null {
	const upper = ifcClass.toUpperCase();
	if (upper === 'IFCREINFORCINGBAR' || upper === 'IFCREINFORCINGMESH' || upper === 'IFCTENDON') {
		return config.material_densities['steel'] ?? 7850;
	}
	const joined = materials.join(' ').toLowerCase();
	if (!joined) return null;
	for (const key of Object.keys(config.material_densities).sort((a, b) => b.length - a.length)) {
		if (joined.includes(key)) {
			const d = config.material_densities[key];
			if (d !== undefined && d > 0) return d;
		}
	}
	return null;
}
