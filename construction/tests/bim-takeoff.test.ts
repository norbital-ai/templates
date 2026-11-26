import { Effect } from 'effect';
import { expect, it } from '@effect/vitest';
import { new_id } from '@norbital-ai/bolt';
import {
	assetSignature,
	cleanupAndMeasure,
	dropDuplicates,
	fillFromGeometry,
	mergeIdenticalArchetypes
} from '../src/services/bim/cleanup.js';
import {
	evaluateComplianceRules,
	evaluateSemanticComplianceRules
} from '../src/services/bim/compliance.js';
import { resolveBimConfig } from '../src/services/bim/config.js';
import {
	measureElement,
	measureMesh,
	netAreaOf,
	type ElementMeasure,
	type MeshMeasure
} from '../src/services/bim/geometry.js';
import {
	buildTenderBoqCsv,
	cleanAndOrganizeIfcStep,
	organizeTakeoffLines
} from '../src/services/bim/organizer.js';
import {
	buildBimCostEstimateFromExtracted,
	rankCandidateMatrixRules
} from '../src/services/bim/pricing.js';
import type {
	ArchetypeDecision,
	BimArchetype,
	BimStoreyBucket,
	ExtractedBimModel,
	MatrixItem,
	SopRule
} from '../src/services/bim/schema.js';
import { createIfcStepStreamParser } from '../src/services/bim/step-parser.js';
import {
	buildComplexCommercialTowerIfc4,
	COMMERCIAL_TOWER_MATRIX
} from './fixtures/complex-tower-ifc4.js';
import {
	buildHdbCondoTower15StoreyIfc4,
	HDB_CONDO_MATRIX
} from './fixtures/hdb-condo-tower-ifc4.js';

/** An axis-aligned box mesh in web-ifc's interleaved layout (position + zero normal), 12 triangles. */
const box = (x: number, y: number, z: number) => {
	const corners = [
		[0, 0, 0],
		[x, 0, 0],
		[x, y, 0],
		[0, y, 0],
		[0, 0, z],
		[x, 0, z],
		[x, y, z],
		[0, y, z]
	];
	const faces = [
		[0, 2, 1, 0, 3, 2],
		[4, 5, 6, 4, 6, 7],
		[0, 1, 5, 0, 5, 4],
		[2, 3, 7, 2, 7, 6],
		[1, 2, 6, 1, 6, 5],
		[0, 4, 7, 0, 7, 3]
	].flat();
	return {
		verts: new Float32Array(corners.flatMap((c) => [...c, 0, 0, 0])),
		indices: new Uint32Array(faces)
	};
};
const meshOf = (x: number, y: number, z: number): MeshMeasure => {
	const { verts, indices } = box(x, y, z);
	const m = measureMesh(verts, indices);
	if (m === null) throw new Error('box has no mesh');
	return m;
};
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** A quarter turn about Z, then a shift: a wall drawn along the other axis of the plan. */
const TURNED = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 25, -4, 3, 1];

const archetype = (
	over: Partial<BimArchetype> & Pick<BimArchetype, 'archetype_id'>
): BimArchetype => ({
	representative_express_id: 1,
	representative_part_ids: [],
	ifc_class: 'IFCWALL',
	family: 'Wall',
	type_name: null,
	object_type: null,
	predefined_type: null,
	operation_type: null,
	classification_code: null,
	classification_name: null,
	materials: [],
	material_layers: [],
	layer_count: 0,
	properties: [],
	sample_names: [],
	total_count: 1,
	has_length: false,
	has_area: false,
	has_volume: false,
	has_weight: false,
	...over
});
const bucket = (
	over: Partial<BimStoreyBucket> & Pick<BimStoreyBucket, 'archetype_id'>
): BimStoreyBucket => ({
	storey: 'Level 1',
	element_count: 1,
	length_m: 0,
	length_measured_count: 0,
	area_m2: 0,
	area_measured_count: 0,
	volume_m3: 0,
	volume_measured_count: 0,
	weight_kg: 0,
	weight_measured_count: 0,
	sample_express_ids: [],
	...over
});
const model = (archetypes: BimArchetype[], buckets: BimStoreyBucket[]): ExtractedBimModel => ({
	schema: 'IFC4',
	project_name: null,
	storeys: ['Level 1', 'Level 2'],
	total_asset_count: buckets.reduce((n, b) => n + b.element_count, 0),
	archetypes,
	buckets
});

it('measures a closed mesh by its volume and an element by its own axes, whatever its placement', () => {
	const mesh = meshOf(4, 0.2, 3);
	expect(mesh.volume).toBeCloseTo(2.4, 6);
	expect(mesh.triangles).toBe(12);
	const turned = measureElement([{ mesh, transform: TURNED }]);
	expect(turned?.volume).toBeCloseTo(2.4, 6);
	expect(turned?.extents.map((e) => Number(e.toFixed(6)))).toEqual([4, 3, 0.2]);
	// a placement in millimetres scales lengths by 1/1000 and volume by its determinant
	const mm = [0.001, 0, 0, 0, 0, 0.001, 0, 0, 0, 0, 0.001, 0, 0, 0, 0, 1];
	const scaled = measureElement([{ mesh: meshOf(4000, 200, 3000), transform: mm }]);
	expect(scaled?.volume).toBeCloseTo(2.4, 6);
	expect(scaled?.extents.map((e) => Number(e.toFixed(6)))).toEqual([4, 3, 0.2]);
	expect(measureElement([])).toBeNull();
});

it('fills quantities the model left out from geometry, weighs only steel, and keeps quantities the model measured', () => {
	const bar: ElementMeasure = {
		volume: 0.001,
		triangles: 40,
		extents: [6, 0.016, 0.016],
		center: [0, 0, 0]
	};
	const slab: ElementMeasure = {
		volume: 1.5,
		triangles: 12,
		extents: [10, 1, 0.15],
		center: [0, 0, 0]
	};
	const filled = fillFromGeometry(
		model(
			[
				archetype({ archetype_id: 'R', ifc_class: 'IFCREINFORCINGBAR' }),
				archetype({ archetype_id: 'S', ifc_class: 'IFCSLAB', materials: ['Concrete C40'] }),
				archetype({ archetype_id: 'Q', ifc_class: 'IFCSLAB' })
			],
			[
				bucket({ archetype_id: 'R', element_count: 2, element_ids: [1, 2] }),
				bucket({ archetype_id: 'S', element_count: 2, element_ids: [3, 4] }),
				bucket({
					archetype_id: 'Q',
					element_count: 1,
					element_ids: [5],
					volume_m3: 9,
					volume_measured_count: 1
				})
			]
		),
		new Map([
			[1, bar],
			[2, bar],
			[3, slab],
			[5, slab]
		])
	);
	const [rebar, concrete, measured] = filled.buckets;
	expect(rebar?.weight_kg).toBeCloseTo(15.7, 6);
	expect(rebar?.weight_measured_count).toBe(2);
	expect(rebar?.length_m).toBe(12);
	// one of the two slabs has no geometry: it is measured as missing, never estimated
	expect(concrete?.volume_m3).toBe(1.5);
	expect(concrete?.volume_measured_count).toBe(1);
	expect(concrete?.area_m2).toBe(10);
	expect(concrete?.weight_measured_count).toBe(0);
	expect(measured?.volume_m3).toBe(9);
	expect(filled.archetypes.find((a) => a.archetype_id === 'R')?.has_weight).toBe(true);
	expect(filled.archetypes.find((a) => a.archetype_id === 'S')?.has_weight).toBe(false);
});

