/**
 * Streaming ISO-10303-21 IFC STEP parser, IFC2x3→IFC4 class normalizer, and archetype aggregator.
 * Zero-regex hot path skips ~95% geometry/placement/style entities in browser workers and tests.
 */
import {
	createServiceMatcher,
	defaultContinuityForClass,
	resolveBimConfig,
	snapSizeBandLabel
} from './config.js';
import type {
	BimArchetype,
	BimAssetRecord,
	BimConfig,
	BimSettingsRow,
	BimStoreyBucket,
	ContinuityMode,
	ExtractedBimModel,
	IfcStreamStats,
	ParsedIfcModel
} from './schema.js';

export const ASSET_CLASSES = new Set(
	'IFCWALL IFCWALLSTANDARDCASE IFCWALLELEMENTEDCASE IFCSLAB IFCSLABSTANDARDCASE IFCSLABELEMENTEDCASE IFCCOLUMN IFCCOLUMNSTANDARDCASE IFCBEAM IFCBEAMSTANDARDCASE IFCROOF IFCSTAIR IFCSTAIRFLIGHT IFCDOOR IFCDOORSTANDARDCASE IFCWINDOW IFCWINDOWSTANDARDCASE IFCCOVERING IFCCURTAINWALL IFCPLATE IFCPLATESTANDARDCASE IFCMEMBER IFCMEMBERSTANDARDCASE IFCFOOTING IFCPILE IFCRAILING IFCRAMP IFCRAMPFLIGHT IFCCHIMNEY IFCSHADINGDEVICE IFCBUILDINGELEMENTPROXY IFCBUILDINGELEMENTPART IFCREINFORCINGBAR IFCREINFORCINGMESH IFCTENDON IFCFASTENER IFCMECHANICALFASTENER IFCDISCRETEACCESSORY IFCTRANSPORTELEMENT IFCCIVILELEMENT IFCGEOGRAPHICELEMENT IFCPAVEMENT IFCKERB IFCEARTHWORKSCUT IFCEARTHWORKSFILL IFCSURFACEFEATURE IFCFURNISHINGELEMENT IFCFURNITURE IFCSYSTEMFURNITUREELEMENT IFCFLOWTERMINAL IFCFLOWCONTROLLER IFCFLOWSEGMENT IFCFLOWFITTING IFCFLOWMOVINGDEVICE IFCFLOWSTORAGEDEVICE IFCENERGYCONVERSIONDEVICE IFCFLOWTREATMENTDEVICE IFCDISTRIBUTIONCONTROLELEMENT IFCDISTRIBUTIONFLOWELEMENT IFCDISTRIBUTIONCHAMBERELEMENT IFCELECTRICDISTRIBUTIONBOARD IFCELECTRICDISTRIBUTIONPOINT IFCELECTRICAPPLIANCE IFCLIGHTFIXTURE IFCOUTLET IFCSWITCHINGDEVICE IFCCABLESEGMENT IFCCABLEFITTING IFCCABLECARRIERSEGMENT IFCCABLECARRIERFITTING IFCPROTECTIVEDEVICE IFCSANITARYTERMINAL IFCFIRESUPPRESSIONTERMINAL IFCAIRTERMINAL IFCPIPESEGMENT IFCPIPEFITTING IFCDUCTSEGMENT IFCDUCTFITTING IFCVALVE IFCPUMP IFCFAN IFCCHILLER IFCBOILER IFCCOMPRESSOR IFCCONDENSER IFCEVAPORATOR IFCHEATEXCHANGER IFCCOOLINGTOWER IFCUNITARYEQUIPMENT IFCTANK IFCINTERCEPTOR IFCSENSOR IFCALARM IFCACTUATOR IFCCONTROLLER IFCSOLARDEVICE IFCAUDIOVISUALAPPLIANCE IFCCOMMUNICATIONSAPPLIANCE'.split(
		' '
	)
);

const STRUCTURAL_ENTITIES = new Set(
	'IFCPROJECT IFCSITE IFCBUILDING IFCBUILDINGSTOREY IFCSPACE IFCSIUNIT IFCMEASUREWITHUNIT IFCCONVERSIONBASEDUNIT IFCUNITASSIGNMENT IFCMAPCONVERSION IFCPROJECTEDCRS IFCRELAGGREGATES IFCRELCONTAINEDINSPATIALSTRUCTURE IFCCLASSIFICATIONREFERENCE IFCRELASSOCIATESCLASSIFICATION IFCRELDEFINESBYTYPE IFCRELASSOCIATESMATERIAL IFCMATERIAL IFCMATERIALLAYER IFCMATERIALLAYERSET IFCMATERIALLAYERSETUSAGE IFCMATERIALLIST IFCMATERIALCONSTITUENT IFCMATERIALCONSTITUENTSET IFCMATERIALPROFILE IFCMATERIALPROFILESET IFCMATERIALPROFILESETUSAGE IFCQUANTITYLENGTH IFCQUANTITYAREA IFCQUANTITYVOLUME IFCQUANTITYWEIGHT IFCELEMENTQUANTITY IFCPROPERTYSINGLEVALUE IFCPROPERTYSET IFCRELDEFINESBYPROPERTIES IFCDOORSTYLE IFCWINDOWSTYLE IFCSYSTEM IFCDISTRIBUTIONSYSTEM IFCGROUP IFCRELASSIGNSTOGROUP IFCDISTRIBUTIONPORT IFCRELCONNECTSPORTS IFCRELNESTS IFCRELCONNECTSPORTTOELEMENT IFCRELVOIDSELEMENT IFCRELCOVERSBLDGELEMENTS'.split(
		' '
	)
);

export const UPGRADEABLE_GENERIC_CLASSES = new Set(
	'IFCBUILDINGELEMENTPROXY IFCDISTRIBUTIONFLOWELEMENT IFCFLOWSEGMENT IFCFLOWFITTING IFCFLOWTERMINAL IFCFLOWCONTROLLER IFCFLOWMOVINGDEVICE IFCFLOWSTORAGEDEVICE IFCENERGYCONVERSIONDEVICE IFCFLOWTREATMENTDEVICE IFCDISTRIBUTIONCONTROLELEMENT'.split(
		' '
	)
);

const TYPE_ENTITY_TO_CLASS: Readonly<Record<string, string>> = Object.fromEntries(
	'IFCPIPESEGMENT IFCPIPEFITTING IFCDUCTSEGMENT IFCDUCTFITTING IFCCABLESEGMENT IFCCABLEFITTING IFCCABLECARRIERSEGMENT IFCCABLECARRIERFITTING IFCVALVE IFCPUMP IFCFAN IFCCHILLER IFCBOILER IFCCOMPRESSOR IFCCONDENSER IFCEVAPORATOR IFCHEATEXCHANGER IFCCOOLINGTOWER IFCUNITARYEQUIPMENT IFCTANK IFCINTERCEPTOR IFCAIRTERMINAL IFCSANITARYTERMINAL IFCFIRESUPPRESSIONTERMINAL IFCLIGHTFIXTURE IFCOUTLET IFCSWITCHINGDEVICE IFCELECTRICDISTRIBUTIONBOARD IFCELECTRICAPPLIANCE IFCPROTECTIVEDEVICE IFCSENSOR IFCALARM IFCACTUATOR IFCCONTROLLER IFCSOLARDEVICE IFCAUDIOVISUALAPPLIANCE IFCCOMMUNICATIONSAPPLIANCE IFCFURNITURE IFCSYSTEMFURNITUREELEMENT IFCTRANSPORTELEMENT'
		.split(' ')
		.map((cls) => [`${cls}TYPE`, cls])
);

const OPERATION_TYPE_ENUMS = new Set(
	'SINGLE_SWING_LEFT SINGLE_SWING_RIGHT DOUBLE_DOOR_SINGLE_SWING DOUBLE_DOOR_SINGLE_SWING_OPPOSITE_LEFT DOUBLE_DOOR_SINGLE_SWING_OPPOSITE_RIGHT DOUBLE_SWING_LEFT DOUBLE_SWING_RIGHT DOUBLE_DOOR_DOUBLE_SWING SLIDING_TO_LEFT SLIDING_TO_RIGHT DOUBLE_DOOR_SLIDING FOLDING_TO_LEFT FOLDING_TO_RIGHT DOUBLE_DOOR_FOLDING REVOLVING ROLLINGUP SWING_FIXED_LEFT SWING_FIXED_RIGHT SINGLE_PANEL DOUBLE_PANEL_VERTICAL DOUBLE_PANEL_HORIZONTAL TRIPLE_PANEL_VERTICAL TRIPLE_PANEL_BOTTOM TRIPLE_PANEL_TOP TRIPLE_PANEL_LEFT TRIPLE_PANEL_RIGHT TRIPLE_PANEL_HORIZONTAL'.split(
		' '
	)
);

const SEMANTIC_PROPERTY_NAMES = new Set(
	'firerating isexternal loadbearing acousticrating reference category family type material finish surfacefinish structuralmaterial thermaltransmittance nominaldiameter diameter outerdiameter innerdiameter size insulationthickness class schedule pressurerating systemname systemtype systemclassification service servicetype capacity voltage power grade concretegrade thickness width height clearwidth clearheight riserheight treadlength slope gradient parapetheight occupancytype predefinedtype operationtype partitioningtype glazingareafaction numberofleaves doorleafcount omniclassnumber assemblycode classificationcode'.split(
		' '
	)
);

