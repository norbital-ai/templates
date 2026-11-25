/**
 * Streaming ISO-10303-21 IFC STEP parser and archetype aggregator.
 *
 * Pure TypeScript with zero native/DOM dependencies so it runs identically inside Bolt's
 * isolated-vm guest runtime (for <= 8 MiB uploaded IFCs) and inside a browser Web Worker
 * streaming arbitrarily large 100–500+ MiB federated BIM files in 4 MiB slices.
 *
 * Design for high-throughput large BIM models (e.g., 18-storey HDB + playground + MEP):
 * - Zero-regex hot path skips ~95% geometry/placement/style entities (`IFCCARTESIANPOINT`,
 *   `IFCPOLYLOOP`, `IFCFACE`, etc.) on the entity name check without slicing arguments.
 * - Captures rich semantic metadata (IFC*TYPE names, PredefinedType, IFCMATERIAL layer/constituent
 *   sets, Uniclass/Uniformat/CP83 classification refs, and key Pset traits like FireRating,
 *   LoadBearing, IsExternal) needed for intelligent AI Costing Matrix classification.
 * - Aggregates tens or hundreds of thousands of instances into compact unique asset archetypes
 *   and `(archetype, storey)` quantity buckets (~30–180 KiB JSON even for 150k+ elements).
 */

/** Physical IFC2x3 & IFC4 building, structural, MEP, transport, civil, site, and landscape classes. */
export const ASSET_CLASSES = new Set<string>([
	// Architecture & Building Elements
	'IFCWALL',
	'IFCWALLSTANDARDCASE',
	'IFCWALLELEMENTEDCASE',
	'IFCSLAB',
	'IFCSLABSTANDARDCASE',
	'IFCSLABELEMENTEDCASE',
	'IFCCOLUMN',
	'IFCCOLUMNSTANDARDCASE',
	'IFCBEAM',
	'IFCBEAMSTANDARDCASE',
	'IFCROOF',
	'IFCSTAIR',
	'IFCSTAIRFLIGHT',
	'IFCDOOR',
	'IFCDOORSTANDARDCASE',
	'IFCWINDOW',
	'IFCWINDOWSTANDARDCASE',
	'IFCCOVERING',
	'IFCCURTAINWALL',
	'IFCPLATE',
	'IFCPLATESTANDARDCASE',
	'IFCMEMBER',
	'IFCMEMBERSTANDARDCASE',
	'IFCFOOTING',
	'IFCPILE',
	'IFCRAILING',
	'IFCRAMP',
	'IFCRAMPFLIGHT',
	'IFCCHIMNEY',
	'IFCSHADINGDEVICE',
	'IFCBUILDINGELEMENTPROXY',
	'IFCBUILDINGELEMENTPART',
	'IFCREINFORCINGBAR',
	'IFCREINFORCINGMESH',
	'IFCTENDON',
	'IFCFASTENER',
	'IFCMECHANICALFASTENER',
	'IFCDISCRETEACCESSORY',
	// Vertical Transport (Lifts / Escalators)
	'IFCTRANSPORTELEMENT',
	// Civil, Site, Landscape, External Works & Playground
	'IFCCIVILELEMENT',
	'IFCGEOGRAPHICELEMENT',
	'IFCPAVEMENT',
	'IFCKERB',
	'IFCEARTHWORKSCUT',
	'IFCEARTHWORKSFILL',
	'IFCSURFACEFEATURE',
	'IFCFURNISHINGELEMENT',
	'IFCFURNITURE',
	'IFCSYSTEMFURNITUREELEMENT',
	// MEP / Electrical / Fire / Sanitary / ACMV
	'IFCFLOWTERMINAL',
	'IFCFLOWCONTROLLER',
	'IFCFLOWSEGMENT',
	'IFCFLOWFITTING',
	'IFCFLOWMOVINGDEVICE',
	'IFCFLOWSTORAGEDEVICE',
	'IFCENERGYCONVERSIONDEVICE',
	'IFCFLOWTREATMENTDEVICE',
	'IFCDISTRIBUTIONCONTROLELEMENT',
	'IFCDISTRIBUTIONFLOWELEMENT',
	'IFCDISTRIBUTIONCHAMBERELEMENT',
	'IFCELECTRICDISTRIBUTIONBOARD',
	'IFCELECTRICDISTRIBUTIONPOINT',
	'IFCELECTRICAPPLIANCE',
	'IFCLIGHTFIXTURE',
	'IFCOUTLET',
	'IFCSWITCHINGDEVICE',
	'IFCCABLESEGMENT',
	'IFCCABLEFITTING',
	'IFCCABLECARRIERSEGMENT',
	'IFCCABLECARRIERFITTING',
	'IFCPROTECTIVEDEVICE',
	'IFCSANITARYTERMINAL',
	'IFCFIRESUPPRESSIONTERMINAL',
	'IFCAIRTERMINAL',
	'IFCPIPESEGMENT',
	'IFCPIPEFITTING',
	'IFCDUCTSEGMENT',
	'IFCDUCTFITTING',
	'IFCVALVE',
	'IFCPUMP',
	'IFCFAN',
	'IFCCHILLER',
	'IFCBOILER',
	'IFCCOMPRESSOR',
	'IFCCONDENSER',
	'IFCEVAPORATOR',
	'IFCHEATEXCHANGER',
	'IFCCOOLINGTOWER',
	'IFCUNITARYEQUIPMENT',
	'IFCTANK',
	'IFCINTERCEPTOR',
	'IFCSENSOR',
	'IFCALARM',
	'IFCACTUATOR',
	'IFCCONTROLLER',
	'IFCSOLARDEVICE',
	'IFCAUDIOVISUALAPPLIANCE',
	'IFCCOMMUNICATIONSAPPLIANCE'
]);

