<script lang="ts">
	import Icon from '@iconify/svelte';
	import { Effect, Schema } from 'effect';
	import { Badge, Button, cn } from '@norbital-ai/ui';
	import { attach, fork, run } from '@norbital-ai/ui/effect';
	import { Bound, Grid, Imposter, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { watch } from 'runed';
	import { convertIfcToFragments } from './ifc_viewer.converter.js';
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
		Effect.all([
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
		])
	);

	function normalizeFileUrlForSameOrigin(
		rawUrl: string,
		origin: string
	): Effect.Effect<string, never> {
		return Effect.try({
			try: () => {
				const base = origin.endsWith('/') ? origin : `${origin}/`;
				const parsed = new URL(rawUrl, base);
				if (parsed.pathname.startsWith('/api/files/')) {
					const originRoot = origin.replace(/\/$/, '');
					return `${originRoot}${parsed.pathname}${parsed.search}${parsed.hash}`;
				}
				return parsed.href;
			},
			catch: viewerFailure('normalize-model-url')
		}).pipe(Effect.catch(() => Effect.succeed(rawUrl)));
	}

	type LoadBanner = 'none' | 'loading' | { error: string };

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
	};

	const IFC_FETCH_TIMEOUT_MS = 120000;
	const IFC_CONVERSION_TIMEOUT_MS = 60000;
	const IFC_FRAGMENT_LOAD_TIMEOUT_MS = 120000;
	const DEFAULT_BACKGROUND_COLOR = 'var(--color-background)';
	const DEFAULT_SELECTION_COLOR = 'var(--color-brand)';
	const DEFAULT_MARKER_COLOR = 'var(--color-muted-foreground)';
	const FOCUS_STYLE_ID = 'ui-ifc-issue-focus';

	function resolveCssColor(css: string): string {
		if (!css.startsWith('var(')) return css;
		const name = css.slice(4, -1).trim();
		const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
		return value || '#f2f1ed';
	}

	interface Props extends IFCViewerProps {}
	let {
		t,
		src,
		alt,
		markers = [],
		markerGroups,
		issues = [],
		focusIssue = null,
		onTagIssue,
		onOpenIssue
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
	let propertiesOpen = $state(false);
	let sectionPanelOpen = $state(false);
	let modelBounds = $state<ModelBounds | null>(null);
	let cutX = $state(100);
	let cutY = $state(100);
	let cutZ = $state(100);
	let viewer = $state.raw<IFCViewerRuntime | null>(null);
	let markerSyncFrame = $state.raw(0);

	const selectedElementIssues = $derived.by(() => {
		if (!selectedItem) return [];
		return issues.filter((issue) => issue.expressId === selectedItem?.expressId);
	});
	const sectionActive = $derived(cutX < 100 || cutY < 100 || cutZ < 100);

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
		const message = label
			? `${label} exceeded ${timeoutMs}ms`
			: `Operation exceeded ${timeoutMs}ms`;
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

	function refitModel(): void {
		const runtime = viewer;
		const group = runtime?.currentGroup;
		if (!runtime || !group) return;
		fork(
			Effect.tryPromise({
				try: () => runtime.world.camera.controls.fitToBox(group.box, true),
				catch: viewerFailure('refit-model')
			}).pipe(Effect.ignore),
			() => {}
		);
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
				return {
					OBC,
					OBF,
					FRAGS,
					THREE,
					components,
					world,
					fragments,
					highlighter: null,
					currentGroup: null,
					markerStyleIds: []
				};
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

	function loadIfcModelIntoRuntime(runtime: IFCViewerRuntime, url: string) {
		return Effect.gen(function* () {
			const fetchUrl = yield* normalizeFileUrlForSameOrigin(url, window.location.origin);
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
			const modelName = yield* getModelName(fetchUrl);
			const fragmentBytes = yield* withTimeout(
				convertIfcToFragments(buffer, t),
				IFC_CONVERSION_TIMEOUT_MS,
				t('component.ifc_conversion')
			);
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
			yield* Effect.sync(() => {
				runtime.world.scene.three.add(group.object);
				runtime.currentGroup = group;
				modelBounds = {
					minX: group.box.min.x,
					maxX: group.box.max.x,
					minY: group.box.min.y,
					maxY: group.box.max.y,
					minZ: group.box.min.z,
					maxZ: group.box.max.z
				};
				applyClippingPlanes(runtime);
			});
			const controls = runtime.world.camera.controls;
			yield* Effect.tryPromise({
				try: () => controls.fitToBox(group.box, false),
				catch: viewerFailure('frame-model')
			}).pipe(Effect.uninterruptible);
			yield* Effect.sync(() => controls.update(0));
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
				const runtime = yield* Effect.acquireRelease(createViewerRuntime(node), (runtime) =>
					Effect.gen(function* () {
						if (viewer === runtime) {
							viewer = null;
							resetSelectionState();
						}
						yield* disposeRuntime(runtime).pipe(Effect.ignore);
					})
				);
				viewer = runtime;
				applyInteractionLock(runtime, interactionLocked);
				yield* loadIfcModelIntoRuntime(runtime, url);
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
					color: new runtime.THREE.Color('#ef4444'),
					opacity: 1,
					transparent: false,
					renderedFaces: runtime.FRAGS.RenderedFaces.TWO
				});
			});
			yield* Effect.tryPromise({
				try: () =>
					highlighter.highlightByID(
						FOCUS_STYLE_ID,
						{ [group.modelId]: new Set([issue.expressId]) },
						true,
						true
					),
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
			// Capture 3D ray hit point and current camera viewpoint for BIM pin tagging
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

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		fork(handlePick(), (failure) => {
			loadBanner = { error: messageOf(failure) };
		});
	}

	watch(
		() => interactionLocked,
		(locked) => {
			if (!viewer) return;
			applyInteractionLock(viewer, locked);
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
	watch(
		() => focusIssue,
		(issue) => {
			if (!issue || !viewer?.currentGroup) return;
			fork(focusOnIssue(issue), () => {});
		}
	);
</script>

<Bound
	size="fill"
	min_height="30rem"
	clip
	class="relative rounded-lg border border-border/80 bg-muted/20"
>
	<Imposter placement="fill">
		<div
			class={cn(
				'size-full overscroll-contain border-0 bg-transparent p-0 text-left',
				interactionLocked ? 'touch-pan-y' : 'touch-none'
			)}
			role="button"
			tabindex={0}
			aria-label={alt ?? t('component.ifc_model_preview')}
			onclick={() =>
				fork(handlePick(), (failure) => {
					loadBanner = { error: messageOf(failure) };
				})}
			onkeydown={handleKeydown}
			{@attach viewerAttach}
		></div>
	</Imposter>

	{#if loadBanner === 'loading'}
		<Imposter placement="fill" class="pointer-events-auto bg-background/80 p-4">
			<Inline align="center" justify="center" size="fill">
				<p class="text-sm text-muted-foreground">{t('component.loading_ifc_model')}</p>
			</Inline>
		</Imposter>
	{:else if typeof loadBanner === 'object'}
		<Imposter placement="fill" class="pointer-events-auto bg-background/85 p-4">
			<Inline align="center" justify="center" size="fill">
				<p class="max-w-sm text-center text-sm text-destructive">{loadBanner.error}</p>
			</Inline>
		</Imposter>
	{:else if !trimmedSrc}
		<Imposter placement="fill" class="p-4">
			<Inline align="center" justify="center" size="fill">
				<p class="text-sm text-muted-foreground">{t('component.no_ifc_model')}</p>
			</Inline>
		</Imposter>
	{/if}

	<Imposter placement="top" class="pointer-events-none p-3">
		<Inline align="start" justify="between" gap="sm">
			<div class="w-full max-w-[min(28rem,100%)] min-w-0">
				{#if selectedItem}
					{@const item = selectedItem}
					<Stack
						gap="xs"
						class="pointer-events-auto rounded-md border border-border/80 bg-background/95 p-2.5 shadow-sm"
					>
						<Inline align="start" justify="between" gap="xs">
							<button
								type="button"
								class="min-w-0 flex-1 rounded-sm px-1 py-0.5 text-left transition-colors hover:bg-muted/60"
								onclick={() => (propertiesOpen = !propertiesOpen)}
							>
								<Inline align="center" justify="between" gap="xs">
									<div class="min-w-0">
										<span class="block truncate text-sm font-medium text-foreground">
											{item.title}
										</span>
										<span class="block truncate text-micro text-muted-foreground">
											{#if item.subtitle}{item.subtitle} ·
											{/if}#{item.expressId}
										</span>
									</div>
									<Icon
										icon="lucide:chevron-down"
										class="h-4 w-4 shrink-0 text-muted-foreground transition-transform {propertiesOpen
											? 'rotate-180'
											: ''}"
									/>
								</Inline>
							</button>
							<Button
								size="icon"
								variant="ghost"
								hint={t('component.clear_selected_element')}
								class="shrink-0"
								onclick={clearSelection}
							>
								<Icon icon="lucide:x" />
							</Button>
						</Inline>

						{#if onTagIssue}
							<Inline
								align="center"
								justify="between"
								gap="xs"
								class="border-t border-border/60 pt-2"
							>
								<span class="text-micro text-muted-foreground">
									{#if selectedElementIssues.length > 0}
										{t('component.element_tagged_issues_count', {
											count: selectedElementIssues.length
										})}
									{:else}
										{t('component.click_to_tag_issue')}
									{/if}
								</span>
								<Button variant="brand" onclick={() => onTagIssue?.(item)}>
									<Icon icon="lucide:pin" class="size-3.5" />
									{t('component.tag_issue_and_photos')}
								</Button>
							</Inline>
						{/if}

						{#if selectedElementIssues.length > 0}
							<Stack gap="xs" class="border-t border-border/60 pt-2">
								{#each selectedElementIssues as issue (issue.id)}
									<button
										type="button"
										class="w-full rounded-md border border-border/70 bg-muted/30 p-2 text-left transition-colors hover:bg-muted/60"
										onclick={() => onOpenIssue?.(issue.id)}
									>
										<Inline align="center" justify="between" gap="xs">
											<span class="min-w-0 truncate text-xs font-medium text-foreground">
												{#if issue.issue_number}{issue.issue_number} ·
												{/if}{issue.title}
											</span>
											<Badge variant="outline">{issue.severity}</Badge>
										</Inline>
										{#if issue.photoUrls.length > 0}
											<Inline gap="xs" class="mt-1.5">
												{#each issue.photoUrls.slice(0, 3) as url (url)}
													<img
														src={url}
														alt={issue.title}
														class="size-10 rounded border border-border/70 object-cover"
													/>
												{/each}
											</Inline>
										{/if}
									</button>
								{/each}
							</Stack>
						{/if}

						{#if propertiesOpen}
							<div class="rounded-md border border-border/80 bg-background/95 p-2.5">
								<p class="text-overline pb-1.5">{t('component.selected_element_properties')}</p>
								<Scroll
									axis="both"
									name={t('component.selected_element_properties')}
									max="compact"
									class="rounded-md bg-muted/50 p-2 text-micro wrap-break-word text-muted-foreground"
								>
									<Grid as="dl" tracks="minmax(5.5rem, 10rem) 1fr" gap="sm" row_gap="xs">
										{#each item.properties as property (property.name)}
											<dt>{property.name}</dt>
											<dd class="text-foreground">{property.value}</dd>
										{/each}
									</Grid>
								</Scroll>
							</div>
						{/if}
					</Stack>
				{/if}
			</div>

			<Stack align="end" gap="xs" class="pointer-events-auto">
				<Inline align="center" gap="xs">
					<Button
						size="icon"
						variant={sectionPanelOpen || sectionActive ? 'secondary' : 'ghost'}
						aria-pressed={sectionPanelOpen}
						hint={t('component.axis_section_scrubbers')}
						onclick={() => (sectionPanelOpen = !sectionPanelOpen)}
					>
						<Icon icon="lucide:sliders-horizontal" />
					</Button>
					<Button
						size="icon"
						variant="ghost"
						hint={t('component.reset_camera_view')}
						onclick={refitModel}
					>
						<Icon icon="lucide:maximize-2" />
					</Button>
					<Button
						size="icon"
						variant={interactionLocked ? 'secondary' : 'ghost'}
						aria-pressed={!interactionLocked}
						hint={interactionLocked
							? t('component.unlock_model_navigation')
							: t('component.lock_model_navigation')}
						onclick={toggleInteractionLock}
					>
						<Icon icon={interactionLocked ? 'lucide:lock' : 'lucide:unlock'} />
					</Button>
				</Inline>

				{#if sectionPanelOpen && modelBounds}
					<Stack
						gap="xs"
						class="w-56 rounded-md border border-border/80 bg-background/95 p-3 shadow-sm"
					>
						<Inline align="center" justify="between">
							<p class="text-overline">{t('component.axis_section_scrubbers')}</p>
							{#if sectionActive}
								<button
									type="button"
									class="text-micro text-muted-foreground underline hover:text-foreground"
									onclick={resetAxes}
								>
									{t('component.reset_axes')}
								</button>
							{/if}
						</Inline>
						<label class="grid gap-1 text-micro text-muted-foreground">
							<Inline justify="between">
								<span>{t('component.axis_y_elevation')}</span>
								<span class="tabular-nums text-foreground">{cutY}%</span>
							</Inline>
							<input
								type="range"
								min="0"
								max="100"
								step="1"
								bind:value={cutY}
								class="accent-primary h-1.5 w-full cursor-pointer"
							/>
						</label>
						<label class="grid gap-1 text-micro text-muted-foreground">
							<Inline justify="between">
								<span>{t('component.axis_x_section')}</span>
								<span class="tabular-nums text-foreground">{cutX}%</span>
							</Inline>
							<input
								type="range"
								min="0"
								max="100"
								step="1"
								bind:value={cutX}
								class="accent-primary h-1.5 w-full cursor-pointer"
							/>
						</label>
						<label class="grid gap-1 text-micro text-muted-foreground">
							<Inline justify="between">
								<span>{t('component.axis_z_section')}</span>
								<span class="tabular-nums text-foreground">{cutZ}%</span>
							</Inline>
							<input
								type="range"
								min="0"
								max="100"
								step="1"
								bind:value={cutZ}
								class="accent-primary h-1.5 w-full cursor-pointer"
							/>
						</label>
					</Stack>
				{/if}
			</Stack>
		</Inline>
	</Imposter>

	{#if normalizedMarkerGroups.length > 0}
		<Imposter
			placement="bottom-start"
			class="pointer-events-none max-w-[min(16rem,85%)] rounded-md border border-border/80 bg-background/90 p-2 shadow-sm"
			aria-label={t('component.marker_legend')}
		>
			<Stack gap="xs">
				<p class="text-overline">{t('component.highlights')}</p>
				<Stack as="ul" gap="xs">
					{#each normalizedMarkerGroups as group (group.label + group.color + group.expressIds.join(','))}
						<li>
							<Inline gap="xs" class="text-micro text-foreground">
								<span
									class="size-2.5 shrink-0 rounded-sm border border-border/60"
									style={`background-color: ${group.color}`}
									aria-hidden="true"
								></span>
								<span class="min-w-0 truncate">{group.label}</span>
							</Inline>
						</li>
					{/each}
				</Stack>
			</Stack>
		</Imposter>
	{/if}
</Bound>
