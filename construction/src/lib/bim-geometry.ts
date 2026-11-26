/**
 * Quantities and identity from BIM element geometry, as plain arithmetic over web-ifc meshes so it runs anywhere.
 *
 * A model's own quantity sets are often missing (most Revit exports carry none), so every element is also measured
 * from its mesh: its solid volume, and the extents of its own oriented box (length, then the face its two longest
 * sides span). Steel elements weigh their volume at steel's density, which prices rebar by the tonne. Elements modelled
 * twice are dropped, and archetypes drawn the same within a tolerance, with the same material families and traits,
 * are one asset under two names and are merged before any of them is classified.
 */
import type { BimArchetype, BimStoreyBucket, ExtractedBimModel } from './bim-step-stream.js';

/** kg/m³; rebar and structural steel are priced by weight. */
const STEEL_DENSITY = 7850;
const STEEL_CLASSES = new Set(['IFCREINFORCINGBAR', 'IFCREINFORCINGMESH', 'IFCTENDON']);
const STEEL_MATERIAL = /\b(steel|rebar|reinforc)/i;

/** One mesh in its own coordinates: solid volume, triangle count and bounds. */
export type MeshMeasure = {
	readonly volume: number;
	readonly triangles: number;
	readonly min: readonly [number, number, number];
	readonly max: readonly [number, number, number];
};

/** One element measured: volume, triangles, its three extents (longest first) and where it sits, in metres. */
export type ElementMeasure = {
	readonly volume: number;
	readonly triangles: number;
	readonly extents: readonly [number, number, number];
	readonly center: readonly [number, number, number];
};

/** Measures a web-ifc mesh (`verts` interleaved x,y,z,nx,ny,nz): the divergence-theorem volume of its triangles. */
export function measureMesh(verts: Float32Array, indices: Uint32Array): MeshMeasure | null {
	const count = Math.floor(verts.length / 6);
	if (count === 0 || indices.length < 3) return null;
	const min: [number, number, number] = [Infinity, Infinity, Infinity];
	const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
	for (let v = 0; v < count; v++)
		for (let k = 0; k < 3; k++) {
			const c = verts[v * 6 + k] ?? 0;
			min[k] = Math.min(min[k] ?? Infinity, c);
			max[k] = Math.max(max[k] ?? -Infinity, c);
		}
	let six = 0;
	const at = (i: number, k: number) => verts[(indices[i] ?? 0) * 6 + k] ?? 0;
	for (let i = 0; i + 2 < indices.length; i += 3) {
		const [ax, ay, az] = [at(i, 0), at(i, 1), at(i, 2)];
		const [bx, by, bz] = [at(i + 1, 0), at(i + 1, 1), at(i + 1, 2)];
		const [cx, cy, cz] = [at(i + 2, 0), at(i + 2, 1), at(i + 2, 2)];
		six += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
	}
	return { volume: Math.abs(six) / 6, triangles: Math.floor(indices.length / 3), min, max };
}

/** A column-major 4×4 transform's 3×3 determinant: how it scales volume. */
const determinant = (m: readonly number[]) =>
	(m[0] ?? 0) * ((m[5] ?? 0) * (m[10] ?? 0) - (m[9] ?? 0) * (m[6] ?? 0)) -
	(m[4] ?? 0) * ((m[1] ?? 0) * (m[10] ?? 0) - (m[9] ?? 0) * (m[2] ?? 0)) +
	(m[8] ?? 0) * ((m[1] ?? 0) * (m[6] ?? 0) - (m[5] ?? 0) * (m[2] ?? 0));

/**
 * An element from its placed meshes: volumes scaled by each placement, extents along the first placement's own axes
 * (a wall's length, height and thickness rather than its footprint in plan).
 */