const STRUCTURAL_ENTITIES = new Set<string>([
	'IFCPROJECT',
	'IFCSITE',
	'IFCBUILDING',
	'IFCBUILDINGSTOREY',
	'IFCSPACE',
	'IFCSIUNIT',
	'IFCMEASUREWITHUNIT',
	'IFCCONVERSIONBASEDUNIT',
	'IFCRELAGGREGATES',
	'IFCRELCONTAINEDINSPATIALSTRUCTURE',
	'IFCCLASSIFICATIONREFERENCE',
	'IFCRELASSOCIATESCLASSIFICATION',
	'IFCRELDEFINESBYTYPE',
	'IFCRELASSOCIATESMATERIAL',
	'IFCMATERIAL',
	'IFCMATERIALLAYER',
	'IFCMATERIALLAYERSET',
	'IFCMATERIALLAYERSETUSAGE',
	'IFCMATERIALLIST',
	'IFCMATERIALCONSTITUENT',
	'IFCMATERIALCONSTITUENTSET',
	'IFCMATERIALPROFILE',
	'IFCMATERIALPROFILESET',
	'IFCMATERIALPROFILESETUSAGE',
	'IFCQUANTITYLENGTH',
	'IFCQUANTITYAREA',
	'IFCQUANTITYVOLUME',
	'IFCQUANTITYWEIGHT',
	'IFCELEMENTQUANTITY',
	'IFCPROPERTYSINGLEVALUE',
	'IFCPROPERTYSET',
	'IFCRELDEFINESBYPROPERTIES',
	'IFCDOORSTYLE',
	'IFCWINDOWSTYLE'
]);

/** IFC2x3 & IFC4 door/window operation & partitioning enum tokens (distinct from PredefinedType). */
const OPERATION_TYPE_ENUMS = new Set<string>([
	'SINGLE_SWING_LEFT',
	'SINGLE_SWING_RIGHT',
	'DOUBLE_DOOR_SINGLE_SWING',
	'DOUBLE_DOOR_SINGLE_SWING_OPPOSITE_LEFT',
	'DOUBLE_DOOR_SINGLE_SWING_OPPOSITE_RIGHT',
	'DOUBLE_SWING_LEFT',
	'DOUBLE_SWING_RIGHT',
	'DOUBLE_DOOR_DOUBLE_SWING',
	'SLIDING_TO_LEFT',
	'SLIDING_TO_RIGHT',
	'DOUBLE_DOOR_SLIDING',
	'FOLDING_TO_LEFT',
	'FOLDING_TO_RIGHT',
	'DOUBLE_DOOR_FOLDING',
	'REVOLVING',
	'ROLLINGUP',
	'SWING_FIXED_LEFT',
	'SWING_FIXED_RIGHT',
	'SINGLE_PANEL',
	'DOUBLE_PANEL_VERTICAL',
	'DOUBLE_PANEL_HORIZONTAL',
	'TRIPLE_PANEL_VERTICAL',
	'TRIPLE_PANEL_BOTTOM',
	'TRIPLE_PANEL_TOP',
	'TRIPLE_PANEL_LEFT',
	'TRIPLE_PANEL_RIGHT',
	'TRIPLE_PANEL_HORIZONTAL'
]);

/** High-signal property names kept for semantic AI classification. */
const SEMANTIC_PROPERTY_NAMES = new Set<string>([
	'firerating',
	'isexternal',
	'loadbearing',
	'acousticrating',
	'reference',
	'category',
	'family',
	'type',
	'material',
	'finish',
	'surfacefinish',
	'structuralmaterial',
	'thermaltransmittance',
	'nominaldiameter',
	'systemname',
	'systemclassification',
	'capacity',
	'voltage',
	'power',
	'grade',
	'concretegrade',
	'thickness',
	'width',
	'height',
	'occupancytype',
	'predefinedtype',
	'operationtype',
	'partitioningtype',
	'glazingareafaction',
	'numberofleaves',
	'doorleafcount'
]);

export type BimAssetRecord = {
	readonly express_id: number;
	readonly global_id: string | null;
	readonly ifc_class: string;
	readonly name: string;
	readonly family: string;
	readonly type_id: number | null;
	readonly type_name: string | null;
	readonly object_type: string | null;
	readonly predefined_type: string | null;
	readonly operation_type: string | null;
	readonly storey: string;
	readonly classification_code: string | null;
	readonly classification_name: string | null;
	readonly materials: readonly string[];
	readonly material_layers: readonly string[];
	readonly layer_count: number;
	readonly properties: readonly string[];
	readonly part_ids: readonly number[];
	readonly length_m: number | null;
	readonly area_m2: number | null;
	readonly volume_m3: number | null;
	readonly weight_kg: number | null;
};

export type ParsedIfcModel = {
	readonly schema: string;
	readonly project_name: string | null;
	readonly storeys: readonly string[];
	readonly assets: readonly BimAssetRecord[];
	readonly class_counts: Readonly<Record<string, number>>;
};

export type BimArchetype = {
	readonly archetype_id: string;
	readonly representative_express_id: number;
	readonly representative_part_ids: readonly number[];
	readonly ifc_class: string;
	readonly family: string;
	readonly type_name: string | null;
	readonly object_type: string | null;
	readonly predefined_type: string | null;
	readonly operation_type: string | null;
	readonly classification_code: string | null;
	readonly classification_name: string | null;
	readonly materials: readonly string[];
	readonly material_layers: readonly string[];
	readonly layer_count: number;
	readonly properties: readonly string[];
	readonly sample_names: readonly string[];
	readonly total_count: number;
	readonly has_length: boolean;
	readonly has_area: boolean;
	readonly has_volume: boolean;
	readonly has_weight: boolean;
	readonly visual_views?: readonly string[];
};

export type BimStoreyBucket = {
	readonly archetype_id: string;
	readonly storey: string;
	readonly element_count: number;
	readonly length_m: number;
	readonly length_measured_count: number;
	readonly area_m2: number;
	readonly area_measured_count: number;
	readonly volume_m3: number;
	readonly volume_measured_count: number;
	readonly weight_kg: number;
	readonly weight_measured_count: number;
	readonly sample_express_ids: readonly number[];
};

export type ExtractedBimModel = {
	readonly schema: string;
	readonly project_name: string | null;
	readonly storeys: readonly string[];
	readonly total_asset_count: number;
	readonly archetypes: readonly BimArchetype[];
	readonly buckets: readonly BimStoreyBucket[];
};

/** Decodes STEP ISO-10303-21 `\X2\....\X0\` UTF-16 hex escapes inside IFC strings. */
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

