import { Effect, type Scope } from 'effect';
import {
	assetSignature,
	dropDuplicates,
	fillFromGeometry,
	measureElement,
	measureMesh,
	mergeIdenticalArchetypes,
	type ElementMeasure,
	type MeshMeasure
} from '../bim-geometry.js';
import type { BimArchetype, ExtractedBimModel } from '../bim-step-stream.js';
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
const MAX_VISUAL_ARCHETYPES = 200;

/** The geometry pass's progress: measuring every element, then picturing each unique asset. */
export type BimGeometryProgress =
	| { readonly phase: 'measuring'; readonly done: number; readonly total: number }
	| {
			readonly phase: 'snapshots';
			readonly done: number;
			readonly total: number;
			readonly captured: number;
	  };

type SnapshotAngle = {
	readonly yawOffsetRad: number;
	readonly pitchRad: number;
};

/**
 * Four studio camera angles around an isolated asset, laid out in a square 2 × 2 picture (vision models refuse a
 * long strip):
 * 1. Front 3/4 isometric (shows overall 3D form, panels, glazing, hardware, frame)
 * 2. Direct front elevation (shows double vs single leaf, sliding overlap, mullions, symmetry)
 * 3. Side / rear-top 3/4 profile (shows multi-layer thickness, sliding tracks, depth, top shape)
 * 4. Plan from above (shows bar shapes and bends, duct and tray runs, slab and furniture outlines)
 */
const MULTI_ANGLE_VIEWS: readonly SnapshotAngle[] = [
	{ yawOffsetRad: (34 * Math.PI) / 180, pitchRad: (20 * Math.PI) / 180 },
	{ yawOffsetRad: 0, pitchRad: (4 * Math.PI) / 180 },
	{ yawOffsetRad: (112 * Math.PI) / 180, pitchRad: (28 * Math.PI) / 180 },
	{ yawOffsetRad: 0, pitchRad: (88 * Math.PI) / 180 }
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
			flatMesh.delete?.();
		}
	}

	return { group, geometries, edges, materials, meshCount };
}

/** The takeoff and, by archetype, its four-angle picture. */
export type Takeoff = {
	readonly extracted: ExtractedBimModel;
	readonly pictures: ReadonlyMap<string, Blob>;
	/** Elements dropped as modelled twice. */
	readonly duplicates: number;
};

/** A takeoff as stored: element ids are only for measuring. */
const stored = ({ assemblies: _parts, ...extracted }: ExtractedBimModel): ExtractedBimModel => ({
	...extracted,
	buckets: extracted.buckets.map(({ element_ids: _ids, ...bucket }) => bucket)
});

/**
 * The browser's pass over the model's geometry (`web-ifc` + `three` on an offscreen WebGL canvas), between the STEP
 * stream and the stored takeoff:
 * 1. measures every element from its mesh;
 * 2. drops elements modelled twice and fills the quantities the model's own quantity sets leave out;
 * 3. merges archetypes that are one asset under different names or drawn a little off (tolerance, material families);
 * 4. renders each unique asset alone from four angles into one square picture, for System 1 to classify by sight.
 * It fails soft: without WebGL or WASM the takeoff keeps the stream's quantities and goes without pictures.
 */