export function measureElement(
	placed: readonly { readonly mesh: MeshMeasure; readonly transform: readonly number[] }[]
): ElementMeasure | null {
	const first = placed[0];
	if (first === undefined) return null;
	const axes = [0, 1, 2].map((k) => {
		const col = [
			first.transform[k * 4] ?? 0,
			first.transform[k * 4 + 1] ?? 0,
			first.transform[k * 4 + 2] ?? 0
		];
		const norm = Math.hypot(...col) || 1;
		return col.map((c) => c / norm);
	});
	const lo = [Infinity, Infinity, Infinity];
	const hi = [-Infinity, -Infinity, -Infinity];
	const wlo = [Infinity, Infinity, Infinity];
	const whi = [-Infinity, -Infinity, -Infinity];
	let volume = 0;
	let triangles = 0;
	for (const { mesh, transform: m } of placed) {
		volume += mesh.volume * Math.abs(determinant(m));
		triangles += mesh.triangles;
		for (let corner = 0; corner < 8; corner++) {
			const p = [0, 1, 2].map((k) => ((corner >> k) & 1 ? mesh.max[k] : mesh.min[k]) ?? 0);
			const w = [0, 1, 2].map(
				(r) =>
					(m[r] ?? 0) * (p[0] ?? 0) +
					(m[4 + r] ?? 0) * (p[1] ?? 0) +
					(m[8 + r] ?? 0) * (p[2] ?? 0) +
					(m[12 + r] ?? 0)
			);
			for (let k = 0; k < 3; k++) {
				wlo[k] = Math.min(wlo[k] ?? Infinity, w[k] ?? 0);
				whi[k] = Math.max(whi[k] ?? -Infinity, w[k] ?? 0);
			}
			axes.forEach((axis, k) => {
				const along =
					(axis[0] ?? 0) * (w[0] ?? 0) +
					(axis[1] ?? 0) * (w[1] ?? 0) +
					(axis[2] ?? 0) * (w[2] ?? 0);
				lo[k] = Math.min(lo[k] ?? Infinity, along);
				hi[k] = Math.max(hi[k] ?? -Infinity, along);
			});
		}
	}
	const [a = 0, b = 0, c = 0] = [0, 1, 2]
		.map((k) => (hi[k] ?? 0) - (lo[k] ?? 0))
		.sort((x, y) => y - x);
	const mid = (k: number) => ((wlo[k] ?? 0) + (whi[k] ?? 0)) / 2;
	return { volume, triangles, extents: [a, b, c], center: [mid(0), mid(1), mid(2)] };
}

const isSteel = (arch: BimArchetype) =>
	STEEL_CLASSES.has(arch.ifc_class.toUpperCase()) ||
	[...arch.materials, ...arch.material_layers].some((m) => STEEL_MATERIAL.test(m));

/**
 * Fills each bucket's quantities from geometry wherever the model's own quantity sets measured fewer of its elements
 * than the geometry did. Length is an element's longest extent, area the face of its two longest, volume its solid,
 * weight its volume at steel's density for steel elements only. Nothing is estimated for an element without geometry.
 */