/** Splits top-level STEP argument lists respecting single-quoted strings and nested parentheses. */
function splitStepArgs(raw: string): string[] {
	const args: string[] = [];
	let depth = 0;
	let inStr = false;
	let start = 0;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw.charCodeAt(i);
		if (ch === 39) {
			// '\''
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
		const unescaped = inner.includes("''") ? inner.replace(/''/g, "'") : inner;
		return decodeStepEscapes(unescaped).trim() || null;
	}
	return t || null;
}

function unquoteTypedStepValue(token: string | undefined): string | null {
	if (token == null || token === '$' || token === '*') return null;
	const t = token.trim();
	const paren = t.indexOf('(');
	if (paren > 0 && t.endsWith(')')) {
		const inner = t.slice(paren + 1, -1).trim();
		if (inner === '.T.') return 'true';
		if (inner === '.F.') return 'false';
		if (inner === '.U.') return null;
		return unquoteStep(inner);
	}
	if (t === '.T.') return 'true';
	if (t === '.F.') return 'false';
	return unquoteStep(t);
}

function parseEnumToken(token: string | undefined): string | null {
	if (token == null) return null;
	const t = token.trim();
	if (t.length > 2 && t.charCodeAt(0) === 46 && t.charCodeAt(t.length - 1) === 46) {
		const val = t.slice(1, -1).toUpperCase();
		if (val === 'NOTDEFINED' || val === 'USERDEFINED' || val === 'ELEMENT') return null;
		return val;
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
	let i = 0;
	const len = token.length;
	while (i < len) {
		if (token.charCodeAt(i) === 35) {
			i++;
			let n = 0;
			let digits = 0;
			while (i < len) {
				const c = token.charCodeAt(i);
				if (c < 48 || c > 57) break;
				n = n * 10 + (c - 48);
				digits++;
				i++;
			}
			if (digits > 0) out.push(n);
		} else {
			i++;
		}
	}
	return out;
}

function parseStepNumber(token: string | undefined): number | null {
	if (token == null || token === '$' || token === '*') return null;
	let s = token.trim();
	const paren = s.indexOf('(');
	if (paren > 0 && s.endsWith(')')) {
		s = s.slice(paren + 1, -1).trim();
	}
	if (s.length === 0 || s.charCodeAt(0) === 39 || s.charCodeAt(0) === 46) return null;
	const n = Number(s);
	return Number.isFinite(n) ? n : null;
}

function quantityPriority(kind: 'length' | 'area' | 'volume' | 'weight', name: string): number {
	const n = name.toLowerCase();
	if (kind === 'area') {
		if (n === 'netsidearea' || n === 'netfloorarea' || n === 'netarea' || n === 'netsurfacearea')
			return 10;
		if (n === 'grosssidearea' || n === 'grossfloorarea' || n === 'grossarea') return 8;
		if (n === 'area' || n === 'footprintarea' || n === 'outerSurfaceArea'.toLowerCase()) return 6;
		if (n.includes('crosssection')) return 2;
		return 4;
	}
	if (kind === 'volume') {
		if (n === 'netvolume') return 10;
		if (n === 'grossvolume') return 8;
		if (n === 'volume') return 6;
		return 4;
	}
	if (kind === 'length') {
		if (n === 'length' || n === 'nominallength' || n === 'netlength') return 10;
		if (n === 'perimeter' || n === 'grossperimeter') return 6;
		if (n === 'height' || n === 'width' || n === 'depth' || n === 'thickness') return 2;
		return 4;
	}
	if (n === 'netweight' || n === 'weight' || n === 'mass') return 10;
	if (n === 'grossweight') return 8;
	return 4;
}

function isRelevantEntity(entity: string): boolean {
	if (ASSET_CLASSES.has(entity) || STRUCTURAL_ENTITIES.has(entity)) return true;
	return entity.length > 7 && entity.startsWith('IFC') && entity.endsWith('TYPE');
}

export type IfcStreamStats = {
	readonly statements_scanned: number;
	readonly relevant_statements: number;
	readonly raw_assets: number;
};

type RawAsset = {
	readonly express_id: number;
	readonly global_id: string | null;
	readonly ifc_class: string;
	readonly name: string;
	readonly object_type: string | null;
	readonly predefined_type: string | null;
	readonly operation_type: string | null;
};

type TypeInfo = {
	readonly name: string | null;
	readonly description: string | null;
	readonly predefined_type: string | null;
	readonly operation_type: string | null;
};

type MaterialLayerMeta = {
	readonly material_ref: number | null;
	readonly thickness_raw: number | null;
	readonly name: string | null;
};

/**
 * Normalizes an IFC element name by stripping per-instance numeric IDs / tags (e.g., `Door-001`,
 * `Wall_L01_14`, `Basic Wall:RC-200:1042`, `KONE MonoSpace 1000kg:L1`) while keeping type
 * specifiers and dimensions (`400A`, `200mm`, `2400x2100`) intact.
 */
function normalizeInstanceName(raw: string): string {
	let s = raw.trim();
	if (s.length === 0) return '';
	// Strip Revit-style trailing `:123456` or `:L1` / `:D01` instance tags while keeping Family:Type
	const colonParts = s
		.split(':')
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
	if (colonParts.length >= 3) {
		const last = colonParts[colonParts.length - 1] ?? '';
		if (/^(?:[A-Za-z]{0,2}\d{1,7}|[0-9A-Fa-f]{6,})$/.test(last)) {
			colonParts.pop();
		}
		s = colonParts.join(':');
	} else if (colonParts.length === 2) {
		const second = colonParts[1] ?? '';
		if (/^(?:[A-Za-z]{0,2}\d{1,7}|Zone\s*[A-Za-z0-9]+)$/i.test(second)) {
			s = colonParts[0] ?? s;
		}
	}
	// Strip trailing instance numbering (`Door-001`, `Door #12`, `Wall_L02_05`), never dimensions (`200mm`, `400A`, `1000kg`)
	s = s.replace(/(?:[\s_-]+(?:#|no\.?|id|L\d{1,2}[\s_-]?)?\d{1,6})$/i, '').trim();
	return s.toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Computes the strict deduplication key for a resolved BIM element so identical assets never get
 * sent to System 1 more than once:
 * - Elements linked to an `IFC*TYPE` / `IFC*STYLE` collapse strictly by their type definition +
 *   operation/predefined type + material layers (ignoring per-instance names like `Door-001`..`Door-500`).
 * - Un-typed elements collapse by normalized instance family/name + objectType + operation/predefined
 *   type + material layers.
 */
function computeArchetypeSignature(elem: BimAssetRecord): string {
	const layerSig =
		elem.material_layers.length > 0
			? elem.material_layers.map((l) => l.toLowerCase()).join('+')
			: elem.materials.map((m) => m.toLowerCase()).join('+');
	if (elem.type_id !== null) {
		const typeKey =
			elem.type_name !== null && elem.type_name.trim().length > 0
				? normalizeInstanceName(elem.type_name) || elem.type_name.trim().toLowerCase()
				: `#${elem.type_id}`;
		return [
			'TYPE',
			elem.ifc_class,
			typeKey,
			elem.operation_type ?? '',
			elem.predefined_type ?? '',
			(elem.classification_code ?? '').toLowerCase(),
			layerSig
		].join('|');
	}
	const normName = normalizeInstanceName(elem.name) || elem.family.toLowerCase();
	return [
		'INST',
		elem.ifc_class,
		normName,
		(elem.object_type ?? '').toLowerCase(),
		elem.operation_type ?? '',
		elem.predefined_type ?? '',
		(elem.classification_code ?? '').toLowerCase(),
		layerSig
	].join('|');
}

function classifyEnums(
	args: readonly string[],
	startIdx: number
): { readonly predefined: string | null; readonly operation: string | null } {
	let predefined: string | null = null;
	let operation: string | null = null;
	for (let k = args.length - 1; k >= startIdx; k--) {
		const parsed = parseEnumToken(args[k]);
		if (parsed === null) continue;
		if (OPERATION_TYPE_ENUMS.has(parsed)) {
			if (operation === null) operation = parsed;
		} else if (predefined === null) {
			predefined = parsed;
		}
	}
	return { predefined, operation };
}

type QtyEntry = {
	readonly kind: 'length' | 'area' | 'volume' | 'weight';
	readonly name: string;
	readonly value: number;
};

type PropEntry = {
	readonly key: string;
	readonly label: string;
	readonly numeric: number | null;
	readonly text: string | null;
};

/**
 * Creates a streaming ISO-10303-21 IFC STEP parser.
 * Push arbitrary UTF-8 string or `Uint8Array` slices via `push(chunk)`, then call `finish()`
 * to obtain a compact `ExtractedBimModel` (or `finishFull()` for per-element `ParsedIfcModel`).
 */
export function createIfcStepStreamParser() {
	const decoder = new TextDecoder('utf-8', { fatal: false });
	let remainder = '';
	let schema = 'IFC2X3';
	let schemaFound = false;
	let projectName: string | null = null;
	let statementsScanned = 0;
	let relevantStatements = 0;

	const storeys = new Map<number, string>();
	const spaces = new Map<number, string>();
	const sites = new Map<number, string>();
	const parentOf = new Map<number, number>();
	const childrenOf = new Map<number, number[]>();
	const elementToContainer = new Map<number, number>();
	const classifications = new Map<number, { code: string | null; name: string | null }>();
	const entityClassification = new Map<number, number>();

	// Type definitions (`IFCRELDEFINESBYTYPE` -> `IFC*TYPE` / `IFCDOORSTYLE` / `IFCWINDOWSTYLE`)
	const typeObjects = new Map<number, TypeInfo>();
	const elementToType = new Map<number, number>();

	// Material graph (`IFCRELASSOCIATESMATERIAL` -> Material / LayerSet / ConstituentSet / ProfileSet / List)
	const materialNames = new Map<number, string>();
	const materialLayers = new Map<number, MaterialLayerMeta>();
	const materialLinks = new Map<number, number[]>();
	const entityMaterials = new Map<number, number[]>();

	// SI unit factors
	let lengthFactor = 1;
	let areaFactor = 1;
	let volumeFactor = 1;
	let massFactor = 1;
	const measureWithUnit = new Map<number, number>();

	// Quantities & Properties
	const qtyValues = new Map<number, QtyEntry>();
	const elemQuantities = new Map<number, number[]>();
	const propSingle = new Map<number, PropEntry>();
	const propSets = new Map<number, number[]>();
	const entityDefs = new Map<number, number[]>();

	const rawAssets: RawAsset[] = [];

	function pushMapList(map: Map<number, number[]>, key: number, value: number): void {
		const list = map.get(key);
		if (list !== undefined) list.push(value);
		else map.set(key, [value]);
	}

	function processStatement(stmt: string): void {
		statementsScanned++;
		const len = stmt.length;
		let i = 0;
		while (i < len && stmt.charCodeAt(i) <= 32) i++;
		if (i >= len) return;

		// Header FILE_SCHEMA detection
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

		if (stmt.charCodeAt(i) !== 35) return; // must start with '#'
		i++;
		let id = 0;
		let digits = 0;
		while (i < len) {
			const c = stmt.charCodeAt(i);
			if (c < 48 || c > 57) break;
			id = id * 10 + (c - 48);
			digits++;
			i++;
		}
		if (digits === 0) return;

		while (i < len && stmt.charCodeAt(i) <= 32) i++;
		if (i >= len || stmt.charCodeAt(i) !== 61) return; // '='
		i++;
		while (i < len && stmt.charCodeAt(i) <= 32) i++;

		const entityStart = i;
		while (i < len) {
			const c = stmt.charCodeAt(i);
			if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95) {
				i++;
			} else {
				break;
			}
		}
		if (i === entityStart) return;
		const entity = stmt.slice(entityStart, i).toUpperCase();

		// FAST PATH: skip ~95% geometry/placement/style entities immediately!
		if (!isRelevantEntity(entity)) return;
		relevantStatements++;

		const openParen = stmt.indexOf('(', i);
		const closeParen = stmt.lastIndexOf(')');
		if (openParen < 0 || closeParen <= openParen) return;
		const argStr = stmt.slice(openParen + 1, closeParen);

		if (ASSET_CLASSES.has(entity)) {
			const args = splitStepArgs(argStr);
			const globalId = unquoteStep(args[0]);
			const name = unquoteStep(args[2]) ?? entity;
			const objectType = unquoteStep(args[4]);
			const enums = classifyEnums(args, 5);
			rawAssets.push({
				express_id: id,
				global_id: globalId,
				ifc_class: entity,
				name,
				object_type: objectType,
				predefined_type: enums.predefined,
				operation_type: enums.operation
			});
			return;
		}

		if (entity === 'IFCPROJECT') {
			const args = splitStepArgs(argStr);
			projectName = unquoteStep(args[5]) ?? unquoteStep(args[2]);
		} else if (entity === 'IFCBUILDINGSTOREY') {
			const args = splitStepArgs(argStr);
			const label = unquoteStep(args[2]) ?? unquoteStep(args[7]) ?? `Storey #${id}`;
			storeys.set(id, label);
		} else if (entity === 'IFCSPACE') {
			const args = splitStepArgs(argStr);
			const label = unquoteStep(args[7]) ?? unquoteStep(args[2]) ?? `Space #${id}`;
			spaces.set(id, label);
		} else if (entity === 'IFCSITE') {
			const args = splitStepArgs(argStr);
			const label = unquoteStep(args[7]) ?? unquoteStep(args[2]) ?? 'Site / External Works';
			sites.set(id, label);
		} else if (entity === 'IFCSIUNIT') {
			const args = splitStepArgs(argStr);
			const unitType = args[1] ?? '';
			const prefix = args[2] ?? '';
			if (unitType.includes('LENGTHUNIT')) {
				if (prefix.includes('MILLI')) lengthFactor = 0.001;
				else if (prefix.includes('CENTI')) lengthFactor = 0.01;
				else if (prefix.includes('DECI')) lengthFactor = 0.1;
				else if (prefix.includes('KILO')) lengthFactor = 1000;
			} else if (unitType.includes('AREAUNIT')) {
				if (prefix.includes('MILLI')) areaFactor = 1e-6;
				else if (prefix.includes('CENTI')) areaFactor = 1e-4;
			} else if (unitType.includes('VOLUMEUNIT')) {
				if (prefix.includes('MILLI')) volumeFactor = 1e-9;
				else if (prefix.includes('CENTI')) volumeFactor = 1e-6;
			} else if (unitType.includes('MASSUNIT')) {
				if (prefix.includes('GRAM') && !prefix.includes('KILO')) massFactor = 0.001;
			}
		} else if (entity === 'IFCMEASUREWITHUNIT') {
			const args = splitStepArgs(argStr);
			const factor = parseStepNumber(args[0]);
			if (factor !== null && factor > 0) measureWithUnit.set(id, factor);
		} else if (entity === 'IFCCONVERSIONBASEDUNIT') {
			const args = splitStepArgs(argStr);
			const unitType = args[1] ?? '';
			const factorRef = parseRef(args[3]);
			const factor = factorRef !== null ? measureWithUnit.get(factorRef) : undefined;
			if (factor !== undefined) {
				if (unitType.includes('LENGTHUNIT')) lengthFactor = factor;
				else if (unitType.includes('AREAUNIT')) areaFactor = factor;
				else if (unitType.includes('VOLUMEUNIT')) volumeFactor = factor;
				else if (unitType.includes('MASSUNIT')) massFactor = factor;
			}
		} else if (entity === 'IFCRELAGGREGATES') {
			const args = splitStepArgs(argStr);
			const parentId = parseRef(args[4]);
			const childIds = parseRefList(args[5]);
			if (parentId !== null) {
				for (const cid of childIds) {
					parentOf.set(cid, parentId);
					pushMapList(childrenOf, parentId, cid);
				}
			}
		} else if (entity === 'IFCRELCONTAINEDINSPATIALSTRUCTURE') {
			const args = splitStepArgs(argStr);
			const related = parseRefList(args[4]);
			const structure = parseRef(args[5]);
			if (structure !== null) {
				for (const rid of related) elementToContainer.set(rid, structure);
			}
		} else if (entity === 'IFCCLASSIFICATIONREFERENCE') {
			const args = splitStepArgs(argStr);
			const code = unquoteStep(args[1]);
			const name = unquoteStep(args[2]);
			if (code !== null || name !== null) {
				classifications.set(id, { code, name });
			}
		} else if (entity === 'IFCRELASSOCIATESCLASSIFICATION') {
			const args = splitStepArgs(argStr);
			const related = parseRefList(args[4]);
			const classRef = parseRef(args[5]);
			if (classRef !== null) {
				for (const rid of related) entityClassification.set(rid, classRef);
			}
		} else if (entity === 'IFCRELDEFINESBYTYPE') {
			const args = splitStepArgs(argStr);
			const related = parseRefList(args[4]);
			const typeRef = parseRef(args[5]);
			if (typeRef !== null) {
				for (const rid of related) elementToType.set(rid, typeRef);
			}
		} else if (entity === 'IFCMATERIAL') {
			const args = splitStepArgs(argStr);
			const name = unquoteStep(args[0]);
			if (name !== null) materialNames.set(id, name);
		} else if (entity === 'IFCMATERIALLAYER') {
			const args = splitStepArgs(argStr);
			// IFCMATERIALLAYER(Material, LayerThickness, IsVentilated, Name, ...)
			const matRef = parseRef(args[0]);
			const thicknessRaw = parseStepNumber(args[1]);
			const layerName = unquoteStep(args[3]);
			materialLayers.set(id, {
				material_ref: matRef,
				thickness_raw: thicknessRaw,
				name: layerName
			});
			if (matRef !== null) materialLinks.set(id, [matRef]);
		} else if (entity === 'IFCMATERIALCONSTITUENT' || entity === 'IFCMATERIALPROFILE') {
			const args = splitStepArgs(argStr);
			// IFCMATERIALCONSTITUENT(Name, Desc, Material, ...), IFCMATERIALPROFILE(Name, Desc, Material, ...)
			const matRef = parseRef(args[2]) ?? parseRef(args[0]);
			if (matRef !== null) materialLinks.set(id, [matRef]);
		} else if (
			entity === 'IFCMATERIALLAYERSET' ||
			entity === 'IFCMATERIALLIST' ||
			entity === 'IFCMATERIALCONSTITUENTSET' ||
			entity === 'IFCMATERIALPROFILESET'
		) {
			const refs = parseRefList(argStr);
			if (refs.length > 0) materialLinks.set(id, refs);
		} else if (entity === 'IFCMATERIALLAYERSETUSAGE' || entity === 'IFCMATERIALPROFILESETUSAGE') {
			const args = splitStepArgs(argStr);
			const setRef = parseRef(args[0]);
			if (setRef !== null) materialLinks.set(id, [setRef]);
		} else if (entity === 'IFCRELASSOCIATESMATERIAL') {
			const args = splitStepArgs(argStr);
			const related = parseRefList(args[4]);
			const matRef = parseRef(args[5]);
			if (matRef !== null) {
				for (const rid of related) pushMapList(entityMaterials, rid, matRef);
			}
		} else if (entity === 'IFCQUANTITYLENGTH') {
			const args = splitStepArgs(argStr);
			const name = unquoteStep(args[0]) ?? 'length';
			const v = parseStepNumber(args[3]);
			if (v !== null && v > 0) qtyValues.set(id, { kind: 'length', name, value: v });
		} else if (entity === 'IFCQUANTITYAREA') {
			const args = splitStepArgs(argStr);
			const name = unquoteStep(args[0]) ?? 'area';
			const v = parseStepNumber(args[3]);
			if (v !== null && v > 0) qtyValues.set(id, { kind: 'area', name, value: v });
		} else if (entity === 'IFCQUANTITYVOLUME') {
			const args = splitStepArgs(argStr);
			const name = unquoteStep(args[0]) ?? 'volume';
			const v = parseStepNumber(args[3]);
			if (v !== null && v > 0) qtyValues.set(id, { kind: 'volume', name, value: v });
		} else if (entity === 'IFCQUANTITYWEIGHT') {
			const args = splitStepArgs(argStr);
			const name = unquoteStep(args[0]) ?? 'weight';
			const v = parseStepNumber(args[3]);
			if (v !== null && v > 0) qtyValues.set(id, { kind: 'weight', name, value: v });
		} else if (entity === 'IFCELEMENTQUANTITY') {
			const args = splitStepArgs(argStr);
			elemQuantities.set(id, parseRefList(args[5]));
		} else if (entity === 'IFCPROPERTYSINGLEVALUE') {
			const args = splitStepArgs(argStr);
			const label = unquoteStep(args[0]);
			if (label === null) return;
			const key = label.toLowerCase().replace(/[^a-z0-9]/g, '');
			const numeric = parseStepNumber(args[2]);
			const isQtyFallback =
				numeric !== null &&
				numeric > 0 &&
				(key === 'length' ||
					key === 'netlength' ||
					key === 'nominallength' ||
					key === 'area' ||
					key === 'netarea' ||
					key === 'grossarea' ||
					key === 'netsidearea' ||
					key === 'netfloorarea' ||
					key === 'volume' ||
					key === 'netvolume' ||
					key === 'grossvolume' ||
					key === 'weight' ||
					key === 'mass' ||
					key === 'netweight');
			const isSemantic = SEMANTIC_PROPERTY_NAMES.has(key);
			if (!isQtyFallback && !isSemantic) return;
			const text = isSemantic ? unquoteTypedStepValue(args[2]) : null;
			if (numeric !== null || text !== null) {
				propSingle.set(id, { key, label, numeric, text });
			}
		} else if (entity === 'IFCPROPERTYSET') {
			const args = splitStepArgs(argStr);
			propSets.set(id, parseRefList(args[4]));
		} else if (entity === 'IFCRELDEFINESBYPROPERTIES') {
			const args = splitStepArgs(argStr);
			const related = parseRefList(args[4]);
			const defRef = parseRef(args[5]);
			if (defRef !== null) {
				for (const rid of related) pushMapList(entityDefs, rid, defRef);
			}
		} else if (
			entity.endsWith('TYPE') ||
			entity === 'IFCDOORSTYLE' ||
			entity === 'IFCWINDOWSTYLE'
		) {
			const args = splitStepArgs(argStr);
			const name = unquoteStep(args[2]);
			const description = unquoteStep(args[3]);
			const enums = classifyEnums(args, 4);
			// Capture HasPropertySets (arg 5 in IfcTypeObject) so type-level properties attach to instances
			const hasProps = parseRefList(args[5]);
			for (const pRef of hasProps) pushMapList(entityDefs, id, pRef);
			if (
				name !== null ||
				description !== null ||
				enums.predefined !== null ||
				enums.operation !== null
			) {
				typeObjects.set(id, {
					name,
					description,
					predefined_type: enums.predefined,
					operation_type: enums.operation
				});
			}
		}
	}

	function scanBuffer(text: string): string {
		let start = 0;
		let inStr = false;
		const len = text.length;
		for (let i = 0; i < len; i++) {
			const ch = text.charCodeAt(i);
			if (ch === 39) {
				if (inStr && i + 1 < len && text.charCodeAt(i + 1) === 39) {
					i++;
					continue;
				}
				inStr = !inStr;
				continue;
			}
			if (!inStr && ch === 59) {
				// ';' terminates a STEP statement
				processStatement(text.slice(start, i));
				start = i + 1;
			}
		}
		return start < len ? text.slice(start) : '';
	}

	function push(chunk: string | Uint8Array): void {
		const piece = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
		if (piece.length === 0) return;
		const combined = remainder.length > 0 ? remainder + piece : piece;
		remainder = scanBuffer(combined);
	}

	function flush(): void {
		const tail = decoder.decode();
		const combined = remainder + tail;
		remainder = '';
		if (combined.length > 0) {
			const leftover = scanBuffer(combined);
			if (leftover.trim().length > 0) processStatement(leftover);
		}
	}

	function resolveStorey(expressId: number): string {
		let curr = elementToContainer.get(expressId);
		if (curr === undefined) curr = parentOf.get(expressId);
		let hops = 0;
		let fallbackSpace: string | null = null;
		let fallbackSite: string | null = null;
		while (curr !== undefined && hops < 8) {
			const s = storeys.get(curr);
			if (s !== undefined) return s;
			if (fallbackSpace === null) {
				const sp = spaces.get(curr);
				if (sp !== undefined) fallbackSpace = sp;
			}
			if (fallbackSite === null) {
				const st = sites.get(curr);
				if (st !== undefined) fallbackSite = st;
			}
			curr = parentOf.get(curr);
			hops++;
		}
		return fallbackSpace ?? fallbackSite ?? 'Unassigned';
	}

	const materialCache = new Map<number, readonly string[]>();
	function collectMaterials(refId: number, depth = 0): readonly string[] {
		if (depth > 6) return [];
		const cached = materialCache.get(refId);
		if (cached !== undefined) return cached;
		const direct = materialNames.get(refId);
		if (direct !== undefined) {
			const out = [direct];
			materialCache.set(refId, out);
			return out;
		}
		const children = materialLinks.get(refId);
		if (children === undefined || children.length === 0) return [];
		const set = new Set<string>();
		for (const cid of children) {
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

	const layerCache = new Map<number, readonly string[]>();
	function collectMaterialLayers(refId: number, depth = 0): readonly string[] {
		if (depth > 6) return [];
		const cached = layerCache.get(refId);
		if (cached !== undefined) return cached;
		const layer = materialLayers.get(refId);
		if (layer !== undefined) {
			const matName =
				(layer.material_ref !== null ? materialNames.get(layer.material_ref) : undefined) ??
				layer.name ??
				'Layer';
			let desc = matName;
			if (layer.thickness_raw !== null && layer.thickness_raw > 0) {
				const mm = Math.round(layer.thickness_raw * lengthFactor * 1000 * 10) / 10;
				if (mm > 0) desc = `${matName} (${mm}mm)`;
			}
			const out = [desc];
			layerCache.set(refId, out);
			return out;
		}
		const children = materialLinks.get(refId);
		if (children === undefined || children.length === 0) return [];
		const out: string[] = [];
		for (const cid of children) {
			for (const entry of collectMaterialLayers(cid, depth + 1)) {
				out.push(entry);
				if (out.length >= 12) break;
			}
			if (out.length >= 12) break;
		}
		layerCache.set(refId, out);
		return out;
	}

	function resolveMaterialsFor(
		expressId: number,
		typeId: number | undefined
	): {
		readonly materials: readonly string[];
		readonly material_layers: readonly string[];
	} {
		const refs = entityMaterials.get(expressId);
		const typeRefs = typeId !== undefined ? entityMaterials.get(typeId) : undefined;
		if (refs === undefined && typeRefs === undefined) {
			return { materials: [], material_layers: [] };
		}
		const names = new Set<string>();
		let layers: readonly string[] = [];
		for (const list of [refs, typeRefs]) {
			if (list === undefined) continue;
			for (const ref of list) {
				if (layers.length === 0) {
					const foundLayers = collectMaterialLayers(ref);
					if (foundLayers.length > 0) layers = foundLayers;
				}
				for (const name of collectMaterials(ref)) {
					names.add(name);
					if (names.size >= 6) break;
				}
			}
		}
		return { materials: [...names], material_layers: layers };
	}

	function resolveQuantitiesAndProps(expressId: number, typeId: number | undefined) {
		let lengthM: number | null = null;
		let lengthPri = -1;
		let areaM2: number | null = null;
		let areaPri = -1;
		let volumeM3: number | null = null;
		let volumePri = -1;
		let weightKg: number | null = null;
		let weightPri = -1;
		const propMap = new Map<string, string>();

		const defLists = [
			entityDefs.get(expressId),
			typeId !== undefined ? entityDefs.get(typeId) : undefined
		];
		for (const defs of defLists) {
			if (defs === undefined) continue;
			for (const defId of defs) {
				const qIds = elemQuantities.get(defId);
				if (qIds !== undefined) {
					for (const qid of qIds) {
						const q = qtyValues.get(qid);
						if (q === undefined) continue;
						const pri = quantityPriority(q.kind, q.name);
						if (q.kind === 'length' && pri > lengthPri) {
							lengthM = q.value * lengthFactor;
							lengthPri = pri;
						} else if (q.kind === 'area' && pri > areaPri) {
							areaM2 = q.value * areaFactor;
							areaPri = pri;
						} else if (q.kind === 'volume' && pri > volumePri) {
							volumeM3 = q.value * volumeFactor;
							volumePri = pri;
						} else if (q.kind === 'weight' && pri > weightPri) {
							weightKg = q.value * massFactor;
							weightPri = pri;
						}
					}
				}
				const pIds = propSets.get(defId);
				if (pIds !== undefined) {
					for (const pid of pIds) {
						const p = propSingle.get(pid);
						if (p === undefined) continue;
						if (p.numeric !== null && p.numeric > 0) {
							if (
								(p.key === 'length' || p.key === 'netlength' || p.key === 'nominallength') &&
								lengthM === null
							) {
								lengthM = p.numeric * lengthFactor;
							} else if (
								(p.key === 'area' ||
									p.key === 'netarea' ||
									p.key === 'grossarea' ||
									p.key === 'netsidearea' ||
									p.key === 'netfloorarea') &&
								areaM2 === null
							) {
								areaM2 = p.numeric * areaFactor;
							} else if (
								(p.key === 'volume' || p.key === 'netvolume' || p.key === 'grossvolume') &&
								volumeM3 === null
							) {
								volumeM3 = p.numeric * volumeFactor;
							} else if (
								(p.key === 'weight' || p.key === 'mass' || p.key === 'netweight') &&
								weightKg === null
							) {
								weightKg = p.numeric * massFactor;
							}
						}
						if (p.text !== null && p.text.length > 0 && propMap.size < 8) {
							if (!propMap.has(p.label)) {
								propMap.set(p.label, `${p.label}=${p.text.slice(0, 60)}`);
							}
						}
					}
				}
			}
		}

		return {
			lengthM,
			areaM2,
			volumeM3,
			weightKg,
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
		const storey = resolveStorey(a.express_id);
		const cleanTypeName =
			typeInfo?.name
				?.trim()
				.replace(/:(?:[A-Za-z]{0,2}\d{1,7}|[0-9A-Fa-f]{6,})$/, '')
				.trim() ?? null;
		const family = cleanTypeName || a.name.split(':')[0]?.trim() || a.object_type || a.ifc_class;
		const typeName = cleanTypeName;
		const predefinedType = a.predefined_type ?? typeInfo?.predefined_type ?? null;
		const operationType = a.operation_type ?? typeInfo?.operation_type ?? null;
		const partIds = (childrenOf.get(a.express_id) ?? []).slice(0, 32);

		return {
			express_id: a.express_id,
			global_id: a.global_id,
			ifc_class: a.ifc_class,
			name: a.name,
			family,
			type_id: typeId ?? null,
			type_name: typeName,
			object_type: a.object_type,
			predefined_type: predefinedType,
			operation_type: operationType,
			storey,
			classification_code: cls?.code ?? null,
			classification_name: cls?.name ?? null,
			materials: matInfo.materials,
			material_layers: matInfo.material_layers,
			layer_count: matInfo.material_layers.length,
			properties: qp.properties,
			part_ids: partIds,
			length_m: qp.lengthM,
			area_m2: qp.areaM2,
			volume_m3: qp.volumeM3,
			weight_kg: qp.weightKg
		};
	}

	function stats(): IfcStreamStats {
		return {
			statements_scanned: statementsScanned,
			relevant_statements: relevantStatements,
			raw_assets: rawAssets.length
		};
	}

	function finishFull(): ParsedIfcModel {
		flush();
		const classCounts: Record<string, number> = {};
		const assets: BimAssetRecord[] = rawAssets.map((raw) => {
			classCounts[raw.ifc_class] = (classCounts[raw.ifc_class] ?? 0) + 1;
			return resolveElement(raw);
		});
		return {
			schema,
			project_name: projectName,
			storeys: [...new Set(storeys.values())],
			assets,
			class_counts: classCounts
		};
	}

	function finish(): ExtractedBimModel {
		flush();
		const explicitStoreys = [...new Set(storeys.values())];
		return aggregateResolvedAssets(
			schema,
			projectName,
			explicitStoreys,
			rawAssets.map(resolveElement)
		);
	}

	return { push, finish, finishFull, stats };
}

function aggregateResolvedAssets(
	schema: string,
	projectName: string | null,
	explicitStoreys: readonly string[],
	assets: readonly BimAssetRecord[]
): ExtractedBimModel {
	const sigToId = new Map<string, string>();
	const archetypes = new Map<
		string,
		{
			archetype_id: string;
			representative_express_id: number;
			representative_part_ids: readonly number[];
			ifc_class: string;
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
		}
	>();
	const buckets = new Map<
		string,
		{
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
		}
	>();
	let nextArchNum = 1;
	const seenStoreys = new Set<string>(explicitStoreys);

	for (const elem of assets) {
		seenStoreys.add(elem.storey);
		const sig = computeArchetypeSignature(elem);

		let archId = sigToId.get(sig);
		let arch = archId !== undefined ? archetypes.get(archId) : undefined;
		if (archId === undefined || arch === undefined) {
			archId = `A${nextArchNum++}`;
			sigToId.set(sig, archId);
			arch = {
				archetype_id: archId,
				representative_express_id: elem.express_id,
				representative_part_ids: elem.part_ids,
				ifc_class: elem.ifc_class,
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
		for (const p of elem.properties) if (arch.properties.size < 8) arch.properties.add(p);
		if (arch.material_layers.length === 0 && elem.material_layers.length > 0) {
			arch.material_layers = elem.material_layers;
			arch.layer_count = elem.layer_count;
		}
		if (arch.representative_part_ids.length === 0 && elem.part_ids.length > 0) {
			arch.representative_part_ids = elem.part_ids;
		}
		if (elem.length_m !== null) arch.has_length = true;
		if (elem.area_m2 !== null) arch.has_area = true;
		if (elem.volume_m3 !== null) arch.has_volume = true;
		if (elem.weight_kg !== null) arch.has_weight = true;

		const bucketKey = `${archId}::${elem.storey}`;
		let bucket = buckets.get(bucketKey);
		if (bucket === undefined) {
			bucket = {
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
				sample_express_ids: []
			};
			buckets.set(bucketKey, bucket);
		}
		bucket.element_count += 1;
		if (elem.length_m !== null) {
			bucket.length_m += elem.length_m;
			bucket.length_measured_count += 1;
		}
		if (elem.area_m2 !== null) {
			bucket.area_m2 += elem.area_m2;
			bucket.area_measured_count += 1;
		}
		if (elem.volume_m3 !== null) {
			bucket.volume_m3 += elem.volume_m3;
			bucket.volume_measured_count += 1;
		}
		if (elem.weight_kg !== null) {
			bucket.weight_kg += elem.weight_kg;
			bucket.weight_measured_count += 1;
		}
		if (bucket.sample_express_ids.length < 10) bucket.sample_express_ids.push(elem.express_id);
	}

	const orderedStoreys = [...new Set([...explicitStoreys, ...seenStoreys])].filter(
		(s) => s !== 'Unassigned' || seenStoreys.has('Unassigned')
	);

	return {
		schema,
		project_name: projectName,
		storeys: explicitStoreys.length > 0 ? [...explicitStoreys] : orderedStoreys,
		total_asset_count: assets.length,
		archetypes: [...archetypes.values()]
			.sort((a, b) => b.total_count - a.total_count || a.archetype_id.localeCompare(b.archetype_id))
			.map((a) => ({
				archetype_id: a.archetype_id,
				representative_express_id: a.representative_express_id,
				representative_part_ids: [...a.representative_part_ids],
				ifc_class: a.ifc_class,
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
		buckets: [...buckets.values()].map((b) => ({
			archetype_id: b.archetype_id,
			storey: b.storey,
			element_count: b.element_count,
			length_m: Number(b.length_m.toFixed(4)),
			length_measured_count: b.length_measured_count,
			area_m2: Number(b.area_m2.toFixed(4)),
			area_measured_count: b.area_measured_count,
			volume_m3: Number(b.volume_m3.toFixed(4)),
			volume_measured_count: b.volume_measured_count,
			weight_kg: Number(b.weight_kg.toFixed(4)),
			weight_measured_count: b.weight_measured_count,
			sample_express_ids: b.sample_express_ids
		}))
	};
}

/** Converts an already-parsed `ParsedIfcModel` into compact bucketed `ExtractedBimModel`. */
export function extractFromParsedModel(parsed: ParsedIfcModel): ExtractedBimModel {
	return aggregateResolvedAssets(parsed.schema, parsed.project_name, parsed.storeys, parsed.assets);
}
