/**
 * Pure 3D mesh metrology over `web-ifc` flat buffers: zero-allocation solid volume, exact net face
 * area (openings & cutouts subtracted via cofactor projection), oriented extents, linear length,
 * and cross-section sizing. Runs identically in browser workers and unit tests.
 */
import type { ContinuityMode } from './schema.js';

export type MeshMeasure = {
	readonly volume: number;
	readonly totalArea: number;
	readonly faceArea: readonly [number, number, number];
	readonly domNormal: readonly [number, number, number];
	readonly triangles: number;
	readonly min: readonly [number, number, number];
	readonly max: readonly [number, number, number];
};

export type ElementMeasure = {
	readonly volume: number;
	readonly netArea?: number;
	readonly totalArea?: number;
	readonly triangles: number;
	readonly extents: readonly [number, number, number];
	readonly center: readonly [number, number, number];
	readonly worldMin?: readonly [number, number, number];
	readonly worldMax?: readonly [number, number, number];
};

export function measureMesh(verts: Float32Array, indices: Uint32Array): MeshMeasure | null {
	const count = Math.floor(verts.length / 6);
	const triCount = Math.floor(indices.length / 3);
	if (count === 0 || triCount === 0) return null;

	let minX = Infinity,
		minY = Infinity,
		minZ = Infinity;
	let maxX = -Infinity,
		maxY = -Infinity,
		maxZ = -Infinity;
	for (let base = 0, limit = count * 6; base < limit; base += 6) {
		const x = verts[base] ?? 0,
			y = verts[base + 1] ?? 0,
			z = verts[base + 2] ?? 0;
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (z < minZ) minZ = z;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
		if (z > maxZ) maxZ = z;
	}

	let sixVol = 0,
		totalArea = 0,
		faX = 0,
		faY = 0,
		faZ = 0,
		dnX = 0,
		dnY = 0,
		dnZ = 0;
	for (let i = 0, len = triCount * 3; i < len; i += 3) {
		const ia = (indices[i] ?? 0) * 6,
			ib = (indices[i + 1] ?? 0) * 6,
			ic = (indices[i + 2] ?? 0) * 6;
		const ax = verts[ia] ?? 0,
			ay = verts[ia + 1] ?? 0,
			az = verts[ia + 2] ?? 0;
		const bx = verts[ib] ?? 0,
			by = verts[ib + 1] ?? 0,
			bz = verts[ib + 2] ?? 0;
		const cx = verts[ic] ?? 0,
			cy = verts[ic + 1] ?? 0,
			cz = verts[ic + 2] ?? 0;

		sixVol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
		const e1x = bx - ax,
			e1y = by - ay,
			e1z = bz - az;
		const e2x = cx - ax,
			e2y = cy - ay,
			e2z = cz - az;
		const nx = e1y * e2z - e1z * e2y;
		const ny = e1z * e2x - e1x * e2z;
		const nz = e1x * e2y - e1y * e2x;
		const twiceArea = Math.hypot(nx, ny, nz);
		if (twiceArea <= 1e-14) continue;

		totalArea += 0.5 * twiceArea;
		faX += 0.5 * Math.abs(nx);
		faY += 0.5 * Math.abs(ny);
		faZ += 0.5 * Math.abs(nz);
		const sign =
			nz > 1e-9 || (Math.abs(nz) <= 1e-9 && (ny > 1e-9 || (Math.abs(ny) <= 1e-9 && nx >= 0)))
				? 0.5
				: -0.5;
		dnX += sign * nx;
		dnY += sign * ny;
		dnZ += sign * nz;
	}

	return {
		volume: Math.abs(sixVol) / 6,
		totalArea,
		faceArea: [faX, faY, faZ],
		domNormal: [dnX, dnY, dnZ],
		triangles: triCount,
		min: [minX, minY, minZ],
		max: [maxX, maxY, maxZ]
	};
}