export function fillFromGeometry(
	extracted: ExtractedBimModel,
	measured: ReadonlyMap<number, ElementMeasure>
): ExtractedBimModel {
	const steel = new Set(extracted.archetypes.filter(isSteel).map((a) => a.archetype_id));
	const flags = new Map<
		string,
		{ length: boolean; area: boolean; volume: boolean; weight: boolean }
	>();
	const buckets = extracted.buckets.map((bucket): BimStoreyBucket => {
		let count = 0;
		let length = 0;
		let area = 0;
		let volume = 0;
		for (const id of bucket.element_ids ?? []) {
			const m = measured.get(id);
			if (m === undefined) continue;
			count += 1;
			length += m.extents[0];
			area += m.extents[0] * m.extents[1];
			volume += m.volume;
		}
		const weighs = steel.has(bucket.archetype_id);
		const take = (own: number) => count > own;
		const next: BimStoreyBucket = {
			...bucket,
			...(take(bucket.length_measured_count)
				? { length_m: round(length), length_measured_count: count }
				: {}),
			...(take(bucket.area_measured_count)
				? { area_m2: round(area), area_measured_count: count }
				: {}),
			...(take(bucket.volume_measured_count)
				? { volume_m3: round(volume), volume_measured_count: count }
				: {}),
			...(weighs && take(bucket.weight_measured_count)
				? { weight_kg: round(volume * STEEL_DENSITY), weight_measured_count: count }
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
			return f === undefined
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

const round = (n: number) => Number(n.toFixed(4));

/** Spellings of one material, as models from different hands carry them. */
const MATERIAL_FAMILIES: readonly (readonly [RegExp, string])[] = [
	[/galv|\bgi\b/i, 'galvanised steel'],
	[/stainless/i, 'stainless steel'],
	[/rebar|reinforc|\bb500|steel|钢/i, 'steel'],
	[/concrete|\bconc|\bc\d{2}\b|cast-in-place|混凝土/i, 'concrete'],
	[/masonry|\bblock|\bcmu\b|brick/i, 'masonry'],
	[/gypsum|plasterboard|\bgwb\b|drywall/i, 'gypsum'],
	[/glass|glaz/i, 'glass'],
	[/alumin/i, 'aluminium'],
	[/timber|wood|oak|hardwood/i, 'timber'],
	[/pvc|plastic/i, 'plastic'],
	[/copper|\bcu\b/i, 'copper']
];
const materialFamily = (name: string) =>
	MATERIAL_FAMILIES.find(([pattern]) => pattern.test(name))?.[1] ?? name.trim().toLowerCase();

/** Classes an exporter falls back to for anything: a chair exported as a proxy is still a chair. */
const GENERIC_CLASSES = new Set([
	'IFCBUILDINGELEMENTPROXY',
	'IFCFURNISHINGELEMENT',
	'IFCFLOWTERMINAL',
	'IFCFLOWSEGMENT',
	'IFCFLOWFITTING',
	'IFCFLOWCONTROLLER',
	'IFCDISTRIBUTIONFLOWELEMENT'
]);
const classFamily = (ifcClass: string) =>
	ifcClass.toUpperCase().replace(/(STANDARDCASE|ELEMENTEDCASE)$/, '');

/** How far two drawings of one thing may differ: 3 %, and at least a centimetre on any side. */
const TOLERANCE = 0.03;
const near = (a: number, b: number, floor: number) =>
	Math.abs(a - b) <= Math.max(floor, TOLERANCE * Math.max(Math.abs(a), Math.abs(b)));
const sameShape = (a: ElementMeasure, b: ElementMeasure) =>
	near(a.volume, b.volume, 1e-5) && a.extents.every((e, k) => near(e, b.extents[k] ?? 0, 0.01));

/**
 * What must match for two archetypes to be one asset, names left out: material families, traits that change the price
 * (a fire rating; references and marks are names) and, unless one side is a generic export class, its class, kind and
 * operation.
 */
const identity = (arch: BimArchetype) => ({
	generic: GENERIC_CLASSES.has(arch.ifc_class.toUpperCase()),
	kind: [classFamily(arch.ifc_class), arch.predefined_type ?? '', arch.operation_type ?? ''].join(
		'|'
	),
	common: [
		[...new Set([...arch.materials, ...arch.material_layers].map(materialFamily))].sort().join('+'),
		arch.properties
			.filter((p) => !/^(reference|name|mark|tag|isexternal)=/i.test(p))
			.map((p) => p.toLowerCase())
			.sort()
			.join('+')
	].join('|')
});

/**
 * An asset's name for remembering it across takeoffs and projects: its identity (names left out) and its size to
 * 2 cm. What a QS corrected, or System 1 decided, for one signature applies wherever it appears again.
 */
export function assetSignature(arch: BimArchetype, m: ElementMeasure): string {
	const who = identity(arch);
	return [
		who.generic ? 'GENERIC' : who.kind,
		who.common,
		m.extents.map((e) => Math.round(e / 0.02) * 2).join('x')
	].join('|');
}

/**
 * Merges archetypes that are one asset under different names into the first of them (the most numerous), so each
 * asset is classified once and its storey buckets add up: same identity, and a representative drawn the same within
 * the tolerance. `measures` holds each archetype's representative.
 */
export function mergeIdenticalArchetypes(
	extracted: ExtractedBimModel,
	measures: ReadonlyMap<string, ElementMeasure>
): ExtractedBimModel {
	const into = new Map<string, string>();
	const kept: { id: string; who: ReturnType<typeof identity>; m: ElementMeasure }[] = [];
	for (const a of extracted.archetypes) {
		const m = measures.get(a.archetype_id);
		if (m === undefined) continue;
		const who = identity(a);
		const same = kept.find(
			(k) =>
				k.who.common === who.common &&
				(k.who.kind === who.kind || k.who.generic || who.generic) &&
				sameShape(k.m, m)
		);
		if (same === undefined) kept.push({ id: a.archetype_id, who, m });
		else into.set(a.archetype_id, same.id);
	}
	if (into.size === 0) return extracted;
	const archetypes = new Map(extracted.archetypes.map((a) => [a.archetype_id, a] as const));
	for (const [dup, keep] of into) {
		const d = archetypes.get(dup);
		const k = archetypes.get(keep);
		if (d === undefined || k === undefined) continue;
		archetypes.set(keep, {
			...k,
			total_count: k.total_count + d.total_count,
			sample_names: [...new Set([...k.sample_names, ...d.sample_names])].slice(0, 3),
			has_length: k.has_length || d.has_length,
			has_area: k.has_area || d.has_area,
			has_volume: k.has_volume || d.has_volume,
			has_weight: k.has_weight || d.has_weight
		});
		archetypes.delete(dup);
	}
	const buckets = new Map<string, BimStoreyBucket>();
	for (const b of extracted.buckets) {
		const archetype_id = into.get(b.archetype_id) ?? b.archetype_id;
		const key = `${archetype_id}::${b.storey}`;
		const held = buckets.get(key);
		buckets.set(
			key,
			held === undefined
				? { ...b, archetype_id }
				: {
						...held,
						element_count: held.element_count + b.element_count,
						length_m: round(held.length_m + b.length_m),
						length_measured_count: held.length_measured_count + b.length_measured_count,
						area_m2: round(held.area_m2 + b.area_m2),
						area_measured_count: held.area_measured_count + b.area_measured_count,
						volume_m3: round(held.volume_m3 + b.volume_m3),
						volume_measured_count: held.volume_measured_count + b.volume_measured_count,
						weight_kg: round(held.weight_kg + b.weight_kg),
						weight_measured_count: held.weight_measured_count + b.weight_measured_count,
						sample_express_ids: [...held.sample_express_ids, ...b.sample_express_ids].slice(0, 10),
						element_ids: [...(held.element_ids ?? []), ...(b.element_ids ?? [])]
					}
		);
	}
	return { ...extracted, archetypes: [...archetypes.values()], buckets: [...buckets.values()] };
}

/**
 * Drops elements modelled twice in a federated model (the architect's copy of a structural slab, say): the same class
 * family drawn the same within the tolerance, centred within 5 cm of another. A bucket that loses an element loses its
 * own quantity sets too, so geometry measures what is left.
 */
export function dropDuplicates(
	extracted: ExtractedBimModel,
	measured: ReadonlyMap<number, ElementMeasure>
): { readonly extracted: ExtractedBimModel; readonly duplicates: number } {
	const familyOf = new Map(
		extracted.archetypes.map((a) => [a.archetype_id, classFamily(a.ifc_class)] as const)
	);
	// ponytail: a 5 cm grid cell per centre; a twin straddling a cell edge is missed, neighbour cells if it matters
	const seen = new Map<string, ElementMeasure[]>();
	let duplicates = 0;
	const buckets = extracted.buckets.map((bucket): BimStoreyBucket => {
		const ids = bucket.element_ids ?? [];
		const keep = ids.filter((id) => {
			const m = measured.get(id);
			if (m === undefined) return true;
			const key = [
				familyOf.get(bucket.archetype_id),
				...m.center.map((c) => Math.round(c / 0.05))
			].join('|');
			const there = seen.get(key) ?? [];
			if (there.some((other) => sameShape(other, m))) return false;
			seen.set(key, [...there, m]);
			return true;
		});
		const lost = ids.length - keep.length;
		if (lost === 0) return bucket;
		duplicates += lost;
		return {
			...bucket,
			element_ids: keep,
			element_count: bucket.element_count - lost,
			sample_express_ids: bucket.sample_express_ids.filter((id) => keep.includes(id)),
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
	const total = extracted.total_asset_count - duplicates;
	return {
		extracted: {
			...extracted,
			total_asset_count: total,
			buckets: buckets.filter((b) => b.element_count > 0),
			archetypes: extracted.archetypes.map((a) => ({
				...a,
				total_count: buckets
					.filter((b) => b.archetype_id === a.archetype_id)
					.reduce((n, b) => n + b.element_count, 0)
			}))
		},
		duplicates
	};
}
