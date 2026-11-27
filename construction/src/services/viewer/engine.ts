/**
 * Pure Effect controller for the 3D IFC viewer (Three.js + @thatopen/components + fragments):
 * runtime boot/disposal, two-tier cached fragment loading, anti-flicker rendering configuration,
 * section-plane clipping, camera presets/keyboard nav, focus/marker highlighting, and raycast picking.
 */
import { Effect, Schema } from 'effect';
import * as Predicate from 'effect/Predicate';
import { convertIfcToFragments, readCachedFragments, writeCachedFragments } from './converter.js';
import {
	fetchEffect,
	messageOf,
	type IFCSelectedElement,
	type IFCViewerFocus,
	type IFCViewerMarkerGroup,
	type IFCViewerPinCoords,
	type Translator,
	type ViewerColor,
	type ViewerColorConstructor,
	type ViewerComponents,
	type ViewerComponentsModule,
	type ViewerFragmentsManager,
	type ViewerFragmentsModel,
	type ViewerFragmentsModule,
	type ViewerFrontendModule,
	type ViewerHighlighter,
	type ViewerItemData,
	type ViewerThreeModule,
	type ViewerWorld
} from './types.js';

export class ViewerOperationFailed extends Schema.TaggedError<ViewerOperationFailed>()(
	'ViewerOperationFailed',
	{
		operation: Schema.String,
		message: Schema.String,
		cause: Schema.Defect()
	}
) {}

export const viewerFailure = (operation: string) => (cause: unknown) =>
	new ViewerOperationFailed({ operation, message: messageOf(cause), cause });

const viewerLibraries = Effect.cached(
	Effect.all(
		[
			Effect.tryPromise({
				try: () =>
					import(
						/* @vite-ignore */ 'https://esm.sh/@thatopen/components@3.4.6?deps=three@0.185.1,@thatopen/fragments@3.4.6,web-ifc@0.0.77,camera-controls@3.1.2'
					),
				catch: viewerFailure('load-components')
			}),
			Effect.tryPromise({
				try: () =>
					import(
						/* @vite-ignore */ 'https://esm.sh/@thatopen/components-front@3.4.3?deps=@thatopen/components@3.4.6,@thatopen/fragments@3.4.6,three@0.185.1,web-ifc@0.0.77,camera-controls@3.1.2'
					),
				catch: viewerFailure('load-components-front')
			}),
			Effect.tryPromise({
				try: () =>
					import(
						/* @vite-ignore */ 'https://esm.sh/@thatopen/fragments@3.4.6?deps=three@0.185.1,web-ifc@0.0.77'
					),
				catch: viewerFailure('load-fragments')
			}),
			Effect.tryPromise({
				try: () => import(/* @vite-ignore */ 'https://esm.sh/three@0.185.1'),
				catch: viewerFailure('load-three')
			})
		],
		{ concurrency: 'unbounded' }
	)
);

export type LoadBanner =
	'none' | 'downloading' | 'converting' | 'loading' | { readonly error: string };
export type NavMode = 'orbit' | 'pan' | 'inspect';
export type CameraPreset = 'iso' | 'top' | 'front' | 'side';
export type ModelBounds = {
	readonly minX: number;
	readonly maxX: number;
	readonly minY: number;
	readonly maxY: number;
	readonly minZ: number;
	readonly maxZ: number;
};

export type IFCViewerRuntime = {
	OBC: ViewerComponentsModule;
	OBF: ViewerFrontendModule;
	FRAGS: ViewerFragmentsModule;
	THREE: ViewerThreeModule;
	components: ViewerComponents;
	world: ViewerWorld;
	fragments: ViewerFragmentsManager;
	highlighter: ViewerHighlighter | null;
	currentGroup: ViewerFragmentsModel | null;
	markerStyleIds: string[];
	rotateAction: number;
	truckAction: number;
	touchRotateAction: number;
	touchTruckAction: number;
	onControlsRest: () => void;
};

const IFC_FETCH_TIMEOUT_MS = 120_000;
const IFC_CONVERSION_TIMEOUT_MS = 60_000;
const IFC_FRAGMENT_LOAD_TIMEOUT_MS = 120_000;
const DEFAULT_BACKGROUND_COLOR = 'var(--color-background)';
const DEFAULT_SELECTION_COLOR = 'var(--color-brand)';
const DEFAULT_MARKER_COLOR = 'var(--color-muted-foreground)';
const FOCUS_STYLE_ID = 'ui-ifc-focus';
const GHOST_STYLE_ID = 'ui-ifc-ghost';
const GHOST_OPACITY = 0.08;

