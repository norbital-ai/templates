/**
 * Realistic 15-Storey Singapore HDB / Condo Residential Tower IFC4+SG Fixture with Exact Analytical Ground Truth.
 *
 * Models a full 17-level Singapore public/private residential block (`Punggol Cove Residences`:
 * B1 Basement Carpark → L01 Void Deck & Drop-Off → L02–L15 Typical PPVC Residential Flats → Roof Plant & Tank Deck)
 * including CORENET X IFC-SG specifics:
 * - SVY21 Georeferencing (`IFCPROJECTEDCRS('EPSG:3414')` + `IFCMAPCONVERSION`)
 * - Singapore `SGPset_*` property sets (`SGPset_Wall`, `SGPset_Slab`, `SGPset_Door`, `SGPset_StairFlight`)
 * - Household Shelter (300mm RC shelter walls + SCDF blast door), PPVC residential flats, transfer slab,
 *   precast escape staircases (incl. 1 deliberate 188mm BCA riser violation), barrier-free drop-off ramp
 *   (incl. deliberate 10.5% slope violation vs BCA 8.33% max), balcony balustrades (incl. 1 deliberate 900mm
 *   low parapet violation vs BCA 1000mm min), wet/dry fire risers, domestic cold water & sanitary stacks,
 *   electrical rising mains, passenger + fireman lifts, 2 federated duplicate beams, 2 inline pipe proxies,
 *   and an L-shaped lobby sofa placed 0.35 m from a sharp glass divider (for wide-aperture spatial SOP linting).
 */
import { BigDecimal } from 'effect';
import {
	measureElement,
	measureMesh,
	type ElementMeasure,
	type MeshMeasure
} from '../../src/services/bim/geometry.js';
import type { MatrixItem } from '../../src/services/bim/schema.js';
import { divSafe, moneyStr, toDecimal } from '../../src/services/commercial/decimal.js';

export type HdbTowerFixture = {
	readonly ifcText: string;
	readonly elementMeasures: ReadonlyMap<number, ElementMeasure>;
	readonly groundTruthByCode: ReadonlyMap<
		string,
		{ readonly expected_qty: number; readonly unit: string }
	>;
	readonly expectedTotalWith5PctContingency: string;
	readonly totalPhysicalAssetsAfterDedup: number;
	readonly duplicateBeamIds: readonly number[];
	readonly inlineProxyIds: readonly number[];
	readonly nonCompliantStairFlightId: number;
	readonly nonCompliantRampId: number;
	readonly nonCompliantRailingId: number;
	readonly lShapedSofaId: number;
	readonly sharpGlassFinId: number;
};

