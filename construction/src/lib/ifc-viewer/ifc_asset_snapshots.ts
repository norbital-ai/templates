import { Effect } from 'effect';
import type { BimArchetype } from '../bim-step-stream.js';
import {
	fetchEffect,
	messageOf,
	type ViewerBufferGeometry,
	type ViewerEdgesGeometry,
	type ViewerIfcApi,
	type ViewerMaterial,
	type ViewerThreeModule
} from './ifc_viewer.types.js';

const WEB_IFC_WASM_URL = 'https://esm.sh/web-ifc@0.0.77/web-ifc.wasm';
const SNAPSHOT_SIZE = 224;
const SNAPSHOT_JPEG_QUALITY = 0.74;
const MAX_WASM_SOURCE_BYTES = 250 * 1024 * 1024;
const MAX_VISUAL_ARCHETYPES = 120;
const SOFT_TWO_VIEW_BYTES = 1_800_000;
const MAX_TOTAL_VISUAL_BYTES = 2_400_000;

export type BimSnapshotProgress = {
	readonly done: number;
	readonly total: number;
	readonly captured: number;
};

type SnapshotAngle = {
	readonly yawOffsetRad: number;
	readonly pitchRad: number;
};

/**
 * Three complementary studio camera angles around an isolated asset:
 * 1. Front 3/4 isometric (shows overall 3D form, panels, glazing, hardware, frame)
 * 2. Direct front elevation (shows double vs single leaf, sliding overlap, mullions, symmetry)
 * 3. Side / rear-top 3/4 profile (shows multi-layer thickness, sliding tracks, depth, top shape)
 */
const MULTI_ANGLE_VIEWS: readonly SnapshotAngle[] = [
	{ yawOffsetRad: (34 * Math.PI) / 180, pitchRad: (20 * Math.PI) / 180 },
	{ yawOffsetRad: 0, pitchRad: (4 * Math.PI) / 180 },
	{ yawOffsetRad: (112 * Math.PI) / 180, pitchRad: (28 * Math.PI) / 180 }
];

const COMPACT_ANGLE_VIEWS: readonly SnapshotAngle[] = [
	{ yawOffsetRad: (34 * Math.PI) / 180, pitchRad: (20 * Math.PI) / 180 },
	{ yawOffsetRad: (112 * Math.PI) / 180, pitchRad: (28 * Math.PI) / 180 }
];

const loadVisualRuntime = Effect.gen(function* () {
	// Match ifc_viewer.converter.worker.ts: esm.sh's process shim reports versions.node,
	// which trips web-ifc's Node environment guard unless cleared before importing web-ifc.
	const { default: processShim } = yield* Effect.tryPromise({
		try: () => import(/* @vite-ignore */ 'https://esm.sh/node/process.mjs'),
		catch: (cause) => new Error(`load-process-shim: ${messageOf(cause)}`)
	});
	yield* Effect.sync(() => {
		Object.defineProperty(processShim, 'versions', { value: {}, configurable: true });
	});
	const [{ IfcAPI }, THREE] = yield* Effect.all([
		Effect.tryPromise({
			try: () => import(/* @vite-ignore */ 'https://esm.sh/web-ifc@0.0.77'),
			catch: (cause) => new Error(`load-web-ifc: ${messageOf(cause)}`)
		}),
		Effect.tryPromise({
			try: () => import(/* @vite-ignore */ 'https://esm.sh/three@0.185.1'),
			catch: (cause) => new Error(`load-three: ${messageOf(cause)}`)
		})
	]);
	const ifcApi: ViewerIfcApi = new IfcAPI();
	yield* Effect.tryPromise({
		try: () => ifcApi.Init(() => WEB_IFC_WASM_URL, true),
		catch: (cause) => new Error(`init-web-ifc: ${messageOf(cause)}`)
	});
	return { ifcApi, THREE };
});