export function normalizeFileUrlForSameOrigin(
	rawUrl: string,
	origin: string
): Effect.Effect<{ readonly fetchUrl: string; readonly cacheKey: string }, never> {
	return Effect.try({
		try: () => {
			const parsed = new URL(rawUrl, origin.endsWith('/') ? origin : `${origin}/`);
			if (parsed.pathname.startsWith('/api/files/')) {
				return {
					fetchUrl: `${origin.replace(/\/$/, '')}${parsed.pathname}${parsed.search}${parsed.hash}`,
					cacheKey: parsed.pathname
				};
			}
			return { fetchUrl: parsed.href, cacheKey: parsed.href };
		},
		catch: viewerFailure('normalize-model-url')
	}).pipe(Effect.catch(() => Effect.succeed({ fetchUrl: rawUrl, cacheKey: rawUrl })));
}

export function resolveCssColor(css: string): string {
	const computed = getComputedStyle(document.documentElement);
	const raw = css.startsWith('var(')
		? computed.getPropertyValue(css.slice(4, -1).trim()).trim()
		: css;
	const resolved = raw || computed.color;
	if (!resolved) return 'currentColor';
	const canvas = document.createElement('canvas');
	canvas.width = 1;
	canvas.height = 1;
	const c2d = canvas.getContext('2d');
	if (!c2d) return resolved;
	c2d.fillStyle = resolved;
	c2d.fillRect(0, 0, 1, 1);
	const [r, g, b] = c2d.getImageData(0, 0, 1, 1).data;
	return `rgb(${r}, ${g}, ${b})`;
}

export function modelGeometryInfo(bounds: ModelBounds) {
	const cx = (bounds.minX + bounds.maxX) * 0.5;
	const cy = (bounds.minY + bounds.maxY) * 0.5;
	const cz = (bounds.minZ + bounds.maxZ) * 0.5;
	const dx = bounds.maxX - bounds.minX;
	const dy = bounds.maxY - bounds.minY;
	const dz = bounds.maxZ - bounds.minZ;
	return { cx, cy, cz, dx, dy, dz, radius: Math.max(1, Math.hypot(dx, dy, dz) * 0.5) };
}

export function applyClippingPlanes(
	runtime: IFCViewerRuntime,
	bounds: ModelBounds | null,
	cutX: number,
	cutY: number,
	cutZ: number
): void {
	const renderer = runtime.world.renderer.three;
	if (!bounds || (cutX >= 100 && cutY >= 100 && cutZ >= 100)) {
		renderer.localClippingEnabled = false;
		renderer.clippingPlanes = [];
		return;
	}
	const planes = [];
	const pad = 0.05;
	if (cutX < 100) {
		planes.push(
			new runtime.THREE.Plane(
				new runtime.THREE.Vector3(-1, 0, 0),
				bounds.minX + ((bounds.maxX - bounds.minX) * cutX) / 100 + pad
			)
		);
	}
	if (cutY < 100) {
		planes.push(
			new runtime.THREE.Plane(
				new runtime.THREE.Vector3(0, -1, 0),
				bounds.minY + ((bounds.maxY - bounds.minY) * cutY) / 100 + pad
			)
		);
	}
	if (cutZ < 100) {
		planes.push(
			new runtime.THREE.Plane(
				new runtime.THREE.Vector3(0, 0, -1),
				bounds.minZ + ((bounds.maxZ - bounds.minZ) * cutZ) / 100 + pad
			)
		);
	}
	renderer.localClippingEnabled = true;
	renderer.clippingPlanes = planes;
}

export function applyNavigationControls(runtime: IFCViewerRuntime, pan: boolean): void {
	const controls = runtime.world.camera.controls;
	if (controls.mouseButtons) {
		controls.mouseButtons.left = pan ? runtime.truckAction : runtime.rotateAction;
		controls.mouseButtons.right = runtime.truckAction;
	}
	if (controls.touches) {
		controls.touches.one = pan ? runtime.touchTruckAction : runtime.touchRotateAction;
	}
}

