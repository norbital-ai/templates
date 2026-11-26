import { expect, it } from '@effect/vitest';
import {
	buildBimCostEstimateFromExtracted,
	rankCandidateMatrixRules,
	type MatrixItem
} from '../src/lib/bim-pipeline.js';
import {
	dropDuplicates,
	fillFromGeometry,
	measureElement,
	measureMesh,
	mergeIdenticalArchetypes,
	type ElementMeasure,
	type MeshMeasure
} from '../src/lib/bim-geometry.js';
import {
	createIfcStepStreamParser,
	type BimArchetype,
	type BimStoreyBucket,
	type ExtractedBimModel
} from '../src/lib/bim-step-stream.js';

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