export function measureElement(
	placed: readonly { readonly mesh: MeshMeasure; readonly transform: readonly number[] }[]
): ElementMeasure | null {
	const first = placed[0];
	if (!first) return null;
	const fm = first.transform;
	const normAxis = (x: number, y: number, z: number): [number, number, number] => {
		const n = Math.hypot(x, y, z) || 1;
		return [x / n, y / n, z / n];
	};
	const [a0x, a0y, a0z] = normAxis(fm[0] ?? 1, fm[1] ?? 0, fm[2] ?? 0);
	const [a1x, a1y, a1z] = normAxis(fm[4] ?? 0, fm[5] ?? 1, fm[6] ?? 0);
	const [a2x, a2y, a2z] = normAxis(fm[8] ?? 0, fm[9] ?? 0, fm[10] ?? 1);

	let lo0 = Infinity,
		lo1 = Infinity,
		lo2 = Infinity;
	let hi0 = -Infinity,
		hi1 = -Infinity,
		hi2 = -Infinity;
	let wloX = Infinity,
		wloY = Infinity,
		wloZ = Infinity;
	let whiX = -Infinity,
		whiY = -Infinity,
		whiZ = -Infinity;
	let volume = 0,
		totalArea = 0,
		triangles = 0;
	let axisArea0 = 0,
		axisArea1 = 0,
		axisArea2 = 0,
		worldDomArea = 0;
	let maxPartA0 = 0,
		maxPartA1 = 0,
		maxPartA2 = 0;

	for (const entry of placed) {
		const { mesh, transform: m } = entry;
		const m00 = m[0] ?? 0,
			m10 = m[1] ?? 0,
			m20 = m[2] ?? 0;
		const m01 = m[4] ?? 0,
			m11 = m[5] ?? 0,
			m21 = m[6] ?? 0;
		const m02 = m[8] ?? 0,
			m12 = m[9] ?? 0,
			m22 = m[10] ?? 0;
		const tx = m[12] ?? 0,
			ty = m[13] ?? 0,
			tz = m[14] ?? 0;

		const c00 = m11 * m22 - m21 * m12,
			c10 = m21 * m02 - m01 * m22,
			c20 = m01 * m12 - m11 * m02;
		const c01 = m12 * m20 - m22 * m10,
			c11 = m22 * m00 - m02 * m20,
			c21 = m02 * m10 - m12 * m00;
		const c02 = m10 * m21 - m20 * m11,
			c12 = m20 * m01 - m00 * m21,
			c22 = m00 * m11 - m10 * m01;

		volume += mesh.volume * Math.abs(m00 * c00 + m10 * c10 + m20 * c20);
		triangles += mesh.triangles;
		totalArea +=
			mesh.totalArea *
			((Math.hypot(c00, c10, c20) + Math.hypot(c01, c11, c21) + Math.hypot(c02, c12, c22)) / 3);

		const [fx, fy, fz] = mesh.faceArea;
		const pA0 =
			fx * Math.abs(c00 * a0x + c10 * a0y + c20 * a0z) +
			fy * Math.abs(c01 * a0x + c11 * a0y + c21 * a0z) +
			fz * Math.abs(c02 * a0x + c12 * a0y + c22 * a0z);
		const pA1 =
			fx * Math.abs(c00 * a1x + c10 * a1y + c20 * a1z) +
			fy * Math.abs(c01 * a1x + c11 * a1y + c21 * a1z) +
			fz * Math.abs(c02 * a1x + c12 * a1y + c22 * a1z);
		const pA2 =
			fx * Math.abs(c00 * a2x + c10 * a2y + c20 * a2z) +
			fy * Math.abs(c01 * a2x + c11 * a2y + c21 * a2z) +
			fz * Math.abs(c02 * a2x + c12 * a2y + c22 * a2z);
		axisArea0 += pA0;
		axisArea1 += pA1;
		axisArea2 += pA2;
		if (pA0 > maxPartA0) maxPartA0 = pA0;
		if (pA1 > maxPartA1) maxPartA1 = pA1;
		if (pA2 > maxPartA2) maxPartA2 = pA2;

		const [dnx, dny, dnz] = mesh.domNormal;
		worldDomArea +=
			0.5 *
			Math.hypot(
				c00 * dnx + c01 * dny + c02 * dnz,
				c10 * dnx + c11 * dny + c12 * dnz,
				c20 * dnx + c21 * dny + c22 * dnz
			);

		const [minX, minY, minZ] = mesh.min;
		const [maxX, maxY, maxZ] = mesh.max;
		for (let corner = 0; corner < 8; corner++) {
			const px = corner & 1 ? maxX : minX;
			const py = corner & 2 ? maxY : minY;
			const pz = corner & 4 ? maxZ : minZ;
			const wx = m00 * px + m01 * py + m02 * pz + tx;
			const wy = m10 * px + m11 * py + m12 * pz + ty;
			const wz = m20 * px + m21 * py + m22 * pz + tz;
			if (wx < wloX) wloX = wx;
			if (wy < wloY) wloY = wy;
			if (wz < wloZ) wloZ = wz;
			if (wx > whiX) whiX = wx;
			if (wy > whiY) whiY = wy;
			if (wz > whiZ) whiZ = wz;

			const p0 = a0x * wx + a0y * wy + a0z * wz;
			const p1 = a1x * wx + a1y * wy + a1z * wz;
			const p2 = a2x * wx + a2y * wy + a2z * wz;
			if (p0 < lo0) lo0 = p0;
			if (p0 > hi0) hi0 = p0;
			if (p1 < lo1) lo1 = p1;
			if (p1 > hi1) hi1 = p1;
			if (p2 < lo2) lo2 = p2;
			if (p2 > hi2) hi2 = p2;
		}
	}

	const e0 = Math.max(0, hi0 - lo0),
		e1 = Math.max(0, hi1 - lo1),
		e2 = Math.max(0, hi2 - lo2);
	const thinIdx = e0 <= e1 && e0 <= e2 ? 0 : e1 <= e0 && e1 <= e2 ? 1 : 2;
	const sumThinArea =
		thinIdx === 0 ? 0.5 * axisArea0 : thinIdx === 1 ? 0.5 * axisArea1 : 0.5 * axisArea2;
	const maxPartThinArea =
		thinIdx === 0 ? 0.5 * maxPartA0 : thinIdx === 1 ? 0.5 * maxPartA1 : 0.5 * maxPartA2;
	const sorted = [e0, e1, e2].sort((x, y) => y - x);
	const a = sorted[0] ?? 0,
		b = sorted[1] ?? 0,
		c = sorted[2] ?? 0;
	const obbArea = a * b;
	// Multi-leaf stacked walls/slabs (e.g. inner leaf + insulation + cladding) overlap along their thin axis: use the primary leaf face area.
	const thinAxisArea =
		placed.length > 1 && obbArea > 0 && sumThinArea > obbArea * 1.15 && maxPartThinArea > 1e-6
			? maxPartThinArea
			: sumThinArea;
	const rawNet = thinAxisArea > 1e-6 ? thinAxisArea : worldDomArea;
	const netArea =
		rawNet > 1e-6 ? (obbArea > 0 ? Math.min(rawNet, obbArea * 1.02) : rawNet) : obbArea;

	return {
		volume,
		netArea,
		totalArea,
		triangles,
		extents: [a, b, c],
		center: [(wloX + whiX) * 0.5, (wloY + whiY) * 0.5, (wloZ + whiZ) * 0.5],
		worldMin: [wloX, wloY, wloZ],
		worldMax: [whiX, whiY, whiZ]
	};
}