export function tuneCameraControls(
	runtime: IFCViewerRuntime,
	bounds: ModelBounds | null,
	pan: boolean
): void {
	const controls = runtime.world.camera.controls;
	controls.dollyToCursor = true;
	controls.infinityDolly = true;
	controls.dollySpeed = 0.85;
	controls.truckSpeed = 1.8;
	controls.smoothTime = 0.12;
	controls.draggingSmoothTime = 0.08;
	if (bounds) {
		const { radius } = modelGeometryInfo(bounds);
		controls.minDistance = 0.4;
		controls.maxDistance = Math.max(radius * 10, 120);
		const cam = runtime.world.camera.three;
		if (typeof cam.updateProjectionMatrix === 'function') {
			cam.near = Math.max(0.05, radius * 0.002);
			cam.far = Math.max(radius * 25, 500);
			cam.updateProjectionMatrix();
		}
	}
	applyNavigationControls(runtime, pan);
}

export function framePresetEffect(
	runtime: IFCViewerRuntime,
	bounds: ModelBounds | null,
	preset: CameraPreset,
	transition: boolean
) {
	return Effect.gen(function* () {
		if (!bounds || !runtime.currentGroup) return;
		const controls = runtime.world.camera.controls;
		const { cx, cy, cz, radius } = modelGeometryInfo(bounds);
		const dist = Math.max(radius * 2.05, 6);
		const [px, py, pz] =
			preset === 'top'
				? [cx, cy + dist * 1.55, cz + 0.02]
				: preset === 'front'
					? [cx, cy + dist * 0.14, cz + dist * 1.35]
					: preset === 'side'
						? [cx + dist * 1.35, cy + dist * 0.14, cz]
						: [cx + dist * 0.72, cy + dist * 0.52, cz + dist * 0.82];
		yield* Effect.tryPromise({
			try: () => controls.setLookAt(px, py, pz, cx, cy, cz, transition),
			catch: viewerFailure('frame-preset')
		}).pipe(Effect.ignore);
		if (!transition) controls.update(0);
	});
}

export function zoomByEffect(
	runtime: IFCViewerRuntime,
	bounds: ModelBounds | null,
	direction: 1 | -1
) {
	const dolly = runtime.world.camera.controls.dolly;
	if (!dolly) return Effect.void;
	const radius = bounds ? modelGeometryInfo(bounds).radius : 12;
	const step = direction * Math.max(radius * 0.28, 2.5);
	return Effect.tryPromise({
		try: () => dolly.call(runtime.world.camera.controls, step, true),
		catch: viewerFailure('zoom-camera')
	}).pipe(Effect.ignore);
}

export function focusSelectedEffect(runtime: IFCViewerRuntime, pin: IFCViewerPinCoords) {
	const setTarget = runtime.world.camera.controls.setTarget;
	if (typeof setTarget !== 'function') return Effect.void;
	return Effect.tryPromise({
		try: () => setTarget.call(runtime.world.camera.controls, pin.x, pin.y, pin.z, true),
		catch: viewerFailure('focus-selected')
	}).pipe(Effect.ignore);
}

/** Keyboard WASD / Arrow / Q / E camera nudge; returns `null` when key is not a nav key. */
export function nudgeCameraEffect(
	runtime: IFCViewerRuntime,
	bounds: ModelBounds | null,
	key: string
): Effect.Effect<void, never> | null {
	const controls = runtime.world.camera.controls;
	const step = Math.max((bounds ? modelGeometryInfo(bounds).radius : 12) * 0.08, 0.8);
	const lower = key.toLowerCase();
	if (
		(lower === 'w' || key === 'ArrowUp' || lower === 's' || key === 'ArrowDown') &&
		typeof controls.dolly === 'function'
	) {
		const dolly = controls.dolly;
		const dist = lower === 'w' || key === 'ArrowUp' ? step : -step;
		return Effect.tryPromise({
			try: () => dolly.call(controls, dist, true),
			catch: () => undefined
		}).pipe(Effect.ignore);
	}
	if (typeof controls.truck !== 'function') return null;
	const truck = controls.truck;
	const delta: readonly [number, number] | null =
		lower === 'a' || key === 'ArrowLeft'
			? [-step, 0]
			: lower === 'd' || key === 'ArrowRight'
				? [step, 0]
				: lower === 'q'
					? [0, step]
					: lower === 'e'
						? [0, -step]
						: null;
	return delta
		? Effect.tryPromise({
				try: () => truck.call(controls, delta[0], delta[1], true),
				catch: () => undefined
			}).pipe(Effect.ignore)
		: null;
}

