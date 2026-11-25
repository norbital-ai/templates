<script lang="ts">
	import { Effect, Schema } from 'effect';
	import { Badge, Button, Icon, Image, Spinner, Surface, cn, enum_text } from '@norbital-ai/ui';
	import { attach, fork, run } from '@norbital-ai/ui/effect';
	import { Bound, Grid, Imposter, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import {
		create_disclosure,
		create_slider,
		create_switch,
		create_toggle_group,
		register_control,
		watch
	} from '@norbital-ai/ui/behaviors';
	import {
		convertIfcToFragments,
		readCachedFragments,
		writeCachedFragments
	} from './ifc_viewer.converter.js';
	import {
		type IFCSelectedElement,
		type IFCViewerIssueSummary,
		type IFCViewerMarkerGroup,
		type IFCViewerPinCoords,
		type IFCViewerProps,
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
		type ViewerWorld,
		fetchEffect,
		messageOf
	} from './ifc_viewer.types.js';
	import * as Predicate from 'effect/Predicate';

	class ViewerOperationFailed extends Schema.TaggedError<ViewerOperationFailed>()(
		'ViewerOperationFailed',
		{
			operation: Schema.String,
			message: Schema.String,
			cause: Schema.Defect()
		}
	) {}
	const viewerFailure = (operation: string) => (cause: unknown) =>
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

	function normalizeFileUrlForSameOrigin(
		rawUrl: string,
		origin: string
	): Effect.Effect<{ readonly fetchUrl: string; readonly cacheKey: string }, never> {
		return Effect.try({
			try: () => {
				const base = origin.endsWith('/') ? origin : `${origin}/`;
				const parsed = new URL(rawUrl, base);
				if (parsed.pathname.startsWith('/api/files/')) {
					const originRoot = origin.replace(/\/$/, '');
					return {
						fetchUrl: `${originRoot}${parsed.pathname}${parsed.search}${parsed.hash}`,
						cacheKey: parsed.pathname
					};
				}
				return { fetchUrl: parsed.href, cacheKey: parsed.href };
			},
			catch: viewerFailure('normalize-model-url')
		}).pipe(Effect.catch(() => Effect.succeed({ fetchUrl: rawUrl, cacheKey: rawUrl })));
	}

	type LoadBanner = 'none' | 'downloading' | 'converting' | 'loading' | { readonly error: string };
	type NavMode = 'orbit' | 'pan' | 'inspect';
	type CameraPreset = 'iso' | 'top' | 'front' | 'side';

	type ModelBounds = {
		readonly minX: number;
		readonly maxX: number;
		readonly minY: number;
		readonly maxY: number;
		readonly minZ: number;
		readonly maxZ: number;
	};

	type IFCViewerRuntime = {
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
	};

	const IFC_FETCH_TIMEOUT_MS = 120000;
	const IFC_CONVERSION_TIMEOUT_MS = 60000;
	const IFC_FRAGMENT_LOAD_TIMEOUT_MS = 120000;
	const PICK_DRAG_THRESHOLD_PX = 5;
	const DEFAULT_BACKGROUND_COLOR = 'var(--color-background)';
	const DEFAULT_SELECTION_COLOR = 'var(--color-brand)';
	const DEFAULT_MARKER_COLOR = 'var(--color-muted-foreground)';
	const FOCUS_STYLE_ID = 'ui-ifc-issue-focus';

	function resolveCssColor(css: string): string {
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

	interface Props extends IFCViewerProps {}
	let {
		t,
		translateKey,
		src,
		alt,
		markers = [],
		markerGroups,
		issues = [],
		focusIssue = null,
		onClearFocus,
		onTagIssue,
		onOpenIssue,
		onReplaceModel
	}: Props = $props();

	const trimmedSrc = $derived(src?.trim() ?? '');
	const markerKey = $derived(markers.join(','));
	const normalizedMarkerGroups = $derived.by(() => {
		if (!markerGroups?.length) return [];
		return markerGroups
			.map((group: IFCViewerMarkerGroup) => ({
				label: group.label,
				color: group.color,
				expressIds: group.expressIds
			}))
			.filter((group) => group.expressIds.length > 0);
	});
	const markerGroupsKey = $derived(JSON.stringify(normalizedMarkerGroups));

	let selectedItem = $state<IFCSelectedElement | null>(null);
	let loadBanner = $state<LoadBanner>('none');
	let interactionLocked = $state(false);
	let navMode = $state<NavMode>('orbit');
	let shiftPanning = $state(false);
	let propertiesOpen = $state(false);
	let sectionPanelOpen = $state(false);
	let modelBounds = $state<ModelBounds | null>(null);
	let cutX = $state(100);
	let cutY = $state(100);
	let cutZ = $state(100);
	let viewer = $state.raw<IFCViewerRuntime | null>(null);
	let markerSyncFrame = $state.raw(0);
	let pointerDown = $state.raw<{
		readonly x: number;
		readonly y: number;
		readonly button: number;
	} | null>(null);

	const selectedElementIssues = $derived.by(() => {
		if (!selectedItem) return [];
		return issues.filter((issue) => issue.expressId === selectedItem?.expressId);
	});
	const sectionActive = $derived(cutX < 100 || cutY < 100 || cutZ < 100);
	const effectivePan = $derived(navMode === 'pan' || shiftPanning);

	const loadingMessage = $derived.by(() => {
		if (loadBanner === 'downloading') return t('component.downloading_ifc_model');
		if (loadBanner === 'converting') return t('component.converting_ifc_model');
		if (loadBanner === 'loading') return t('component.loading_ifc_model');
		return '';
	});

	const canvasCursorClass = $derived(
		interactionLocked
			? 'cursor-default touch-pan-y'
			: effectivePan
				? 'cursor-move touch-none'
				: navMode === 'inspect'
					? 'cursor-crosshair touch-none'
					: 'cursor-grab active:cursor-grabbing touch-none'
	);

	function modelGeometryInfo(bounds: ModelBounds) {
		const cx = (bounds.minX + bounds.maxX) * 0.5;
		const cy = (bounds.minY + bounds.maxY) * 0.5;
		const cz = (bounds.minZ + bounds.maxZ) * 0.5;
		const dx = bounds.maxX - bounds.minX;
		const dy = bounds.maxY - bounds.minY;
		const dz = bounds.maxZ - bounds.minZ;
		const radius = Math.max(1, Math.hypot(dx, dy, dz) * 0.5);
		return { cx, cy, cz, dx, dy, dz, radius };
	}

	function resetAxes(): void {
		cutX = 100;
		cutY = 100;
		cutZ = 100;
	}

	function applyClippingPlanes(runtime: IFCViewerRuntime): void {
		const bounds = modelBounds;
		const renderer = runtime.world.renderer.three;
		if (!bounds || (cutX >= 100 && cutY >= 100 && cutZ >= 100)) {
			renderer.localClippingEnabled = false;
			renderer.clippingPlanes = [];
			return;
		}
		const planes = [];
		const pad = 0.05;
		if (cutX < 100) {
			const val = bounds.minX + ((bounds.maxX - bounds.minX) * cutX) / 100 + pad;
			planes.push(new runtime.THREE.Plane(new runtime.THREE.Vector3(-1, 0, 0), val));
		}
		if (cutY < 100) {
			const val = bounds.minY + ((bounds.maxY - bounds.minY) * cutY) / 100 + pad;
			planes.push(new runtime.THREE.Plane(new runtime.THREE.Vector3(0, -1, 0), val));
		}
		if (cutZ < 100) {
			const val = bounds.minZ + ((bounds.maxZ - bounds.minZ) * cutZ) / 100 + pad;
			planes.push(new runtime.THREE.Plane(new runtime.THREE.Vector3(0, 0, -1), val));
		}
		renderer.localClippingEnabled = true;
		renderer.clippingPlanes = planes;
	}

	function applyNavigationControls(runtime: IFCViewerRuntime): void {
		const controls = runtime.world.camera.controls;
		const pan = navMode === 'pan' || shiftPanning;
		if (controls.mouseButtons) {
			controls.mouseButtons.left = pan ? runtime.truckAction : runtime.rotateAction;
			controls.mouseButtons.right = runtime.truckAction;
		}
		if (controls.touches) {
			controls.touches.one = pan ? runtime.touchTruckAction : runtime.touchRotateAction;
		}
	}

	function tuneCameraControls(runtime: IFCViewerRuntime, bounds: ModelBounds | null): void {
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
		}
		applyNavigationControls(runtime);
	}

	function framePresetEffect(runtime: IFCViewerRuntime, preset: CameraPreset, transition: boolean) {
		return Effect.gen(function* () {
			const bounds = modelBounds;
			const group = runtime.currentGroup;
			const controls = runtime.world.camera.controls;
			if (!bounds || !group) return;
			const { cx, cy, cz, radius } = modelGeometryInfo(bounds);
			const dist = Math.max(radius * 2.05, 6);
			let px = cx + dist * 0.72;
			let py = cy + dist * 0.52;
			let pz = cz + dist * 0.82;
			if (preset === 'top') {
				px = cx;
				py = cy + dist * 1.55;
				pz = cz + 0.02;
			} else if (preset === 'front') {
				px = cx;
				py = cy + dist * 0.14;
				pz = cz + dist * 1.35;
			} else if (preset === 'side') {
				px = cx + dist * 1.35;
				py = cy + dist * 0.14;
				pz = cz;
			}
			yield* Effect.tryPromise({
				try: () => controls.setLookAt(px, py, pz, cx, cy, cz, transition),
				catch: viewerFailure('frame-preset')
			}).pipe(Effect.ignore);
			if (!transition) controls.update(0);
		});
	}

	function framePreset(preset: CameraPreset): void {
		const runtime = viewer;
		if (!runtime) return;
		fork(framePresetEffect(runtime, preset, true), () => {});
	}

	function refitModel(): void {
		framePreset('iso');
	}

	function zoomBy(direction: 1 | -1): void {
		const runtime = viewer;
		if (!runtime?.world.camera.controls.dolly) return;
		const radius = modelBounds ? modelGeometryInfo(modelBounds).radius : 12;
		const step = direction * Math.max(radius * 0.28, 2.5);
		const dolly = runtime.world.camera.controls.dolly;
		fork(
			Effect.tryPromise({
				try: () => dolly.call(runtime.world.camera.controls, step, true),
				catch: viewerFailure('zoom-camera')
			}).pipe(Effect.ignore),
			() => {}
		);
	}

	function focusSelected(): void {
		const runtime = viewer;
		const pin = selectedItem?.pin;
		if (!runtime || !pin) return;
		const controls = runtime.world.camera.controls;
		if (typeof controls.setTarget === 'function') {
			const setTarget = controls.setTarget;
			fork(
				Effect.tryPromise({
					try: () => setTarget.call(controls, pin.x, pin.y, pin.z, true),
					catch: viewerFailure('focus-selected')
				}).pipe(Effect.ignore),
				() => {}
			);
		}
	}

	function fetchIfcModelResponse(url: string) {
		return fetchEffect(url, 'load-ifc-model').pipe(
			Effect.timeoutOrElse({
				duration: IFC_FETCH_TIMEOUT_MS,
				orElse: () => Effect.fail(new Error(t('component.ifc_download_timed_out')))
			})
		);
	}

	function assertIfcBodyNotHtml(
		response: Response,
		buffer: Uint8Array
	): Effect.Effect<void, Error> {
		const contentType = response.headers.get('content-type') ?? '';
		if (contentType.toLowerCase().includes('text/html')) {
			return Effect.fail(new Error(t('component.ifc_html_instead_of_bytes')));
		}
		const headLen = Math.min(120, buffer.length);
		if (headLen === 0) return Effect.void;
		const head = new TextDecoder('utf-8', { fatal: false }).decode(buffer.subarray(0, headLen));
		const lower = head.trimStart().toLowerCase();
		if (lower.startsWith('<!doctype html') || lower.startsWith('<html')) {
			return Effect.fail(new Error(t('component.ifc_html_instead_of_bytes')));
		}
		return Effect.void;
	}

	function withTimeout<T, E>(
		effect: Effect.Effect<T, E>,
		timeoutMs: number,
		label?: string
	): Effect.Effect<T, E | Error> {
		const message = t('component.ifc_operation_timed_out', {
			label: label ?? t('component.ifc_element'),
			ms: timeoutMs
		});
		return effect.pipe(
			Effect.timeoutOrElse({
				duration: timeoutMs,
				orElse: () => Effect.fail(new Error(message))
			})
		);
	}

	function getModelName(url: string): Effect.Effect<string, never> {
		return Effect.try({
			try: () => new URL(url, window.location.href),
			catch: viewerFailure('read-model-name')
		}).pipe(
			Effect.map((parsed) => parsed.pathname.split('/').pop()?.trim() ?? 'ifc-model.ifc'),
			Effect.catch(() => Effect.succeed('ifc-model.ifc'))
		);
	}

	function resetSelectionState(): void {
		propertiesOpen = false;
		selectedItem = null;
	}

	function clearSelection(): void {
		resetSelectionState();
		if (focusIssue) onClearFocus?.();
		const highlighter = viewer?.highlighter;
		if (highlighter) {
			void run(
				Effect.tryPromise({
					try: () => highlighter.clear('select'),
					catch: viewerFailure('clear-selection')
				}).pipe(Effect.ignore)
			);
		}
	}

	function applyInteractionLock(runtime: IFCViewerRuntime, locked: boolean): void {
		runtime.world.camera.enabled = !locked;
	}

	function toggleInteractionLock(): void {
		interactionLocked = !interactionLocked;
	}

	function cancelScheduledMarkerVisualization(): void {
		if (markerSyncFrame === 0 || typeof globalThis.cancelAnimationFrame !== 'function') return;
		cancelAnimationFrame(markerSyncFrame);
		markerSyncFrame = 0;
	}

	function scheduleMarkerVisualization(): void {
		if (typeof globalThis.requestAnimationFrame !== 'function') {
			fork(syncMarkerVisualization(), (failure) => {
				loadBanner = { error: messageOf(failure) };
			});
			return;
		}
		cancelScheduledMarkerVisualization();
		markerSyncFrame = requestAnimationFrame(() => {
			markerSyncFrame = 0;
			fork(syncMarkerVisualization(), (failure) => {
				loadBanner = { error: messageOf(failure) };
			});
		});
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
		if (properties == null) return null;
		const rawValue = properties[key];
		if (rawValue == null || Array.isArray(rawValue)) return null;
		if (Predicate.isString(rawValue.value) || Predicate.isNumber(rawValue.value)) {
			return String(rawValue.value);
		}
		return null;
	}

	function buildSelectedItem(
		expressId: number,
		properties: ViewerItemData | null,
		pin: IFCViewerPinCoords | null
	): IFCSelectedElement {
		const name = readPropertyValue(properties, 'Name');
		const entityType = readPropertyValue(properties, 'type');
		const globalId = readPropertyValue(properties, 'GlobalId');
		return {
			expressId,
			globalId,
			title: name ?? entityType ?? t('component.ifc_element'),
			subtitle: name == null ? null : entityType,
			pin,
			properties: Object.keys(properties ?? {}).flatMap((key) => {
				const value =
					key.startsWith('_') || key === 'GlobalId' ? null : readPropertyValue(properties, key);
				return value == null ? [] : [{ name: key, value }];
			})
		};
	}

	function clearMarkerVisualization(runtime: IFCViewerRuntime) {
		return Effect.suspend(() => {
			const highlighter = runtime.highlighter;
			const cleared =
				highlighter === null
					? Effect.void
					: Effect.forEach(runtime.markerStyleIds, (styleId) =>
							Effect.tryPromise({
								try: () => highlighter.clear(styleId),
								catch: viewerFailure('clear-marker-style')
							}).pipe(Effect.andThen(() => Effect.sync(() => highlighter.styles.delete(styleId))))
						);
			return Effect.andThen(
				cleared,
				Effect.sync(() => {
					runtime.markerStyleIds = [];
				})
			);
		});
	}

	function clearModel(runtime: IFCViewerRuntime) {
		return Effect.gen(function* () {
			yield* clearMarkerVisualization(runtime);
			const highlighter = runtime.highlighter;
			if (highlighter !== null) {
				yield* Effect.tryPromise({
					try: () => highlighter.clear('select'),
					catch: viewerFailure('clear-selection')
				}).pipe(Effect.ignore);
				yield* Effect.tryPromise({
					try: () => highlighter.clear(FOCUS_STYLE_ID),
					catch: viewerFailure('clear-focus')
				}).pipe(Effect.ignore);
			}
			const group = runtime.currentGroup;
			if (group == null) return;
			runtime.world.scene.three.remove(group.object);
			yield* Effect.tryPromise({
				try: () => runtime.fragments.core.disposeModel(group.modelId),
				catch: viewerFailure('dispose-model')
			});
			runtime.currentGroup = null;
			modelBounds = null;
		});
	}

	function createViewerRuntime(container: HTMLDivElement) {
		return Effect.gen(function* () {
			const cachedLibraries = yield* viewerLibraries;
			const [OBC, OBF, FRAGS, THREE] = yield* cachedLibraries;
			const components = new OBC.Components();
			return yield* Effect.gen(function* () {
				const worlds = components.get(OBC.Worlds);
				const world = worlds.create();
				world.scene = new OBC.SimpleScene(components);
				world.scene.setup();
				world.scene.three.background = new THREE.Color(resolveCssColor(DEFAULT_BACKGROUND_COLOR));
				world.renderer = new OBC.SimpleRenderer(components, container);
				world.camera = new OBC.SimpleCamera(components);
				components.init();
				const fragments = components.get(OBC.FragmentsManager);
				const worker = yield* Effect.tryPromise({
					try: () => OBC.FragmentsManager.getWorker(),
					catch: viewerFailure('load-fragments-worker')
				});
				yield* Effect.sync(() => fragments.init(worker));
				const controls = world.camera.controls;
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
					touchTruckAction: 128
				};
				tuneCameraControls(runtime, null);
				return runtime;
			}).pipe(Effect.onError(() => Effect.sync(() => components.dispose())));
		});
	}

	function ensureInteractionSystems(runtime: IFCViewerRuntime): ViewerHighlighter {
		if (runtime.highlighter !== null) return runtime.highlighter;
		const { OBC, OBF, THREE, components, world } = runtime;
		components.get(OBC.Raycasters).get(world);
		const highlighter = components.get(OBF.Highlighter);
		highlighter.setup({
			world,
			autoHighlightOnClick: false,
			selectionColor: new THREE.Color(resolveCssColor(DEFAULT_SELECTION_COLOR))
		});
		highlighter.multiple = 'none';
		highlighter.zoomToSelection = false;
		runtime.highlighter = highlighter;
		return highlighter;
	}

	function disposeRuntime(runtime: IFCViewerRuntime) {
		return clearModel(runtime).pipe(
			Effect.ensuring(Effect.sync(() => runtime.components.dispose()))
		);
	}

	function resolveFragmentBytes(fetchUrl: string, cacheKey: string) {
		return Effect.gen(function* () {
			const cached = yield* readCachedFragments(cacheKey);
			if (cached !== null) {
				loadBanner = 'loading';
				return cached;
			}
			loadBanner = 'downloading';
			const response = yield* fetchIfcModelResponse(fetchUrl);
			if (!response.ok) {
				return yield* Effect.fail(
					new Error(t('component.ifc_download_failed', { status: response.status }))
				);
			}
			const arrayBuffer = yield* Effect.tryPromise({
				try: () => response.arrayBuffer(),
				catch: viewerFailure('read-model-bytes')
			});
			const buffer = new Uint8Array(arrayBuffer);
			yield* assertIfcBodyNotHtml(response, buffer);
			loadBanner = 'converting';
			const fragmentBytes = yield* withTimeout(
				convertIfcToFragments(buffer, t),
				IFC_CONVERSION_TIMEOUT_MS,
				t('component.ifc_conversion')
			);
			yield* writeCachedFragments(cacheKey, fragmentBytes);
			return fragmentBytes;
		});
	}

	function loadFragmentsIntoRuntime(
		runtime: IFCViewerRuntime,
		fetchUrl: string,
		fragmentBytes: Uint8Array
	) {
		return Effect.gen(function* () {
			loadBanner = 'loading';
			const modelName = yield* getModelName(fetchUrl);
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
				t('component.ifc_fragment_load')
			);
			const nextBounds: ModelBounds = {
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
				modelBounds = nextBounds;
				tuneCameraControls(runtime, nextBounds);
				applyClippingPlanes(runtime);
			});
			yield* framePresetEffect(runtime, 'iso', false).pipe(Effect.uninterruptible);
		});
	}

	function viewerAttachment(url: string) {
		return attach((node: HTMLDivElement) => {
			return Effect.gen(function* () {
				if (!url) {
					cancelScheduledMarkerVisualization();
					resetSelectionState();
					viewer = null;
					modelBounds = null;
					loadBanner = 'none';
					return;
				}
				loadBanner = 'loading';
				const { fetchUrl, cacheKey } = yield* normalizeFileUrlForSameOrigin(
					url,
					window.location.origin
				);
				// Parallelize Three/OBC runtime boot and client-cached/fetched fragment conversion
				const [runtime, fragmentBytes] = yield* Effect.all(
					[
						Effect.acquireRelease(createViewerRuntime(node), (rt) =>
							Effect.gen(function* () {
								if (viewer === rt) {
									viewer = null;
									resetSelectionState();
								}
								yield* disposeRuntime(rt).pipe(Effect.ignore);
							})
						),
						resolveFragmentBytes(fetchUrl, cacheKey)
					],
					{ concurrency: 'unbounded' }
				);
				viewer = runtime;
				applyInteractionLock(runtime, interactionLocked);
				yield* loadFragmentsIntoRuntime(runtime, fetchUrl, fragmentBytes);
				loadBanner = 'none';
				scheduleMarkerVisualization();
				yield* Effect.never;
			}).pipe(
				Effect.catch((error) => {
					const cause = error instanceof ViewerOperationFailed ? error.cause : error;
					loadBanner = {
						error:
							cause instanceof DOMException && cause.name === 'AbortError'
								? t('component.ifc_download_timed_out')
								: error instanceof Error
									? messageOf(error)
									: t('component.ifc_load_failed')
					};
					return Effect.logError('[IFCViewer] Failed to initialize or load IFC viewer.', error);
				}),
				Effect.ensuring(Effect.sync(cancelScheduledMarkerVisualization))
			);
		});
	}

	const viewerAttach = $derived(viewerAttachment(trimmedSrc));

	function syncMarkerVisualization() {
		return Effect.gen(function* () {
			const runtime = viewer;
			const group = runtime?.currentGroup;
			if (!runtime || !group) return;
			const needsInteraction =
				runtime.markerStyleIds.length > 0 ||
				normalizedMarkerGroups.length > 0 ||
				markers.length > 0;
			if (needsInteraction) ensureInteractionSystems(runtime);
			yield* clearMarkerVisualization(runtime);
			const highlighter = runtime.highlighter;
			if (highlighter === null) return;
			if (normalizedMarkerGroups.length > 0) {
				yield* Effect.forEach(normalizedMarkerGroups, (markerGroup, index) =>
					Effect.gen(function* () {
						const styleId = `ui-ifc-marker-${index}`;
						const color = yield* parseMarkerColor(markerGroup.color, runtime.THREE.Color);
						yield* Effect.sync(() => {
							highlighter.styles.set(styleId, {
								color,
								opacity: 1,
								transparent: false,
								renderedFaces: runtime.FRAGS.RenderedFaces.TWO
							});
							runtime.markerStyleIds.push(styleId);
						});
						const fragmentIdMap = { [group.modelId]: new Set(markerGroup.expressIds) };
						yield* Effect.tryPromise({
							try: () => highlighter.highlightByID(styleId, fragmentIdMap, true, false),
							catch: viewerFailure('highlight-marker-group')
						});
					})
				);
				return;
			}
			if (markers.length === 0) return;
			const styleId = 'ui-ifc-markers';
			yield* Effect.sync(() => {
				highlighter.styles.set(styleId, {
					color: new runtime.THREE.Color(resolveCssColor(DEFAULT_SELECTION_COLOR)),
					opacity: 1,
					transparent: false,
					renderedFaces: runtime.FRAGS.RenderedFaces.TWO
				});
				runtime.markerStyleIds.push(styleId);
			});
			const fragmentIdMap = { [group.modelId]: new Set(markers) };
			yield* Effect.tryPromise({
				try: () => highlighter.highlightByID(styleId, fragmentIdMap, true, false),
				catch: viewerFailure('highlight-markers')
			});
		});
	}

	function focusOnIssue(issue: IFCViewerIssueSummary) {
		return Effect.gen(function* () {
			const runtime = viewer;
			const group = runtime?.currentGroup;
			if (!runtime || !group) return;
			const highlighter = ensureInteractionSystems(runtime);
			yield* Effect.sync(() => {
				highlighter.styles.set(FOCUS_STYLE_ID, {
					color: new runtime.THREE.Color(resolveCssColor('var(--color-destructive)')),
					opacity: 1,
					transparent: false,
					renderedFaces: runtime.FRAGS.RenderedFaces.TWO
				});
			});
			const issueElements = { [group.modelId]: new Set([issue.expressId]) };
			yield* Effect.tryPromise({
				try: () => runtime.components.get(runtime.OBC.Hider).isolate(issueElements),
				catch: viewerFailure('isolate-issue-element')
			}).pipe(Effect.ignore);
			yield* Effect.tryPromise({
				try: () => highlighter.highlightByID(FOCUS_STYLE_ID, issueElements, true, true),
				catch: viewerFailure('focus-issue-element')
			}).pipe(Effect.ignore);
			if (
				issue.pin != null &&
				issue.pin.camera_x != null &&
				issue.pin.camera_y != null &&
				issue.pin.camera_z != null
			) {
				const { x, y, z, camera_x, camera_y, camera_z } = issue.pin;
				yield* Effect.tryPromise({
					try: () =>
						runtime.world.camera.controls.setLookAt(camera_x, camera_y, camera_z, x, y, z, true),
					catch: viewerFailure('focus-issue-camera')
				}).pipe(Effect.ignore);
			}
			const properties = (yield* Effect.tryPromise({
				try: () => group.getItemsData([issue.expressId]),
				catch: viewerFailure('read-focus-properties')
			}).pipe(Effect.catch(() => Effect.succeed([null]))))[0];
			selectedItem = buildSelectedItem(issue.expressId, properties ?? null, issue.pin);
		});
	}

	/** Leaves the focused issue: every element visible again, the focus colour cleared, the whole model framed. */
	function showWholeModel() {
		return Effect.gen(function* () {
			const runtime = viewer;
			if (!runtime?.currentGroup) return;
			yield* Effect.tryPromise({
				try: () => runtime.components.get(runtime.OBC.Hider).set(true),
				catch: viewerFailure('show-whole-model')
			}).pipe(Effect.ignore);
			yield* framePresetEffect(runtime, 'iso', true);
			const highlighter = runtime.highlighter;
			if (highlighter === null) return;
			yield* Effect.tryPromise({
				try: () => highlighter.clear(FOCUS_STYLE_ID),
				catch: viewerFailure('clear-focus')
			}).pipe(Effect.ignore);
		});
	}

	function handlePick() {
		return Effect.gen(function* () {
			const runtime = viewer;
			const group = runtime?.currentGroup;
			if (!runtime || !group) return;
			const highlighter = ensureInteractionSystems(runtime);
			yield* Effect.tryPromise({
				try: () => highlighter.highlight('select', true, false),
				catch: viewerFailure('select-model-item')
			});
			if (viewer !== runtime) return;
			const selection = highlighter.selection.select;
			const modelId = Object.keys(selection)[0];
			const id = modelId ? selection[modelId]?.values().next().value : undefined;
			if (modelId == null || id == null) {
				clearSelection();
				return;
			}
			const raycaster = runtime.components.get(runtime.OBC.Raycasters).get(runtime.world);
			const castRay = raycaster.castRay;
			const hit =
				typeof castRay === 'function'
					? yield* Effect.tryPromise({
							try: () => castRay.call(raycaster),
							catch: viewerFailure('cast-pin-ray')
						}).pipe(Effect.catch(() => Effect.succeed(null)))
					: null;
			const fallbackTarget = new runtime.THREE.Vector3(0, 0, 0);
			group.box.getCenter(fallbackTarget);
			const point = hit?.point ?? fallbackTarget;
			const camPos = runtime.world.camera.three.position;
			const roundCoord = (n: number) => Math.round(n * 1000) / 1000;
			const pin: IFCViewerPinCoords = {
				x: roundCoord(point.x),
				y: roundCoord(point.y),
				z: roundCoord(point.z),
				camera_x: roundCoord(camPos.x),
				camera_y: roundCoord(camPos.y),
				camera_z: roundCoord(camPos.z)
			};

			const selectedModel = runtime.fragments.list.get(modelId);
			const properties = selectedModel
				? (yield* Effect.tryPromise({
						try: () => selectedModel.getItemsData([id]),
						catch: viewerFailure('read-item-properties')
					}))[0]
				: null;
			if (viewer !== runtime) return;
			selectedItem = buildSelectedItem(id, properties ?? null, pin);
		});
	}

	function handlePointerDown(event: PointerEvent): void {
		pointerDown = { x: event.clientX, y: event.clientY, button: event.button };
	}

	function handleCanvasClick(event: MouseEvent): void {
		const down = pointerDown;
		pointerDown = null;
		if (down !== null) {
			if (down.button !== 0) return;
			const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
			if (moved > PICK_DRAG_THRESHOLD_PX) return;
		}
		const explicitInspect = navMode === 'inspect' || event.metaKey || event.ctrlKey;
		if (!explicitInspect) return;
		fork(handlePick(), (failure) => {
			loadBanner = { error: messageOf(failure) };
		});
	}

	function handleWindowKeydown(event: KeyboardEvent): void {
		if (event.key === 'Shift') shiftPanning = true;
	}

	function handleWindowKeyup(event: KeyboardEvent): void {
		if (event.key === 'Shift') shiftPanning = false;
	}

	function handleCanvasKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			clearSelection();
			return;
		}
		const runtime = viewer;
		if (!runtime || interactionLocked) return;
		const controls = runtime.world.camera.controls;
		const radius = modelBounds ? modelGeometryInfo(modelBounds).radius : 12;
		const step = Math.max(radius * 0.08, 0.8);
		const key = event.key.toLowerCase();
		if (key === 'r') {
			event.preventDefault();
			framePreset('iso');
		} else if ((key === 'w' || event.key === 'ArrowUp') && typeof controls.dolly === 'function') {
			event.preventDefault();
			const dolly = controls.dolly;
			fork(
				Effect.tryPromise({
					try: () => dolly.call(controls, step, true),
					catch: () => undefined
				}).pipe(Effect.ignore),
				() => {}
			);
		} else if ((key === 's' || event.key === 'ArrowDown') && typeof controls.dolly === 'function') {
			event.preventDefault();
			const dolly = controls.dolly;
			fork(
				Effect.tryPromise({
					try: () => dolly.call(controls, -step, true),
					catch: () => undefined
				}).pipe(Effect.ignore),
				() => {}
			);
		} else if ((key === 'a' || event.key === 'ArrowLeft') && typeof controls.truck === 'function') {
			event.preventDefault();
			const truck = controls.truck;
			fork(
				Effect.tryPromise({
					try: () => truck.call(controls, -step, 0, true),
					catch: () => undefined
				}).pipe(Effect.ignore),
				() => {}
			);
		} else if (
			(key === 'd' || event.key === 'ArrowRight') &&
			typeof controls.truck === 'function'
		) {
			event.preventDefault();
			const truck = controls.truck;
			fork(
				Effect.tryPromise({
					try: () => truck.call(controls, step, 0, true),
					catch: () => undefined
				}).pipe(Effect.ignore),
				() => {}
			);
		} else if (key === 'q' && typeof controls.truck === 'function') {
			event.preventDefault();
			const truck = controls.truck;
			fork(
				Effect.tryPromise({
					try: () => truck.call(controls, 0, step, true),
					catch: () => undefined
				}).pipe(Effect.ignore),
				() => {}
			);
		} else if (key === 'e' && typeof controls.truck === 'function') {
			event.preventDefault();
			const truck = controls.truck;
			fork(
				Effect.tryPromise({
					try: () => truck.call(controls, 0, -step, true),
					catch: () => undefined
				}).pipe(Effect.ignore),
				() => {}
			);
		}
	}

	watch(
		() => interactionLocked,
		(locked) => {
			if (!viewer) return;
			applyInteractionLock(viewer, locked);
		}
	);
	watch(
		() => [navMode, shiftPanning] as const,
		() => {
			if (!viewer) return;
			applyNavigationControls(viewer);
		}
	);
	watch(
		() => [markerKey, markerGroupsKey] as const,
		() => {
			scheduleMarkerVisualization();
		}
	);
	watch(
		() => [cutX, cutY, cutZ, modelBounds] as const,
		() => {
			if (!viewer) return;
			applyClippingPlanes(viewer);
		}
	);
	const words = (key: string): string => (translateKey ? translateKey(key) : key);

	const sliderY = $derived(
		create_slider({
			min: 0,
			max: 100,
			step: 1,
			value: () => cutY,
			on_change: (v) => (cutY = v),
			label: t('component.axis_y_elevation')
		})
	);
	const sliderX = $derived(
		create_slider({
			min: 0,
			max: 100,
			step: 1,
			value: () => cutX,
			on_change: (v) => (cutX = v),
			label: t('component.axis_x_section')
		})
	);
	const sliderZ = $derived(
		create_slider({
			min: 0,
			max: 100,
			step: 1,
			value: () => cutZ,
			on_change: (v) => (cutZ = v),
			label: t('component.axis_z_section')
		})
	);

	$effect(() =>
		register_control({
			id: 'construction:ifc-viewer',
			kind: 'viewer',
			label: alt ?? t('component.ifc_model_preview'),
			state: () => ({
				selected_express_id: selectedItem?.expressId ?? null,
				nav_mode: navMode,
				section_panel_open: sectionPanelOpen,
				cut_x: cutX,
				cut_y: cutY,
				cut_z: cutZ,
				interaction_locked: interactionLocked
			}),
			actions: {
				reset_view: refitModel,
				reset_axes: resetAxes,
				clear_selection: clearSelection,
				toggle_lock: toggleInteractionLock
			}
		})
	);

	const navModeGroup = create_toggle_group({
		items: () => ['orbit', 'pan', 'inspect'],
		mode: 'single',
		value: () => [navMode],
		on_change: (values) => {
			const next = values[0];
			if (next === 'orbit' || next === 'pan' || next === 'inspect') navMode = next;
			else navMode = 'orbit';
		}
	});

	const propertiesDisclosure = create_disclosure({
		open: () => propertiesOpen,
		on_open_change: (next) => (propertiesOpen = next)
	});

	const sectionDisclosure = create_disclosure({
		open: () => sectionPanelOpen,
		on_open_change: (next) => (sectionPanelOpen = next)
	});

	const lockSwitch = create_switch({
		checked: () => interactionLocked,
		on_change: (next) => {
			if (next !== interactionLocked) toggleInteractionLock();
		}
	});

	watch(
		() => focusIssue,
		(issue) => {
			if (!viewer?.currentGroup) return;
			if (issue) fork(focusOnIssue(issue), () => {});
			else {
				resetSelectionState();
				fork(showWholeModel(), () => {});
			}
		}
	);