it('merges one asset under other names, drawn a little off or exported as a proxy, never one that differs in material or trait', () => {
	const door = (w: number): ElementMeasure => ({
		volume: 0.08 * (w / 0.9),
		triangles: 220,
		extents: [2.1, w, 0.045],
		center: [0, 0, 0]
	});
	const a = archetype({
		archetype_id: 'A',
		ifc_class: 'IFCDOOR',
		materials: ['Wood - Oak'],
		properties: ['Reference=D-09']
	});
	// another name, another spelling of the material, drawn 5 mm wider
	const b = archetype({
		archetype_id: 'B',
		ifc_class: 'IFCDOOR',
		materials: ['Timber'],
		properties: ['Reference=Door 900']
	});
	const fire = archetype({
		archetype_id: 'F',
		ifc_class: 'IFCDOOR',
		materials: ['Hardwood'],
		properties: ['Reference=D-09', 'FireRating=FD60']
	});
	const glass = archetype({ archetype_id: 'G', ifc_class: 'IFCDOOR', materials: ['Glass'] });
	const wide = archetype({ archetype_id: 'W', ifc_class: 'IFCDOOR', materials: ['Oak'] });
	const chair: ElementMeasure = {
		volume: 0.02,
		triangles: 36,
		extents: [0.94, 0.45, 0.45],
		center: [0, 0, 0]
	};
	const c1 = archetype({
		archetype_id: 'C1',
		ifc_class: 'IFCFURNITURE',
		predefined_type: 'CHAIR',
		materials: ['Timber']
	});
	const c2 = archetype({
		archetype_id: 'C2',
		ifc_class: 'IFCBUILDINGELEMENTPROXY',
		materials: ['Wood - Oak']
	});

	const merged = mergeIdenticalArchetypes(
		model(
			[a, b, fire, glass, wide, c1, c2],
			[
				bucket({ archetype_id: 'A', element_count: 3, area_m2: 5.7, area_measured_count: 3 }),
				bucket({ archetype_id: 'B', element_count: 2, area_m2: 3.8, area_measured_count: 2 }),
				bucket({ archetype_id: 'B', storey: 'Level 2', element_count: 1 }),
				bucket({ archetype_id: 'F', element_count: 1 }),
				bucket({ archetype_id: 'G', element_count: 1 }),
				bucket({ archetype_id: 'W', element_count: 1 }),
				bucket({ archetype_id: 'C1', element_count: 4 }),
				bucket({ archetype_id: 'C2', element_count: 2 })
			]
		),
		new Map([
			['A', door(0.9)],
			['B', door(0.905)],
			['F', door(0.9)],
			['G', door(0.9)],
			['W', door(1.0)],
			['C1', chair],
			['C2', { ...chair, extents: [0.94, 0.452, 0.448] }]
		])
	);
	expect(merged.archetypes.map((x) => x.archetype_id)).toEqual(['A', 'F', 'G', 'W', 'C1']);
	expect(merged.archetypes[0]?.total_count).toBe(2);
	const level1 = merged.buckets.find((x) => x.archetype_id === 'A' && x.storey === 'Level 1');
	expect(level1?.element_count).toBe(5);
	expect(level1?.area_m2).toBe(9.5);
	expect(
		merged.buckets.find((x) => x.archetype_id === 'A' && x.storey === 'Level 2')?.element_count
	).toBe(1);
	expect(merged.buckets.find((x) => x.archetype_id === 'C1')?.element_count).toBe(6);
	expect(merged.buckets.some((x) => x.archetype_id === 'B' || x.archetype_id === 'C2')).toBe(false);
});

it('drops an element modelled twice in the same place, and lets geometry measure what is left', () => {
	const slab: ElementMeasure = {
		volume: 144,
		triangles: 12,
		extents: [40, 24, 0.15],
		center: [20, 12, 2.725]
	};
	const column: ElementMeasure = {
		volume: 0.5,
		triangles: 12,
		extents: [2.8, 0.6, 0.3],
		center: [0.15, 0.3, 1.4]
	};
	const { extracted, duplicates } = dropDuplicates(
		model(
			[
				archetype({ archetype_id: 'S', ifc_class: 'IFCSLAB' }),
				archetype({ archetype_id: 'SA', ifc_class: 'IFCSLABSTANDARDCASE' }),
				archetype({ archetype_id: 'C', ifc_class: 'IFCCOLUMN' })
			],
			[
				bucket({ archetype_id: 'S', element_count: 1, element_ids: [1] }),
				// the architect's copy of the same slab, with quantity sets of its own
				bucket({
					archetype_id: 'SA',
					element_count: 1,
					element_ids: [2],
					volume_m3: 144,
					volume_measured_count: 1
				}),
				bucket({ archetype_id: 'C', element_count: 2, element_ids: [3, 4] })
			]
		),
		new Map([
			[1, slab],
			[2, { ...slab, center: [20.01, 12, 2.725] }],
			[3, column],
			[4, { ...column, center: [8.15, 0.3, 1.4] }]
		])
	);
	expect(duplicates).toBe(1);
	expect(extracted.total_asset_count).toBe(3);
	expect(extracted.buckets.map((b) => `${b.archetype_id}:${b.element_count}`)).toEqual([
		'S:1',
		'C:2'
	]);
	expect(extracted.archetypes.find((a) => a.archetype_id === 'SA')?.total_count).toBe(0);
});

it('derives what the model does not carry, storey by storey, unless the model carries it there', () => {
	const rules: MatrixItem[] = [
		{
			code: 'SLAB',
			name: 'Slab concrete',
			category: 'bim_asset',
			discipline: 'structural',
			trade_specialty: 'structural',
			ifc_classes: ['IFCSLAB'],
			match_keywords: [],
			unit: 'm3',
			quantity_basis: 'volume',
			currency: 'SGD',
			unit_rate: '400',
			waste_factor_pct: '0',
			carbon_factor: '0',
			active: true
		},
		{
			code: 'REBAR',
			name: 'Rebar (modelled)',
			category: 'bim_asset',
			discipline: 'structural',
			trade_specialty: 'structural',
			ifc_classes: ['IFCREINFORCINGBAR'],
			match_keywords: [],
			unit: 'kg',
			quantity_basis: 'weight',
			currency: 'SGD',
			unit_rate: '2',
			waste_factor_pct: '0',
			carbon_factor: '0',
			active: true
		},
		{
			code: 'REBAR-SLAB',
			name: 'Rebar to slabs (derived)',
			category: 'bim_asset',
			discipline: 'structural',
			trade_specialty: 'structural',
			ifc_classes: [],
			match_keywords: [],
			unit: 'kg',
			quantity_basis: 'derived',
			derived_from: 'SLAB',
			ratio: '100',
			stands_in_for: 'REBAR',
			currency: 'SGD',
			unit_rate: '2',
			waste_factor_pct: '0',
			carbon_factor: '0',
			active: true
		}
	];
	expect(rankCandidateMatrixRules([], rules, 80).map((r) => r.code)).toEqual(['SLAB', 'REBAR']);
	const result = buildBimCostEstimateFromExtracted({
		extracted: model(
			[
				archetype({ archetype_id: 'S', ifc_class: 'IFCSLAB' }),
				archetype({ archetype_id: 'R', ifc_class: 'IFCREINFORCINGBAR' })
			],
			[
				bucket({ archetype_id: 'S', storey: 'Level 1', volume_m3: 10, volume_measured_count: 1 }),
				bucket({ archetype_id: 'S', storey: 'Level 2', volume_m3: 10, volume_measured_count: 1 }),
				// rebar is modelled on Level 2 only
				bucket({
					archetype_id: 'R',
					storey: 'Level 2',
					element_count: 50,
					weight_kg: 900,
					weight_measured_count: 50
				})
			]
		),
		matrix: rules,
		currency: 'SGD',
		ai_decisions: {
			S: { matrix_code: 'SLAB', method: 'ai_sys1', confidence: 0.9, reason: 'slab' },
			R: { matrix_code: 'REBAR', method: 'ai_sys1', confidence: 0.9, reason: 'rebar' }
		},
		contingency_pct: '0'
	});
	const line = (code: string, storey: string) =>
		result.bim_assets.find((l) => l.matrix_code === code && l.storey === storey);
	expect(line('REBAR-SLAB', 'Level 1')?.measured_qty).toBe('1000');
	expect(line('REBAR-SLAB', 'Level 1')?.element_count).toBe(0);
	expect(line('REBAR-SLAB', 'Level 1')?.match_reason).toContain('100 kg per m3 of SLAB');
	expect(line('REBAR-SLAB', 'Level 2')).toBeUndefined();
	expect(line('REBAR', 'Level 2')?.measured_qty).toBe('900');
	// 2 × 10 m³ × 400 + 1000 kg × 2 (Level 1, derived) + 900 kg × 2 (Level 2, modelled)
	expect(result.bim_subtotal).toBe('11800.00');
	expect(result.bim_asset_count).toBe(52);
});