export function measureAndPicture(
	source: File | string,
	extracted: ExtractedBimModel,
	onProgress?: (progress: BimGeometryProgress) => void
): Effect.Effect<Takeoff, never> {
	const plain = (): Takeoff => ({
		extracted: stored(extracted),
		pictures: new Map(),
		duplicates: 0
	});
	if (extracted.archetypes.length === 0 || typeof document === 'undefined') {
		return Effect.succeed(plain());
	}

	const task = Effect.gen(function* () {
		const bytes = yield* loadSourceBytes(source);
		if (bytes === null) return plain();

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

		// a shared geometry (a type's mapped item) is read once
		const meshes = new Map<number, MeshMeasure | null>();
		const meshOf = (geometryId: number): MeshMeasure | null => {
			const held = meshes.get(geometryId);
			if (held !== undefined) return held;
			const geo = ifcApi.GetGeometry(modelID, geometryId);
			try {
				const measured = measureMesh(
					ifcApi.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize()),
					ifcApi.GetIndexArray(geo.GetIndexData(), geo.GetIndexDataSize())
				);
				meshes.set(geometryId, measured);
				return measured;
			} finally {
				geo.delete();
			}
		};
		const measureIds = (ids: readonly number[]): ElementMeasure | null => {
			const placed: { mesh: MeshMeasure; transform: readonly number[] }[] = [];
			for (const id of ids) {
				const flat = ifcApi.GetFlatMesh(modelID, id);
				try {
					for (let i = 0; i < flat.geometries.size(); i++) {
						const g = flat.geometries.get(i);
						const mesh = meshOf(g.geometryExpressID);
						if (mesh !== null && g.flatTransformation.length === 16)
							placed.push({ mesh, transform: g.flatTransformation });
					}
				} finally {
					flat.delete?.();
				}
			}
			return measureElement(placed);
		};

		// 1. every element, measured
		const ids = extracted.buckets.flatMap((b) => b.element_ids ?? []);
		const measured = new Map<number, ElementMeasure>();
		for (let i = 0; i < ids.length; i++) {
			const id = ids[i];
			if (id === undefined) continue;
			// an assembly is measured whole: its own geometry and every part's
			const m = measureIds([id, ...(extracted.assemblies?.[String(id)] ?? [])]);
			if (m !== null) measured.set(id, m);
			if ((i + 1) % 500 === 0 || i + 1 === ids.length) {
				onProgress?.({ phase: 'measuring', done: i + 1, total: ids.length });
				yield* Effect.yieldNow;
			}
		}
		// 2. what was modelled twice counts once; what geometry measures fills what the model left out
		const { extracted: single, duplicates } = dropDuplicates(extracted, measured);
		const filled = fillFromGeometry(single, measured);

		// 3. one asset under two names, or drawn a little off, is classified once
		const representatives = new Map<string, ElementMeasure>();
		for (const arch of filled.archetypes) {
			const m =
				measured.get(arch.representative_express_id) ??
				(arch.representative_part_ids.length > 0 ? measureIds(arch.representative_part_ids) : null);
			if (m !== null) representatives.set(arch.archetype_id, m);
		}
		const merged = mergeIdenticalArchetypes(filled, representatives);
		const signed = {
			...merged,
			archetypes: merged.archetypes.map((a) => {
				const m = representatives.get(a.archetype_id);
				return m === undefined ? a : { ...a, signature: assetSignature(a, m) };
			})
		};

		// 4. each unique asset, pictured alone
		const pictures = yield* picture(ifcApi, THREE, modelID, signed.archetypes, onProgress).pipe(
			Effect.catchCause(() => Effect.succeed(new Map<string, Blob>()))
		);
		return { extracted: stored(signed), pictures, duplicates };
	}).pipe(Effect.scoped);

	// soft in every way: a web-ifc fault is a defect, not a failure
	return task.pipe(Effect.catchCause(() => Effect.succeed(plain())));
}

/** Renders each archetype's representative alone from four studio angles into one square JPEG, by archetype. */
function picture(
	ifcApi: ViewerIfcApi,
	THREE: ViewerThreeModule,
	modelID: number,
	archetypes: readonly BimArchetype[],
	onProgress?: (progress: BimGeometryProgress) => void
): Effect.Effect<ReadonlyMap<string, Blob>, Error, Scope.Scope> {
	return Effect.gen(function* () {
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
		const pictures = new Map<string, Blob>();
		// the four angles in one square picture: front three-quarter, front elevation / side-rear, plan
		const sheet = document.createElement('canvas');
		sheet.width = SNAPSHOT_SIZE * 2;
		sheet.height = SNAPSHOT_SIZE * 2;
		const paint = sheet.getContext('2d');
		if (paint === null) return pictures;

		for (let idx = 0; idx < targetCount; idx++) {
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

							for (const [slot, angle] of MULTI_ANGLE_VIEWS.entries()) {
								const yaw = baseYaw + angle.yawOffsetRad;
								const cosPitch = Math.cos(angle.pitchRad);
								camera.position.set(
									Math.sin(yaw) * cosPitch * dist,
									Math.sin(angle.pitchRad) * dist,
									Math.cos(yaw) * cosPitch * dist
								);
								camera.lookAt(0, 0, 0);
								renderer.render(scene, camera);
								paint.drawImage(
									renderer.domElement,
									(slot % 2) * SNAPSHOT_SIZE,
									Math.floor(slot / 2) * SNAPSHOT_SIZE
								);
							}
							scene.remove(built.group);
							const picture = yield* Effect.callback<Blob | null>((resume) => {
								sheet.toBlob(
									(blob) => resume(Effect.succeed(blob)),
									'image/jpeg',
									SNAPSHOT_JPEG_QUALITY
								);
							});
							if (picture !== null) pictures.set(arch.archetype_id, picture);
						}
					}
				}
			} finally {
				for (const g of built.geometries) g.dispose();
				for (const e of built.edges) e.dispose();
				for (const m of built.materials) m.dispose();
			}

			onProgress?.({
				phase: 'snapshots',
				done: idx + 1,
				total: targetCount,
				captured: pictures.size
			});
			if ((idx + 1) % 4 === 0) {
				yield* Effect.yieldNow;
			}
		}

		return pictures;
	});
}