</script>

<svelte:window
	onkeydown={handleWindowKeydown}
	onkeyup={handleWindowKeyup}
	onblur={() => (shiftPanning = false)}
/>

<Bound
	size="fill"
	min_height="30rem"
	clip
	class="relative rounded-control border border-border bg-muted"
>
	<Imposter placement="fill">
		<div
			class={cn(
				'size-full overscroll-contain border-0 bg-transparent text-left',
				canvasCursorClass
			)}
			role="application"
			tabindex={0}
			aria-label={alt ?? t('component.ifc_model_preview')}
			onpointerdown={handlePointerDown}
			onclick={handleCanvasClick}
			onkeydown={handleCanvasKeydown}
			{@attach viewerAttach}
		></div>
	</Imposter>

	{#if loadBanner === 'downloading' || loadBanner === 'converting' || loadBanner === 'loading'}
		<Imposter placement="fill" class="pointer-events-auto">
			<Surface tone="muted" padding="md" radius="none" class="size-full">
				<Inline align="center" justify="center" gap="sm" size="fill" aria-busy="true">
					<Spinner />
					<p class="text-xs text-muted-foreground">{loadingMessage}</p>
				</Inline>
			</Surface>
		</Imposter>
	{:else if typeof loadBanner === 'object'}
		<Imposter placement="fill" class="pointer-events-auto">
			<Surface tone="muted" padding="md" radius="none" class="size-full">
				<Inline align="center" justify="center" size="fill">
					<p class="max-w-sm text-center text-xs text-destructive">{loadBanner.error}</p>
				</Inline>
			</Surface>
		</Imposter>
	{:else if !trimmedSrc}
		<Imposter placement="fill">
			<Surface tone="muted" padding="md" radius="none" class="size-full">
				<Inline align="center" justify="center" size="fill">
					<p class="text-xs text-muted-foreground">{t('component.no_ifc_model')}</p>
				</Inline>
			</Surface>
		</Imposter>
	{/if}

	<Imposter placement="top" offset="sm" class="pointer-events-none">
		<Inline align="start" justify="between" gap="sm">
			<div class="w-full max-w-xs min-w-0">
				{#if selectedItem}
					{@const item = selectedItem}
					<Surface tone="popover" padding="xs" radius="control" class="pointer-events-auto">
						<Stack gap="xs" divided>
							<Inline align="start" justify="between" gap="xs">
								<button
									{...propertiesDisclosure.trigger_attrs()}
									class="min-w-0 grow rounded-inset px-1 py-0.5 text-left transition-colors hover:bg-muted"
								>
									<Inline align="center" justify="between" gap="xs">
										<div class="min-w-0">
											<span
												class="block truncate text-xs font-medium leading-tight text-foreground"
											>
												{item.title}
											</span>
											<span class="block truncate text-micro leading-tight text-muted-foreground">
												{#if item.subtitle}{item.subtitle} ·
												{/if}#{item.expressId}
											</span>
										</div>
										<Icon
											name="lucide:chevron-down"
											class="size-3.5 shrink-0 text-muted-foreground transition-transform {propertiesOpen
												? 'rotate-180'
												: ''}"
										/>
									</Inline>
								</button>
								<Inline gap="none">
									{#if item.pin}
										<Button
											size="icon"
											variant="ghost"
											class="size-7"
											hint={t('component.focus_selected_element')}
											onclick={focusSelected}
										>
											<Icon name="lucide:focus" class="size-3.5" />
										</Button>
									{/if}
									<Button
										size="icon"
										variant="ghost"
										class="size-7"
										hint={t('component.clear_selected_element')}
										onclick={clearSelection}
									>
										<Icon name="lucide:x" class="size-3.5" />
									</Button>
								</Inline>
							</Inline>

							{#if onTagIssue}
								<Inline align="center" justify="between" gap="xs" class="pt-1">
									<span class="text-micro leading-tight text-muted-foreground">
										{#if selectedElementIssues.length > 0}
											{t('component.element_tagged_issues_count', {
												count: selectedElementIssues.length
											})}
										{:else}
											{t('component.click_to_tag_issue')}
										{/if}
									</span>
									<Button
										variant="brand"
										class="h-6 px-2 text-micro"
										onclick={() => onTagIssue?.(item)}
									>
										<Icon name="lucide:pin" class="size-3" />
										{t('component.tag_issue_and_photos')}
									</Button>
								</Inline>
							{/if}

							{#if selectedElementIssues.length > 0}
								<Stack gap="xs" class="pt-1">
									{#each selectedElementIssues as issue (issue.id)}
										<Surface tone="subtle" padding="xs" radius="control">
											<button
												type="button"
												class="w-full text-left"
												onclick={() => onOpenIssue?.(issue.id)}
											>
												<Stack gap="xs">
													<Inline align="center" justify="between" gap="xs">
														<span class="min-w-0 truncate text-xs font-medium text-foreground">
															{#if issue.issue_number}{issue.issue_number} ·
															{/if}{issue.title}
														</span>
														<Badge variant="outline" class="text-tiny">
															{enum_text(issue.severity, {
																t: words,
																model: 'issues',
																field: 'severity'
															})}
														</Badge>
													</Inline>
													{#if issue.photoUrls.length > 0}
														<Inline gap="xs">
															{#each issue.photoUrls.slice(0, 3) as url (url)}
																<Image
																	src={url}
																	alt={issue.title}
																	class="size-9 rounded-inset border border-border"
																	image_class="object-cover"
																/>
															{/each}
														</Inline>
													{/if}
												</Stack>
											</button>
										</Surface>
									{/each}
								</Stack>
							{/if}

							{#if propertiesOpen}
								<Stack {...propertiesDisclosure.content_attrs()} gap="xs" class="pt-1">
									<p class="text-tiny font-medium tracking-wider uppercase text-muted-foreground">
										{t('component.selected_element_properties')}
									</p>
									<Surface tone="subtle" padding="xs" radius="control">
										<Scroll
											axis="both"
											name={t('component.selected_element_properties')}
											max="compact"
											class="text-micro leading-snug wrap-break-word"
										>
											<Grid as="dl" tracks="minmax(5rem, 8rem) 1fr" gap="xs" row_gap="xs">
												{#each item.properties as property (property.name)}
													<dt class="text-micro text-muted-foreground">{property.name}</dt>
													<dd class="text-micro text-foreground">{property.value}</dd>
												{/each}
											</Grid>
										</Scroll>
									</Surface>
								</Stack>
							{/if}
						</Stack>
					</Surface>
				{/if}
			</div>

			<Stack align="end" gap="xs" class="pointer-events-auto">
				<div
					class="flex items-center gap-0.5 rounded-control border border-border bg-popover/90 p-0.5 backdrop-blur-xs"
				>
					<div class="flex items-center gap-0.5" {...navModeGroup.root_attrs()}>
						<Button
							{...navModeGroup.item_attrs('orbit')}
							{@attach navModeGroup.item('orbit')}
							size="icon"
							variant={navMode === 'orbit' ? 'secondary' : 'ghost'}
							class="size-7"
							hint={t('component.nav_mode_orbit')}
						>
							<Icon name="lucide:orbit" class="size-3.5" />
						</Button>
						<Button
							{...navModeGroup.item_attrs('pan')}
							{@attach navModeGroup.item('pan')}
							size="icon"
							variant={navMode === 'pan' ? 'secondary' : 'ghost'}
							class="size-7"
							hint={t('component.nav_mode_pan')}
						>
							<Icon name="lucide:hand" class="size-3.5" />
						</Button>
						<Button
							{...navModeGroup.item_attrs('inspect')}
							{@attach navModeGroup.item('inspect')}
							size="icon"
							variant={navMode === 'inspect' ? 'secondary' : 'ghost'}
							class="size-7"
							hint={t('component.nav_mode_inspect')}
						>
							<Icon name="lucide:mouse-pointer-click" class="size-3.5" />
						</Button>
					</div>
					<span class="mx-0.5 h-4 w-px bg-border" aria-hidden="true"></span>
					<Button
						size="icon"
						variant="ghost"
						class="size-7"
						hint={t('component.zoom_in')}
						onclick={() => zoomBy(1)}
					>
						<Icon name="lucide:zoom-in" class="size-3.5" />
					</Button>
					<Button
						size="icon"
						variant="ghost"
						class="size-7"
						hint={t('component.zoom_out')}
						onclick={() => zoomBy(-1)}
					>
						<Icon name="lucide:zoom-out" class="size-3.5" />
					</Button>
					<Button
						size="icon"
						variant="ghost"
						class="size-7"
						hint={t('component.reset_camera_view')}
						onclick={refitModel}
					>
						<Icon name="lucide:maximize-2" class="size-3.5" />
					</Button>
					<span class="mx-0.5 h-4 w-px bg-border" aria-hidden="true"></span>
					<Button
						{...sectionDisclosure.trigger_attrs()}
						size="icon"
						variant={sectionPanelOpen || sectionActive ? 'secondary' : 'ghost'}
						class="size-7"
						hint={t('component.axis_section_scrubbers')}
					>
						<Icon name="lucide:sliders-horizontal" class="size-3.5" />
					</Button>
					<Button
						{...lockSwitch.attrs()}
						size="icon"
						variant={interactionLocked ? 'secondary' : 'ghost'}
						class="size-7"
						hint={interactionLocked
							? t('component.unlock_model_navigation')
							: t('component.lock_model_navigation')}
					>
						<Icon name={interactionLocked ? 'lucide:lock' : 'lucide:unlock'} class="size-3.5" />
					</Button>
					{#if onReplaceModel}
						<span class="mx-0.5 h-4 w-px bg-border" aria-hidden="true"></span>
						<Button
							size="icon"
							variant="ghost"
							class="size-7"
							hint={t('component.replace_ifc_model')}
							onclick={onReplaceModel}
						>
							<Icon name="lucide:upload" class="size-3.5" />
						</Button>
					{/if}
				</div>

				{#if modelBounds}
					<div
						class="flex items-center gap-0.5 rounded-control border border-border bg-popover/90 p-0.5 backdrop-blur-xs"
					>
						{#each [['iso', t('component.view_iso')], ['top', t('component.view_top')], ['front', t('component.view_front')], ['side', t('component.view_side')]] as const as [preset, label] (preset)}
							<button
								type="button"
								class="h-5 rounded-inset px-1.5 text-tiny font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								onclick={() => framePreset(preset)}
							>
								{label}
							</button>
						{/each}
					</div>
				{/if}

				{#if sectionPanelOpen && modelBounds}
					<div {...sectionDisclosure.content_attrs()} class="w-44">
						<Surface tone="popover" padding="xs" radius="control">
							<div class="flex flex-col gap-2">
								<div class="flex items-center justify-between gap-2">
									<p class="text-tiny font-medium tracking-wider uppercase text-muted-foreground">
										{t('component.axis_section_scrubbers')}
									</p>
									{#if sectionActive}
										<button
											type="button"
											class="text-tiny font-medium text-primary hover:underline"
											onclick={resetAxes}
										>
											{t('component.reset_axes')}
										</button>
									{/if}
								</div>
								<div class="flex flex-col gap-0.5">
									<div class="flex items-center justify-between text-micro leading-tight">
										<span class="text-muted-foreground">{t('component.axis_y_elevation')}</span>
										<span class="tabular-nums text-foreground">{cutY}%</span>
									</div>
									<div
										class="relative flex h-3.5 w-full cursor-pointer items-center"
										{@attach sliderY.track}
									>
										<div class="h-1 w-full rounded-full bg-muted">
											<div
												class="h-full rounded-full bg-primary"
												style={`width: ${sliderY.percent}%`}
											></div>
										</div>
										<div
											class="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow-xs"
											style={`left: ${sliderY.percent}%`}
											{...sliderY.thumb_attrs()}
										></div>
									</div>
								</div>
								<div class="flex flex-col gap-0.5">
									<div class="flex items-center justify-between text-micro leading-tight">
										<span class="text-muted-foreground">{t('component.axis_x_section')}</span>
										<span class="tabular-nums text-foreground">{cutX}%</span>
									</div>
									<div
										class="relative flex h-3.5 w-full cursor-pointer items-center"
										{@attach sliderX.track}
									>
										<div class="h-1 w-full rounded-full bg-muted">
											<div
												class="h-full rounded-full bg-primary"
												style={`width: ${sliderX.percent}%`}
											></div>
										</div>
										<div
											class="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow-xs"
											style={`left: ${sliderX.percent}%`}
											{...sliderX.thumb_attrs()}
										></div>
									</div>
								</div>
								<div class="flex flex-col gap-0.5">
									<div class="flex items-center justify-between text-micro leading-tight">
										<span class="text-muted-foreground">{t('component.axis_z_section')}</span>
										<span class="tabular-nums text-foreground">{cutZ}%</span>
									</div>
									<div
										class="relative flex h-3.5 w-full cursor-pointer items-center"
										{@attach sliderZ.track}
									>
										<div class="h-1 w-full rounded-full bg-muted">
											<div
												class="h-full rounded-full bg-primary"
												style={`width: ${sliderZ.percent}%`}
											></div>
										</div>
										<div
											class="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow-xs"
											style={`left: ${sliderZ.percent}%`}
											{...sliderZ.thumb_attrs()}
										></div>
									</div>
								</div>
							</div>
						</Surface>
					</div>
				{/if}
			</Stack>
		</Inline>
	</Imposter>

	{#if focusIssue}
		<Imposter placement="bottom-start" offset="sm" class="pointer-events-auto max-w-72">
			<Surface tone="popover" padding="xs" radius="control">
				<Inline align="center" justify="between" gap="sm">
					<span class="min-w-0 truncate text-micro text-foreground">
						{t('component.showing_issue_only', {
							issue: focusIssue.issue_number ?? focusIssue.title
						})}
					</span>
					<Button variant="ghost" class="h-6 px-2 text-micro" onclick={() => onClearFocus?.()}>
						{t('component.show_whole_model')}
					</Button>
				</Inline>
			</Surface>
		</Imposter>
	{:else if normalizedMarkerGroups.length > 0}
		<Imposter
			placement="bottom-start"
			offset="sm"
			class="pointer-events-none max-w-52"
			aria-label={t('component.marker_legend')}
		>
			<div class="rounded-control border border-border bg-popover/90 px-2 py-1.5 backdrop-blur-xs">
				<p class="mb-1 text-tiny font-medium tracking-wider uppercase text-muted-foreground">
					{t('component.highlights')}
				</p>
				<ul class="flex flex-col gap-1">
					{#each normalizedMarkerGroups as group (group.label + group.color + group.expressIds.join(','))}
						<li class="flex items-center gap-1.5 text-micro leading-tight text-foreground">
							<span
								class="size-2 shrink-0 rounded-full"
								style={`background-color: ${group.color}`}
								aria-hidden="true"
							></span>
							<span class="min-w-0 truncate">{group.label}</span>
						</li>
					{/each}
				</ul>
			</div>
		</Imposter>
	{/if}

	{#if modelBounds && !focusIssue}
		<Imposter placement="bottom-end" offset="sm" class="pointer-events-none hidden sm:block">
			<div
				class="rounded-control border border-border bg-popover/85 px-2 py-1 text-tiny leading-tight text-muted-foreground backdrop-blur-xs"
			>
				{navMode === 'inspect'
					? t('component.nav_hint_inspect')
					: navMode === 'pan'
						? t('component.nav_hint_pan')
						: t('component.nav_hint_orbit')}
			</div>
		</Imposter>
	{/if}
</Bound>