it('counts an assembly once, as a whole, and keeps its parts for its geometry', () => {
	const parser = createIfcStepStreamParser();
	parser.push(`ISO-10303-21;
HEADER;
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#20= IFCBUILDINGSTOREY('0St1',#1,'Level 1',$,$,$,$,'Level 1',.ELEMENT.,0.);
#30= IFCSTAIR('0Str',#1,'Stair:Precast',$,$,$,$,'S1',.STRAIGHT_RUN_STAIR.);
#31= IFCSTAIRFLIGHT('0Fl1',#1,'Flight 1',$,$,$,$,'F1',$,$,$,$,.STRAIGHT.);
#32= IFCSTAIRFLIGHT('0Fl2',#1,'Flight 2',$,$,$,$,'F2',$,$,$,$,.STRAIGHT.);
#33= IFCRAILING('0Rl1',#1,'Railing',$,$,$,$,'R1',.HANDRAIL.);
#40= IFCRELAGGREGATES('0Agg',#1,$,$,#30,(#31,#32));
#50= IFCRELCONTAINEDINSPATIALSTRUCTURE('0Rel1',#1,$,$,(#30,#33),#20);
ENDSEC;
END-ISO-10303-21;`);
	const taken = parser.finish();
	expect(taken.total_asset_count).toBe(2);
	expect(taken.archetypes.map((a) => a.ifc_class).sort()).toEqual(['IFCRAILING', 'IFCSTAIR']);
	expect(taken.assemblies).toEqual({ '30': [31, 32] });
});

/** Helper: axis-aligned box shifted by `(ox, oy, oz)` as a single placement-transformed mesh. */
const shiftedBox = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) => ({
	mesh: meshOf(dx, dy, dz),
	transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ox, oy, oz, 1]
});

it('measures exact net surface area for walls with window openings and L-shaped slabs within 1%', () => {
	// 6m × 3m × 0.2m wall composed of 4 solid piers around a 2m × 1.5m window cutout:
	// Gross face area = 18 m², cutout = 3 m², exact net face area = 15.0 m² (naive bbox would overestimate by +20%)
	const wallWithOpening = measureElement([
		shiftedBox(0, 0, 0, 2, 0.2, 3), // left pier: 6 m²
		shiftedBox(4, 0, 0, 2, 0.2, 3), // right pier: 6 m²
		shiftedBox(2, 0, 0, 2, 0.2, 0.9), // sill below window: 1.8 m²
		shiftedBox(2, 0, 2.4, 2, 0.2, 0.6) // lintel above window: 1.2 m²
	]);
	expect(wallWithOpening).not.toBeNull();
	expect(wallWithOpening?.volume).toBeCloseTo(3.0, 4);
	expect(wallWithOpening ? netAreaOf(wallWithOpening) : 0).toBeCloseTo(15.0, 2);

	// L-shaped floor slab (0.15m thick): 10m×4m wing (40m²) + 4m×6m wing (24m²) = 64 m² exact
	// (naive bbox 10m×10m = 100m² would overestimate by +56%!)
	const lSlab = measureElement([shiftedBox(0, 0, 0, 10, 4, 0.15), shiftedBox(0, 4, 0, 4, 6, 0.15)]);
	expect(lSlab).not.toBeNull();
	expect(lSlab?.volume).toBeCloseTo(9.6, 4);
	expect(lSlab ? netAreaOf(lSlab) : 0).toBeCloseTo(64.0, 2);
});