const OPENING_CLASSES = new Set([
	'IFCDOOR',
	'IFCDOORSTANDARDCASE',
	'IFCWINDOW',
	'IFCWINDOWSTANDARDCASE'
]);
const QTY_ENTITY_KIND: Readonly<Record<string, 'length' | 'area' | 'volume' | 'weight'>> = {
	IFCQUANTITYLENGTH: 'length',
	IFCQUANTITYAREA: 'area',
	IFCQUANTITYVOLUME: 'volume',
	IFCQUANTITYWEIGHT: 'weight'
};
const QTY_FALLBACK_KEYS: Readonly<Record<string, 'length' | 'area' | 'volume' | 'weight'>> = {
	length: 'length',
	netlength: 'length',
	nominallength: 'length',
	area: 'area',
	netarea: 'area',
	grossarea: 'area',
	netsidearea: 'area',
	netfloorarea: 'area',
	volume: 'volume',
	netvolume: 'volume',
	grossvolume: 'volume',
	weight: 'weight',
	mass: 'weight',
	netweight: 'weight'
};

function decodeStepEscapes(value: string): string {
	if (!value.includes('\\X')) return value;
	return value.replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_, hex: string) => {
		let out = '';
		for (let i = 0; i + 4 <= hex.length; i += 4) {
			const code = Number.parseInt(hex.slice(i, i + 4), 16);
			if (Number.isFinite(code)) out += String.fromCharCode(code);
		}
		return out;
	});
}

function splitStepArgs(raw: string): string[] {
	const args: string[] = [];
	let depth = 0,
		inStr = false,
		start = 0;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw.charCodeAt(i);
		if (ch === 39) {
			if (inStr && raw.charCodeAt(i + 1) === 39) {
				i++;
				continue;
			}
			inStr = !inStr;
			continue;
		}
		if (inStr) continue;
		if (ch === 40) depth++;
		else if (ch === 41) depth = depth > 0 ? depth - 1 : 0;
		else if (ch === 44 && depth === 0) {
			args.push(raw.slice(start, i).trim());
			start = i + 1;
		}
	}
	const tail = raw.slice(start).trim();
	if (tail.length > 0 || args.length > 0) args.push(tail);
	return args;
}

function unquoteStep(token: string | undefined): string | null {
	if (token == null || token === '$' || token === '*') return null;
	const t = token.trim();
	if (t.length >= 2 && t.charCodeAt(0) === 39 && t.charCodeAt(t.length - 1) === 39) {
		const inner = t.slice(1, -1);
		return (
			decodeStepEscapes(inner.includes("''") ? inner.replace(/''/g, "'") : inner).trim() || null
		);
	}
	return t || null;
}

function unquoteTypedStepValue(token: string | undefined): {
	readonly typeName: string | null;
	readonly text: string | null;
} {
	if (token == null || token === '$' || token === '*') return { typeName: null, text: null };
	const t = token.trim();
	const paren = t.indexOf('(');
	if (paren > 0 && t.endsWith(')')) {
		const typeName = t.slice(0, paren).trim().toUpperCase();
		const inner = t.slice(paren + 1, -1).trim();
		if (inner === '.T.') return { typeName, text: 'true' };
		if (inner === '.F.') return { typeName, text: 'false' };
		if (inner === '.U.') return { typeName, text: null };
		return { typeName, text: unquoteStep(inner) };
	}
	return { typeName: null, text: t === '.T.' ? 'true' : t === '.F.' ? 'false' : unquoteStep(t) };
}

function parseEnumToken(token: string | undefined): string | null {
	if (token == null) return null;
	const t = token.trim();
	if (t.length > 2 && t.charCodeAt(0) === 46 && t.charCodeAt(t.length - 1) === 46) {
		const val = t.slice(1, -1).toUpperCase();
		return val === 'NOTDEFINED' || val === 'USERDEFINED' || val === 'ELEMENT' ? null : val;
	}
	return null;
}

function parseRef(token: string | undefined): number | null {
	if (token == null) return null;
	const t = token.trim();
	if (t.length < 2 || t.charCodeAt(0) !== 35) return null;
	let n = 0;
	for (let i = 1; i < t.length; i++) {
		const c = t.charCodeAt(i);
		if (c < 48 || c > 57) return null;
		n = n * 10 + (c - 48);
	}
	return n > 0 ? n : null;
}

function parseRefList(token: string | undefined): number[] {
	if (token == null) return [];
	const out: number[] = [];
	for (let i = 0; i < token.length; i++) {
		if (token.charCodeAt(i) !== 35) continue;
		i++;
		let n = 0,
			digits = 0;
		while (i < token.length) {
			const c = token.charCodeAt(i);
			if (c < 48 || c > 57) {
				i--;
				break;
			}
			n = n * 10 + (c - 48);
			digits++;
			i++;
		}
		if (digits > 0) out.push(n);
	}
	return out;
}

