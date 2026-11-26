import { Effect, type Scope } from 'effect';
import { cleanupAndMeasure } from '../bim/cleanup.js';
import { resolveBimConfig } from '../bim/config.js';
import {
	measureElement,
	measureMesh,
	type ElementMeasure,
	type MeshMeasure
} from '../bim/geometry.js';
import type {
	BimArchetype,
	BimCleanupReport,
	BimConfig,
	BimSettingsRow,
	ExtractedBimModel
} from '../bim/schema.js';
import {
	fetchEffect,
	messageOf,
	type ViewerBufferGeometry,
	type ViewerEdgesGeometry,
	type ViewerIfcApi,
	type ViewerMaterial,
	type ViewerThreeModule
} from './types.js';

const WEB_IFC_WASM_URL = 'https://esm.sh/web-ifc@0.0.77/web-ifc.wasm';
const SNAPSHOT_SIZE = 224;
const SNAPSHOT_JPEG_QUALITY = 0.74;
const MAX_WASM_SOURCE_BYTES = 250 * 1024 * 1024;

export type BimGeometryProgress =
	| { readonly phase: 'measuring'; readonly done: number; readonly total: number }
	| {
			readonly phase: 'snapshots';
			readonly done: number;
			readonly total: number;
			readonly captured: number;
	  };

const MULTI_ANGLE_VIEWS = [
	{ yawOffsetRad: (34 * Math.PI) / 180, pitchRad: (20 * Math.PI) / 180 },
	{ yawOffsetRad: 0, pitchRad: (4 * Math.PI) / 180 },
	{ yawOffsetRad: (112 * Math.PI) / 180, pitchRad: (28 * Math.PI) / 180 },
	{ yawOffsetRad: 0, pitchRad: (88 * Math.PI) / 180 }
] as const;

const loadVisualRuntime = Effect.gen(function* () {
	const { default: processShim } = yield* Effect.tryPromise({
		try: () => import(/* @vite-ignore */ 'https://esm.sh/node/process.mjs'),
		catch: (cause) => new Error(`load-process-shim: ${messageOf(cause)}`)
	});
	yield* Effect.sync(() =>
		Object.defineProperty(processShim, 'versions', { value: {}, configurable: true })
	);
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
		if (source.size <= 0 || source.size > MAX_WASM_SOURCE_BYTES) return Effect.succeed(null);
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
		return buf.byteLength <= 0 || buf.byteLength > MAX_WASM_SOURCE_BYTES
			? null
			: new Uint8Array(buf);
	});
}