it('auto-cleans IFC2x3 classes, traces contiguous MEP networks, promotes inline proxies, splits multi-storey risers, and respects configurable rules', () => {
	const parser = createIfcStepStreamParser();
	parser.push(`ISO-10303-21;
HEADER;
FILE_SCHEMA(('IFC2X3'));
ENDSEC;
DATA;
#10= IFCPROJECT('0P',#1,'P',$,$,'Tower',$,$,$);
#20= IFCBUILDINGSTOREY('0S1',#1,'Level 1',$,$,$,$,'Level 1',.ELEMENT.,0.);
#21= IFCBUILDINGSTOREY('0S2',#1,'Level 2',$,$,$,$,'Level 2',.ELEMENT.,3.);
#22= IFCBUILDINGSTOREY('0S3',#1,'Roof',$,$,$,$,'Roof',.ELEMENT.,6.);
#90= IFCSPACE('0Sp',#1,'Roof Space Volume',$,$,$,$,'R301',.ELEMENT.,.INTERNAL.,0.);
#100= IFCPIPESEGMENTTYPE('0PT',#1,'Steel Pipe 25mm',$,$,$,$,'PT1',$,.RIGIDSEGMENT.);
#101= IFCFLOWSEGMENT('0P1',#1,'Generic Pipe Run A',$,'Pipe',$,$,'P1');
#102= IFCBUILDINGELEMENTPROXY('0Px1',#1,'Contractor Unclassed Pipe Piece',$,'Generic',$,$,'PX1');
#103= IFCENERGYCONVERSIONDEVICE('0Blr',#1,'Hydronic Heating Boiler 147kW',$,'Boiler',$,$,'B1');
#104= IFCFLOWSEGMENT('0P2',#1,'Domestic Cold Water Pipe 20mm',$,'Pipe',$,$,'P2');
#105= IFCBUILDINGELEMENTPROXY('0Px2',#1,'Standalone Temp Scaffold Bay',$,'Scaffold',$,$,'PX2');
#106= IFCFLOWSEGMENT('0Riser',#1,'Hydronic Vertical Riser 40mm',$,'Riser',$,$,'R1');
#110= IFCRELDEFINESBYTYPE('0RT',#1,$,$,(#101,#104,#106),#100);
#120= IFCPROPERTYSINGLEVALUE('Size',$,IFCTEXT('25 mm'),$);
#121= IFCPROPERTYSET('0PS1',#1,'Pset_Dimensions',$,(#120));
#122= IFCRELDEFINESBYPROPERTIES('0RP1',#1,$,$,(#101),#121);
#123= IFCPROPERTYSINGLEVALUE('System Type',$,IFCTEXT('Domestic Cold Water'),$);
#124= IFCPROPERTYSINGLEVALUE('Size',$,IFCTEXT('20 mm'),$);
#125= IFCPROPERTYSET('0PS2',#1,'Pset_Mechanical',$,(#123,#124));
#126= IFCRELDEFINESBYPROPERTIES('0RP2',#1,$,$,(#104),#125);
#127= IFCPROPERTYSINGLEVALUE('System Type',$,IFCTEXT('Hydronic Supply'),$);
#128= IFCPROPERTYSINGLEVALUE('Size',$,IFCTEXT('40 mm'),$);
#129= IFCPROPERTYSET('0PS3',#1,'Pset_Riser',$,(#127,#128));
#130= IFCRELDEFINESBYPROPERTIES('0RP3',#1,$,$,(#106),#129);
#140= IFCSYSTEM('0Sys1',#1,'Hydronic Heating Loop',$,'HVAC');
#141= IFCRELASSIGNSTOGROUP('0AG1',#1,$,$,(#103),$,#140);
#150= IFCDISTRIBUTIONPORT('0Pt1',#1,'Port Boiler',$,$,$,$,.SOURCE.);
#151= IFCDISTRIBUTIONPORT('0Pt2',#1,'Port Pipe1',$,$,$,$,.SINK.);
#152= IFCRELCONNECTSPORTTOELEMENT('0CE1',#1,$,$,#150,#103);
#153= IFCRELCONNECTSPORTTOELEMENT('0CE2',#1,$,$,#151,#101);
#154= IFCRELCONNECTSPORTS('0CP1',#1,$,$,#150,#151,$);
#160= IFCQUANTITYLENGTH('Length',$,$,1.0);
#161= IFCELEMENTQUANTITY('0QL1',#1,'Qto_PipeSegmentBaseQuantities',$,$,(#160));
#162= IFCRELDEFINESBYPROPERTIES('0RQL1',#1,$,$,(#101),#161);
#200= IFCRELCONTAINEDINSPATIALSTRUCTURE('0RC1',#1,$,$,(#90,#101,#102,#103,#104,#105,#106),#20);
ENDSEC;
END-ISO-10303-21;`);
	const streamed = parser.finish();
	// IFCSPACE excluded automatically
	expect(streamed.total_asset_count).toBe(6);
	expect(streamed.storey_elevations).toEqual({ 'Level 1': 0, 'Level 2': 3, Roof: 6 });

	// Supply geometry:
	// #103 boiler at x=[0,1], #101 pipe at x=[1,4] (3m real vs 1m IFC -> triggers variance warning),
	// #102 inline proxy touching #101 at x=[4.01, 6.01] (elongated pipe shape -> promoted to IFCPIPESEGMENT + hydronic_hvac!),
	// #104 CW pipe touching boiler spatially at x=[0.99, 3] (explicit domestic_cold_water must NOT bleed into hydronic!),
	// #105 standalone scaffold proxy far away at x=[20, 22] (stays discontiguous IFCBUILDINGELEMENTPROXY),
	// #106 vertical riser z=[0.2, 5.8] spanning Level 1 (0-3m) and Level 2 (3-6m) -> splits proportionally!
	const boxMeasure = (
		ox: number,
		oy: number,
		oz: number,
		dx: number,
		dy: number,
		dz: number
	): ElementMeasure => {
		const m = measureElement([shiftedBox(ox, oy, oz, dx, dy, dz)]);
		if (m === null) throw new Error('expected box measure');
		return m;
	};
	const measured = new Map<number, ElementMeasure>([
		[103, boxMeasure(0, 0, 0, 1.0, 0.8, 1.2)],
		[101, boxMeasure(1.0, 0.4, 0.6, 3.0, 0.025, 0.025)],
		[102, boxMeasure(4.01, 0.4, 0.6, 2.0, 0.025, 0.025)],
		[104, boxMeasure(0.99, 0.4, 0.6, 2.0, 0.02, 0.02)],
		[105, boxMeasure(20, 20, 0, 2.0, 1.2, 2.0)],
		[106, boxMeasure(5, 5, 0.2, 0.04, 0.04, 5.6)]
	]);

	const { extracted, cleanup } = cleanupAndMeasure(streamed, measured, resolveBimConfig());
	expect(cleanup.upgraded_classes).toBeGreaterThanOrEqual(4); // 3 IFC2x3 flow segments + 1 inline proxy
	expect(cleanup.propagated_services).toBeGreaterThanOrEqual(2); // #101 via port + #102 via spatial touch
	expect(cleanup.multi_storey_splits).toBeGreaterThanOrEqual(1); // #106 riser split across Level 1 & Level 2
	expect(cleanup.variance_warnings).toBeGreaterThanOrEqual(1); // #101 1m IFC vs 3m mesh

	// Check inline proxy #102 was promoted to contiguous_linear IFCPIPESEGMENT on hydronic_hvac (25mm -> 21-32mm band)
	const hydronicPipes25 = extracted.archetypes.filter(
		(a) =>
			a.ifc_class === 'IFCPIPESEGMENT' && a.service === 'hydronic_hvac' && a.size_band === '21-32mm'
	);
	expect(hydronicPipes25.length).toBeGreaterThanOrEqual(1);
	expect(hydronicPipes25.every((a) => a.continuity === 'contiguous_linear')).toBe(true);
	const hydronic25Buckets = extracted.buckets.filter((b) =>
		hydronicPipes25.some((a) => a.archetype_id === b.archetype_id)
	);
	expect(hydronic25Buckets.reduce((s, b) => s + b.element_count, 0)).toBe(2); // #101 + promoted proxy #102
	const totalHydronic25Len = hydronic25Buckets.reduce((s, b) => s + b.length_m, 0);
	expect(totalHydronic25Len).toBeCloseTo(3.0, 1); // 1m explicit IFC (#101, variance flagged) + 2m mesh (#102)

	// Check domestic_cold_water pipe stayed strictly isolated on domestic_cold_water
	const cwPipe = extracted.archetypes.find((a) => a.service === 'domestic_cold_water');
	expect(cwPipe?.ifc_class).toBe('IFCPIPESEGMENT');
	expect(cwPipe?.continuity).toBe('contiguous_linear');

	// Check standalone scaffold proxy remained discontiguous IFCBUILDINGELEMENTPROXY
	const scaffold = extracted.archetypes.find((a) => a.ifc_class === 'IFCBUILDINGELEMENTPROXY');
	expect(scaffold?.continuity).toBe('discontiguous');

	// Check vertical riser (40mm -> 33-50mm band) split proportionally across Level 1 & Level 2 (total length 5.6m preserved!)
	const riserArch = extracted.archetypes.find((a) => a.size_band === '33-50mm');
	expect(riserArch).toBeDefined();
	const riserBuckets = extracted.buckets.filter((b) => b.archetype_id === riserArch?.archetype_id);
	expect(riserBuckets.map((b) => b.storey).sort()).toEqual(['Level 1', 'Level 2']);
	expect(riserBuckets.reduce((s, b) => s + b.length_m, 0)).toBeCloseTo(5.6, 1);

	// Check variance warning propagated onto bucket
	expect(extracted.buckets.some((b) => b.quantity_warning != null)).toBe(true);
});