function loadSourceBytes(source: File | string): Effect.Effect<Uint8Array | null, Error> {
	if (typeof source !== 'string') {
		if (source.size <= 0 || source.size > MAX_WASM_SOURCE_BYTES) {
			return Effect.succeed(null);
		}
		return Effect.tryPromise({
			try: async () => new Uint8Array(await source.arrayBuffer()),
			catch: (cause) => new Error(`read-local-ifc: ${messageOf(cause)}`)
		});
	}
	return Effect.gen(function* () {
		const response = yield* fetchEffect(source, 'fetch-ifc-for-snapshots');
		if (!response.ok) return null;
		const contentLen = Number(response.headers.get('content-length') ?? '0');
		if (Number.isFinite(contentLen) && contentLen > MAX_WASM_SOURCE_BYTES) return null;
		const buf = yield* Effect.tryPromise({
			try: () => response.arrayBuffer(),
			catch: (cause) => new Error(`read-remote-ifc: ${messageOf(cause)}`)
		});
		if (buf.byteLength <= 0 || buf.byteLength > MAX_WASM_SOURCE_BYTES) return null;
		return new Uint8Array(buf);
	});
}

function buildIsolatedAssetGroup(
	ifcApi: ViewerIfcApi,
	THREE: ViewerThreeModule,
	modelID: number,
	expressIds: readonly number[],
	edgeMaterial: ViewerMaterial
): {
	readonly group: ReturnType<ViewerThreeModule['Group']['prototype']['add']>;
	readonly geometries: ViewerBufferGeometry[];
	readonly edges: ViewerEdgesGeometry[];
	readonly materials: ViewerMaterial[];
	readonly meshCount: number;
} {
	const group = new THREE.Group();
	const geometries: ViewerBufferGeometry[] = [];
	const edges: ViewerEdgesGeometry[] = [];
	const materials: ViewerMaterial[] = [];
	let meshCount = 0;

	for (const expressId of expressIds) {
		const flatMesh = ifcApi.GetFlatMesh(modelID, expressId);
		try {
			const count = flatMesh.geometries.size();
			for (let i = 0; i < count; i++) {
				const placed = flatMesh.geometries.get(i);
				const ifcGeo = ifcApi.GetGeometry(modelID, placed.geometryExpressID);
				try {
					const verts = ifcApi.GetVertexArray(ifcGeo.GetVertexData(), ifcGeo.GetVertexDataSize());
					const indices = ifcApi.GetIndexArray(ifcGeo.GetIndexData(), ifcGeo.GetIndexDataSize());
					if (verts.length < 6 || indices.length < 3) continue;

					const vertCount = Math.floor(verts.length / 6);
					const positions = new Float32Array(vertCount * 3);
					const normals = new Float32Array(vertCount * 3);
					let hasNonZeroNormal = false;
					for (let v = 0; v < vertCount; v++) {
						const src = v * 6;
						const dst = v * 3;
						positions[dst] = verts[src] ?? 0;
						positions[dst + 1] = verts[src + 1] ?? 0;
						positions[dst + 2] = verts[src + 2] ?? 0;
						const nx = verts[src + 3] ?? 0;
						const ny = verts[src + 4] ?? 0;
						const nz = verts[src + 5] ?? 0;
						normals[dst] = nx;
						normals[dst + 1] = ny;
						normals[dst + 2] = nz;
						if (!hasNonZeroNormal && (nx !== 0 || ny !== 0 || nz !== 0)) {
							hasNonZeroNormal = true;
						}
					}

					const geo = new THREE.BufferGeometry();
					geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
					geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
					geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
					if (placed.flatTransformation.length === 16) {
						const matrix = new THREE.Matrix4().fromArray(placed.flatTransformation);
						geo.applyMatrix4(matrix);
					}
					if (!hasNonZeroNormal) {
						geo.computeVertexNormals();
					}

					const { x: r, y: g, z: b, w: a } = placed.color;
					const isUncoloredBlack = r <= 0.02 && g <= 0.02 && b <= 0.02;
					const color = isUncoloredBlack
						? new THREE.Color('#cbd5e1')
						: new THREE.Color().setRGB(
								Math.min(1, Math.max(0, r)),
								Math.min(1, Math.max(0, g)),
								Math.min(1, Math.max(0, b))
							);
					const alpha = Number.isFinite(a) && a > 0 ? Math.min(1, a) : 1;
					const transparent = alpha < 0.96;
					const mat = new THREE.MeshStandardMaterial({
						color,
						transparent,
						opacity: transparent ? Math.max(0.32, alpha) : 1,
						side: THREE.DoubleSide,
						roughness: transparent ? 0.25 : 0.58,
						metalness: transparent ? 0.15 : 0.08
					});

					group.add(new THREE.Mesh(geo, mat));
					const edgeGeo = new THREE.EdgesGeometry(geo, 22);
					group.add(new THREE.LineSegments(edgeGeo, edgeMaterial));
					geometries.push(geo);
					edges.push(edgeGeo);
					materials.push(mat);
					meshCount++;
				} finally {
					ifcGeo.delete();
				}
			}
		} finally {
			flatMesh.delete();
		}
	}

	return { group, geometries, edges, materials, meshCount };
}

