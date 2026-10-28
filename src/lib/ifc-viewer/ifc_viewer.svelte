<script lang="ts">
	import { run, fork, attach, bolt } from '$bolt';
	import Icon from '@iconify/svelte';
	import { Effect, Schema } from 'effect';
	import { Button, cn } from '@norbital-ai/ui';
	import { Bound, Grid, Imposter, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { watch } from 'runed';
	import { convertIfcToFragments } from './ifc_viewer.converter.js';
	import {
		type IFCViewerMarkerGroup,
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
	/** The four esm.sh module graphs the viewer needs, loaded once per mounting build. */
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
	type SelectedItem = {
		title: string;
		subtitle: string | null;
		properties: readonly { readonly name: string; readonly value: string }[];
	};
	type LoadBanner =
		| 'none'
		| 'loading'
		| {
				error: string;
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
	const DEFAULT_SHOW_GRID = false;
	function resolveCssColor(css: string): string {
		if (!css.startsWith('var(')) return css;
		const name = css.slice(4, -1).trim();
		const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
		return value || '#f2f1ed';
	}
	interface Props extends IFCViewerProps {}
	let { src, alt, markers = [], markerGroups }: Props = $props();
	const t = bolt.t;
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
	let selectedItem = $state<SelectedItem | null>(null);
	let loadBanner = $state<LoadBanner>('none');
	let interactionLocked = $state(true);
	let propertiesOpen = $state(false);
	let viewer = $state.raw<IFCViewerRuntime | null>(null);
	let markerSyncFrame = $state.raw(0);
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
		const trimmed = head.trimStart();
		const lower = trimmed.toLowerCase();
		if (lower.startsWith('<!doctype html') || lower.startsWith('<html')) {
			return Effect.fail(new Error(t('component.ifc_html_instead_of_bytes')));
		}
		return Effect.void;
	}
	/** Each conversion and fragment load has its own labelled wall. */
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
			Effect.catch((error) =>
				Effect.logDebug(
					'[IFCViewer] Using the fallback filename for an invalid model URL.',
					error
				).pipe(Effect.as('ifc-model.ifc'))
			)
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
				}).pipe(
					Effect.catch((error) =>
						Effect.logError('[IFCViewer] Failed to clear the selection.', error)
					)
				)
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
			Effect.catch((error) =>
				Effect.logDebug('[IFCViewer] Using the fallback marker color.', error).pipe(
					Effect.andThen(
						Effect.try({
							try: () => color.setStyle(resolveCssColor(DEFAULT_MARKER_COLOR)),
							catch: viewerFailure('parse-fallback-marker-color')
						})
					)
				)
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
	function buildSelectedItem(properties: ViewerItemData | null): SelectedItem {
		const name = readPropertyValue(properties, 'Name');
		const entityType = readPropertyValue(properties, 'type');
		return {
			title: name ?? entityType ?? t('component.ifc_element'),
			subtitle: name == null ? null : entityType,
			// the element's named attributes; `_`-prefixed engine keys and the GlobalId are identifiers, not facts
			properties: Object.keys(properties ?? {}).flatMap((key) => {
				const value =
					key.startsWith('_') || key === 'GlobalId' ? null : readPropertyValue(properties, key);
				return value == null ? [] : [{ name: key, value }];
			})
		};
	}
	function clearMarkerVisualization(runtime: IFCViewerRuntime) {
		// `suspend` keeps the read of `runtime.highlighter` where it was: on every run of the effect,
		// not once when it is described.
		return Effect.suspend(() => {
			const highlighter = runtime.highlighter;
			// Highlighter state must be cleared before the matching style is deleted.
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
				}).pipe(
					Effect.catch((error) =>
						Effect.logError('[IFCViewer] Failed to clear the selection.', error)
					)
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
				if (DEFAULT_SHOW_GRID) {
					components.get(OBC.Grids).create(world);
				}
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
		if (runtime.highlighter !== null) {
			return runtime.highlighter;
		}
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
			});
			// Frame the model by its own bounds: the default camera sits far out and a building renders a speck. The
			// camera skips its own update while scroll-safe mode locks it, so the fit is applied here.
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
						yield* disposeRuntime(runtime).pipe(
							Effect.tapError((error) =>
								Effect.logError('[IFCViewer] Failed to dispose viewer runtime.', error)
							),
							Effect.ignore
						);
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
			if (needsInteraction) {
				ensureInteractionSystems(runtime);
			}
			yield* clearMarkerVisualization(runtime);
			const highlighter = runtime.highlighter;
			if (highlighter === null) return;
			if (normalizedMarkerGroups.length > 0) {
				// Each style must be registered before its ordered highlighter mutation.
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
			const selectedModel = runtime.fragments.list.get(modelId);
			const properties = selectedModel
				? (yield* Effect.tryPromise({
						try: () => selectedModel.getItemsData([id]),
						catch: viewerFailure('read-item-properties')
					}))[0]
				: null;
			if (viewer !== runtime) return;
			selectedItem = buildSelectedItem(properties ?? null);
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
</script>

<Bound size="standard" clip class="relative rounded-lg border border-border/80 bg-muted/20">
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
			<Inline align="center" justify="center" fill>
				<p class="text-sm text-muted-foreground">{t('component.loading_ifc_model')}</p>
			</Inline>
		</Imposter>
	{:else if typeof loadBanner === 'object'}
		<Imposter placement="fill" class="pointer-events-auto bg-background/85 p-4">
			<Inline align="center" justify="center" fill>
				<p class="max-w-sm text-center text-sm text-destructive">
					{loadBanner.error}
				</p>
			</Inline>
		</Imposter>
	{:else if !trimmedSrc}
		<Imposter placement="fill" class="p-4">
			<Inline align="center" justify="center" fill>
				<p class="text-sm text-muted-foreground">{t('component.no_ifc_model')}</p>
			</Inline>
		</Imposter>
	{/if}

	<!-- After the banners in source order: every Imposter shares one z-layer, so paint order is DOM order. -->
	<Imposter placement="top" class="pointer-events-none p-3">
		<Inline align="start" justify="between" gap="sm">
			<div class="min-w-0 w-full max-w-[min(38rem,100%)]">
				{#if selectedItem}
					{@const item = selectedItem}
					<Stack
						gap="xs"
						class="pointer-events-auto rounded-md border border-border/80 bg-background/95 p-2 shadow-sm"
					>
						<button
							type="button"
							class="w-full min-w-0 rounded-sm px-1 py-1 text-left transition-colors hover:bg-muted/60"
							onclick={() => (propertiesOpen = !propertiesOpen)}
						>
							<Inline align="start" justify="between" gap="xs">
								<div class="min-w-0">
									<span class="block truncate text-sm font-medium text-foreground">
										{item.title}
									</span>
									{#if item.subtitle}
										<span class="block truncate text-[11px] text-muted-foreground">
											{item.subtitle}
										</span>
									{/if}
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
							class="shrink-0 self-start"
							onclick={clearSelection}
						>
							<Icon icon="lucide:x" />
						</Button>

						{#if propertiesOpen}
							<div class="rounded-md border border-border/80 bg-background/95 p-3 shadow-sm">
								<p class="text-overline pb-2">
									{t('component.selected_element_properties')}
								</p>
								<Scroll
									axis="both"
									name="Selected element properties"
									class="max-h-80 rounded-md bg-muted/50 p-3 text-[11px] wrap-break-word text-muted-foreground"
								>
									<Grid as="dl" tracks="minmax(6rem, 12rem) 1fr" gap="sm" rowGap="xs">
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

			<Inline align="center" gap="sm" class="pointer-events-auto">
				{#if interactionLocked}
					<div
						class="hidden rounded-md border border-border/80 bg-background/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm sm:block"
					>
						{t('component.scroll_safe_mode')}
					</div>
				{/if}
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
		</Inline>
	</Imposter>

	{#if normalizedMarkerGroups.length > 0}
		<Imposter
			placement="bottom-start"
			class="pointer-events-none max-w-[min(16rem,85%)] rounded-md border border-border/80 bg-background/90 p-2 shadow-sm"
			aria-label={t('component.marker_legend')}
		>
			<Stack gap="sm">
				<p class="text-overline">
					{t('component.highlights')}
				</p>
				<Stack as="ul" gap="xs">
					{#each normalizedMarkerGroups as group (group.label + group.color + group.expressIds.join(','))}
						<li>
							<Inline gap="xs" class="text-[11px] text-foreground">
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