export const HDB_CONDO_MATRIX: readonly MatrixItem[] = [
	{
		code: 'HDB-PILE',
		name: 'Bored RC Foundation Piles',
		category: 'bim_asset',
		discipline: 'structural',
		trade_specialty: 'piling',
		ifc_classes: ['IFCPILE'],
		match_keywords: ['pile'],
		unit: 'm3',
		quantity_basis: 'volume',
		currency: 'SGD',
		unit_rate: '560.00',
		waste_factor_pct: '5.0',
		carbon_factor: '360',
		active: true
	},
	{
		code: 'HDB-COL',
		name: 'RC Structural Columns G40',
		category: 'bim_asset',
		discipline: 'structural',
		trade_specialty: 'structural',
		ifc_classes: ['IFCCOLUMN'],
		match_keywords: ['column'],
		unit: 'm3',
		quantity_basis: 'volume',
		currency: 'SGD',
		unit_rate: '510.00',
		waste_factor_pct: '4.0',
		carbon_factor: '350',
		active: true
	},
	{
		code: 'HDB-BEAM',
		name: 'RC Structural Beams G40',
		category: 'bim_asset',
		discipline: 'structural',
		trade_specialty: 'structural',
		ifc_classes: ['IFCBEAM'],
		match_keywords: ['beam'],
		unit: 'm3',
		quantity_basis: 'volume',
		currency: 'SGD',
		unit_rate: '475.00',
		waste_factor_pct: '4.0',
		carbon_factor: '350',
		active: true
	},
	{
		code: 'HDB-SLAB',
		name: 'Suspended & Transfer RC Slabs G40',
		category: 'bim_asset',
		discipline: 'structural',
		trade_specialty: 'structural',
		ifc_classes: ['IFCSLAB'],
		match_keywords: ['slab', 'transfer'],
		unit: 'm3',
		quantity_basis: 'volume',
		currency: 'SGD',
		unit_rate: '425.00',
		waste_factor_pct: '3.0',
		carbon_factor: '340',
		active: true
	},
	{
		code: 'HDB-HS-WALL',
		name: 'Household Shelter 300mm RC Walls',
		category: 'bim_asset',
		discipline: 'structural',
		trade_specialty: 'structural',
		ifc_classes: ['IFCWALL'],
		match_keywords: ['household shelter', 'bomb shelter', '300mm'],
		unit: 'm3',
		quantity_basis: 'volume',
		currency: 'SGD',
		unit_rate: '620.00',
		waste_factor_pct: '3.0',
		carbon_factor: '380',
		active: true
	},
	{
		code: 'HDB-PPVC-WALL',
		name: 'PPVC Precast Flat Partition Walls',
		category: 'bim_asset',
		discipline: 'architecture',
		trade_specialty: 'finishing',
		ifc_classes: ['IFCWALL'],
		match_keywords: ['ppvc', 'precast', 'drywall'],
		unit: 'm2',
		quantity_basis: 'area',
		currency: 'SGD',
		unit_rate: '96.00',
		waste_factor_pct: '4.0',
		carbon_factor: '42',
		active: true
	},
	{
		code: 'HDB-GLAZING',
		name: 'Sharp Architectural Glass Fin Divider',
		category: 'bim_asset',
		discipline: 'architecture',
		trade_specialty: 'facade',
		ifc_classes: ['IFCPLATE'],
		match_keywords: ['glass fin', 'sharp', 'divider'],
		unit: 'm2',
		quantity_basis: 'area',
		currency: 'SGD',
		unit_rate: '480.00',
		waste_factor_pct: '3.0',
		carbon_factor: '140',
		active: true
	},
	{
		code: 'HDB-DOOR-FLAT',
		name: 'Accessible Flat Entrance Timber Door',
		category: 'bim_asset',
		discipline: 'architecture',
		trade_specialty: 'finishing',
		ifc_classes: ['IFCDOOR'],
		match_keywords: ['flat entrance', 'accessible'],
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '1450.00',
		waste_factor_pct: '2.0',
		carbon_factor: '65',
		active: true
	},
	{
		code: 'HDB-DOOR-HS',
		name: 'SCDF Household Shelter Blast Door',
		category: 'bim_asset',
		discipline: 'architecture',
		trade_specialty: 'fire_protection',
		ifc_classes: ['IFCDOOR'],
		match_keywords: ['blast', 'shelter', 'fire'],
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '4200.00',
		waste_factor_pct: '0.0',
		carbon_factor: '240',
		active: true
	},
	{
		code: 'HDB-STAIR',
		name: 'Precast RC Escape Staircase Flight',
		category: 'bim_asset',
		discipline: 'structural',
		trade_specialty: 'structural',
		ifc_classes: ['IFCSTAIRFLIGHT'],
		match_keywords: ['stair', 'flight'],
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '2800.00',
		waste_factor_pct: '2.0',
		carbon_factor: '950',
		active: true
	},
	{
		code: 'HDB-RAMP',
		name: 'Barrier-Free Concrete Drop-Off Ramp',
		category: 'bim_asset',
		discipline: 'architecture',
		trade_specialty: 'general',
		ifc_classes: ['IFCRAMP'],
		match_keywords: ['ramp', 'drop-off'],
		unit: 'm3',
		quantity_basis: 'volume',
		currency: 'SGD',
		unit_rate: '540.00',
		waste_factor_pct: '3.0',
		carbon_factor: '340',
		active: true
	},
	{
		code: 'HDB-RAIL',
		name: 'Balcony Glass & Aluminium Parapet Railing',
		category: 'bim_asset',
		discipline: 'architecture',
		trade_specialty: 'facade',
		ifc_classes: ['IFCRAILING'],
		match_keywords: ['railing', 'balcony', 'parapet'],
		unit: 'm',
		quantity_basis: 'length',
		currency: 'SGD',
		unit_rate: '320.00',
		waste_factor_pct: '3.0',
		carbon_factor: '45',
		active: true
	},
	{
		code: 'HDB-SOFA',
		name: 'L-Shaped Lobby Lounge Sofa',
		category: 'bim_asset',
		discipline: 'architecture',
		trade_specialty: 'finishing',
		ifc_classes: ['IFCFURNITURE'],
		match_keywords: ['sofa', 'l-shaped', 'lounge'],
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '3800.00',
		waste_factor_pct: '0.0',
		carbon_factor: '180',
		active: true
	},
	{
		code: 'HDB-FIRE-RISER',
		name: 'SCDF DN100 Dry/Wet Fire Riser Pipework',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'fire_protection',
		ifc_classes: ['IFCPIPESEGMENT'],
		match_keywords: ['fire', 'wet riser', 'dry riser'],
		system_services: ['fire_protection'],
		topology_mode: 'contiguous_linear',
		unit: 'm',
		quantity_basis: 'length',
		currency: 'SGD',
		unit_rate: '92.00',
		waste_factor_pct: '5.0',
		carbon_factor: '7.2',
		active: true
	},
	{
		code: 'HDB-CW-PIPE',
		name: 'PUB DN50 Domestic Cold Water Riser',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'plumbing',
		ifc_classes: ['IFCPIPESEGMENT'],
		match_keywords: ['cold water', 'potable'],
		system_services: ['domestic_cold_water'],
		topology_mode: 'contiguous_linear',
		unit: 'm',
		quantity_basis: 'length',
		currency: 'SGD',
		unit_rate: '68.00',
		waste_factor_pct: '5.0',
		carbon_factor: '4.5',
		active: true
	},
	{
		code: 'HDB-SAN-PIPE',
		name: 'PUB DN100 Sanitary Soil & Waste Stack',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'plumbing',
		ifc_classes: ['IFCPIPESEGMENT'],
		match_keywords: ['sanitary', 'soil', 'waste'],
		system_services: ['sanitary_dwv'],
		topology_mode: 'contiguous_linear',
		unit: 'm',
		quantity_basis: 'length',
		currency: 'SGD',
		unit_rate: '54.00',
		waste_factor_pct: '5.0',
		carbon_factor: '3.2',
		active: true
	},
	{
		code: 'HDB-ELEC-MAIN',
		name: 'Electrical Rising Main Busduct',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'electrical',
		ifc_classes: ['IFCCABLECARRIERSEGMENT'],
		match_keywords: ['rising main', 'busduct', 'electrical'],
		system_services: ['electrical_power'],
		topology_mode: 'contiguous_linear',
		unit: 'm',
		quantity_basis: 'length',
		currency: 'SGD',
		unit_rate: '240.00',
		waste_factor_pct: '3.0',
		carbon_factor: '18',
		active: true
	},
	{
		code: 'HDB-LIFT',
		name: 'High-Speed Passenger / Fireman Lift',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'mne',
		ifc_classes: ['IFCTRANSPORTELEMENT'],
		match_keywords: ['lift', 'fireman', 'passenger'],
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '185000.00',
		waste_factor_pct: '0.0',
		carbon_factor: '14000',
		active: true
	},
	{
		code: 'HDB-REBAR-SLAB',
		name: 'Rebar to RC Slabs (derived)',
		category: 'bim_asset',
		discipline: 'structural',
		trade_specialty: 'structural',
		ifc_classes: [],
		match_keywords: [],
		unit: 'kg',
		quantity_basis: 'derived',
		derived_from: 'HDB-SLAB',
		ratio: '110',
		currency: 'SGD',
		unit_rate: '1.65',
		waste_factor_pct: '5.0',
		carbon_factor: '1.99',
		active: true
	}
];