/**
 * Renders isolated multi-angle 3D studio snapshots of ONLY each unique deduplicated BIM asset
 * (never the full building) using `web-ifc@0.0.77` + `three@0.185.1` on an offscreen WebGL canvas.
 *
 * Designed so Jev System 1 (`ctx.ai.sys_1.decide`) visually distinguishes door leaves, sliding
 * tracks, multi-layer walls/doors, windows, fixtures, and site/playground assets even when IFC
 * text metadata is sparse or inconsistent. Fails soft (returns archetypes unchanged) if WebGL,
 * WASM, or memory limits prevent rendering.
 */
export function renderIsolatedAssetSnapshots(
	source: File | string,
	archetypes: readonly BimArchetype[],
	onProgress?: (progress: BimSnapshotProgress) => void
): Effect.Effect<readonly BimArchetype[], never> {
	if (archetypes.length === 0 || typeof document === 'undefined') {
		return Effect.succeed(archetypes);
	}

	const task = Effect.gen(function* () {
		const bytes = yield* loadSourceBytes(source);
		if (bytes === null) return archetypes;

		const { ifcApi, THREE } = yield* loadVisualRuntime;
		const modelID = yield* Effect.acquireRelease(
			Effect.try({
				try: () =>
					ifcApi.OpenModel(bytes, {
						COORDINATE_TO_ORIGIN: false,
						USE_FAST_BOOLS: true
					}),
				catch: (cause) => new Error(`open-ifc-model: ${messageOf(cause)}`)
			}),
			(id) =>
				Effect.sync(() => {
					ifcApi.CloseModel(id);
				}).pipe(Effect.ignore)
		);

		const renderer = yield* Effect.acquireRelease(
			Effect.try({
				try: () => {
					const r = new THREE.WebGLRenderer({
						antialias: true,
						preserveDrawingBuffer: true,
						alpha: false,
						powerPreference: 'high-performance'
					});
					r.setPixelRatio(1);
					r.setSize(SNAPSHOT_SIZE, SNAPSHOT_SIZE, false);
					return r;
				},
				catch: (cause) => new Error(`create-webgl-renderer: ${messageOf(cause)}`)
			}),
			(r) =>
				Effect.sync(() => {
					r.dispose();
				}).pipe(Effect.ignore)
		);

		const edgeMaterial = yield* Effect.acquireRelease(
			Effect.sync(
				() =>
					new THREE.LineBasicMaterial({
						color: 0x334155,
						transparent: true,
						opacity: 0.42
					})
			),
			(mat) =>
				Effect.sync(() => {
					mat.dispose();
				}).pipe(Effect.ignore)
		);

		const scene = new THREE.Scene();
		scene.background = new THREE.Color('#f1f5f9');
		const hemi = new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 1.05);
		scene.add(hemi);
		const keyLight = new THREE.DirectionalLight(0xffffff, 0.95);
		keyLight.position.set(6, 10, 8);
		scene.add(keyLight);
		const fillLight = new THREE.DirectionalLight(0xe2e8f0, 0.55);
		fillLight.position.set(-7, 4, -6);
		scene.add(fillLight);

		const fovDeg = 34;
		const fovRad = (fovDeg * Math.PI) / 180;
		const camera = new THREE.PerspectiveCamera(fovDeg, 1, 0.01, 5000);
		const box = new THREE.Box3();
		const center = new THREE.Vector3();
		const size = new THREE.Vector3();

		const targetCount = Math.min(archetypes.length, MAX_VISUAL_ARCHETYPES);
		const result: BimArchetype[] = [...archetypes];
		let totalBytes = 0;
		let captured = 0;

		for (let idx = 0; idx < targetCount; idx++) {
			if (totalBytes >= MAX_TOTAL_VISUAL_BYTES) break;
			const arch = archetypes[idx];
			if (arch === undefined) continue;

			// Render ONLY this single representative asset (and only its own sub-parts if it is an assembly)
			let built = buildIsolatedAssetGroup(
				ifcApi,
				THREE,
				modelID,
				[arch.representative_express_id],
				edgeMaterial
			);
			if (built.meshCount === 0 && arch.representative_part_ids.length > 0) {
				for (const g of built.geometries) g.dispose();
				for (const e of built.edges) e.dispose();
				for (const m of built.materials) m.dispose();
				built = buildIsolatedAssetGroup(
					ifcApi,
					THREE,
					modelID,
					arch.representative_part_ids,
					edgeMaterial
				);
			}

			try {
				if (built.meshCount > 0) {
					box.setFromObject(built.group);
					if (!box.isEmpty()) {
						box.getCenter(center);
						box.getSize(size);
						const maxDim = Math.max(size.x, size.y, size.z);
						if (Number.isFinite(maxDim) && maxDim > 1e-4) {
							// Center the isolated asset at the origin so cameras orbit cleanly around it
							built.group.position.set(-center.x, -center.y, -center.z);
							scene.add(built.group);

							// Orient front views perpendicular to the widest horizontal face (never edge-on for doors/walls!)
							const baseYaw = size.x < size.z * 0.65 ? Math.PI / 2 : 0;
							const radius = size.length() * 0.5;
							const dist = Math.max(maxDim * 0.85, (radius / Math.sin(fovRad / 2)) * 1.08);
							camera.near = Math.max(0.005, dist / 200);
							camera.far = Math.max(100, dist * 12);
							camera.updateProjectionMatrix();

							const angles =
								totalBytes >= SOFT_TWO_VIEW_BYTES ? COMPACT_ANGLE_VIEWS : MULTI_ANGLE_VIEWS;
							const views: string[] = [];
							for (const angle of angles) {
								const yaw = baseYaw + angle.yawOffsetRad;
								const cosPitch = Math.cos(angle.pitchRad);
								camera.position.set(
									Math.sin(yaw) * cosPitch * dist,
									Math.sin(angle.pitchRad) * dist,
									Math.cos(yaw) * cosPitch * dist
								);
								camera.lookAt(0, 0, 0);
								renderer.render(scene, camera);
								const dataUrl = renderer.domElement.toDataURL('image/jpeg', SNAPSHOT_JPEG_QUALITY);
								if (
									dataUrl.startsWith('data:image/jpeg;base64,') &&
									totalBytes + dataUrl.length <= MAX_TOTAL_VISUAL_BYTES
								) {
									views.push(dataUrl);
									totalBytes += dataUrl.length;
								}
							}
							scene.remove(built.group);

							if (views.length > 0) {
								result[idx] = { ...arch, visual_views: views };
								captured++;
							}
						}
					}
				}
			} finally {
				for (const g of built.geometries) g.dispose();
				for (const e of built.edges) e.dispose();
				for (const m of built.materials) m.dispose();
			}

			onProgress?.({ done: idx + 1, total: targetCount, captured });
			if ((idx + 1) % 4 === 0) {
				yield* Effect.yieldNow;
			}
		}

		return result;
	}).pipe(Effect.scoped);

	return task.pipe(Effect.catch(() => Effect.succeed(archetypes)));
}