function parseStepNumber(token: string | undefined): number | null {
	if (token == null || token === '$' || token === '*') return null;
	let s = token.trim();
	const paren = s.indexOf('(');
	if (paren > 0 && s.endsWith(')')) s = s.slice(paren + 1, -1).trim();
	if (!s || s.charCodeAt(0) === 39 || s.charCodeAt(0) === 46) return null;
	const n = Number(s);
	return Number.isFinite(n) ? n : null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function parseNominalSizeMm(raw: string): number | null {
	const s = raw.trim();
	if (!s) return null;
	const pos = (v: number) => (Number.isFinite(v) && v > 0 ? r1(v) : null);
	const dn = s.match(/\b(?:dn|nb)\s*(\d+(?:\.\d+)?)\b/i);
	if (dn?.[1]) return pos(Number(dn[1]));
	const rectMm = s.match(/(\d+(?:\.\d+)?)\s*(?:mm)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*mm/i);
	if (rectMm?.[1] && rectMm?.[2]) return pos(Math.max(Number(rectMm[1]), Number(rectMm[2])));
	const mm = s.match(/(\d+(?:\.\d+)?)\s*mm/i);
	if (mm?.[1]) return pos(Number(mm[1]));
	const cm = s.match(/(\d+(?:\.\d+)?)\s*cm\b/i);
	if (cm?.[1]) return pos(Number(cm[1]) * 10);
	const m = s.match(/(\d+(?:\.\d+)?)\s*m(?:\b|ø)/i);
	if (m?.[1]) return pos(Number(m[1]) * 1000);
	const fracInch = s.match(/(\d+)\s+(\d+)\/(\d+)\s*(?:"|in\b)/i);
	if (fracInch?.[1] && fracInch?.[2] && fracInch?.[3]) {
		return pos((Number(fracInch[1]) + Number(fracInch[2]) / Number(fracInch[3])) * 25.4);
	}
	const onlyFrac = s.match(/(\d+)\/(\d+)\s*(?:"|in\b)/i);
	if (onlyFrac?.[1] && onlyFrac?.[2])
		return pos((Number(onlyFrac[1]) / Number(onlyFrac[2])) * 25.4);
	const decInch = s.match(/(\d+(?:\.\d+)?)\s*(?:"|in\b)/i);
	if (decInch?.[1]) return pos(Number(decInch[1]) * 25.4);
	return null;
}

function quantityPriority(kind: 'length' | 'area' | 'volume' | 'weight', name: string): number {
	const n = name.toLowerCase();
	if (kind === 'area') {
		if (['netsidearea', 'netfloorarea', 'netarea', 'netsurfacearea'].includes(n)) return 10;
		if (['grosssidearea', 'grossfloorarea', 'grossarea'].includes(n)) return 8;
		if (['area', 'footprintarea', 'outersurfacearea'].includes(n)) return 6;
		return n.includes('crosssection') ? 2 : 4;
	}
	if (kind === 'volume')
		return n === 'netvolume' ? 10 : n === 'grossvolume' ? 8 : n === 'volume' ? 6 : 4;
	if (kind === 'length') {
		if (['length', 'nominallength', 'netlength', 'grosslength'].includes(n)) return 10;
		if (
			[
				'perimeter',
				'grossperimeter',
				'width',
				'depth',
				'thickness',
				'overallwidth',
				'overallheight'
			].includes(n)
		)
			return -1;
		return n === 'height' ? 3 : 4;
	}
	return ['netweight', 'weight', 'mass'].includes(n) ? 10 : n === 'grossweight' ? 8 : 4;
}

const isRelevantEntity = (entity: string): boolean =>
	ASSET_CLASSES.has(entity) ||
	STRUCTURAL_ENTITIES.has(entity) ||
	(entity.length > 7 && entity.startsWith('IFC') && entity.endsWith('TYPE'));

export function normalizeInstanceName(raw: string): string {
	let s = raw.trim();
	if (!s) return '';
	const parts = s
		.split(':')
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length >= 3) {
		if (/^(?:[A-Za-z]{0,2}\d{1,7}|[0-9A-Fa-f]{6,})$/.test(parts[parts.length - 1] ?? ''))
			parts.pop();
		s = parts.join(':');
	} else if (
		parts.length === 2 &&
		/^(?:[A-Za-z]{0,2}\d{1,7}|Zone\s*[A-Za-z0-9]+)$/i.test(parts[1] ?? '')
	) {
		s = parts[0] ?? s;
	}
	return s
		.replace(/(?:[\s_-]+(?:#|no\.?|id|L\d{1,2}[\s_-]?)?\d{1,6})$/i, '')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, ' ');
}

export function computeArchetypeSignature(elem: BimAssetRecord, config: BimConfig): string {
	const layerSig = (elem.material_layers.length > 0 ? elem.material_layers : elem.materials)
		.map((s) => s.toLowerCase())
		.join('+');
	const needsBand =
		elem.continuity === 'contiguous_linear' ||
		elem.continuity === 'contiguous_planar' ||
		elem.ifc_class.includes('FITTING') ||
		elem.ifc_class === 'IFCVALVE';
	const sizeBand = needsBand
		? (snapSizeBandLabel(elem.nominal_size_mm, config.size_bands_mm) ?? '')
		: '';
	const serviceSig = (elem.service ?? elem.system_type ?? '').toLowerCase();
	const q10 = (v: number | null | undefined) =>
		v != null && v > 0 ? Math.round(v / 10) * 10 : null;
	const clsUp = elem.ifc_class.toUpperCase();
	const dimSig = [
		clsUp.startsWith('IFCSTAIR') && elem.riser_mm != null ? `r=${Math.round(elem.riser_mm)}` : '',
		clsUp.startsWith('IFCSTAIR') && elem.tread_mm != null ? `tr=${Math.round(elem.tread_mm)}` : '',
		clsUp.startsWith('IFCRAMP') && elem.slope_pct != null
			? `sl=${Math.round(elem.slope_pct * 2) / 2}`
			: '',
		clsUp === 'IFCRAILING' && elem.height_mm != null ? `h=${q10(elem.height_mm)}` : '',
		(clsUp.startsWith('IFCDOOR') || clsUp.startsWith('IFCWINDOW')) && elem.width_mm != null
			? `w=${q10(elem.width_mm)}`
			: '',
		(clsUp.startsWith('IFCDOOR') || clsUp.startsWith('IFCWINDOW')) && elem.height_mm != null
			? `h=${q10(elem.height_mm)}`
			: ''
	]
		.filter(Boolean)
		.join(',');
	const traitsSig = [
		elem.fire_rating ? `fr=${elem.fire_rating.toLowerCase()}` : '',
		elem.is_external === true ? 'ext' : elem.is_external === false ? 'int' : '',
		elem.load_bearing === true ? 'lb' : '',
		dimSig
	]
		.filter(Boolean)
		.join(',');
	const tail = [
		serviceSig,
		sizeBand,
		elem.insulated ? 'INS' : '',
		elem.operation_type ?? '',
		elem.predefined_type ?? '',
		(elem.classification_code ?? '').toLowerCase(),
		layerSig,
		traitsSig
	];
	if (elem.type_id !== null) {
		const typeKey = elem.type_name?.trim()
			? normalizeInstanceName(elem.type_name) || elem.type_name.trim().toLowerCase()
			: `#${elem.type_id}`;
		return ['TYPE', elem.ifc_class, elem.continuity, typeKey, ...tail].join('|');
	}
	const normName = normalizeInstanceName(elem.name) || elem.family.toLowerCase();
	return [
		'INST',
		elem.ifc_class,
		elem.continuity,
		normName,
		(elem.object_type ?? '').toLowerCase(),
		...tail
	].join('|');
}

function classifyEnums(args: readonly string[], startIdx: number) {
	let predefined: string | null = null,
		operation: string | null = null;
	for (let k = args.length - 1; k >= startIdx; k--) {
		const parsed = parseEnumToken(args[k]);
		if (parsed === null) continue;
		if (OPERATION_TYPE_ENUMS.has(parsed)) operation ??= parsed;
		else predefined ??= parsed;
	}
	return { predefined, operation };
}

type RawAsset = {
	readonly express_id: number;
	readonly global_id: string | null;
	readonly ifc_class: string;
	readonly name: string;
	readonly object_type: string | null;
	readonly predefined_type: string | null;
	readonly operation_type: string | null;
	readonly overall_height_raw: number | null;
	readonly overall_width_raw: number | null;
	readonly riser_raw: number | null;
	readonly tread_raw: number | null;
};
type TypeInfo = {
	readonly entity: string;
	readonly name: string | null;
	readonly description: string | null;
	readonly predefined_type: string | null;
	readonly operation_type: string | null;
};
type QtyEntry = {
	readonly kind: 'length' | 'area' | 'volume' | 'weight';
	readonly name: string;
	readonly value: number;
};
type PropEntry = {
	readonly key: string;
	readonly label: string;
	readonly valueType: string | null;
	readonly numeric: number | null;
	readonly text: string | null;
};

const pushList = (map: Map<number, number[]>, key: number, val: number) => {
	const list = map.get(key);
	if (list) list.push(val);
	else map.set(key, [val]);
};

export function createIfcStepStreamParser(
	configInput?: BimSettingsRow | Partial<BimConfig> | null
) {
	const config = resolveBimConfig(configInput);
	const matchService = createServiceMatcher(config);
	const excludedClasses = new Set(config.exclude_ifc_classes.map((c) => c.toUpperCase()));
	const semanticKeys = new Set([...SEMANTIC_PROPERTY_NAMES, ...config.extra_property_keys]);
	const decoder = new TextDecoder('utf-8', { fatal: false });

	let remainder = '',
		schema = 'IFC2X3',
		schemaFound = false;
	let projectName: string | null = null;
	let crsName: string | null = null;
	let statementsScanned = 0,
		relevantStatements = 0;
	let lengthFactor = 1,
		areaFactor = 1,
		volumeFactor = 1,
		massFactor = 1;
	const siUnits = new Map<
		number,
		{ readonly kind: 'length' | 'area' | 'volume' | 'mass'; readonly factor: number }
	>();
	const convUnits = new Map<
		number,
		{ readonly kind: 'length' | 'area' | 'volume' | 'mass'; readonly measureRef: number }
	>();
	const assignedUnitIds = new Set<number>();
	const sgPsetIds = new Set<number>();

	const storeys = new Map<number, string>();
	const storeyElevationsRaw = new Map<number, number>();
	const spaces = new Map<number, string>();
	const sites = new Map<number, string>();
	const parentOf = new Map<number, number>();
	const childrenOf = new Map<number, number[]>();
	const elementToContainer = new Map<number, number>();
	const classifications = new Map<number, { code: string | null; name: string | null }>();
	const entityClassification = new Map<number, number>();
	const systems = new Map<number, { name: string | null; predefined_type: string | null }>();
	const elementToSystems = new Map<number, number[]>();
	const portToElement = new Map<number, number>();
	const portEdges: [number, number][] = [];
	const openingCount = new Map<number, number>();
	const elementCoverings = new Map<number, number[]>();
	const typeObjects = new Map<number, TypeInfo>();
	const elementToType = new Map<number, number>();
	const materialNames = new Map<number, string>();
	const materialLayers = new Map<
		number,
		{ material_ref: number | null; thickness_raw: number | null; name: string | null }
	>();
	const materialLinks = new Map<number, number[]>();
	const entityMaterials = new Map<number, number[]>();
	const measureWithUnit = new Map<
		number,
		{ readonly factor: number; readonly unitRef: number | null }
	>();
	const qtyValues = new Map<number, QtyEntry>();
	const elemQuantities = new Map<number, number[]>();
	const propSingle = new Map<number, PropEntry>();
	const propSets = new Map<number, number[]>();
	const entityDefs = new Map<number, number[]>();
	const rawAssets: RawAsset[] = [];
	const rawById = new Map<number, RawAsset>();

	function unitKindOf(unitType: string): 'length' | 'area' | 'volume' | 'mass' | null {
		if (unitType.includes('LENGTHUNIT')) return 'length';
		if (unitType.includes('AREAUNIT')) return 'area';
		if (unitType.includes('VOLUMEUNIT')) return 'volume';
		if (unitType.includes('MASSUNIT')) return 'mass';
		return null;
	}

	function siUnitFactorOf(
		kind: 'length' | 'area' | 'volume' | 'mass',
		prefix: string,
		name: string
	): number {
		if (kind === 'length') {
			if (prefix.includes('MILLI')) return 0.001;
			if (prefix.includes('CENTI')) return 0.01;
			if (prefix.includes('DECI')) return 0.1;
			if (prefix.includes('KILO')) return 1000;
			return 1;
		}
		if (kind === 'area')
			return prefix.includes('MILLI')
				? 1e-6
				: prefix.includes('CENTI')
					? 1e-4
					: prefix.includes('DECI')
						? 1e-2
						: 1;
		if (kind === 'volume')
			return prefix.includes('MILLI')
				? 1e-9
				: prefix.includes('CENTI')
					? 1e-6
					: prefix.includes('DECI')
						? 1e-3
						: 1;
		return name.includes('GRAM') && !prefix.includes('KILO') ? 0.001 : 1;
	}

	/** Strictly resolves units assigned via `IFCUNITASSIGNMENT` so auxiliary derived-unit SI defs never overwrite project units. */
	function resolveUnits(): void {
		lengthFactor = 1;
		areaFactor = 1;
		volumeFactor = 1;
		massFactor = 1;
		const setFactor = (kind: 'length' | 'area' | 'volume' | 'mass', factor: number) => {
			if (kind === 'length') lengthFactor = factor;
			else if (kind === 'area') areaFactor = factor;
			else if (kind === 'volume') volumeFactor = factor;
			else massFactor = factor;
		};
		const applyUnitId = (uid: number): boolean => {
			const si = siUnits.get(uid);
			if (si) {
				setFactor(si.kind, si.factor);
				return true;
			}
			const conv = convUnits.get(uid);
			if (conv) {
				const mw = measureWithUnit.get(conv.measureRef);
				if (mw) {
					const base = mw.unitRef !== null ? (siUnits.get(mw.unitRef)?.factor ?? 1) : 1;
					setFactor(conv.kind, mw.factor * base);
					return true;
				}
			}
			return false;
		};
		if (assignedUnitIds.size > 0) {
			for (const uid of assignedUnitIds) applyUnitId(uid);
			return;
		}
		const seenKinds = new Set<string>();
		for (const [uid, def] of siUnits) {
			if (!seenKinds.has(def.kind)) {
				seenKinds.add(def.kind);
				applyUnitId(uid);
			}
		}
		for (const [uid, def] of convUnits) {
			if (!seenKinds.has(def.kind)) {
				seenKinds.add(def.kind);
				applyUnitId(uid);
			}
		}
	}

	function processStatement(stmt: string): void {
		statementsScanned++;
		const len = stmt.length;
		let i = 0;
		while (i < len && stmt.charCodeAt(i) <= 32) i++;
		if (i >= len) return;

		if (!schemaFound && stmt.charCodeAt(i) !== 35) {
			if (stmt.indexOf('FILE_SCHEMA', i) !== -1) {
				const m = stmt.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i);
				if (m?.[1]) {
					schema = m[1];
					schemaFound = true;
				}
			}
			return;
		}
		if (stmt.charCodeAt(i) !== 35) return;
		i++;
		let id = 0,
			digits = 0;
		while (i < len) {
			const c = stmt.charCodeAt(i);
			if (c < 48 || c > 57) break;
			id = id * 10 + (c - 48);
			digits++;
			i++;
		}
		if (digits === 0) return;
		while (i < len && stmt.charCodeAt(i) <= 32) i++;
		if (i >= len || stmt.charCodeAt(i) !== 61) return;
		i++;
		while (i < len && stmt.charCodeAt(i) <= 32) i++;

		const entityStart = i;
		while (i < len) {
			const c = stmt.charCodeAt(i);
			if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95) i++;
			else break;
		}
		if (i === entityStart) return;
		const entity = stmt.slice(entityStart, i).toUpperCase();
		if (!isRelevantEntity(entity)) return;
		relevantStatements++;

		const openParen = stmt.indexOf('(', i);
		const closeParen = stmt.lastIndexOf(')');
		if (openParen < 0 || closeParen <= openParen) return;
		const argStr = stmt.slice(openParen + 1, closeParen);

		if (ASSET_CLASSES.has(entity)) {
			if (excludedClasses.has(entity)) return;
			const args = splitStepArgs(argStr);
			const enums = classifyEnums(args, 5);
			const isOpen = OPENING_CLASSES.has(entity);
			const isStairFlight = entity === 'IFCSTAIRFLIGHT';
			const h = isOpen ? parseStepNumber(args[8]) : null;
			const w = isOpen ? parseStepNumber(args[9]) : null;
			const riser = isStairFlight ? parseStepNumber(args[10]) : null;
			const tread = isStairFlight ? parseStepNumber(args[11]) : null;
			const rec: RawAsset = {
				express_id: id,
				global_id: unquoteStep(args[0]),
				ifc_class: entity,
				name: unquoteStep(args[2]) ?? entity,
				object_type: unquoteStep(args[4]),
				predefined_type: enums.predefined,
				operation_type: enums.operation,
				overall_height_raw: h !== null && h > 0 ? h : null,
				overall_width_raw: w !== null && w > 0 ? w : null,
				riser_raw: riser !== null && riser > 0 ? riser : null,
				tread_raw: tread !== null && tread > 0 ? tread : null
			};
			rawAssets.push(rec);
			rawById.set(id, rec);
			return;
		}

		const qtyKind = QTY_ENTITY_KIND[entity];
		if (qtyKind) {
			const args = splitStepArgs(argStr);
			const v = parseStepNumber(args[3]);
			if (v !== null && v > 0)
				qtyValues.set(id, { kind: qtyKind, name: unquoteStep(args[0]) ?? qtyKind, value: v });
			return;
		}

		const args = splitStepArgs(argStr);
		switch (entity) {
			case 'IFCPROJECT':
				projectName = unquoteStep(args[5]) ?? unquoteStep(args[2]);
				break;
			case 'IFCBUILDINGSTOREY': {
				storeys.set(id, unquoteStep(args[2]) ?? unquoteStep(args[7]) ?? `Storey #${id}`);
				const elev = parseStepNumber(args[9]);
				if (elev !== null) storeyElevationsRaw.set(id, elev);
				break;
			}
			case 'IFCSPACE':
				spaces.set(id, unquoteStep(args[7]) ?? unquoteStep(args[2]) ?? `Space #${id}`);
				break;
			case 'IFCSITE':
				sites.set(id, unquoteStep(args[7]) ?? unquoteStep(args[2]) ?? 'Site / External Works');
				break;
			case 'IFCSYSTEM':
			case 'IFCDISTRIBUTIONSYSTEM':
			case 'IFCGROUP': {
				const name = unquoteStep(args[2]) ?? unquoteStep(args[3]);
				const { predefined } = classifyEnums(args, 4);
				if (name !== null || predefined !== null)
					systems.set(id, { name, predefined_type: predefined });
				break;
			}
			case 'IFCRELASSIGNSTOGROUP': {
				const g = parseRef(args[6]);
				if (g !== null) for (const rid of parseRefList(args[4])) pushList(elementToSystems, rid, g);
				break;
			}
			case 'IFCRELCONNECTSPORTS': {
				const p1 = parseRef(args[4]),
					p2 = parseRef(args[5]);
				if (p1 !== null && p2 !== null) portEdges.push([p1, p2]);
				break;
			}
			case 'IFCRELNESTS': {
				const owner = parseRef(args[4]);
				if (owner !== null) for (const nid of parseRefList(args[5])) portToElement.set(nid, owner);
				break;
			}
			case 'IFCRELCONNECTSPORTTOELEMENT': {
				const p = parseRef(args[4]),
					e = parseRef(args[5]);
				if (p !== null && e !== null) portToElement.set(p, e);
				break;
			}
			case 'IFCRELVOIDSELEMENT': {
				const e = parseRef(args[4]);
				if (e !== null) openingCount.set(e, (openingCount.get(e) ?? 0) + 1);
				break;
			}
			case 'IFCRELCOVERSBLDGELEMENTS': {
				const e = parseRef(args[4]);
				if (e !== null) for (const cid of parseRefList(args[5])) pushList(elementCoverings, e, cid);
				break;
			}
			case 'IFCSIUNIT': {
				const kind = unitKindOf(args[1] ?? '');
				if (kind)
					siUnits.set(id, { kind, factor: siUnitFactorOf(kind, args[2] ?? '', args[3] ?? '') });
				break;
			}
			case 'IFCMEASUREWITHUNIT': {
				const f = parseStepNumber(args[0]);
				if (f !== null && f > 0) measureWithUnit.set(id, { factor: f, unitRef: parseRef(args[1]) });
				break;
			}
			case 'IFCCONVERSIONBASEDUNIT': {
				const kind = unitKindOf(args[1] ?? '');
				const fRef = parseRef(args[3]);
				if (kind && fRef !== null) convUnits.set(id, { kind, measureRef: fRef });
				break;
			}
			case 'IFCUNITASSIGNMENT': {
				for (const uid of parseRefList(args[0])) assignedUnitIds.add(uid);
				break;
			}
			case 'IFCPROJECTEDCRS': {
				const name = [unquoteStep(args[0]), unquoteStep(args[2]), unquoteStep(args[3])]
					.filter(Boolean)
					.join(' / ');
				if (name) crsName ??= name;
				break;
			}
			case 'IFCMAPCONVERSION': {
				if (crsName === null) crsName = 'IfcMapConversion';
				break;
			}
			case 'IFCRELAGGREGATES': {
				const p = parseRef(args[4]);
				if (p !== null)
					for (const c of parseRefList(args[5])) {
						parentOf.set(c, p);
						pushList(childrenOf, p, c);
					}
				break;
			}
			case 'IFCRELCONTAINEDINSPATIALSTRUCTURE': {
				const s = parseRef(args[5]);
				if (s !== null) for (const r of parseRefList(args[4])) elementToContainer.set(r, s);
				break;
			}
			case 'IFCCLASSIFICATIONREFERENCE': {
				const code = unquoteStep(args[1]),
					name = unquoteStep(args[2]);
				if (code !== null || name !== null) classifications.set(id, { code, name });
				break;
			}
			case 'IFCRELASSOCIATESCLASSIFICATION': {
				const c = parseRef(args[5]);
				if (c !== null) for (const r of parseRefList(args[4])) entityClassification.set(r, c);
				break;
			}
			case 'IFCRELDEFINESBYTYPE': {
				const t = parseRef(args[5]);
				if (t !== null) for (const r of parseRefList(args[4])) elementToType.set(r, t);
				break;
			}
			case 'IFCMATERIAL': {
				const name = unquoteStep(args[0]);
				if (name !== null) materialNames.set(id, name);
				break;
			}
			case 'IFCMATERIALLAYER': {
				const matRef = parseRef(args[0]);
				materialLayers.set(id, {
					material_ref: matRef,
					thickness_raw: parseStepNumber(args[1]),
					name: unquoteStep(args[3])
				});
				if (matRef !== null) materialLinks.set(id, [matRef]);
				break;
			}
			case 'IFCMATERIALCONSTITUENT':
			case 'IFCMATERIALPROFILE': {
				const m = parseRef(args[2]) ?? parseRef(args[0]);
				if (m !== null) materialLinks.set(id, [m]);
				break;
			}
			case 'IFCMATERIALLAYERSET':
			case 'IFCMATERIALLIST':
			case 'IFCMATERIALCONSTITUENTSET':
			case 'IFCMATERIALPROFILESET': {
				const refs = parseRefList(argStr);
				if (refs.length > 0) materialLinks.set(id, refs);
				break;
			}
			case 'IFCMATERIALLAYERSETUSAGE':
			case 'IFCMATERIALPROFILESETUSAGE': {
				const s = parseRef(args[0]);
				if (s !== null) materialLinks.set(id, [s]);
				break;
			}
			case 'IFCRELASSOCIATESMATERIAL': {
				const m = parseRef(args[5]);
				if (m !== null) for (const r of parseRefList(args[4])) pushList(entityMaterials, r, m);
				break;
			}
			case 'IFCELEMENTQUANTITY':
				elemQuantities.set(id, parseRefList(args[5]));
				break;
			case 'IFCPROPERTYSET': {
				const psetName = unquoteStep(args[2]);
				if (psetName && /^sgpset_|^sg_/i.test(psetName.trim())) sgPsetIds.add(id);
				propSets.set(id, parseRefList(args[4]));
				break;
			}
			case 'IFCRELDEFINESBYPROPERTIES': {
				const d = parseRef(args[5]);
				if (d !== null) for (const r of parseRefList(args[4])) pushList(entityDefs, r, d);
				break;
			}
			case 'IFCPROPERTYSINGLEVALUE': {
				const label = unquoteStep(args[0]);
				if (!label) return;
				const key = label.toLowerCase().replace(/[^a-z0-9]/g, '');
				const numeric = parseStepNumber(args[2]);
				const isQtyFallback =
					numeric !== null && numeric > 0 && QTY_FALLBACK_KEYS[key] !== undefined;
				if (!isQtyFallback && !semanticKeys.has(key)) return;
				const parsed = unquoteTypedStepValue(args[2]);
				const cleanText =
					parsed.text && parsed.text.toLowerCase() !== label.trim().toLowerCase()
						? parsed.text
						: null;
				if (numeric !== null || cleanText !== null) {
					propSingle.set(id, { key, label, valueType: parsed.typeName, numeric, text: cleanText });
				}
				break;
			}
			default: {
				if (entity.endsWith('TYPE') || entity === 'IFCDOORSTYLE' || entity === 'IFCWINDOWSTYLE') {
					const enums = classifyEnums(args, 4);
					for (const pRef of parseRefList(args[5])) pushList(entityDefs, id, pRef);
					typeObjects.set(id, {
						entity,
						name: unquoteStep(args[2]),
						description: unquoteStep(args[3]),
						predefined_type: enums.predefined,
						operation_type: enums.operation
					});
				}
			}
		}
	}

	function scanBuffer(text: string): string {
		let start = 0,
			inStr = false;
		for (let i = 0; i < text.length; i++) {
			const ch = text.charCodeAt(i);
			if (ch === 39) {
				if (inStr && i + 1 < text.length && text.charCodeAt(i + 1) === 39) {
					i++;
					continue;
				}
				inStr = !inStr;
				continue;
			}
			if (!inStr && ch === 59) {
				processStatement(text.slice(start, i));
				start = i + 1;
			}
		}
		return start < text.length ? text.slice(start) : '';
	}

	const push = (chunk: string | Uint8Array): void => {
		const piece = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
		if (piece.length > 0) remainder = scanBuffer(remainder ? remainder + piece : piece);
	};

	const flush = (): void => {
		const combined = remainder + decoder.decode();
		remainder = '';
		if (combined.length > 0) {
			const leftover = scanBuffer(combined);
			if (leftover.trim().length > 0) processStatement(leftover);
		}
	};

	function resolveStorey(expressId: number): string {
		let curr = elementToContainer.get(expressId) ?? parentOf.get(expressId);
		let fallbackSpace: string | null = null,
			fallbackSite: string | null = null;
		for (let hops = 0; curr !== undefined && hops < 8; hops++) {
			const s = storeys.get(curr);
			if (s !== undefined) return s;
			fallbackSpace ??= spaces.get(curr) ?? null;
			fallbackSite ??= sites.get(curr) ?? null;
			curr = parentOf.get(curr);
		}
		return fallbackSpace ?? fallbackSite ?? 'Unassigned';
	}

	const materialCache = new Map<number, readonly string[]>();
	function collectMaterials(refId: number, depth = 0): readonly string[] {
		if (depth > 6) return [];
		const cached = materialCache.get(refId);
		if (cached) return cached;
		const direct = materialNames.get(refId);
		if (direct !== undefined) {
			const out = [direct];
			materialCache.set(refId, out);
			return out;
		}
		const set = new Set<string>();
		for (const cid of materialLinks.get(refId) ?? []) {
			for (const name of collectMaterials(cid, depth + 1)) {
				set.add(name);
				if (set.size >= 6) break;
			}
			if (set.size >= 6) break;
		}
		const out = [...set];
		materialCache.set(refId, out);
		return out;
	}

	const layerCache = new Map<number, readonly { desc: string; mm: number }[]>();
	function collectMaterialLayers(
		refId: number,
		depth = 0
	): readonly { desc: string; mm: number }[] {
		if (depth > 6) return [];
		const cached = layerCache.get(refId);
		if (cached) return cached;
		const layer = materialLayers.get(refId);
		if (layer) {
			const matName =
				(layer.material_ref !== null ? materialNames.get(layer.material_ref) : undefined) ??
				layer.name ??
				'Layer';
			const mm =
				layer.thickness_raw && layer.thickness_raw > 0
					? r1(layer.thickness_raw * lengthFactor * 1000)
					: 0;
			const out = [{ desc: mm > 0 ? `${matName} (${mm}mm)` : matName, mm }];
			layerCache.set(refId, out);
			return out;
		}
		const out: { desc: string; mm: number }[] = [];
		for (const cid of materialLinks.get(refId) ?? []) {
			for (const entry of collectMaterialLayers(cid, depth + 1)) {
				out.push(entry);
				if (out.length >= 12) break;
			}
			if (out.length >= 12) break;
		}
		layerCache.set(refId, out);
		return out;
	}

	function resolveMaterialsFor(expressId: number, typeId: number | undefined) {
		const names = new Set<string>();
		let layers: readonly { desc: string; mm: number }[] = [];
		for (const list of [
			entityMaterials.get(expressId),
			typeId !== undefined ? entityMaterials.get(typeId) : undefined
		]) {
			for (const ref of list ?? []) {
				if (layers.length === 0) layers = collectMaterialLayers(ref);
				for (const name of collectMaterials(ref)) {
					names.add(name);
					if (names.size >= 6) break;
				}
			}
		}
		const totalMm = layers.reduce((acc, l) => acc + l.mm, 0);
		return {
			materials: [...names],
			material_layers: layers.map((l) => l.desc),
			total_thickness_mm: totalMm > 0 ? r1(totalMm) : null
		};
	}

	function resolveQuantitiesAndProps(expressId: number, typeId: number | undefined) {
		const qty: {
			length: number | null;
			area: number | null;
			volume: number | null;
			weight: number | null;
		} = {
			length: null,
			area: null,
			volume: null,
			weight: null
		};
		const pri = { length: -1, area: -1, volume: -1, weight: -1 };
		const factorOf = {
			length: lengthFactor,
			area: areaFactor,
			volume: volumeFactor,
			weight: massFactor
		};

		let systemName: string | null = null,
			systemType: string | null = null;
		let sizeLabel: string | null = null,
			sizeFromTextMm: number | null = null,
			sizeFromLengthMm: number | null = null;
		let widthMm: number | null = null,
			heightMm: number | null = null,
			thicknessMm: number | null = null;
		let riserMm: number | null = null,
			treadMm: number | null = null,
			slopePct: number | null = null;
		let insulationMm: number | null = null,
			fireRating: string | null = null,
			hasSgPset = false;
		let isExternal: boolean | null = null,
			loadBearing: boolean | null = null,
			propMaterial: string | null = null;
		const propMap = new Map<string, string>();

		for (const defs of [
			entityDefs.get(expressId),
			typeId !== undefined ? entityDefs.get(typeId) : undefined
		]) {
			for (const defId of defs ?? []) {
				if (sgPsetIds.has(defId)) hasSgPset = true;
				for (const qid of elemQuantities.get(defId) ?? []) {
					const q = qtyValues.get(qid);
					if (!q) continue;
					if (q.kind === 'length') {
						const qn = q.name.toLowerCase();
						const mm = r1(q.value * lengthFactor * 1000);
						if (
							(qn === 'width' || qn === 'overallwidth' || qn === 'clearwidth') &&
							widthMm === null
						)
							widthMm = mm;
						else if (
							(qn === 'height' || qn === 'overallheight' || qn === 'clearheight') &&
							heightMm === null
						)
							heightMm = mm;
						else if ((qn === 'thickness' || qn === 'depth') && thicknessMm === null)
							thicknessMm = mm;
					}
					const p = quantityPriority(q.kind, q.name);
					if (p > pri[q.kind]) {
						qty[q.kind] = q.value * factorOf[q.kind];
						pri[q.kind] = p;
					}
				}
				for (const pid of propSets.get(defId) ?? []) {
					const p = propSingle.get(pid);
					if (!p) continue;
					if (p.numeric !== null && p.numeric > 0) {
						const fbKind = QTY_FALLBACK_KEYS[p.key];
						if (fbKind && qty[fbKind] === null) {
							qty[fbKind] = p.numeric * factorOf[fbKind];
						} else if (
							p.valueType === 'IFCLENGTHMEASURE' ||
							p.valueType === 'IFCPOSITIVELENGTHMEASURE'
						) {
							const mm = r1(p.numeric * lengthFactor * 1000);
							if (p.key === 'nominaldiameter' || p.key === 'diameter' || p.key === 'thickness') {
								sizeFromLengthMm ??= mm;
								if (p.key === 'thickness') thicknessMm ??= mm;
							} else if (p.key === 'width' || p.key === 'overallwidth' || p.key === 'clearwidth')
								widthMm ??= mm;
							else if (
								p.key === 'height' ||
								p.key === 'overallheight' ||
								p.key === 'clearheight' ||
								p.key === 'parapetheight'
							)
								heightMm ??= mm;
							else if (p.key === 'riserheight') riserMm ??= mm;
							else if (p.key === 'treadlength') treadMm ??= mm;
							else if (p.key === 'insulationthickness') insulationMm ??= mm;
						} else if (p.key === 'slope' || p.key === 'gradient') {
							// IFC PlaneAngle (rad) or Ratio (e.g. 0.0833 = 8.33%) or already percent (>1)
							const raw = p.numeric;
							slopePct ??= r1(raw > 1 ? raw : raw * 100);
						} else if (p.key === 'insulationthickness' && insulationMm === null) {
							insulationMm = r1(p.numeric * 1000);
						}
					}
					if (p.text) {
						if (p.key === 'systemname') systemName ??= p.text;
						else if (
							['systemtype', 'systemclassification', 'service', 'servicetype'].includes(p.key)
						)
							systemType ??= p.text;
						else if (p.key === 'size' && sizeLabel === null) {
							sizeLabel = p.text;
							sizeFromTextMm = parseNominalSizeMm(p.text);
						} else if (p.key === 'firerating') fireRating ??= p.text;
						else if (p.key === 'isexternal' && isExternal === null)
							isExternal = p.text === 'true' ? true : p.text === 'false' ? false : null;
						else if (p.key === 'loadbearing' && loadBearing === null)
							loadBearing = p.text === 'true' ? true : p.text === 'false' ? false : null;
						else if (p.key === 'material' || p.key === 'structuralmaterial')
							propMaterial ??= p.text;
						if (propMap.size < 16 && !propMap.has(p.label))
							propMap.set(p.label, `${p.label}=${p.text.slice(0, 60)}`);
					}
				}
			}
		}
		if (fireRating !== null && !propMap.has('FireRating'))
			propMap.set('FireRating', `FireRating=${fireRating.slice(0, 60)}`);

		for (const sref of elementToSystems.get(expressId) ?? []) {
			const sys = systems.get(sref);
			if (!sys) continue;
			if (sys.name) systemName ??= sys.name;
			if (sys.predefined_type) systemType ??= sys.predefined_type;
		}

		return {
			lengthM: qty.length,
			areaM2: qty.area,
			volumeM3: qty.volume,
			weightKg: qty.weight,
			systemName,
			systemType,
			sizeLabel,
			nominalSizeMm: sizeFromTextMm ?? sizeFromLengthMm,
			widthMm,
			heightMm,
			thicknessMm,
			riserMm,
			treadMm,
			slopePct,
			hasSgPset,
			insulationMm,
			fireRating,
			isExternal,
			loadBearing,
			propMaterial,
			properties: [...propMap.values()]
		};
	}

	function resolveElement(a: RawAsset): BimAssetRecord {
		const typeId = elementToType.get(a.express_id);
		const typeInfo = typeId !== undefined ? typeObjects.get(typeId) : undefined;
		const classRef =
			entityClassification.get(a.express_id) ??
			(typeId !== undefined ? entityClassification.get(typeId) : undefined);
		const cls = classRef !== undefined ? classifications.get(classRef) : undefined;
		const matInfo = resolveMaterialsFor(a.express_id, typeId);
		const qp = resolveQuantitiesAndProps(a.express_id, typeId);
		const cleanTypeName =
			typeInfo?.name
				?.trim()
				.replace(/:(?:[A-Za-z]{0,2}\d{1,7}|[0-9A-Fa-f]{6,})$/, '')
				.trim() ?? null;
		const family = cleanTypeName || a.name.split(':')[0]?.trim() || a.object_type || a.ifc_class;

		let canonicalClass = a.ifc_class,
			originalClass: string | null = null,
			cleanupNote: string | null = null;
		if (
			config.auto_reclassify_generic &&
			UPGRADEABLE_GENERIC_CLASSES.has(a.ifc_class) &&
			typeInfo
		) {
			const upgraded = TYPE_ENTITY_TO_CLASS[typeInfo.entity];
			if (upgraded && upgraded !== a.ifc_class) {
				canonicalClass = upgraded;
				originalClass = a.ifc_class;
				cleanupNote = `Upgraded ${a.ifc_class} → ${upgraded} from ${typeInfo.entity}`;
			}
		}

		const materials =
			matInfo.materials.length > 0 ? matInfo.materials : qp.propMaterial ? [qp.propMaterial] : [];
		const coveredInsulation = (elementCoverings.get(a.express_id) ?? []).some(
			(cid) => rawById.get(cid)?.predefined_type === 'INSULATION'
		);
		const combinedSys = [qp.systemType, qp.systemName, cls?.name].filter(Boolean).join(' ');
		const service =
			(combinedSys ? matchService(combinedSys) : null) ??
			(['IFCCABLESEGMENT', 'IFCCABLECARRIERSEGMENT', 'IFCCABLEFITTING'].includes(canonicalClass)
				? matchService(canonicalClass)
				: null);
		const partIds = (childrenOf.get(a.express_id) ?? []).slice(0, 32);
		const resolvedWidthMm =
			a.overall_width_raw !== null ? r1(a.overall_width_raw * lengthFactor * 1000) : qp.widthMm;
		const resolvedHeightMm =
			a.overall_height_raw !== null ? r1(a.overall_height_raw * lengthFactor * 1000) : qp.heightMm;
		const resolvedThicknessMm = qp.thicknessMm ?? matInfo.total_thickness_mm;
		// Prefer Pset_StairCommon / Pset_StairFlightCommon RiserHeight/TreadLength (some legacy Revit IFC2x3 exports emit raw positional args in internal feet)
		let resolvedRiserMm =
			qp.riserMm ?? (a.riser_raw !== null ? r1(a.riser_raw * lengthFactor * 1000) : null);
		let resolvedTreadMm =
			qp.treadMm ?? (a.tread_raw !== null ? r1(a.tread_raw * lengthFactor * 1000) : null);
		let resolvedSlopePct = qp.slopePct;
		let resolvedHasSgPset = qp.hasSgPset;

		// Fold child assembly dimensions/SGPsets (e.g. IFCSTAIRFLIGHT under IFCSTAIR, IFCRAMPFLIGHT under IFCRAMP) onto the parent whole
		if (partIds.length > 0) {
			const parentHadRiser = resolvedRiserMm !== null;
			const parentHadTread = resolvedTreadMm !== null;
			for (const pid of partIds) {
				const child = rawById.get(pid);
				if (
					child &&
					(!parentHadRiser ||
						!parentHadTread ||
						(resolvedSlopePct === null && child.ifc_class === 'IFCRAMPFLIGHT'))
				) {
					const cqp =
						child.ifc_class === 'IFCSTAIRFLIGHT' || child.ifc_class === 'IFCRAMPFLIGHT'
							? resolveQuantitiesAndProps(pid, elementToType.get(pid))
							: null;
					if (!parentHadRiser) {
						const rMm =
							cqp?.riserMm ??
							(child.riser_raw !== null ? r1(child.riser_raw * lengthFactor * 1000) : null);
						if (rMm !== null && (resolvedRiserMm === null || rMm > resolvedRiserMm))
							resolvedRiserMm = rMm;
					}
					if (!parentHadTread) {
						const tMm =
							cqp?.treadMm ??
							(child.tread_raw !== null ? r1(child.tread_raw * lengthFactor * 1000) : null);
						if (tMm !== null && (resolvedTreadMm === null || tMm < resolvedTreadMm))
							resolvedTreadMm = tMm;
					}
					if (resolvedSlopePct === null && cqp?.slopePct != null) resolvedSlopePct = cqp.slopePct;
				}
				if (!resolvedHasSgPset) {
					for (const defId of entityDefs.get(pid) ?? []) {
						if (sgPsetIds.has(defId)) {
							resolvedHasSgPset = true;
							break;
						}
					}
				}
			}
		}

		return {
			express_id: a.express_id,
			global_id: a.global_id,
			ifc_class: canonicalClass,
			original_ifc_class: originalClass,
			continuity: defaultContinuityForClass(canonicalClass),
			name: a.name,
			family,
			type_id: typeId ?? null,
			type_entity: typeInfo?.entity ?? null,
			type_name: cleanTypeName,
			object_type: a.object_type,
			predefined_type: a.predefined_type ?? typeInfo?.predefined_type ?? null,
			operation_type: a.operation_type ?? typeInfo?.operation_type ?? null,
			storey: resolveStorey(a.express_id),
			system_name: qp.systemName,
			system_type: qp.systemType,
			service,
			nominal_size_mm: qp.nominalSizeMm ?? matInfo.total_thickness_mm,
			size_label: qp.sizeLabel,
			insulated: (qp.insulationMm !== null && qp.insulationMm > 0) || coveredInsulation,
			insulation_mm: qp.insulationMm,
			fire_rating: qp.fireRating,
			is_external: qp.isExternal,
			load_bearing: qp.loadBearing,
			has_openings: (openingCount.get(a.express_id) ?? 0) > 0,
			classification_code: cls?.code ?? null,
			classification_name: cls?.name ?? null,
			materials,
			material_layers: matInfo.material_layers,
			layer_count: matInfo.material_layers.length,
			properties: qp.properties,
			part_ids: partIds,
			length_m: qp.lengthM,
			area_m2: qp.areaM2,
			volume_m3: qp.volumeM3,
			weight_kg: qp.weightKg,
			...(resolvedWidthMm !== null ? { width_mm: resolvedWidthMm } : {}),
			...(resolvedHeightMm !== null ? { height_mm: resolvedHeightMm } : {}),
			...(resolvedThicknessMm !== null ? { thickness_mm: resolvedThicknessMm } : {}),
			...(resolvedRiserMm !== null ? { riser_mm: resolvedRiserMm } : {}),
			...(resolvedTreadMm !== null ? { tread_mm: resolvedTreadMm } : {}),
			...(resolvedSlopePct !== null ? { slope_pct: resolvedSlopePct } : {}),
			...(resolvedHasSgPset ? { has_sgpset: true } : {}),
			cleanup_note: cleanupNote
		};
	}

	function resolveTopologyEdges(): [number, number][] {
		const edges: [number, number][] = [];
		const seen = new Set<string>();
		for (const [p1, p2] of portEdges) {
			const e1 = portToElement.get(p1),
				e2 = portToElement.get(p2);
			if (e1 === undefined || e2 === undefined || e1 === e2) continue;
			const a = e1 < e2 ? e1 : e2,
				b = e1 < e2 ? e2 : e1;
			const key = `${a}:${b}`;
			if (!seen.has(key)) {
				seen.add(key);
				edges.push([a, b]);
			}
		}
		return edges;
	}

	function resolveStoreyElevations(): Record<string, number> {
		const out: Record<string, number> = {};
		for (const [sid, rawElev] of storeyElevationsRaw) {
			const label = storeys.get(sid);
			if (label !== undefined) out[label] = Number((rawElev * lengthFactor).toFixed(4));
		}
		return out;
	}

	function wholes(): RawAsset[] {
		const ids = new Set(rawAssets.map((a) => a.express_id));
		return rawAssets.filter((a) => {
			const p = parentOf.get(a.express_id);
			return p === undefined || !ids.has(p);
		});
	}

	function assembliesOf(kept: readonly RawAsset[]): Record<string, number[]> {
		const out: Record<string, number[]> = {};
		for (const a of kept) {
			const parts: number[] = [];
			const queue = [...(childrenOf.get(a.express_id) ?? [])];
			while (queue.length > 0) {
				const cid = queue.shift();
				if (cid === undefined || parts.includes(cid)) continue;
				parts.push(cid);
				queue.push(...(childrenOf.get(cid) ?? []));
			}
			if (parts.length > 0) out[String(a.express_id)] = parts;
		}
		return out;
	}

	return {
		push,
		stats: (): IfcStreamStats => ({
			statements_scanned: statementsScanned,
			relevant_statements: relevantStatements,
			raw_assets: rawAssets.length
		}),
		finishFull(): ParsedIfcModel {
			flush();
			resolveUnits();
			const classCounts: Record<string, number> = {};
			const assets = wholes().map((raw) => {
				const resolved = resolveElement(raw);
				classCounts[resolved.ifc_class] = (classCounts[resolved.ifc_class] ?? 0) + 1;
				return resolved;
			});
			return {
				schema,
				project_name: projectName,
				storeys: [...new Set(storeys.values())],
				storey_elevations: resolveStoreyElevations(),
				assets,
				topology_edges: resolveTopologyEdges(),
				class_counts: classCounts
			};
		},
		finish(): ExtractedBimModel {
			flush();
			resolveUnits();
			const kept = wholes();
			const assemblies = assembliesOf(kept);
			const resolved = kept.map(resolveElement);
			const topologyEdges = resolveTopologyEdges();
			const aggregated = aggregateResolvedAssets(
				schema,
				projectName,
				[...new Set(storeys.values())],
				resolved,
				config,
				resolveStoreyElevations()
			);
			return {
				...aggregated,
				...(crsName !== null ? { crs_name: crsName } : {}),
				...(sgPsetIds.size > 0 ? { sgpset_count: sgPsetIds.size } : {}),
				cleanup: {
					upgraded_classes: resolved.filter((r) => r.original_ifc_class !== null).length,
					propagated_services: 0,
					split_mixed_archetypes: 0,
					multi_storey_splits: 0,
					dropped_duplicates: 0,
					variance_warnings: 0
				},
				elements: resolved,
				...(topologyEdges.length > 0 ? { topology_edges: topologyEdges } : {}),
				...(Object.keys(assemblies).length > 0 ? { assemblies } : {})
			};
		}
	};
}

export function aggregateResolvedAssets(
	schema: string,
	projectName: string | null,
	explicitStoreys: readonly string[],
	assets: readonly BimAssetRecord[],
	configInput?: BimSettingsRow | Partial<BimConfig> | null,
	storeyElevations?: Readonly<Record<string, number>>
): ExtractedBimModel {
	const config = resolveBimConfig(configInput);
	const sigToId = new Map<string, string>();
	type ArchAcc = {
		archetype_id: string;
		representative_express_id: number;
		representative_part_ids: readonly number[];
		ifc_class: string;
		original_ifc_class: string | null;
		continuity: ContinuityMode;
		service: string | null;
		nominal_size_mm: number | null;
		size_band: string | null;
		min_width_mm: number | null;
		min_height_mm: number | null;
		min_thickness_mm: number | null;
		max_thickness_mm: number | null;
		max_riser_mm: number | null;
		min_tread_mm: number | null;
		max_slope_pct: number | null;
		has_sgpset: boolean;
		insulated: boolean;
		cleanup_note: string | null;
		family: string;
		type_name: string | null;
		object_type: string | null;
		predefined_type: string | null;
		operation_type: string | null;
		classification_code: string | null;
		classification_name: string | null;
		materials: Set<string>;
		material_layers: readonly string[];
		layer_count: number;
		properties: Set<string>;
		sample_names: Set<string>;
		total_count: number;
		has_length: boolean;
		has_area: boolean;
		has_volume: boolean;
		has_weight: boolean;
	};
	type BucketAcc = {
		archetype_id: string;
		storey: string;
		element_count: number;
		length_m: number;
		length_measured_count: number;
		area_m2: number;
		area_measured_count: number;
		volume_m3: number;
		volume_measured_count: number;
		weight_kg: number;
		weight_measured_count: number;
		sample_express_ids: number[];
		element_ids: number[];
	};
	const archetypes = new Map<string, ArchAcc>();
	const buckets = new Map<string, BucketAcc>();
	const seenStoreys = new Set(explicitStoreys);
	let nextArchNum = 1;

	for (const elem of assets) {
		seenStoreys.add(elem.storey);
		const sig = computeArchetypeSignature(elem, config);
		let archId = sigToId.get(sig);
		let arch = archId ? archetypes.get(archId) : undefined;
		if (!archId || !arch) {
			archId = `A${nextArchNum++}`;
			sigToId.set(sig, archId);
			arch = {
				archetype_id: archId,
				representative_express_id: elem.express_id,
				representative_part_ids: elem.part_ids,
				ifc_class: elem.ifc_class,
				original_ifc_class: elem.original_ifc_class,
				continuity: elem.continuity,
				service: elem.service,
				nominal_size_mm: elem.nominal_size_mm,
				size_band: snapSizeBandLabel(elem.nominal_size_mm, config.size_bands_mm),
				min_width_mm: elem.width_mm ?? null,
				min_height_mm: elem.height_mm ?? null,
				min_thickness_mm: elem.thickness_mm ?? null,
				max_thickness_mm: elem.thickness_mm ?? null,
				max_riser_mm: elem.riser_mm ?? null,
				min_tread_mm: elem.tread_mm ?? null,
				max_slope_pct: elem.slope_pct ?? null,
				has_sgpset: elem.has_sgpset === true,
				insulated: elem.insulated,
				cleanup_note: elem.cleanup_note,
				family: elem.family,
				type_name: elem.type_name,
				object_type: elem.object_type,
				predefined_type: elem.predefined_type,
				operation_type: elem.operation_type,
				classification_code: elem.classification_code,
				classification_name: elem.classification_name,
				materials: new Set(elem.materials),
				material_layers: elem.material_layers,
				layer_count: elem.layer_count,
				properties: new Set(elem.properties),
				sample_names: new Set([elem.name]),
				total_count: 0,
				has_length: false,
				has_area: false,
				has_volume: false,
				has_weight: false
			};
			archetypes.set(archId, arch);
		}
		arch.total_count += 1;
		if (arch.sample_names.size < 3) arch.sample_names.add(elem.name);
		for (const m of elem.materials) if (arch.materials.size < 6) arch.materials.add(m);
		for (const p of elem.properties) if (arch.properties.size < 16) arch.properties.add(p);
		if (arch.material_layers.length === 0 && elem.material_layers.length > 0) {
			arch.material_layers = elem.material_layers;
			arch.layer_count = elem.layer_count;
		}
		if (arch.representative_part_ids.length === 0 && elem.part_ids.length > 0)
			arch.representative_part_ids = elem.part_ids;
		arch.service ??= elem.service;
		if (arch.nominal_size_mm === null && elem.nominal_size_mm !== null) {
			arch.nominal_size_mm = elem.nominal_size_mm;
			arch.size_band = snapSizeBandLabel(elem.nominal_size_mm, config.size_bands_mm);
		}
		if (
			elem.width_mm != null &&
			elem.width_mm > 0 &&
			(arch.min_width_mm === null || elem.width_mm < arch.min_width_mm)
		)
			arch.min_width_mm = elem.width_mm;
		if (
			elem.height_mm != null &&
			elem.height_mm > 0 &&
			(arch.min_height_mm === null || elem.height_mm < arch.min_height_mm)
		)
			arch.min_height_mm = elem.height_mm;
		if (elem.thickness_mm != null && elem.thickness_mm > 0) {
			if (arch.min_thickness_mm === null || elem.thickness_mm < arch.min_thickness_mm)
				arch.min_thickness_mm = elem.thickness_mm;
			if (arch.max_thickness_mm === null || elem.thickness_mm > arch.max_thickness_mm)
				arch.max_thickness_mm = elem.thickness_mm;
		}
		if (
			elem.riser_mm != null &&
			elem.riser_mm > 0 &&
			(arch.max_riser_mm === null || elem.riser_mm > arch.max_riser_mm)
		)
			arch.max_riser_mm = elem.riser_mm;
		if (
			elem.tread_mm != null &&
			elem.tread_mm > 0 &&
			(arch.min_tread_mm === null || elem.tread_mm < arch.min_tread_mm)
		)
			arch.min_tread_mm = elem.tread_mm;
		if (
			elem.slope_pct != null &&
			elem.slope_pct > 0 &&
			(arch.max_slope_pct === null || elem.slope_pct > arch.max_slope_pct)
		)
			arch.max_slope_pct = elem.slope_pct;
		if (elem.has_sgpset) arch.has_sgpset = true;
		if (elem.insulated) arch.insulated = true;
		arch.cleanup_note ??= elem.cleanup_note;
		if (elem.length_m !== null) arch.has_length = true;
		if (elem.area_m2 !== null) arch.has_area = true;
		if (elem.volume_m3 !== null) arch.has_volume = true;
		if (elem.weight_kg !== null) arch.has_weight = true;

		const bKey = `${archId}::${elem.storey}`;
		let b = buckets.get(bKey);
		if (!b) {
			b = {
				archetype_id: archId,
				storey: elem.storey,
				element_count: 0,
				length_m: 0,
				length_measured_count: 0,
				area_m2: 0,
				area_measured_count: 0,
				volume_m3: 0,
				volume_measured_count: 0,
				weight_kg: 0,
				weight_measured_count: 0,
				sample_express_ids: [],
				element_ids: []
			};
			buckets.set(bKey, b);
		}
		b.element_count += 1;
		if (elem.length_m !== null) {
			b.length_m += elem.length_m;
			b.length_measured_count += 1;
		}
		if (elem.area_m2 !== null) {
			b.area_m2 += elem.area_m2;
			b.area_measured_count += 1;
		}
		if (elem.volume_m3 !== null) {
			b.volume_m3 += elem.volume_m3;
			b.volume_measured_count += 1;
		}
		if (elem.weight_kg !== null) {
			b.weight_kg += elem.weight_kg;
			b.weight_measured_count += 1;
		}
		if (b.sample_express_ids.length < 10) b.sample_express_ids.push(elem.express_id);
		b.element_ids.push(elem.express_id);
	}

	const orderedStoreys = [...new Set([...explicitStoreys, ...seenStoreys])].filter(
		(s) => s !== 'Unassigned' || seenStoreys.has('Unassigned')
	);
	const f4 = (n: number) => Number(n.toFixed(4));

	return {
		schema,
		project_name: projectName,
		storeys: explicitStoreys.length > 0 ? [...explicitStoreys] : orderedStoreys,
		...(storeyElevations && Object.keys(storeyElevations).length > 0
			? { storey_elevations: storeyElevations }
			: {}),
		total_asset_count: assets.length,
		archetypes: [...archetypes.values()]
			.sort((a, b) => b.total_count - a.total_count || a.archetype_id.localeCompare(b.archetype_id))
			.map((a): BimArchetype => ({
				archetype_id: a.archetype_id,
				representative_express_id: a.representative_express_id,
				representative_part_ids: [...a.representative_part_ids],
				ifc_class: a.ifc_class,
				...(a.original_ifc_class ? { original_ifc_class: a.original_ifc_class } : {}),
				continuity: a.continuity,
				...(a.service ? { service: a.service } : {}),
				...(a.nominal_size_mm !== null ? { nominal_size_mm: a.nominal_size_mm } : {}),
				...(a.size_band ? { size_band: a.size_band } : {}),
				...(a.min_width_mm !== null ? { min_width_mm: a.min_width_mm } : {}),
				...(a.min_height_mm !== null ? { min_height_mm: a.min_height_mm } : {}),
				...(a.min_thickness_mm !== null ? { min_thickness_mm: a.min_thickness_mm } : {}),
				...(a.max_thickness_mm !== null ? { max_thickness_mm: a.max_thickness_mm } : {}),
				...(a.max_riser_mm !== null ? { max_riser_mm: a.max_riser_mm } : {}),
				...(a.min_tread_mm !== null ? { min_tread_mm: a.min_tread_mm } : {}),
				...(a.max_slope_pct !== null ? { max_slope_pct: a.max_slope_pct } : {}),
				...(a.has_sgpset ? { has_sgpset: true } : {}),
				...(a.insulated ? { insulated: true } : {}),
				...(a.cleanup_note ? { cleanup_note: a.cleanup_note } : {}),
				family: a.family,
				type_name: a.type_name,
				object_type: a.object_type,
				predefined_type: a.predefined_type,
				operation_type: a.operation_type,
				classification_code: a.classification_code,
				classification_name: a.classification_name,
				materials: [...a.materials],
				material_layers: [...a.material_layers],
				layer_count: a.layer_count,
				properties: [...a.properties],
				sample_names: [...a.sample_names],
				total_count: a.total_count,
				has_length: a.has_length,
				has_area: a.has_area,
				has_volume: a.has_volume,
				has_weight: a.has_weight
			})),
		buckets: [...buckets.values()].map((b): BimStoreyBucket => ({
			...b,
			length_m: f4(b.length_m),
			area_m2: f4(b.area_m2),
			volume_m3: f4(b.volume_m3),
			weight_kg: f4(b.weight_kg)
		}))
	};
}

export function extractFromParsedModel(
	parsed: ParsedIfcModel,
	configInput?: BimSettingsRow | Partial<BimConfig> | null
): ExtractedBimModel {
	return {
		...aggregateResolvedAssets(
			parsed.schema,
			parsed.project_name,
			parsed.storeys,
			parsed.assets,
			configInput,
			parsed.storey_elevations
		),
		elements: parsed.assets,
		...(parsed.topology_edges.length > 0 ? { topology_edges: parsed.topology_edges } : {})
	};
}

export function parseIfcStep(text: string, config?: BimSettingsRow | null): ParsedIfcModel {
	const parser = createIfcStepStreamParser(config);
	parser.push(text);
	return parser.finishFull();
}