it('computes dimension-aware signatures, catches cell-boundary duplicates, respects custom config, and ranks rules by service/size/insulation', () => {
	const cfg = resolveBimConfig({
		material_densities: { copper: 9000 },
		duplicate_center_tol_m: 0.05
	});

	// Dimension-aware signatures: 1m and 6m DN25 hydronic pipes share one LIN signature
	const pipeArch = archetype({
		archetype_id: 'P',
		ifc_class: 'IFCPIPESEGMENT',
		continuity: 'contiguous_linear',
		service: 'hydronic_hvac',
		size_band: 'DN25',
		nominal_size_mm: 25,
		materials: ['Copper']
	});
	const sig1m = assetSignature(
		pipeArch,
		{ volume: 0.0005, triangles: 24, extents: [1.0, 0.025, 0.025], center: [0, 0, 0] },
		cfg
	);
	const sig6m = assetSignature(
		pipeArch,
		{ volume: 0.003, triangles: 24, extents: [6.0, 0.025, 0.025], center: [0, 0, 0] },
		cfg
	);
	expect(sig1m).toBe(sig6m);
	expect(sig1m.startsWith('LIN|')).toBe(true);

	// Discrete doors of different widths produce distinct DSC signatures
	const doorArch = archetype({
		archetype_id: 'D',
		ifc_class: 'IFCDOOR',
		continuity: 'discontiguous'
	});
	const sigD900 = assetSignature(
		doorArch,
		{ volume: 0.08, triangles: 40, extents: [2.1, 0.9, 0.045], center: [0, 0, 0] },
		cfg
	);
	const sigD1200 = assetSignature(
		doorArch,
		{ volume: 0.11, triangles: 40, extents: [2.1, 1.2, 0.045], center: [0, 0, 0] },
		cfg
	);
	expect(sigD900).not.toBe(sigD1200);
	expect(sigD900.startsWith('DSC|')).toBe(true);

	// 27-neighbor spatial hash catches duplicates straddling cell boundary x=0.10 (0.09 vs 0.11 = 2cm apart)
	const dupTest = dropDuplicates(
		model(
			[archetype({ archetype_id: 'S1', ifc_class: 'IFCSLAB' })],
			[bucket({ archetype_id: 'S1', element_count: 2, element_ids: [10, 11] })]
		),
		new Map([
			[10, { volume: 10, triangles: 12, extents: [10, 5, 0.2], center: [0.09, 0, 0] }],
			[11, { volume: 10, triangles: 12, extents: [10, 5, 0.2], center: [0.11, 0, 0] }]
		]),
		cfg
	);
	expect(dupTest.duplicates).toBe(1);

	// Custom material density (copper = 9000 kg/m³) drives geometry weight fallback
	const copperFill = fillFromGeometry(
		model(
			[archetype({ archetype_id: 'CU', ifc_class: 'IFCPIPESEGMENT', materials: ['Copper'] })],
			[bucket({ archetype_id: 'CU', element_count: 1, element_ids: [50] })]
		),
		new Map([[50, { volume: 0.01, triangles: 24, extents: [4, 0.05, 0.05], center: [0, 0, 0] }]]),
		cfg
	);
	expect(copperFill.buckets[0]?.weight_kg).toBeCloseTo(90, 4);

	// rankCandidateMatrixRules prioritizes matching service + diameter band + insulation
	const ranked = rankCandidateMatrixRules(
		[
			archetype({
				archetype_id: 'H25',
				ifc_class: 'IFCPIPESEGMENT',
				continuity: 'contiguous_linear',
				service: 'hydronic_hvac',
				nominal_size_mm: 25,
				insulated: true
			})
		],
		[
			{
				code: 'GAS-25',
				name: 'Gas Pipe 25mm',
				category: 'bim_asset',
				discipline: 'mep',
				trade_specialty: 'mne',
				ifc_classes: ['IFCPIPESEGMENT'],
				match_keywords: [],
				system_services: ['natural_gas'],
				min_size_mm: 0,
				max_size_mm: 32,
				insulated: 'uninsulated',
				topology_mode: 'contiguous_linear',
				unit: 'm',
				quantity_basis: 'length',
				currency: 'SGD',
				unit_rate: '115',
				waste_factor_pct: '4',
				carbon_factor: '7',
				active: true
			},
			{
				code: 'HYD-LG',
				name: 'Hydronic Pipe 50-100mm',
				category: 'bim_asset',
				discipline: 'mep',
				trade_specialty: 'hvac',
				ifc_classes: ['IFCPIPESEGMENT'],
				match_keywords: [],
				system_services: ['hydronic_hvac'],
				min_size_mm: 40,
				max_size_mm: 100,
				insulated: 'insulated',
				topology_mode: 'contiguous_linear',
				unit: 'm',
				quantity_basis: 'length',
				currency: 'SGD',
				unit_rate: '95',
				waste_factor_pct: '5',
				carbon_factor: '6',
				active: true
			},
			{
				code: 'HYD-SM',
				name: 'Hydronic Pipe <=32mm',
				category: 'bim_asset',
				discipline: 'mep',
				trade_specialty: 'hvac',
				ifc_classes: ['IFCPIPESEGMENT'],
				match_keywords: [],
				system_services: ['hydronic_hvac'],
				min_size_mm: 0,
				max_size_mm: 34,
				insulated: 'insulated',
				topology_mode: 'contiguous_linear',
				unit: 'm',
				quantity_basis: 'length',
				currency: 'SGD',
				unit_rate: '68',
				waste_factor_pct: '5',
				carbon_factor: '4',
				active: true
			}
		],
		2
	);
	expect(ranked[0]?.code).toBe('HYD-SM');
	expect(ranked.map((r) => r.code)).not.toContain('GAS-25');
});