export const netAreaOf = (m: ElementMeasure): number =>
	m.netArea !== undefined && m.netArea > 0 ? m.netArea : m.extents[0] * m.extents[1];

/** Straight segments return `extents[0]`; sparse curved/L-bend pipes (`fillRatio < 0.45`) use `volume / area`. */
export function linearLengthOf(m: ElementMeasure): number {
	const [e0, e1, e2] = m.extents;
	const obbVol = e0 * e1 * e2;
	const fillRatio = obbVol > 1e-9 ? m.volume / obbVol : 1;
	if (e2 > 1e-4 && e1 > e2 * 1.6 && m.volume > 0 && fillRatio < 0.45) {
		const swept = m.volume / (Math.PI * (e2 * 0.5) * (e2 * 0.5));
		if (swept > e0 * 1.05 && swept < e0 * 2.5) return swept;
	}
	return e0;
}

export function geometricSizeMm(m: ElementMeasure, continuity: ContinuityMode): number | null {
	const [, e1, e2] = m.extents;
	if (continuity === 'contiguous_planar') return e2 > 1e-4 ? Math.round(e2 * 1000 * 10) / 10 : null;
	if (continuity === 'contiguous_linear') {
		if (e1 <= 1e-4 && e2 <= 1e-4) return null;
		const metres = e2 > 1e-5 && e1 / e2 <= 1.25 ? (e1 + e2) * 0.5 : Math.max(e1, e2);
		return Math.round(metres * 1000 * 10) / 10;
	}
	return null;
}

const MATERIAL_FAMILIES: readonly (readonly [RegExp, string])[] = [
	[/galv|\bgi\b/i, 'galvanised steel'],
	[/stainless/i, 'stainless steel'],
	[/rebar|reinforc|\bb500|steel|碳钢|钢/i, 'steel'],
	[/concrete|\bconc|\bc\d{2}\b|cast-in-place|混凝土/i, 'concrete'],
	[/masonry|\bblock|\bcmu\b|brick/i, 'masonry'],
	[/gypsum|plasterboard|\bgwb\b|drywall/i, 'gypsum'],
	[/glass|glaz/i, 'glass'],
	[/alumin/i, 'aluminium'],
	[/timber|wood|oak|hardwood/i, 'timber'],
	[/pvc|upvc|hdpe|pex|plastic/i, 'plastic'],
	[/copper|\bcu\b/i, 'copper']
];

export const materialFamily = (name: string): string =>
	MATERIAL_FAMILIES.find(([pattern]) => pattern.test(name))?.[1] ?? name.trim().toLowerCase();

export const classFamily = (ifcClass: string): string =>
	ifcClass.toUpperCase().replace(/(STANDARDCASE|ELEMENTEDCASE)$/, '');

export const near = (a: number, b: number, floor: number, tolRatio: number): boolean =>
	Math.abs(a - b) <= Math.max(floor, tolRatio * Math.max(Math.abs(a), Math.abs(b)));

export const sameShape = (a: ElementMeasure, b: ElementMeasure, tolRatio: number): boolean =>
	near(a.volume, b.volume, 1e-5, tolRatio) &&
	a.extents.every((e, k) => near(e, b.extents[k] ?? 0, 0.01, tolRatio));