function withTimeout<T, E>(
	effect: Effect.Effect<T, E>,
	timeoutMs: number,
	t: Translator,
	label?: string
) {
	const message = t('component.ifc_operation_timed_out', {
		label: label ?? t('component.ifc_element'),
		ms: timeoutMs
	});
	return effect.pipe(
		Effect.timeoutOrElse({ duration: timeoutMs, orElse: () => Effect.fail(new Error(message)) })
	);
}

function assertIfcBodyNotHtml(
	response: Response,
	buffer: Uint8Array,
	t: Translator
): Effect.Effect<void, Error> {
	if ((response.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) {
		return Effect.fail(new Error(t('component.ifc_html_instead_of_bytes')));
	}
	const headLen = Math.min(120, buffer.length);
	if (headLen === 0) return Effect.void;
	const lower = new TextDecoder('utf-8', { fatal: false })
		.decode(buffer.subarray(0, headLen))
		.trimStart()
		.toLowerCase();
	return lower.startsWith('<!doctype html') || lower.startsWith('<html')
		? Effect.fail(new Error(t('component.ifc_html_instead_of_bytes')))
		: Effect.void;
}

function parseMarkerColor(
	css: string,
	Color: ViewerColorConstructor
): Effect.Effect<ViewerColor, ViewerOperationFailed> {
	const color = new Color();
	return Effect.try({
		try: () => color.setStyle(resolveCssColor(css.trim())),
		catch: viewerFailure('parse-marker-color')
	}).pipe(
		Effect.catch(() =>
			Effect.try({
				try: () => color.setStyle(resolveCssColor(DEFAULT_MARKER_COLOR)),
				catch: viewerFailure('parse-fallback-marker-color')
			})
		),
		Effect.as(color)
	);
}

function readPropertyValue(properties: ViewerItemData | null, key: string): string | null {
	const rawValue = properties?.[key];
	if (rawValue == null || Array.isArray(rawValue)) return null;
	return Predicate.isString(rawValue.value) || Predicate.isNumber(rawValue.value)
		? String(rawValue.value)
		: null;
}

function clearMarkerVisualization(runtime: IFCViewerRuntime) {
	return Effect.suspend(() => {
		const hl = runtime.highlighter;
		const cleared =
			hl === null
				? Effect.void
				: Effect.forEach(runtime.markerStyleIds, (styleId) =>
						Effect.tryPromise({
							try: () => hl.clear(styleId),
							catch: viewerFailure('clear-marker-style')
						}).pipe(Effect.andThen(() => Effect.sync(() => hl.styles.delete(styleId))))
					);
		return Effect.andThen(
			cleared,
			Effect.sync(() => {
				runtime.markerStyleIds = [];
			})
		);
	});
}

export function clearSelectionEffect(runtime: IFCViewerRuntime) {
	const hl = runtime.highlighter;
	return hl
		? Effect.tryPromise({
				try: () => hl.clear('select'),
				catch: viewerFailure('clear-selection')
			}).pipe(Effect.ignore)
		: Effect.void;
}

export function clearModel(runtime: IFCViewerRuntime) {
	return Effect.gen(function* () {
		yield* clearMarkerVisualization(runtime);
		const hl = runtime.highlighter;
		if (hl !== null) {
			yield* Effect.forEach(['select', GHOST_STYLE_ID, FOCUS_STYLE_ID], (id) =>
				Effect.tryPromise({
					try: () => hl.clear(id),
					catch: viewerFailure('clear-highlight')
				}).pipe(Effect.ignore)
			);
		}
		const group = runtime.currentGroup;
		if (group == null) return;
		runtime.world.scene.three.remove(group.object);
		yield* Effect.tryPromise({
			try: () => runtime.fragments.core.disposeModel(group.modelId),
			catch: viewerFailure('dispose-model')
		});
		runtime.currentGroup = null;
	});
}

export function createViewerRuntime(container: HTMLDivElement, pan: boolean) {
	return Effect.gen(function* () {
		const cachedLibraries = yield* viewerLibraries;
		const [OBC, OBF, FRAGS, THREE] = yield* cachedLibraries;
		const components = new OBC.Components();
		return yield* Effect.gen(function* () {
			const world = components.get(OBC.Worlds).create();
			world.scene = new OBC.SimpleScene(components);
			world.scene.setup();
			world.scene.three.background = new THREE.Color(resolveCssColor(DEFAULT_BACKGROUND_COLOR));
			world.renderer = new OBC.SimpleRenderer(components, container, {
				logarithmicDepthBuffer: true,
				antialias: true
			});
			world.renderer.showLogo = false;
			world.camera = new OBC.SimpleCamera(components);
			components.init();
			const fragments = components.get(OBC.FragmentsManager);
			const worker = yield* Effect.tryPromise({
				try: () => OBC.FragmentsManager.getWorker(),
				catch: viewerFailure('load-fragments-worker')
			});
			yield* Effect.sync(() => {
				fragments.init(worker);
				fragments.core.models?.materials?.list?.onItemSet?.add(({ value }) => {
					if (value && !value.isLODMaterial) {
						value.polygonOffset = true;
						value.polygonOffsetFactor = 1;
						value.polygonOffsetUnits = 1;
						value.needsUpdate = true;
					}
				});
			});
			const controls = world.camera.controls;
			const onControlsRest = () => {
				void fragments.core.update?.(true);
			};
			controls.addEventListener?.('rest', onControlsRest);
			const runtime: IFCViewerRuntime = {
				OBC,
				OBF,
				FRAGS,
				THREE,
				components,
				world,
				fragments,
				highlighter: null,
				currentGroup: null,
				markerStyleIds: [],
				rotateAction: controls.mouseButtons?.left ?? 1,
				truckAction: controls.mouseButtons?.right ?? 2,
				touchRotateAction: controls.touches?.one ?? 64,
				touchTruckAction: 128,
				onControlsRest
			};
			tuneCameraControls(runtime, null, pan);
			return runtime;
		}).pipe(Effect.onError(() => Effect.sync(() => components.dispose())));
	});
}

export function ensureInteractionSystems(runtime: IFCViewerRuntime): ViewerHighlighter {
	if (runtime.highlighter !== null) return runtime.highlighter;
	const { OBC, OBF, THREE, components, world } = runtime;
	components.get(OBC.Raycasters).get(world);
	const hl = components.get(OBF.Highlighter);
	hl.setup({
		world,
		autoHighlightOnClick: false,
		selectionColor: new THREE.Color(resolveCssColor(DEFAULT_SELECTION_COLOR))
	});
	hl.multiple = 'none';
	hl.zoomToSelection = false;
	runtime.highlighter = hl;
	return hl;
}

export function disposeRuntime(runtime: IFCViewerRuntime) {
	return clearModel(runtime).pipe(
		Effect.ensuring(
			Effect.sync(() => {
				runtime.world.camera.controls.removeEventListener?.('rest', runtime.onControlsRest);
				runtime.components.dispose();
			})
		)
	);
}

export function resolveFragmentBytes(
	fetchUrl: string,
	cacheKey: string,
	exclude: readonly string[],
	t: Translator,
	onBanner: (banner: LoadBanner) => void
) {
	return Effect.gen(function* () {
		const cached = yield* readCachedFragments(cacheKey);
		if (cached !== null) {
			onBanner('loading');
			return cached;
		}
		onBanner('downloading');
		const response = yield* fetchEffect(fetchUrl, 'load-ifc-model').pipe(
			Effect.timeoutOrElse({
				duration: IFC_FETCH_TIMEOUT_MS,
				orElse: () => Effect.fail(new Error(t('component.ifc_download_timed_out')))
			})
		);
		if (!response.ok)
			return yield* Effect.fail(
				new Error(t('component.ifc_download_failed', { status: response.status }))
			);
		const buffer = new Uint8Array(
			yield* Effect.tryPromise({
				try: () => response.arrayBuffer(),
				catch: viewerFailure('read-model-bytes')
			})
		);
		yield* assertIfcBodyNotHtml(response, buffer, t);
		onBanner('converting');
		const fragmentBytes = yield* withTimeout(
			convertIfcToFragments(buffer, t, exclude),
			IFC_CONVERSION_TIMEOUT_MS,
			t,
			t('component.ifc_conversion')
		);
		yield* writeCachedFragments(cacheKey, fragmentBytes);
		return fragmentBytes;
	});
}

export function loadFragmentsIntoRuntime(
	runtime: IFCViewerRuntime,
	fetchUrl: string,
	fragmentBytes: Uint8Array,
	t: Translator,
	pan: boolean,
	cutX: number,
	cutY: number,
	cutZ: number
) {
	return Effect.gen(function* () {
		const modelName = yield* Effect.try({
			try: () =>
				new URL(fetchUrl, window.location.href).pathname.split('/').pop()?.trim() ??
				'ifc-model.ifc',
			catch: viewerFailure('read-model-name')
		}).pipe(Effect.catch(() => Effect.succeed('ifc-model.ifc')));

		const group = yield* withTimeout(
			Effect.tryPromise({
				try: () =>
					runtime.fragments.core.load(fragmentBytes, {
						modelId: modelName,
						camera: runtime.world.camera.three
					}),
				catch: viewerFailure('load-model-fragments')
			}).pipe(Effect.uninterruptible),
			IFC_FRAGMENT_LOAD_TIMEOUT_MS,
			t,
			t('component.ifc_fragment_load')
		);
		const bounds: ModelBounds = {
			minX: group.box.min.x,
			maxX: group.box.max.x,
			minY: group.box.min.y,
			maxY: group.box.max.y,
			minZ: group.box.min.z,
			maxZ: group.box.max.z
		};
		yield* Effect.sync(() => {
			runtime.world.scene.three.add(group.object);
			runtime.currentGroup = group;
			tuneCameraControls(runtime, bounds, pan);
			applyClippingPlanes(runtime, bounds, cutX, cutY, cutZ);
		});
		yield* framePresetEffect(runtime, bounds, 'iso', false).pipe(Effect.uninterruptible);
		return bounds;
	});
}

export function syncMarkerVisualizationEffect(
	runtime: IFCViewerRuntime,
	opts: {
		readonly focus: IFCViewerFocus | null;
		readonly focusKey: string;
		readonly framedFocusKey: string;
		readonly markers: readonly number[];
		readonly markerGroups: readonly IFCViewerMarkerGroup[];
	}
) {
	return Effect.gen(function* () {
		const group = runtime.currentGroup;
		if (!group) return opts.framedFocusKey;
		const needsInteraction =
			runtime.markerStyleIds.length > 0 ||
			opts.markerGroups.length > 0 ||
			opts.markers.length > 0 ||
			opts.focus !== null;
		if (needsInteraction) ensureInteractionSystems(runtime);
		yield* clearMarkerVisualization(runtime);
		const hl = runtime.highlighter;
		if (hl === null) return opts.framedFocusKey;

		if (opts.focus !== null) {
			const zoom = opts.framedFocusKey !== opts.focusKey;
			const inFocus = new Set(opts.focus.expressIds);
			const rest = (yield* Effect.tryPromise({
				try: () => group.getItemsIdsWithGeometry(),
				catch: viewerFailure('read-model-items')
			})).filter((id) => !inFocus.has(id));
			yield* Effect.sync(() => {
				hl.styles.set(GHOST_STYLE_ID, {
					color: new runtime.THREE.Color(resolveCssColor(DEFAULT_MARKER_COLOR)),
					opacity: GHOST_OPACITY,
					transparent: true,
					depthWrite: false,
					renderedFaces: runtime.FRAGS.RenderedFaces.ONE
				});
				hl.styles.set(FOCUS_STYLE_ID, {
					color: new runtime.THREE.Color(resolveCssColor(DEFAULT_SELECTION_COLOR)),
					opacity: 1,
					transparent: false,
					renderedFaces: runtime.FRAGS.RenderedFaces.ONE
				});
			});
			yield* Effect.tryPromise({
				try: () =>
					hl.highlightByID(GHOST_STYLE_ID, { [group.modelId]: new Set(rest) }, true, false),
				catch: viewerFailure('ghost-model')
			});
			yield* Effect.tryPromise({
				try: () => hl.highlightByID(FOCUS_STYLE_ID, { [group.modelId]: inFocus }, true, zoom),
				catch: viewerFailure('focus-elements')
			});
			return opts.focusKey;
		}
		if (opts.markerGroups.length > 0) {
			yield* Effect.forEach(opts.markerGroups, (markerGroup, index) =>
				Effect.gen(function* () {
					const styleId = `ui-ifc-marker-${index}`;
					const color = yield* parseMarkerColor(markerGroup.color, runtime.THREE.Color);
					yield* Effect.sync(() => {
						hl.styles.set(styleId, {
							color,
							opacity: 1,
							transparent: false,
							renderedFaces: runtime.FRAGS.RenderedFaces.ONE
						});
						runtime.markerStyleIds.push(styleId);
					});
					yield* Effect.tryPromise({
						try: () =>
							hl.highlightByID(
								styleId,
								{ [group.modelId]: new Set(markerGroup.expressIds) },
								true,
								false
							),
						catch: viewerFailure('highlight-marker-group')
					});
				})
			);
			return opts.framedFocusKey;
		}
		if (opts.markers.length > 0) {
			const styleId = 'ui-ifc-markers';
			yield* Effect.sync(() => {
				hl.styles.set(styleId, {
					color: new runtime.THREE.Color(resolveCssColor(DEFAULT_SELECTION_COLOR)),
					opacity: 1,
					transparent: false,
					renderedFaces: runtime.FRAGS.RenderedFaces.ONE
				});
				runtime.markerStyleIds.push(styleId);
			});
			yield* Effect.tryPromise({
				try: () =>
					hl.highlightByID(styleId, { [group.modelId]: new Set(opts.markers) }, true, false),
				catch: viewerFailure('highlight-markers')
			});
		}
		return opts.framedFocusKey;
	});
}

export function showWholeModelEffect(runtime: IFCViewerRuntime, bounds: ModelBounds | null) {
	return Effect.gen(function* () {
		if (!runtime.currentGroup) return;
		yield* framePresetEffect(runtime, bounds, 'iso', true);
		const hl = runtime.highlighter;
		if (hl !== null) {
			yield* Effect.forEach([GHOST_STYLE_ID, FOCUS_STYLE_ID], (id) =>
				Effect.tryPromise({ try: () => hl.clear(id), catch: viewerFailure('clear-focus') }).pipe(
					Effect.ignore
				)
			);
		}
	});
}

export function pickElementEffect(
	runtime: IFCViewerRuntime,
	t: Translator
): Effect.Effect<IFCSelectedElement | null, ViewerOperationFailed> {
	return Effect.gen(function* () {
		const group = runtime.currentGroup;
		if (!group) return null;
		const hl = ensureInteractionSystems(runtime);
		yield* Effect.tryPromise({
			try: () => hl.highlight('select', true, false),
			catch: viewerFailure('select-model-item')
		});
		const selection = hl.selection.select;
		const modelId = Object.keys(selection)[0];
		const id = modelId ? selection[modelId]?.values().next().value : undefined;
		if (modelId == null || id == null) return null;

		const raycaster = runtime.components.get(runtime.OBC.Raycasters).get(runtime.world);
		const castRay = raycaster.castRay;
		const hit =
			typeof castRay === 'function'
				? yield* Effect.tryPromise({
						try: () => castRay.call(raycaster),
						catch: viewerFailure('cast-pin-ray')
					}).pipe(Effect.catch(() => Effect.succeed(null)))
				: null;
		const fallback = new runtime.THREE.Vector3(0, 0, 0);
		group.box.getCenter(fallback);
		const point = hit?.point ?? fallback;
		const camPos = runtime.world.camera.three.position;
		const r3 = (n: number) => Math.round(n * 1000) / 1000;
		const pin: IFCViewerPinCoords = {
			x: r3(point.x),
			y: r3(point.y),
			z: r3(point.z),
			camera_x: r3(camPos.x),
			camera_y: r3(camPos.y),
			camera_z: r3(camPos.z)
		};

		const selectedModel = runtime.fragments.list.get(modelId);
		const properties = selectedModel
			? ((yield* Effect.tryPromise({
					try: () => selectedModel.getItemsData([id]),
					catch: viewerFailure('read-item-properties')
				}))[0] ?? null)
			: null;

		const name = readPropertyValue(properties, 'Name');
		const entityType = readPropertyValue(properties, 'type');
		return {
			expressId: id,
			globalId: readPropertyValue(properties, 'GlobalId'),
			title: name ?? entityType ?? t('component.ifc_element'),
			subtitle: name == null ? null : entityType,
			pin,
			properties: Object.keys(properties ?? {}).flatMap((key) => {
				const value =
					key.startsWith('_') || key === 'GlobalId' ? null : readPropertyValue(properties, key);
				return value == null ? [] : [{ name: key, value }];
			})
		};
	});
}