it('achieves < 1.0% cost estimation error rate on a full 6-storey commercial building IFC4 model across all building trades, checks BCA/SCDF/CORENET X compliance dynamically, and auto-organizes the IFC', () => {
	const tower = buildComplexCommercialTowerIfc4(COMMERCIAL_TOWER_MATRIX);
	const parser = createIfcStepStreamParser();
	parser.push(tower.ifcText);
	const streamed = parser.finish();

	// IFCSPACE room volumes excluded; stair flights aggregated into parent IFCSTAIR wholes
	expect(streamed.schema).toBe('IFC4');
	expect(streamed.storeys).toHaveLength(6);

	const { extracted, duplicates, cleanup } = cleanupAndMeasure(
		streamed,
		tower.elementMeasures,
		resolveBimConfig()
	);

	// 1. Verify automatic BIM cleanup (duplicates dropped, legacy classes upgraded, inline proxies promoted, risers split)
	expect(duplicates).toBe(tower.expectedDuplicateCount);
	expect(cleanup.dropped_duplicates).toBe(2);
	expect(cleanup.upgraded_classes).toBeGreaterThanOrEqual(14); // 12 legacy IFCFLOWSEGMENT + 2 inline proxies
	expect(cleanup.propagated_services).toBeGreaterThanOrEqual(6); // 4 untagged CHW runs + 2 inline proxies
	expect(cleanup.multi_storey_splits).toBe(tower.expectedMultiStoreyRiserCount); // 2 CHW + 2 Fire risers
	expect(extracted.total_asset_count).toBe(tower.totalPhysicalAssetsAfterDedup);

	// Standalone scaffold bays stayed discontiguous IFCBUILDINGELEMENTPROXY; inline proxies became IFCPIPESEGMENT
	const proxyArches = extracted.archetypes.filter((a) => a.ifc_class === 'IFCBUILDINGELEMENTPROXY');
	expect(proxyArches.reduce((s, a) => s + a.total_count, 0)).toBe(4);
	expect(proxyArches.every((a) => a.continuity === 'discontiguous')).toBe(true);

	// 2. Classify every unique archetype using top-1 candidate from rankCandidateMatrixRules (zero hand-coded mapping!)
	const aiDecisions: Record<string, ArchetypeDecision> = {};
	for (const arch of extracted.archetypes) {
		const top = rankCandidateMatrixRules([arch], COMMERCIAL_TOWER_MATRIX, 1)[0];
		expect(top).toBeDefined();
		if (top) {
			aiDecisions[arch.archetype_id] = {
				matrix_code: top.code,
				method: 'ai_sys1',
				confidence: 0.96,
				reason: `Matched ${top.code}`
			};
		}
	}

	const estimate = buildBimCostEstimateFromExtracted({
		extracted,
		matrix: COMMERCIAL_TOWER_MATRIX,
		currency: 'SGD',
		contingency_pct: '5',
		ai_decisions: aiDecisions
	});

	// 100% classification coverage across all 6 storeys & ~780 physical elements
	expect(estimate.unmatched_asset_count).toBe(0);
	expect(estimate.classified_asset_count).toBe(extracted.total_asset_count);

	// 3. Prove EVERY SINGLE building item quantity AND total tender estimate is within < 1.0% error rate!
	const measuredByCode = new Map<string, number>();
	for (const line of estimate.bim_assets) {
		if (!line.matrix_code) continue;
		measuredByCode.set(
			line.matrix_code,
			(measuredByCode.get(line.matrix_code) ?? 0) + Number(line.measured_qty)
		);
	}
	for (const [code, truth] of tower.groundTruthByCode) {
		const actualQty = measuredByCode.get(code) ?? 0;
		const relErrPct =
			truth.expected_qty > 0
				? (Math.abs(actualQty - truth.expected_qty) / truth.expected_qty) * 100
				: 0;
		expect(
			relErrPct,
			`Item ${code}: actual=${actualQty} vs expected=${truth.expected_qty}`
		).toBeLessThan(1.0);
	}

	const actualTotal = Number(estimate.total_estimate);
	const expectedTotal = Number(tower.expectedTotalWith5PctContingency);
	const totalErrPct = (Math.abs(actualTotal - expectedTotal) / expectedTotal) * 100;
	expect(expectedTotal).toBeGreaterThan(2_000_000);
	expect(totalErrPct).toBeLessThan(1.0);

	// 4. Verify dynamic Compliance Engine catches exact planted violations via synthetic rules (zero hardcoded rules in engine!)
	const testSopRules: readonly SopRule[] = [
		{
			code: 'CX-SCHEMA-01',
			name: 'IFC4 Schema',
			authority: 'corenet_x',
			severity: 'warning',
			scope: 'model',
			metric: 'schema_version',
			operator: 'contains',
			threshold_text: 'IFC4',
			active: true
		},
		{
			code: 'CX-STOREY-02',
			name: 'Spatial Containment',
			authority: 'corenet_x',
			severity: 'error',
			scope: 'model',
			metric: 'unassigned_storey_pct',
			operator: 'lte',
			threshold_num: 1,
			active: true
		},
		{
			code: 'CX-PROXY-03',
			name: 'Proxy Ratio',
			authority: 'corenet_x',
			severity: 'warning',
			scope: 'model',
			metric: 'proxy_ratio_pct',
			operator: 'lte',
			threshold_num: 5,
			active: true
		},
		{
			code: 'CX-DUP-04',
			name: 'Zero Duplicates',
			authority: 'corenet_x',
			severity: 'error',
			scope: 'model',
			metric: 'duplicate_count',
			operator: 'lte',
			threshold_num: 0,
			active: true
		},
		{
			code: 'BCA-ACC-DOOR-W',
			name: 'Accessible Door Width',
			authority: 'bca',
			severity: 'error',
			scope: 'element',
			metric: 'min_width_mm',
			operator: 'gte',
			threshold_num: 850,
			ifc_classes: ['IFCDOOR', 'IFCDOORSTANDARDCASE'],
			active: true
		},
		{
			code: 'BCA-DOOR-H',
			name: 'Door Headroom',
			authority: 'bca',
			severity: 'error',
			scope: 'element',
			metric: 'min_height_mm',
			operator: 'gte',
			threshold_num: 2000,
			ifc_classes: ['IFCDOOR', 'IFCDOORSTANDARDCASE'],
			active: true
		},
		{
			code: 'BCA-SLAB-THK',
			name: 'Slab Min Thickness',
			authority: 'bca',
			severity: 'warning',
			scope: 'element',
			metric: 'min_thickness_mm',
			operator: 'gte',
			threshold_num: 125,
			ifc_classes: ['IFCSLAB', 'IFCSLABSTANDARDCASE'],
			active: true
		},
		{
			code: 'SCDF-FIRE-DOOR',
			name: 'Fire Door Rating',
			authority: 'scdf',
			severity: 'error',
			scope: 'element',
			metric: 'required_property',
			operator: 'present',
			threshold_text: 'FireRating',
			ifc_classes: ['IFCDOOR', 'IFCDOORSTANDARDCASE'],
			name_contains: ['fire', 'exit', 'stair'],
			active: true
		},
		{
			code: 'PUB-MEP-SYS',
			name: 'MEP Tagging',
			authority: 'pub',
			severity: 'warning',
			scope: 'model',
			metric: 'mep_untagged_pct',
			operator: 'lte',
			threshold_num: 5,
			active: true
		},
		{
			code: 'SOP-TENDER-COV',
			name: 'Tender Coverage',
			authority: 'company_sop',
			severity: 'error',
			scope: 'estimate',
			metric: 'min_classified_pct',
			operator: 'gte',
			threshold_num: 95,
			active: true
		}
	];
	const report = evaluateComplianceRules({
		extracted,
		estimate,
		rules: testSopRules,
		checkedAt: '2026-06-15T08:00:00.000Z'
	});
	const find = (code: string) => report.findings.find((f) => f.rule_code === code);
	expect(find('CX-SCHEMA-01')?.status).toBe('pass');
	expect(find('CX-STOREY-02')?.status).toBe('pass');
	expect(find('CX-PROXY-03')?.status).toBe('pass');
	expect(find('CX-DUP-04')?.status).toBe('fail'); // 2 federated duplicates caught
	expect(find('BCA-ACC-DOOR-W')?.status).toBe('fail'); // 780mm door caught (< 850mm)
	expect(find('BCA-ACC-DOOR-W')?.sample_express_ids).toContain(tower.nonCompliantDoorExpressId);
	expect(find('BCA-DOOR-H')?.status).toBe('pass'); // all doors >= 2100mm
	expect(find('BCA-SLAB-THK')?.status).toBe('pass'); // 200mm slab >= 125mm
	expect(find('SCDF-FIRE-DOOR')?.status).toBe('fail'); // L03 fire escape door missing FireRating
	expect(find('SCDF-FIRE-DOOR')?.sample_express_ids).toContain(
		tower.missingFireRatingDoorExpressId
	);
	expect(find('PUB-MEP-SYS')?.status).toBe('pass'); // 100% MEP service attribution after tracing
	expect(find('SOP-TENDER-COV')?.status).toBe('pass'); // 100% classified >= 95%

	// Dynamic SOP rule configurability: raising slab thickness threshold to 250mm dynamically flips rule to fail
	const strictSlabReport = evaluateComplianceRules({
		extracted,
		estimate,
		rules: [
			{
				code: 'SOP-SLAB-250',
				name: 'Client High-Load Slab Minimum Thickness >= 250mm',
				authority: 'company_sop',
				severity: 'error',
				scope: 'element',
				metric: 'min_thickness_mm',
				operator: 'gte',
				threshold_num: 250,
				ifc_classes: ['IFCSLAB'],
				active: true
			}
		],
		checkedAt: '2026-06-15T08:00:00.000Z'
	});
	expect(strictSlabReport.fail_count).toBe(1);
	expect(strictSlabReport.findings[0]?.rule_code).toBe('SOP-SLAB-250');

	// 5. Verify Auto-Organizer (SMM2 trade packages + storeys reconcile identically to bim_subtotal) & Organized IFC / CSV export
	const organized = organizeTakeoffLines(estimate.bim_assets);
	expect(organized.trades.length).toBeGreaterThanOrEqual(8);
	expect(organized.storeys).toHaveLength(6);
	const tradeSum = organized.trades.reduce((s, tr) => s + Number(tr.amount), 0);
	expect(tradeSum).toBeCloseTo(Number(estimate.bim_subtotal), 2);
	const storeySum = organized.storeys.reduce((s, st) => s + Number(st.amount), 0);
	expect(storeySum).toBeCloseTo(Number(estimate.bim_subtotal), 2);

	const cleaned = cleanAndOrganizeIfcStep(tower.ifcText, extracted);
	expect(cleaned.ifcText).toContain('Pset_NorbitalOrganized');
	expect(cleaned.ifcText).toContain('TradePackage');
	expect(cleaned.ifcText).toContain('CanonicalIfcClass');
	expect(cleaned.ifcText).toContain('IFCDISTRIBUTIONSYSTEM');
	expect(cleaned.ifcText).toContain('IFCGROUP');
	expect(cleaned.stats.duplicates_removed).toBe(2);
	expect(cleaned.stats.classes_promoted).toBeGreaterThanOrEqual(14);
	expect(cleaned.stats.total_elements_tagged).toBe(extracted.total_asset_count);
	// Cleaned & organized IFC re-streams cleanly through STEP parser with zero syntax corruption and 0 duplicates
	const reparsed = createIfcStepStreamParser();
	reparsed.push(cleaned.ifcText);
	const reparsedOut = reparsed.finish();
	expect(reparsedOut.schema).toBe('IFC4');
	expect(reparsedOut.total_asset_count).toBe(extracted.total_asset_count);

	const csv = buildTenderBoqCsv({
		projectName: 'Marina Commercial Tower',
		currency: 'SGD',
		bimAssets: estimate.bim_assets,
		bimSubtotal: estimate.bim_subtotal,
		contingencyPct: '5',
		contingencyAmount: estimate.contingency_amount,
		totalEstimate: estimate.total_estimate
	});
	expect(csv.startsWith('\uFEFFTrade Package,')).toBe(true);
	expect(csv).toContain(estimate.total_estimate);
});