function boxMesh(dx: number, dy: number, dz: number): MeshMeasure {
	const corners = [
		[0, 0, 0],
		[dx, 0, 0],
		[dx, dy, 0],
		[0, dy, 0],
		[0, 0, dz],
		[dx, 0, dz],
		[dx, dy, dz],
		[0, dy, dz]
	];
	const faces = [
		[0, 2, 1, 0, 3, 2],
		[4, 5, 6, 4, 6, 7],
		[0, 1, 5, 0, 5, 4],
		[2, 3, 7, 2, 7, 6],
		[1, 2, 6, 1, 6, 5],
		[0, 4, 7, 0, 7, 3]
	].flat();
	const m = measureMesh(
		new Float32Array(corners.flatMap((c) => [...c, 0, 0, 0])),
		new Uint32Array(faces)
	);
	if (m === null) throw new Error('Invalid box mesh');
	return m;
}

function makeBox(
	ox: number,
	oy: number,
	oz: number,
	dx: number,
	dy: number,
	dz: number
): ElementMeasure {
	const m = measureElement([
		{ mesh: boxMesh(dx, dy, dz), transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ox, oy, oz, 1] }
	]);
	if (m === null) throw new Error('Failed box measure');
	return m;
}

export function buildHdbCondoTower15StoreyIfc4(matrix: readonly MatrixItem[]): HdbTowerFixture {
	const lines: string[] = [];
	const measures = new Map<number, ElementMeasure>();
	let nextId = 1;
	let guidSeq = 1;
	const emit = (stmt: string): number => {
		const eid = nextId++;
		lines.push(`#${eid}= ${stmt};`);
		return eid;
	};
	const guid = () => `3HDBSG15${String(guidSeq++).padStart(14, '0')}`;
	const esc = (s: string) => s.replace(/'/g, "''");

	const owner = emit(`IFCOWNERHISTORY(#2,#3,$,.NOCHANGE.,$,$,$,1767225600)`);
	emit(`IFCPERSONANDORGANIZATION(#4,#5,$)`);
	emit(`IFCAPPLICATION(#5,'2026.1','Norbital IFC-SG Generator','NSG')`);
	emit(`IFCPERSON($,'QP','Architect',$,$,$,$,$)`);
	emit(`IFCORGANIZATION($,'Singapore Residential JV',$,$,$)`);

	const uLen = emit(`IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`);
	const uArea = emit(`IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)`);
	const uVol = emit(`IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)`);
	const uMass = emit(`IFCSIUNIT(*,.MASSUNIT.,.KILO.,.GRAM.)`);
	const uAssign = emit(`IFCUNITASSIGNMENT((#${uLen},#${uArea},#${uVol},#${uMass}))`);

	const originPt = emit(`IFCCARTESIANPOINT((0.,0.,0.))`);
	const dirZ = emit(`IFCDIRECTION((0.,0.,1.))`);
	const dirX = emit(`IFCDIRECTION((1.,0.,0.))`);
	const worldAx = emit(`IFCAXIS2PLACEMENT3D(#${originPt},#${dirZ},#${dirX})`);
	const ctx3d = emit(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#${worldAx},$)`);

	// Real Singapore SVY21 / EPSG:3414 Georeferencing (CORENET X mandatory)
	const crs = emit(
		`IFCPROJECTEDCRS('EPSG:3414','SVY21 / Singapore TM','SVY21','Singapore TM','Transverse Mercator',$,#${uLen})`
	);
	emit(`IFCMAPCONVERSION(#${ctx3d},#${crs},35420.5,42180.2,12.4,1.,0.,1.)`);

	const project = emit(
		`IFCPROJECT('${guid()}',#${owner},'HDB-SG-15','15-Storey Residential Tower',$,'Punggol Cove Residences',$,(#${ctx3d}),#${uAssign})`
	);
	const sitePl = emit(`IFCLOCALPLACEMENT($,#${worldAx})`);
	const site = emit(
		`IFCSITE('${guid()}',#${owner},'Punggol Parcel C',$,$,#${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`
	);
	const bldgPl = emit(`IFCLOCALPLACEMENT(#${sitePl},#${worldAx})`);
	const bldg = emit(
		`IFCBUILDING('${guid()}',#${owner},'Block 108A',$,$,#${bldgPl},$,$,.ELEMENT.,$,$,$)`
	);
	emit(`IFCRELAGGREGATES('${guid()}',#${owner},$,$,#${project},(#${site}))`);
	emit(`IFCRELAGGREGATES('${guid()}',#${owner},$,$,#${site},(#${bldg}))`);

	// 17 storeys: B1 (-3.6m), L01 (0.0m, 4.2m void deck), L02..L15 (3.0m typical PPVC flats), ROOF (46.2m)
	type StoreySpec = {
		readonly key: string;
		readonly name: string;
		readonly elev: number;
		readonly height: number;
	};
	const storeys: StoreySpec[] = [
		{ key: 'B1', name: 'B1 - Basement Carpark', elev: -3.6, height: 3.6 },
		{ key: 'L01', name: 'L01 - Void Deck & Drop-Off', elev: 0.0, height: 4.2 },
		...Array.from({ length: 14 }, (_, i) => ({
			key: `L${String(i + 2).padStart(2, '0')}`,
			name: `L${String(i + 2).padStart(2, '0')} - Typical Residential`,
			elev: 4.2 + i * 3.0,
			height: 3.0
		})),
		{ key: 'ROOF', name: 'ROOF - Tank & Lift Motor Deck', elev: 46.2, height: 3.2 }
	];

	const storeyIds = new Map<string, number>();
	const storeyMembers = new Map<string, number[]>();
	for (const st of storeys) {
		const sid = emit(
			`IFCBUILDINGSTOREY('${guid()}',#${owner},'${esc(st.name)}',$,$,$,$,'${esc(st.name)}',.ELEMENT.,${st.elev.toFixed(3)})`
		);
		storeyIds.set(st.key, sid);
		storeyMembers.set(st.key, []);
	}
	emit(
		`IFCRELAGGREGATES('${guid()}',#${owner},$,$,#${bldg},(${storeys.map((s) => `#${storeyIds.get(s.key)}`).join(',')}))`
	);

	const addSt = (k: string, eid: number) => storeyMembers.get(k)?.push(eid);
	const matCache = new Map<string, number>();
	const assignMat = (ids: number[], name: string) => {
		if (ids.length === 0) return;
		let mid = matCache.get(name);
		if (mid === undefined) {
			mid = emit(`IFCMATERIAL('${esc(name)}')`);
			matCache.set(name, mid);
		}
		emit(
			`IFCRELASSOCIATESMATERIAL('${guid()}',#${owner},$,$,(${ids.map((e) => `#${e}`).join(',')}),#${mid})`
		);
	};
	const addPset = (
		ids: number[],
		psetName: string,
		props: readonly (readonly [string, string])[]
	) => {
		if (ids.length === 0) return;
		const pids = props.map(([k, v]) =>
			emit(`IFCPROPERTYSINGLEVALUE('${esc(k)}',$,IFCLABEL('${esc(v)}'),$)`)
		);
		const ps = emit(
			`IFCPROPERTYSET('${guid()}',#${owner},'${esc(psetName)}',$,(${pids.map((p) => `#${p}`).join(',')}))`
		);
		emit(
			`IFCRELDEFINESBYPROPERTIES('${guid()}',#${owner},$,$,(${ids.map((e) => `#${e}`).join(',')}),#${ps})`
		);
	};

	const gtQty = new Map<string, number>();
	const gtStoreyQty = new Map<string, Map<string, number>>();
	const rec = (code: string, stKey: string, qty: number) => {
		gtQty.set(code, (gtQty.get(code) ?? 0) + qty);
		const stName = storeys.find((s) => s.key === stKey)?.name ?? stKey;
		let sm = gtStoreyQty.get(stName);
		if (!sm) {
			sm = new Map();
			gtStoreyQty.set(stName, sm);
		}
		sm.set(code, (sm.get(code) ?? 0) + qty);
	};

	const pileIds: number[] = [];
	const colIds: number[] = [];
	const beamIds: number[] = [];
	const slabIds: number[] = [];
	const hsWallIds: number[] = [];
	const ppvcWallIds: number[] = [];
	const flatDoorIds: number[] = [];
	const hsDoorIds: number[] = [];
	const stairIds: number[] = [];
	const railIds: number[] = [];

	// 16 Bored Piles (B1)
	const gx = [0.3, 8.0, 16.0, 23.7];
	const gy = [0.3, 6.0, 12.0, 17.7];
	for (const x of gx) {
		for (const y of gy) {
			const pid = emit(
				`IFCPILE('${guid()}',#${owner},'Bored RC Pile 900mm',$,'Bored Pile G40',$,$,'PL',.BORED.,$)`
			);
			pileIds.push(pid);
			addSt('B1', pid);
			measures.set(pid, makeBox(x - 0.45, y - 0.45, -18.6, 0.9, 0.9, 15.0));
			rec('HDB-PILE', 'B1', 0.9 * 0.9 * 15.0);
		}
	}

	// Columns, Beams, Slabs across B1..L15 + Roof slab
	let nonCompliantStairFlightId = 0;
	let nonCompliantRailingId = 0;
	for (const st of storeys) {
		// Floor slab (24m × 18m × 0.22m on L01 transfer = 0.45m, typical = 0.20m)
		const thk = st.key === 'L01' ? 0.45 : 0.2;
		const sid = emit(
			`IFCSLAB('${guid()}',#${owner},'${st.key === 'L01' ? 'Transfer RC Slab 450mm G40' : 'Suspended RC Slab 200mm G40'}',$,'RC Slab G40',$,$,'SL',.FLOOR.)`
		);
		slabIds.push(sid);
		addSt(st.key, sid);
		measures.set(sid, makeBox(0, 0, st.elev, 24.0, 18.0, thk));
		rec('HDB-SLAB', st.key, 24.0 * 18.0 * thk);

		if (st.key === 'ROOF') continue;

		// 16 RC Columns per level
		for (const x of gx) {
			for (const y of gy) {
				const cid = emit(
					`IFCCOLUMN('${guid()}',#${owner},'RC Column 500x500 G40',$,'RC Column G40',$,$,'CL',.COLUMN.)`
				);
				colIds.push(cid);
				addSt(st.key, cid);
				measures.set(cid, makeBox(x - 0.25, y - 0.25, st.elev, 0.5, 0.5, st.height));
				rec('HDB-COL', st.key, 0.5 * 0.5 * st.height);
			}
		}

		// 8 RC Primary Beams per level
		for (let i = 0; i < 4; i++) {
			const y = gy[i] ?? 0;
			for (let j = 0; j < 2; j++) {
				const ox = (gx[j] ?? 0) + 0.25;
				const bid = emit(
					`IFCBEAM('${guid()}',#${owner},'RC Beam 350x600 G40',$,'RC Beam G40',$,$,'BM',.BEAM.)`
				);
				beamIds.push(bid);
				addSt(st.key, bid);
				measures.set(bid, makeBox(ox, y - 0.175, st.elev + st.height - 0.6, 7.2, 0.35, 0.6));
				rec('HDB-BEAM', st.key, 7.2 * 0.35 * 0.6);
			}
		}

		// Precast Staircase Flight per level (L15 deliberately has 188mm riser > 175mm BCA max!)
		const riserM = st.key === 'L15' ? 0.188 : 0.17;
		const flId = emit(
			`IFCSTAIRFLIGHT('${guid()}',#${owner},'Precast RC Escape Stair Flight',$,'Precast Stair Flight',$,$,'SF',16,15,${riserM.toFixed(3)},0.275,.STRAIGHT.)`
		);
		stairIds.push(flId);
		addSt(st.key, flId);
		measures.set(flId, makeBox(11.0, 8.0, st.elev, 3.6, 1.2, st.height));
		rec('HDB-STAIR', st.key, 1);
		if (st.key === 'L15') nonCompliantStairFlightId = flId;

		// Typical residential floors L02..L15: 4 Household Shelters + PPVC walls + doors + balcony railings
		if (st.key.startsWith('L') && st.key !== 'L01') {
			for (let u = 0; u < 4; u++) {
				const ux = (u % 2) * 12.0 + 1.0;
				const uy = Math.floor(u / 2) * 9.0 + 1.0;
				// Household Shelter 300mm RC wall
				const hsw = emit(
					`IFCWALL('${guid()}',#${owner},'Household Shelter 300mm RC Wall G40',$,'Household Shelter RC',$,$,'HSW',.SHEAR.)`
				);
				hsWallIds.push(hsw);
				addSt(st.key, hsw);
				measures.set(hsw, makeBox(ux, uy, st.elev, 2.4, 0.3, st.height));
				rec('HDB-HS-WALL', st.key, 2.4 * 0.3 * st.height);

				// PPVC internal partition wall (area-priced, 120mm thick)
				const pw = emit(
					`IFCWALL('${guid()}',#${owner},'PPVC Precast Flat Partition Wall 120mm',$,'PPVC Drywall Partition',$,$,'PPVC',.PARTITIONING.)`
				);
				ppvcWallIds.push(pw);
				addSt(st.key, pw);
				measures.set(pw, makeBox(ux + 3.0, uy, st.elev, 4.5, 0.12, st.height));
				rec('HDB-PPVC-WALL', st.key, 4.5 * st.height);

				// Accessible flat entrance door (900mm × 2100mm)
				const fd = emit(
					`IFCDOOR('${guid()}',#${owner},'Accessible Flat Entrance Timber Door 900x2100',$,'Flat Entrance Door',$,$,'FD',2.100,0.900,.DOOR.,.SINGLE_SWING_LEFT.,$)`
				);
				flatDoorIds.push(fd);
				addSt(st.key, fd);
				measures.set(fd, makeBox(ux + 1.0, uy + 3.0, st.elev, 0.9, 0.05, 2.1));
				rec('HDB-DOOR-FLAT', st.key, 1);

				// SCDF Household Shelter blast door (900mm × 2100mm, FireRating=FD120)
				const hsd = emit(
					`IFCDOOR('${guid()}',#${owner},'SCDF Household Shelter Blast Door',$,'Blast Fire Door',$,$,'HSD',2.100,0.900,.DOOR.,.SINGLE_SWING_RIGHT.,$)`
				);
				hsDoorIds.push(hsd);
				addSt(st.key, hsd);
				measures.set(hsd, makeBox(ux + 0.5, uy + 0.3, st.elev, 0.9, 0.1, 2.1));
				rec('HDB-DOOR-HS', st.key, 1);

				// Balcony railing (4.0m long; L15 unit 0 deliberately 900mm low parapet < 1000mm BCA Cl. H!)
				const railH = st.key === 'L15' && u === 0 ? 0.9 : 1.05;
				const rl = emit(
					`IFCRAILING('${guid()}',#${owner},'Balcony Parapet Railing',$,'Balcony Glass Railing',$,$,'RL',.BALUSTRADE.)`
				);
				railIds.push(rl);
				addSt(st.key, rl);
				measures.set(rl, makeBox(ux, uy + 7.5, st.elev, 4.0, 0.08, railH));
				rec('HDB-RAIL', st.key, 4.0);
				if (st.key === 'L15' && u === 0) nonCompliantRailingId = rl;
			}
		}
	}

	// Barrier-Free Drop-Off Ramp on L01 (deliberately steep: 0.63m rise over 6.0m run = 10.5% > 8.33% BCA Cl. 4.6!)
	const nonCompliantRampId = emit(
		`IFCRAMP('${guid()}',#${owner},'Drop-Off Barrier-Free Concrete Ramp',$,'Accessible Ramp',$,$,'RMP',.STRAIGHT_RUN_RAMP.)`
	);
	addSt('L01', nonCompliantRampId);
	measures.set(nonCompliantRampId, makeBox(2.0, 15.0, 0.0, 6.0, 1.5, 0.63));
	rec('HDB-RAMP', 'L01', 6.0 * 1.5 * 0.63);

	// L-shaped lobby sofa placed 0.35 m away from a sharp architectural glass fin divider on L01 (tests spatial proximity & semantic SOP!)
	const lShapedSofaId = emit(
		`IFCFURNITURE('${guid()}',#${owner},'L-Shaped Lobby Lounge Sofa',$,'L-Shaped Sofa',$,$,'SOF',.SOFA.)`
	);
	addSt('L01', lShapedSofaId);
	measures.set(lShapedSofaId, makeBox(14.0, 4.0, 0.0, 2.8, 1.8, 0.85));
	rec('HDB-SOFA', 'L01', 1);

	const sharpGlassFinId = emit(
		`IFCPLATE('${guid()}',#${owner},'Sharp Architectural Glass Fin Divider',$,'Sharp Glass Fin',$,$,'GFN',.CURTAIN_PANEL.)`
	);
	addSt('L01', sharpGlassFinId);
	measures.set(sharpGlassFinId, makeBox(17.15, 4.0, 0.0, 0.02, 1.6, 2.6)); // exact 0.35 m gap from sofa x=16.80!
	rec('HDB-GLAZING', 'L01', 1.6 * 2.6);

	// 2 High-Speed Lifts (Passenger + SCDF Fireman Lift)
	const liftIds: number[] = [];
	for (let i = 0; i < 2; i++) {
		const lid = emit(
			`IFCTRANSPORTELEMENT('${guid()}',#${owner},'${i === 0 ? 'Passenger Lift 1000kg' : 'SCDF Fireman Lift 1000kg'}',$,'MRL Lift',$,$,'LFT',.ELEVATOR.)`
		);
		liftIds.push(lid);
		addSt('L01', lid);
		measures.set(lid, makeBox(9.2 + i * 2.2, 8.2, 0.0, 1.8, 1.8, 2.5));
		rec('HDB-LIFT', 'L01', 1);
	}

	// Vertical MEP Risers (spanning B1 → ROOF = 49.0m each) + 2 inline unclassed pipe proxies touching the fire riser!
	const fireRiser = emit(
		`IFCPIPESEGMENT('${guid()}',#${owner},'SCDF DN100 Fire Wet Riser',$,'Fire Wet Riser DN100',$,$,'FR1',.RIGIDSEGMENT.)`
	);
	const cwRiser = emit(
		`IFCPIPESEGMENT('${guid()}',#${owner},'PUB DN50 Domestic Cold Water Riser',$,'Domestic Cold Water DN50',$,$,'CW1',.RIGIDSEGMENT.)`
	);
	const sanStack = emit(
		`IFCPIPESEGMENT('${guid()}',#${owner},'PUB DN100 Sanitary Soil Stack',$,'Sanitary Soil Stack DN100',$,$,'SN1',.RIGIDSEGMENT.)`
	);
	const elecMain = emit(
		`IFCCABLECARRIERSEGMENT('${guid()}',#${owner},'Electrical Rising Main Busduct',$,'Electrical Rising Main',$,$,'EM1',.CABLETRAYSEGMENT.)`
	);
	addSt('B1', fireRiser);
	addSt('B1', cwRiser);
	addSt('B1', sanStack);
	addSt('B1', elecMain);
	measures.set(fireRiser, makeBox(13.5, 8.5, -3.2, 0.1, 0.1, 49.0));
	measures.set(cwRiser, makeBox(14.0, 8.5, -3.2, 0.05, 0.05, 49.0));
	measures.set(sanStack, makeBox(14.5, 8.5, -3.2, 0.1, 0.1, 49.0));
	measures.set(elecMain, makeBox(15.0, 8.5, -3.2, 0.25, 0.08, 49.0));
	rec('HDB-FIRE-RISER', 'B1', 49.0);
	rec('HDB-CW-PIPE', 'B1', 49.0);
	rec('HDB-SAN-PIPE', 'B1', 49.0);
	rec('HDB-ELEC-MAIN', 'B1', 49.0);

	// 2 inline unclassed pipe proxies directly touching fireRiser on L01 (must promote to IFCPIPESEGMENT + fire_protection!)
	const px1 = emit(
		`IFCBUILDINGELEMENTPROXY('${guid()}',#${owner},'Unclassed Fire Spool Piece A',$,'Generic',$,$,'PX1',.NOTDEFINED.)`
	);
	const px2 = emit(
		`IFCBUILDINGELEMENTPROXY('${guid()}',#${owner},'Unclassed Fire Spool Piece B',$,'Generic',$,$,'PX2',.NOTDEFINED.)`
	);
	addSt('L01', px1);
	addSt('L01', px2);
	measures.set(px1, makeBox(13.6, 8.5, 2.5, 2.5, 0.1, 0.1));
	measures.set(px2, makeBox(16.12, 8.5, 2.5, 2.5, 0.1, 0.1));
	rec('HDB-FIRE-RISER', 'L01', 5.0);

	// 2 Federated Duplicate RC Beams on L02 & L03 (must be stripped cleanly on deduplication & IFC clean export!)
	const dup1 = emit(
		`IFCBEAM('${guid()}',#${owner},'Arch Ghost Beam Copy 1',$,'RC Beam G40',$,$,'DUP1',.BEAM.)`
	);
	const dup2 = emit(
		`IFCBEAM('${guid()}',#${owner},'Arch Ghost Beam Copy 2',$,'RC Beam G40',$,$,'DUP2',.BEAM.)`
	);
	addSt('L02', dup1);
	addSt('L03', dup2);
	measures.set(dup1, makeBox(0.555, 0.3 - 0.175, 4.2 + 3.0 - 0.6, 7.2, 0.35, 0.6));
	measures.set(dup2, makeBox(0.555, 0.3 - 0.175, 7.2 + 3.0 - 0.6, 7.2, 0.35, 0.6));

	// Assign materials, SGPset_* (CORENET X IFC-SG), FireRating, and MEP System tags
	assignMat(
		[
			...pileIds,
			...colIds,
			...beamIds,
			dup1,
			dup2,
			...slabIds,
			...hsWallIds,
			...stairIds,
			nonCompliantRampId
		],
		'Concrete Grade 40'
	);
	assignMat(ppvcWallIds, 'Precast Concrete PPVC');
	assignMat([sharpGlassFinId], 'Tempered Glass');
	assignMat(flatDoorIds, 'Solid Core Timber');
	assignMat(hsDoorIds, 'Steel Blast Door');
	assignMat(railIds, 'Aluminium & Laminated Glass');
	assignMat([lShapedSofaId], 'Fabric Upholstery');
	assignMat([fireRiser, cwRiser, px1, px2], 'Galvanised Steel');
	assignMat([sanStack], 'uPVC');
	assignMat([elecMain], 'Copper Busduct');
	assignMat(liftIds, 'Steel & Glass');

	// Singapore CORENET X SGPset_* (>80% element coverage)
	addPset([...slabIds, ...colIds, ...beamIds], 'SGPset_StructuralConcrete', [
		['ConcreteGrade', 'G40']
	]);
	addPset([...hsWallIds, ...ppvcWallIds], 'SGPset_Wall', [['ConstructionType', 'Precast']]);
	addPset([...flatDoorIds, ...hsDoorIds], 'SGPset_Door', [['AccessibleRoute', 'True']]);
	addPset(hsDoorIds, 'Pset_DoorCommon', [['FireRating', 'FD120']]);
	addPset(stairIds, 'SGPset_StairFlight', [['EscapeRoute', 'Protected']]);
	addPset([fireRiser], 'Pset_Mechanical', [
		['System Type', 'Fire Protection Wet Riser'],
		['Size', '100 mm']
	]);
	addPset([cwRiser], 'Pset_Mechanical', [
		['System Type', 'Domestic Cold Water'],
		['Size', '50 mm']
	]);
	addPset([sanStack], 'Pset_Mechanical', [
		['System Type', 'Sanitary DWV'],
		['Size', '100 mm']
	]);
	addPset([elecMain], 'Pset_Electrical', [['System Type', 'Electrical Power Rising Main']]);

	// Spatial containment per storey
	for (const st of storeys) {
		const mems = storeyMembers.get(st.key) ?? [];
		if (mems.length > 0) {
			emit(
				`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid()}',#${owner},$,$,(${mems.map((e) => `#${e}`).join(',')}),#${storeyIds.get(st.key)})`
			);
		}
	}

	// Exact BigDecimal ground-truth tender total (including derived HDB-REBAR-SLAB + 5% contingency)
	const ruleByCode = new Map(matrix.map((m) => [m.code, m] as const));
	const groundTruthByCode = new Map<
		string,
		{ readonly expected_qty: number; readonly unit: string }
	>();
	let directSub = BigDecimal.fromNumberUnsafe(0);
	let derivedSub = BigDecimal.fromNumberUnsafe(0);
	const hundred = BigDecimal.fromNumberUnsafe(100);
	const one = BigDecimal.fromNumberUnsafe(1);

	const priceQty = (code: string, qty: number) => {
		const rule = ruleByCode.get(code);
		if (!rule) return BigDecimal.fromNumberUnsafe(0);
		const wf = divSafe(toDecimal(rule.waste_factor_pct), hundred);
		const priced = BigDecimal.multiply(toDecimal(qty), BigDecimal.sum(one, wf));
		return BigDecimal.multiply(priced, toDecimal(rule.unit_rate));
	};

	for (const [code, qty] of gtQty) {
		const rule = ruleByCode.get(code);
		groundTruthByCode.set(code, { expected_qty: qty, unit: rule?.unit ?? 'ea' });
		directSub = BigDecimal.sum(directSub, priceQty(code, qty));
	}
	const totalSlabVol = gtQty.get('HDB-SLAB') ?? 0;
	const derivedRebarKg = totalSlabVol * 110;
	groundTruthByCode.set('HDB-REBAR-SLAB', { expected_qty: derivedRebarKg, unit: 'kg' });
	derivedSub = BigDecimal.sum(derivedSub, priceQty('HDB-REBAR-SLAB', derivedRebarKg));

	const bimSub = BigDecimal.sum(directSub, derivedSub);
	const totalWith5 = BigDecimal.multiply(bimSub, toDecimal('1.05'));
	const totalRawCount = [...storeyMembers.values()].reduce((s, arr) => s + arr.length, 0);

	const ifcText = [
		'ISO-10303-21;',
		'HEADER;',
		"FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]','IFC-SG CORENET X'),'2;1');",
		"FILE_NAME('Punggol_Cove_15Storey_IFC4SG.ifc','2026-06-15T08:00:00',('QP'),('Norbital'),'IFC4SG','Norbital','');",
		"FILE_SCHEMA(('IFC4'));",
		'ENDSEC;',
		'DATA;',
		...lines,
		'ENDSEC;',
		'END-ISO-10303-21;'
	].join('\n');

	return {
		ifcText,
		elementMeasures: measures,
		groundTruthByCode,
		expectedTotalWith5PctContingency: moneyStr(totalWith5),
		totalPhysicalAssetsAfterDedup: totalRawCount - 2,
		duplicateBeamIds: [dup1, dup2],
		inlineProxyIds: [px1, px2],
		nonCompliantStairFlightId,
		nonCompliantRampId,
		nonCompliantRailingId,
		lShapedSofaId,
		sharpGlassFinId
	};
}