function buildAssetGroup(
	ifcApi: ViewerIfcApi,
	THREE: ViewerThreeModule,
	modelID: number,
	expressIds: readonly number[],
	edgeMaterial: ViewerMaterial,
	overrideStyle?: { readonly color: string; readonly opacity: number }
) {
	const group = new THREE.Group();
	const geometries: ViewerBufferGeometry[] = [];
	const edges: ViewerEdgesGeometry[] = [];
	const materials: ViewerMaterial[] = [];
	let meshCount = 0;

	for (const expressId of expressIds) {
		const flatMesh = ifcApi.GetFlatMesh(modelID, expressId);
		try {
			for (let i = 0; i < flatMesh.geometries.size(); i++) {
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
						const s = v * 6,
							d = v * 3;
						positions[d] = verts[s] ?? 0;
						positions[d + 1] = verts[s + 1] ?? 0;
						positions[d + 2] = verts[s + 2] ?? 0;
						const nx = verts[s + 3] ?? 0,
							ny = verts[s + 4] ?? 0,
							nz = verts[s + 5] ?? 0;
						normals[d] = nx;
						normals[d + 1] = ny;
						normals[d + 2] = nz;
						if (!hasNonZeroNormal && (nx !== 0 || ny !== 0 || nz !== 0)) hasNonZeroNormal = true;
					}

					const geo = new THREE.BufferGeometry();
					geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
					geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
					geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
					if (placed.flatTransformation.length === 16)
						geo.applyMatrix4(new THREE.Matrix4().fromArray(placed.flatTransformation));
					if (!hasNonZeroNormal) geo.computeVertexNormals();

					let color: ReturnType<ViewerThreeModule['Color']['prototype']['setRGB']>;
					let transparent: boolean;
					let opacity: number;
					if (overrideStyle !== undefined) {
						color = new THREE.Color(overrideStyle.color);
						transparent = overrideStyle.opacity < 0.99;
						opacity = overrideStyle.opacity;
					} else {
						const { x: r, y: g, z: b, w: a } = placed.color;
						color =
							r <= 0.02 && g <= 0.02 && b <= 0.02
								? new THREE.Color('#cbd5e1')
								: new THREE.Color().setRGB(
										Math.min(1, Math.max(0, r)),
										Math.min(1, Math.max(0, g)),
										Math.min(1, Math.max(0, b))
									);
						const alpha = Number.isFinite(a) && a > 0 ? Math.min(1, a) : 1;
						transparent = alpha < 0.96;
						opacity = transparent ? Math.max(0.32, alpha) : 1;
					}
					const mat = new THREE.MeshStandardMaterial({
						color,
						transparent,
						opacity,
						side: THREE.DoubleSide,
						roughness: transparent ? 0.25 : 0.58,
						metalness: transparent ? 0.15 : 0.08
					});
					group.add(new THREE.Mesh(geo, mat));
					if (overrideStyle === undefined || overrideStyle.opacity >= 0.9) {
						const edgeGeo = new THREE.EdgesGeometry(geo, 22);
						group.add(new THREE.LineSegments(edgeGeo, edgeMaterial));
						edges.push(edgeGeo);
					}
					geometries.push(geo);
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

function disposeBuilt(built: {
	readonly geometries: ViewerBufferGeometry[];
	readonly edges: ViewerEdgesGeometry[];
	readonly materials: ViewerMaterial[];
}): void {
	for (const g of built.geometries) g.dispose();
	for (const e of built.edges) e.dispose();
	for (const m of built.materials) m.dispose();
}

export type OverviewSpec = {
	readonly key: string;
	readonly label: string;
	readonly kind: 'building' | 'storey';
	readonly storey?: string;
};

export type Takeoff = {
	readonly extracted: ExtractedBimModel;
	readonly pictures: ReadonlyMap<string, Blob>;
	readonly overviews: readonly OverviewSpec[];
	readonly duplicates: number;
	readonly cleanup?: BimCleanupReport;
};

export function stripTransientTakeoff(extracted: ExtractedBimModel): ExtractedBimModel {
	const { assemblies: _parts, elements: _elements, topology_edges: _edges, ...rest } = extracted;
	return {
		...rest,
		archetypes: rest.archetypes.map(({ context_neighbor_ids: _nbs, ...arch }) => arch)
	};
}

export function measureAndPicture(
	source: File | string,
	extracted: ExtractedBimModel,
	options?: {
		readonly config?: BimSettingsRow | Partial<BimConfig> | null;
		readonly resolveKnownSignatures?: (
			signatures: readonly string[]
		) => Effect.Effect<ReadonlySet<string>, never>;
		readonly onProgress?: (progress: BimGeometryProgress) => void;
	}
): Effect.Effect<Takeoff, never> {
	const config = resolveBimConfig(options?.config);
	const onProgress = options?.onProgress;
	const plain = (): Takeoff => ({
		extracted: stripTransientTakeoff(extracted),
		pictures: new Map(),
		overviews: [],
		duplicates: 0,
		...(extracted.cleanup ? { cleanup: extracted.cleanup } : {})
	});
	if (extracted.archetypes.length === 0 || typeof document === 'undefined')
		return Effect.succeed(plain());

	const task = Effect.gen(function* () {
		const bytes = yield* loadSourceBytes(source);
		if (bytes === null) return plain();

		const { ifcApi, THREE } = yield* loadVisualRuntime;
		const modelID = yield* Effect.acquireRelease(
			Effect.try({
				try: () => ifcApi.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false, USE_FAST_BOOLS: true }),
				catch: (cause) => new Error(`open-ifc-model: ${messageOf(cause)}`)
			}),
			(id) => Effect.sync(() => ifcApi.CloseModel(id)).pipe(Effect.ignore)
		);

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

		const ids = extracted.buckets.flatMap((b) => b.element_ids ?? []);
		const measured = new Map<number, ElementMeasure>();
		for (let i = 0; i < ids.length; i++) {
			const id = ids[i];
			if (id === undefined) continue;
			const parts = extracted.assemblies?.[String(id)];
			const m = measureIds(parts && parts.length > 0 ? [id, ...parts] : [id]);
			if (m !== null) measured.set(id, m);
			if ((i + 1) % 500 === 0 || i + 1 === ids.length) {
				onProgress?.({ phase: 'measuring', done: i + 1, total: ids.length });
				yield* Effect.yieldNow;
			}
		}

		const cleaned = cleanupAndMeasure(extracted, measured, config);
		const allSignatures = cleaned.extracted.archetypes.flatMap((a) =>
			a.signature === undefined ? [] : [a.signature]
		);
		const alreadyPictured =
			options?.resolveKnownSignatures !== undefined && allSignatures.length > 0
				? yield* options.resolveKnownSignatures(allSignatures)
				: new Set<string>();
		const toPicture = cleaned.extracted.archetypes.filter(
			(a) => a.signature === undefined || !alreadyPictured.has(a.signature)
		);

		const emptyOverviews: readonly OverviewSpec[] = [];
		const { pictures, overviews } = yield* picture(
			ifcApi,
			THREE,
			modelID,
			cleaned.extracted,
			toPicture,
			config.max_visual_archetypes,
			onProgress
		).pipe(
			Effect.catchCause(() =>
				Effect.succeed({ pictures: new Map<string, Blob>(), overviews: emptyOverviews })
			)
		);

		return {
			extracted: stripTransientTakeoff(cleaned.extracted),
			pictures,
			overviews,
			duplicates: cleaned.duplicates,
			cleanup: cleaned.cleanup
		};
	}).pipe(Effect.scoped);

	return task.pipe(Effect.catchCause(() => Effect.succeed(plain())));
}

const OVERVIEW_MAX_STOREYS = 6;
const OVERVIEW_MAX_BUILDING_IDS = 1200;
const OVERVIEW_MAX_STOREY_IDS = 500;

function sampleIdsUniformly(ids: readonly number[], max: number): number[] {
	if (ids.length <= max) return [...ids];
	const out: number[] = [];
	const step = ids.length / max;
	for (let i = 0; i < max; i++) {
		const id = ids[Math.floor(i * step)];
		if (id !== undefined) out.push(id);
	}
	return out;
}

function selectOverviewStoreys(extracted: ExtractedBimModel): readonly string[] {
	const populated = [
		...new Set(extracted.buckets.filter((b) => b.element_count > 0).map((b) => b.storey))
	];
	if (populated.length <= OVERVIEW_MAX_STOREYS) return populated;
	const sorted = [...populated].sort(
		(a, b) => (extracted.storey_elevations?.[a] ?? 0) - (extracted.storey_elevations?.[b] ?? 0)
	);
	const picks = new Set<string>();
	const last = sorted.length - 1;
	for (let i = 0; i < OVERVIEW_MAX_STOREYS; i++) {
		const st = sorted[Math.round((i / (OVERVIEW_MAX_STOREYS - 1)) * last)];
		if (st !== undefined) picks.add(st);
	}
	return [...picks];
}

function picture(
	ifcApi: ViewerIfcApi,
	THREE: ViewerThreeModule,
	modelID: number,
	extracted: ExtractedBimModel,
	archetypes: readonly BimArchetype[],
	maxArchetypes: number,
	onProgress?: (progress: BimGeometryProgress) => void
): Effect.Effect<
	{ readonly pictures: ReadonlyMap<string, Blob>; readonly overviews: readonly OverviewSpec[] },
	Error,
	Scope.Scope
> {
	return Effect.gen(function* () {
		const targetCount = Math.min(archetypes.length, maxArchetypes);
		if (targetCount === 0 && extracted.buckets.length === 0) {
			const emptyOverviews: readonly OverviewSpec[] = [];
			return { pictures: new Map<string, Blob>(), overviews: emptyOverviews };
		}

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
			(r) => Effect.sync(() => r.dispose()).pipe(Effect.ignore)
		);
		const edgeMaterial = yield* Effect.acquireRelease(
			Effect.sync(
				() => new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.42 })
			),
			(mat) => Effect.sync(() => mat.dispose()).pipe(Effect.ignore)
		);

		const scene = new THREE.Scene();
		scene.background = new THREE.Color('#f1f5f9');
		scene.add(new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 1.05));
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

		const pictures = new Map<string, Blob>();
		const overviews: OverviewSpec[] = [];
		const sheet = document.createElement('canvas');
		sheet.width = SNAPSHOT_SIZE * 2;
		sheet.height = SNAPSHOT_SIZE * 2;
		const paint = sheet.getContext('2d');
		if (paint === null) return { pictures, overviews };

		const renderWideSheet = (
			expressIds: readonly number[],
			angles: readonly { readonly yawOffsetRad: number; readonly pitchRad: number }[]
		) =>
			Effect.gen(function* () {
				const built = buildAssetGroup(ifcApi, THREE, modelID, expressIds, edgeMaterial);
				try {
					if (built.meshCount === 0) return null;
					box.setFromObject(built.group);
					if (box.isEmpty()) return null;
					box.getCenter(center);
					box.getSize(size);
					const maxDim = Math.max(size.x, size.y, size.z);
					if (!Number.isFinite(maxDim) || maxDim <= 1e-4) return null;
					built.group.position.set(-center.x, -center.y, -center.z);
					scene.add(built.group);
					const dist = Math.max(
						maxDim * 0.9,
						((size.length() * 0.5) / Math.sin(fovRad / 2)) * 1.12
					);
					camera.near = Math.max(0.05, dist / 200);
					camera.far = Math.max(200, dist * 12);
					camera.updateProjectionMatrix();
					for (let slot = 0; slot < Math.min(4, angles.length); slot++) {
						const angle = angles[slot];
						if (!angle) continue;
						const cosPitch = Math.cos(angle.pitchRad);
						camera.position.set(
							Math.sin(angle.yawOffsetRad) * cosPitch * dist,
							Math.sin(angle.pitchRad) * dist,
							Math.cos(angle.yawOffsetRad) * cosPitch * dist
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
					return yield* Effect.callback<Blob | null>((resume) => {
						sheet.toBlob(
							(blob) => resume(Effect.succeed(blob)),
							'image/jpeg',
							SNAPSHOT_JPEG_QUALITY
						);
					});
				} finally {
					disposeBuilt(built);
				}
			});

		for (let idx = 0; idx < targetCount; idx++) {
			const arch = archetypes[idx];
			if (arch === undefined) continue;

			let built = buildAssetGroup(
				ifcApi,
				THREE,
				modelID,
				[arch.representative_express_id],
				edgeMaterial
			);
			if (built.meshCount === 0 && arch.representative_part_ids.length > 0) {
				disposeBuilt(built);
				built = buildAssetGroup(ifcApi, THREE, modelID, arch.representative_part_ids, edgeMaterial);
			}
			// Render wide-aperture neighborhood tile (slot 4) for ANY archetype with spatial or MEP neighbors!
			const wantsContext = (arch.context_neighbor_ids?.length ?? 0) > 0;

			try {
				if (built.meshCount > 0) {
					box.setFromObject(built.group);
					if (!box.isEmpty()) {
						box.getCenter(center);
						box.getSize(size);
						const maxDim = Math.max(size.x, size.y, size.z);
						if (Number.isFinite(maxDim) && maxDim > 1e-4) {
							built.group.position.set(-center.x, -center.y, -center.z);
							scene.add(built.group);
							const baseYaw = size.x < size.z * 0.65 ? Math.PI / 2 : 0;
							const dist = Math.max(
								maxDim * 0.85,
								((size.length() * 0.5) / Math.sin(fovRad / 2)) * 1.08
							);
							camera.near = Math.max(0.005, dist / 200);
							camera.far = Math.max(100, dist * 12);
							camera.updateProjectionMatrix();

							for (let slot = 0; slot < (wantsContext ? 3 : 4); slot++) {
								const angle = MULTI_ANGLE_VIEWS[slot];
								if (angle === undefined) continue;
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

							if (wantsContext && arch.context_neighbor_ids) {
								const ctxTarget = buildAssetGroup(
									ifcApi,
									THREE,
									modelID,
									[arch.representative_express_id],
									edgeMaterial,
									{
										color: '#f59e0b',
										opacity: 1
									}
								);
								const ctxNeighbors = buildAssetGroup(
									ifcApi,
									THREE,
									modelID,
									arch.context_neighbor_ids.slice(0, 10),
									edgeMaterial,
									{ color: '#64748b', opacity: 0.3 }
								);
								try {
									const ctxWrapper = new THREE.Group();
									ctxWrapper.add(ctxTarget.group);
									ctxWrapper.add(ctxNeighbors.group);
									box.setFromObject(ctxWrapper);
									if (!box.isEmpty()) {
										box.getCenter(center);
										box.getSize(size);
										const ctxMax = Math.max(size.x, size.y, size.z);
										if (Number.isFinite(ctxMax) && ctxMax > 1e-4) {
											ctxWrapper.position.set(-center.x, -center.y, -center.z);
											scene.add(ctxWrapper);
											const ctxDist = Math.max(
												ctxMax * 0.9,
												((size.length() * 0.5) / Math.sin(fovRad / 2)) * 1.1
											);
											camera.near = Math.max(0.01, ctxDist / 200);
											camera.far = Math.max(100, ctxDist * 12);
											camera.updateProjectionMatrix();
											const yaw = baseYaw + (42 * Math.PI) / 180;
											const pitch = (26 * Math.PI) / 180;
											camera.position.set(
												Math.sin(yaw) * Math.cos(pitch) * ctxDist,
												Math.sin(pitch) * ctxDist,
												Math.cos(yaw) * Math.cos(pitch) * ctxDist
											);
											camera.lookAt(0, 0, 0);
											renderer.render(scene, camera);
											paint.drawImage(renderer.domElement, SNAPSHOT_SIZE, SNAPSHOT_SIZE);
											scene.remove(ctxWrapper);
										}
									}
								} finally {
									disposeBuilt(ctxTarget);
									disposeBuilt(ctxNeighbors);
								}
							}

							const pic = yield* Effect.callback<Blob | null>((resume) => {
								sheet.toBlob(
									(blob) => resume(Effect.succeed(blob)),
									'image/jpeg',
									SNAPSHOT_JPEG_QUALITY
								);
							});
							if (pic !== null) pictures.set(arch.archetype_id, pic);
						}
					}
				}
			} finally {
				disposeBuilt(built);
			}

			onProgress?.({
				phase: 'snapshots',
				done: idx + 1,
				total: targetCount,
				captured: pictures.size
			});
			if ((idx + 1) % 4 === 0) yield* Effect.yieldNow;
		}

		// Render wide-aperture building & key storey overview 2×2 sheets for spatial semantic SOP linting
		const buildingIds = sampleIdsUniformly(
			extracted.buckets.flatMap((b) =>
				b.element_ids?.length ? b.element_ids : b.sample_express_ids
			),
			OVERVIEW_MAX_BUILDING_IDS
		);
		if (buildingIds.length > 0) {
			const bldgBlob = yield* renderWideSheet(buildingIds, MULTI_ANGLE_VIEWS);
			if (bldgBlob !== null) {
				const key = '__overview_building__';
				pictures.set(key, bldgBlob);
				overviews.push({ key, label: 'Whole Building (4-angle wide overview)', kind: 'building' });
			}
		}
		const storeyViews: readonly { readonly yawOffsetRad: number; readonly pitchRad: number }[] = [
			{ yawOffsetRad: 0, pitchRad: (86 * Math.PI) / 180 },
			{ yawOffsetRad: (38 * Math.PI) / 180, pitchRad: (48 * Math.PI) / 180 },
			{ yawOffsetRad: (142 * Math.PI) / 180, pitchRad: (48 * Math.PI) / 180 },
			{ yawOffsetRad: (225 * Math.PI) / 180, pitchRad: (35 * Math.PI) / 180 }
		];
		const targetStoreys = selectOverviewStoreys(extracted);
		for (let sIdx = 0; sIdx < targetStoreys.length; sIdx++) {
			const storey = targetStoreys[sIdx];
			if (!storey) continue;
			const stIds = sampleIdsUniformly(
				extracted.buckets
					.filter((b) => b.storey === storey)
					.flatMap((b) => (b.element_ids?.length ? b.element_ids : b.sample_express_ids)),
				OVERVIEW_MAX_STOREY_IDS
			);
			if (stIds.length === 0) continue;
			const stBlob = yield* renderWideSheet(stIds, storeyViews);
			if (stBlob !== null) {
				const key = `__overview_storey_${sIdx}__`;
				pictures.set(key, stBlob);
				overviews.push({ key, label: `Storey Plan & Cutaway: ${storey}`, kind: 'storey', storey });
			}
		}

		return { pictures, overviews };
	});
}