it.effect(
	'achieves < 1.0% cost error on a 15-storey Singapore HDB/Condo IFC4+SG tower, verifies SVY21/SGPset/stair/ramp/railing BCA rules, runs multimodal spatial semantic SOP linting, and round-trips cleaned IFC with QS writeback',
	() =>
		Effect.gen(function* () {
			const hdb = buildHdbCondoTower15StoreyIfc4(HDB_CONDO_MATRIX);
			const parser = createIfcStepStreamParser();
			parser.push(hdb.ifcText);
			const streamed = parser.finish();

			expect(streamed.schema).toBe('IFC4');
			expect(streamed.crs_name).toContain('3414');
			expect(streamed.sgpset_count).toBeGreaterThan(0);
			expect(streamed.storeys).toHaveLength(17);

			const { extracted, duplicates, cleanup } = cleanupAndMeasure(
				streamed,
				hdb.elementMeasures,
				resolveBimConfig()
			);
			expect(duplicates).toBe(2);
			expect(cleanup.dropped_duplicate_ids).toHaveLength(2);
			expect(cleanup.upgraded_classes).toBeGreaterThanOrEqual(2);
			expect(cleanup.multi_storey_splits).toBe(4);
			expect(extracted.total_asset_count).toBe(hdb.totalPhysicalAssetsAfterDedup);

			// 1. Price every archetype via top-1 ranked Item Matrix candidate and prove < 1.0% error across all 17 storeys
			const aiDecisions: Record<string, ArchetypeDecision> = {};
			for (const arch of extracted.archetypes) {
				const top = rankCandidateMatrixRules([arch], HDB_CONDO_MATRIX, 1)[0];
				expect(top, `No matrix rule for ${arch.ifc_class} ${arch.family}`).toBeDefined();
				if (top) {
					aiDecisions[arch.archetype_id] = {
						matrix_code: top.code,
						method: 'ai_sys1',
						confidence: 0.97,
						reason: `Matched ${top.code}`
					};
				}
			}
			const estimate = buildBimCostEstimateFromExtracted({
				extracted,
				matrix: HDB_CONDO_MATRIX,
				currency: 'SGD',
				contingency_pct: '5',
				ai_decisions: aiDecisions
			});
			expect(estimate.unmatched_asset_count).toBe(0);
			const actualTotal = Number(estimate.total_estimate);
			const expectedTotal = Number(hdb.expectedTotalWith5PctContingency);
			const errPct = (Math.abs(actualTotal - expectedTotal) / expectedTotal) * 100;
			expect(expectedTotal).toBeGreaterThan(2_000_000);
			expect(errPct).toBeLessThan(1.0);

			// 2. Verify wide-aperture 3D spatial neighborhood captured L-shaped sofa 0.35 m from sharp glass fin
			const sofaIdx = extracted.archetypes.findIndex((a) => a.ifc_class === 'IFCFURNITURE');
			const glassIdx = extracted.archetypes.findIndex((a) => a.ifc_class === 'IFCPLATE');
			expect(sofaIdx).toBeGreaterThanOrEqual(0);
			expect(glassIdx).toBeGreaterThanOrEqual(0);
			const sofaArch = extracted.archetypes[sofaIdx];
			const glassArch = extracted.archetypes[glassIdx];
			const nearGlass = sofaArch?.nearby_archetypes?.find(
				(n) => n.archetype_id === glassArch?.archetype_id
			);
			expect(nearGlass).toBeDefined();
			expect(nearGlass?.min_dist_m).toBeCloseTo(0.35, 1);

			// 3. Verify all BCA / CORENET X IFC-SG deterministic metrics + multimodal spatial semantic SOP linting
			const rules: readonly SopRule[] = [
				{
					code: 'CX-GEOREF-05',
					name: 'SVY21 EPSG:3414',
					authority: 'corenet_x',
					severity: 'error',
					scope: 'model',
					metric: 'georef_crs',
					operator: 'contains',
					threshold_text: '3414',
					active: true
				},
				{
					code: 'CX-SGPSET-06',
					name: 'SGPset Coverage',
					authority: 'corenet_x',
					severity: 'warning',
					scope: 'model',
					metric: 'sgpset_coverage_pct',
					operator: 'gte',
					threshold_num: 50,
					active: true
				},
				{
					code: 'CX-DUP-04',
					name: 'Zero Duplicates',
					authority: 'corenet_x',
					severity: 'error',
					scope: 'model',
					metric: 'duplicate_count',
					operator: 'lte',
					threshold_num: 0,
					active: true
				},
				{
					code: 'BCA-STAIR-RISER',
					name: 'Stair Riser <= 175mm',
					authority: 'bca',
					severity: 'error',
					scope: 'element',
					metric: 'max_riser_mm',
					operator: 'lte',
					threshold_num: 175,
					ifc_classes: ['IFCSTAIRFLIGHT'],
					active: true
				},
				{
					code: 'BCA-STAIR-TREAD',
					name: 'Stair Tread >= 250mm',
					authority: 'bca',
					severity: 'error',
					scope: 'element',
					metric: 'min_tread_mm',
					operator: 'gte',
					threshold_num: 250,
					ifc_classes: ['IFCSTAIRFLIGHT'],
					active: true
				},
				{
					code: 'BCA-RAMP-SLOPE',
					name: 'Ramp Slope <= 8.33%',
					authority: 'bca',
					severity: 'error',
					scope: 'element',
					metric: 'max_slope_pct',
					operator: 'lte',
					threshold_num: 8.33,
					ifc_classes: ['IFCRAMP'],
					active: true
				},
				{
					code: 'BCA-RAIL-H',
					name: 'Railing Height >= 1000mm',
					authority: 'bca',
					severity: 'error',
					scope: 'element',
					metric: 'min_height_mm',
					operator: 'gte',
					threshold_num: 1000,
					ifc_classes: ['IFCRAILING'],
					active: true
				},
				{
					code: 'SOP-SEM-CLEARANCE',
					name: 'L-Shaped Seating Away From Sharp Glass Dividers',
					authority: 'company_sop',
					severity: 'warning',
					scope: 'model',
					metric: 'semantic_check',
					operator: 'present',
					threshold_text:
						'Ensure L-shaped lobby lounge seating is at least 1.0 m away from sharp glass dividers.',
					active: true
				}
			];

			const overviewRef = { id: new_id('sys_file'), name: 'building.jpg', mime: 'image/jpeg' };
			const sofaRef = { id: new_id('sys_file'), name: 'sofa.jpg', mime: 'image/jpeg' };
			const extractedWithViews: ExtractedBimModel = {
				...extracted,
				overview_views: [
					{
						label: 'Whole Building (4-angle wide overview)',
						kind: 'building',
						visual_file: overviewRef.id
					}
				],
				archetypes: extracted.archetypes.map((a, i) =>
					i === sofaIdx ? { ...a, visual_file: sofaRef.id } : a
				)
			};

			let capturedFilesCount = 0;
			let capturedPrompt = '';
			const semanticFindings = yield* evaluateSemanticComplianceRules({
				extracted: extractedWithViews,
				rules,
				pictures: new Map([
					[overviewRef.id, overviewRef],
					[sofaRef.id, sofaRef]
				]),
				progress: () => Effect.void,
				infer: (req) => {
					capturedFilesCount = req.files.length;
					capturedPrompt = req.prompt;
					return Effect.succeed({
						results: [
							{
								rule_code: 'SOP-SEM-CLEARANCE',
								compliant: false,
								actual:
									'L-Shaped Lobby Lounge Sofa is 0.35 m from Sharp Architectural Glass Fin Divider (< 1.0 m)',
								offending_archetypes: [sofaIdx]
							}
						]
					});
				}
			});
			expect(capturedFilesCount).toBe(2); // Both wide-aperture building overview AND sofa 4-angle+context screenshot attached!
			expect(capturedPrompt).toContain('"overview_views"');
			expect(capturedPrompt).toContain('"min_dist_m":0.35');

			const report = evaluateComplianceRules({
				extracted: extractedWithViews,
				estimate,
				rules,
				semanticFindings,
				checkedAt: '2026-06-15T08:00:00.000Z'
			});
			const find = (code: string) => report.findings.find((f) => f.rule_code === code);
			expect(find('CX-GEOREF-05')?.status).toBe('pass');
			expect(find('CX-SGPSET-06')?.status).toBe('pass');
			expect(find('CX-DUP-04')?.status).toBe('fail');
			expect(find('BCA-STAIR-RISER')?.status).toBe('fail');
			expect(find('BCA-STAIR-RISER')?.affected_count).toBe(1); // ONLY the 1 L15 non-compliant flight out of 16!
			expect(find('BCA-STAIR-RISER')?.sample_express_ids).toEqual([hdb.nonCompliantStairFlightId]);
			expect(find('BCA-STAIR-TREAD')?.status).toBe('pass');
			expect(find('BCA-RAMP-SLOPE')?.status).toBe('fail');
			expect(find('BCA-RAMP-SLOPE')?.affected_count).toBe(1);
			expect(find('BCA-RAMP-SLOPE')?.actual).toContain('10.5%');
			expect(find('BCA-RAMP-SLOPE')?.sample_express_ids).toEqual([hdb.nonCompliantRampId]);
			expect(find('BCA-RAIL-H')?.status).toBe('fail');
			expect(find('BCA-RAIL-H')?.affected_count).toBe(1); // ONLY the 1 L15 900mm parapet out of 56!
			expect(find('BCA-RAIL-H')?.sample_express_ids).toEqual([hdb.nonCompliantRailingId]);
			expect(find('SOP-SEM-CLEARANCE')?.status).toBe('warning');
			expect(find('SOP-SEM-CLEARANCE')?.affected_count).toBe(1);
			expect(find('SOP-SEM-CLEARANCE')?.sample_express_ids).toContain(hdb.lShapedSofaId);

			// 4. Real IFC Cleaning + QS Override Writeback + Round-Trip Verification
			const overrideSig = sofaArch?.signature;
			expect(overrideSig).toBeDefined();
			const cleaned = cleanAndOrganizeIfcStep(
				hdb.ifcText,
				extracted,
				overrideSig
					? new Map([
							[
								overrideSig,
								{
									ifc_class: 'IFCFURNITURE',
									continuity: 'discontiguous',
									matrix_code: 'HDB-SOFA',
									trade_specialty: 'finishing',
									review_status: 'verified',
									source: 'qs'
								}
							]
						])
					: undefined
			);
			expect(cleaned.stats.duplicates_removed).toBe(2);
			expect(cleaned.stats.classes_promoted).toBe(2); // both inline fire spool proxies promoted to IFCPIPESEGMENT!
			expect(cleaned.stats.systems_created).toBeGreaterThanOrEqual(4); // fire, cw, sanitary, electrical IFCDISTRIBUTIONSYSTEMs!
			expect(cleaned.stats.trade_groups_created).toBeGreaterThanOrEqual(5);
			expect(cleaned.stats.qs_overrides_applied).toBe(1);
			expect(cleaned.stats.total_elements_tagged).toBe(extracted.total_asset_count);
			expect(cleaned.ifcText).toContain("'ItemMatrixCode',$,IFCLABEL('HDB-SOFA')");
			expect(cleaned.ifcText).toContain("'VerificationStatus',$,IFCLABEL('verified')");
			// Zero references to stripped duplicate express IDs anywhere in the cleaned STEP file!
			for (const dupId of hdb.duplicateBeamIds) {
				expect(cleaned.ifcText).not.toMatch(new RegExp(`#${dupId}\\b`));
			}
			// Round-trip re-parse: zero duplicates left, inline proxies now native IFCPIPESEGMENT!
			const reparsed = createIfcStepStreamParser();
			reparsed.push(cleaned.ifcText);
			const after = reparsed.finish();
			expect(after.total_asset_count).toBe(extracted.total_asset_count);
			for (const pxId of hdb.inlineProxyIds) {
				expect(after.elements?.find((e) => e.express_id === pxId)?.ifc_class).toBe(
					'IFCPIPESEGMENT'
				);
			}
		})
);
