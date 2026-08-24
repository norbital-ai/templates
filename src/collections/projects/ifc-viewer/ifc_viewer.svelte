<script lang="ts">
	import Icon from '@iconify/svelte';
	import { Effect } from 'effect';
	import { getErrorMessage } from '@norbital-ai/std';
	import { Button } from '@norbital-ai/ui/button';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Bound, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { cn } from '@norbital-ai/ui/utils';
	import { watch } from 'runed';
	import { convertIfcToFragments } from './ifc_viewer.converter.js';
	import type {
		IFCViewerMarkerGroup,
		IFCViewerProps,
		ViewerColor,
		ViewerColorConstructor,
		ViewerComponents,
		ViewerComponentsModule,
		ViewerFragmentsManager,
		ViewerFragmentsModel,
		ViewerFragmentsModule,
		ViewerFrontendModule,
		ViewerHighlighter,
		ViewerItemData,
		ViewerThreeModule,
		ViewerWorld
	} from './ifc_viewer.types.js';

	/** The four esm.sh module graphs the viewer needs, loaded once per mounting build. */
	const viewerLibraries = Effect.cached(
		Effect.all([
			Effect.tryPromise(
				() =>
					import(
						/* @vite-ignore */ 'https://esm.sh/@thatopen/components@3.4.6?deps=three@0.185.1,@thatopen/fragments@3.4.6,web-ifc@0.0.77,camera-controls@3.1.2'
					)
			),
			Effect.tryPromise(
				() =>
					import(
						/* @vite-ignore */ 'https://esm.sh/@thatopen/components-front@3.4.3?deps=@thatopen/components@3.4.6,@thatopen/fragments@3.4.6,three@0.185.1,web-ifc@0.0.77,camera-controls@3.1.2'
					)
			),
			Effect.tryPromise(
				() =>
					import(
						/* @vite-ignore */ 'https://esm.sh/@thatopen/fragments@3.4.6?deps=three@0.185.1,web-ifc@0.0.77'
					)
			),
			Effect.tryPromise(() => import(/* @vite-ignore */ 'https://esm.sh/three@0.185.1'))
		])
	);

	function normalizeFileUrlForSameOrigin(
		rawUrl: string,
		origin: string
	): Effect.Effect<string, never> {
		return Effect.try(() => {
			const base = origin.endsWith('/') ? origin : `${origin}/`;
			const parsed = new URL(rawUrl, base);
			if (parsed.pathname.startsWith('/api/files/')) {
				const originRoot = origin.replace(/\/$/, '');
				return `${originRoot}${parsed.pathname}${parsed.search}${parsed.hash}`;
			}
			return parsed.href;
		}).pipe(Effect.catch(() => Effect.succeed(rawUrl)));
	}

	type SelectedItem = {
		modelId: string;
		id: number;
		title: string;
		subtitle: string | null;
		properties: string;
	};

	type LoadBanner = 'none' | 'loading' | { error: string };

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

	const IFC_FETCH_TIMEOUT_MS = 120_000;
	const IFC_CONVERSION_TIMEOUT_MS = 60_000;
	const IFC_FRAGMENT_LOAD_TIMEOUT_MS = 120_000;
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

	const { t } = useI18n<TenantI18nKeys>();

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

	function fetchIfcModelResponse(url: string): Effect.Effect<Response, unknown> {
		return Effect.tryPromise(() =>
			fetch(url, { signal: AbortSignal.timeout(IFC_FETCH_TIMEOUT_MS) })
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

	/**
	 * Rejects `effect` after `timeoutMs` with a labelled timeout error.
	 *
	 * The old `@norbital-ai/std` `withTimeout` was removed from the package; the conversion and
	 * fragment-load steps still need the same guard, so the template keeps the identical contract
	 * locally. The label names the step in the error message, matching the previous wording.
	 */
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
		return Effect.try(() => new URL(url, window.location.href)).pipe(
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
			void Effect.runPromise(
				Effect.tryPromise(() => highlighter.clear('select')).pipe(
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
		if (markerSyncFrame === 0 || typeof cancelAnimationFrame !== 'function') return;
		cancelAnimationFrame(markerSyncFrame);
		markerSyncFrame = 0;
	}

	function scheduleMarkerVisualization(): void {
		if (typeof requestAnimationFrame !== 'function') {
			void Effect.runPromise(syncMarkerVisualization());
			return;
		}

		cancelScheduledMarkerVisualization();
		markerSyncFrame = requestAnimationFrame(() => {
			markerSyncFrame = 0;
			void Effect.runPromise(syncMarkerVisualization());
		});
	}

	function parseMarkerColor(
		css: string,
		Color: ViewerColorConstructor
	): Effect.Effect<ViewerColor, never> {
		const color = new Color();
		return Effect.try(() => color.setStyle(resolveCssColor(css.trim()))).pipe(
			Effect.catch(() => Effect.sync(() => color.setStyle(resolveCssColor(DEFAULT_MARKER_COLOR)))),
			Effect.as(color)
		);
	}

	function readPropertyValue(properties: ViewerItemData | null, key: string): string | null {
		if (properties == null) return null;
		const rawValue = properties[key];
		if (rawValue == null || Array.isArray(rawValue)) return null;
		if (typeof rawValue.value === 'string' || typeof rawValue.value === 'number') {
			return String(rawValue.value);
		}
		return null;
	}

	function buildSelectedItem(
		modelId: string,
		id: number,
		properties: ViewerItemData | null
	): SelectedItem {
		const name = readPropertyValue(properties, 'Name');
		const entityType = readPropertyValue(properties, 'type');
		const globalId = readPropertyValue(properties, 'GlobalId');
		const subtitleParts = [entityType, globalId ? `Global ID ${globalId}` : null].filter(
			(part): part is string => part != null
		);

		return {
			modelId,
			id,
			title: name ?? `Element #${id}`,
			subtitle: subtitleParts.length > 0 ? subtitleParts.join(' • ') : null,
			properties: JSON.stringify(properties, null, 2)
		};
	}

	function clearMarkerVisualization(runtime: IFCViewerRuntime): Effect.Effect<void, unknown> {
		// `suspend` keeps the read of `runtime.highlighter` where it was: on every run of the effect,
		// not once when it is described.
		return Effect.suspend(() => {
			const highlighter = runtime.highlighter;
			// Highlighter state must be cleared before the matching style is deleted.
			const cleared: Effect.Effect<unknown, unknown> =
				highlighter === null
					? Effect.void
					: Effect.forEach(runtime.markerStyleIds, (styleId) =>
							Effect.tryPromise(() => highlighter.clear(styleId)).pipe(
								Effect.andThen(() => Effect.sync(() => highlighter.styles.delete(styleId)))
							)
						);
			return Effect.andThen(
				cleared,
				Effect.sync(() => {
					runtime.markerStyleIds = [];
				})
			);
		});
	}

	function clearModel(runtime: IFCViewerRuntime): Effect.Effect<void, unknown> {
		return Effect.gen(function* () {
			yield* clearMarkerVisualization(runtime);
			const highlighter = runtime.highlighter;
			if (highlighter !== null) {
				yield* Effect.tryPromise(() => highlighter.clear('select')).pipe(
					Effect.catch((error) =>
						Effect.logError('[IFCViewer] Failed to clear the selection.', error)
					)
				);
			}
			resetSelectionState();
			const group = runtime.currentGroup;
			if (group == null) return;
			runtime.world.scene.three.remove(group.object);
			yield* Effect.tryPromise(() => runtime.fragments.core.disposeModel(group.modelId));
			runtime.currentGroup = null;
		});
	}

	function createViewerRuntime(
		container: HTMLDivElement
	): Effect.Effect<IFCViewerRuntime, unknown> {
		return Effect.gen(function* () {
			const cachedLibraries = yield* viewerLibraries;
			const [OBC, OBF, FRAGS, THREE] = yield* cachedLibraries;
			const components = new OBC.Components();
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
			const worker = yield* Effect.tryPromise(() => OBC.FragmentsManager.getWorker());
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

	function disposeRuntime(runtime: IFCViewerRuntime): Effect.Effect<void, unknown> {
		return Effect.gen(function* () {
			yield* clearModel(runtime);
			yield* Effect.sync(() => runtime.components.dispose());
		});
	}

	function loadIfcModelIntoRuntime(
		runtime: IFCViewerRuntime,
		url: string
	): Effect.Effect<void, unknown> {
		return Effect.gen(function* () {
			const fetchUrl = yield* normalizeFileUrlForSameOrigin(url, window.location.origin);

			const response = yield* fetchIfcModelResponse(fetchUrl);
			if (!response.ok) {
				return yield* Effect.fail(
					new Error(t('component.ifc_download_failed', { status: response.status }))
				);
			}

			const arrayBuffer = yield* Effect.tryPromise(() => response.arrayBuffer());
			const buffer = new Uint8Array(arrayBuffer);
			yield* assertIfcBodyNotHtml(response, buffer);

			const modelName = yield* getModelName(fetchUrl);
			const fragmentBytes = yield* withTimeout(
				convertIfcToFragments(buffer, t),
				IFC_CONVERSION_TIMEOUT_MS,
				t('component.ifc_conversion')
			);

			const group = yield* withTimeout(
				Effect.tryPromise(() =>
					runtime.fragments.core.load(fragmentBytes, {
						modelId: modelName,
						camera: runtime.world.camera.three
					})
				),
				IFC_FRAGMENT_LOAD_TIMEOUT_MS,
				t('component.ifc_fragment_load')
			);

			yield* Effect.sync(() => {
				runtime.world.scene.three.add(group.object);
				runtime.currentGroup = group;
			});
		});
	}

	function viewerAttachment(url: string) {
		return (node: Element) => {
			if (!(node instanceof HTMLDivElement)) {
				throw new Error('IFC viewer must be mounted on a div element');
			}
			const container = node;
			let cancelled = false;
			let myRuntime: IFCViewerRuntime | null = null;

			// The attachment owns cancellation and teardown for this async lifecycle.
			void Effect.runPromise(
				Effect.gen(function* () {
					if (!url) {
						cancelScheduledMarkerVisualization();
						resetSelectionState();
						viewer = null;
						if (!cancelled) loadBanner = 'none';
						return;
					}
					if (!cancelled) loadBanner = 'loading';

					yield* Effect.gen(function* () {
						const runtime = yield* createViewerRuntime(container);
						if (cancelled) {
							yield* disposeRuntime(runtime);
							return;
						}

						myRuntime = runtime;
						viewer = runtime;
						applyInteractionLock(runtime, interactionLocked);

						yield* loadIfcModelIntoRuntime(runtime, url);
						if (cancelled) return;

						loadBanner = 'none';
						scheduleMarkerVisualization();
					}).pipe(
						Effect.catch((error) => {
							if (cancelled) return Effect.void;
							loadBanner = {
								error:
									error instanceof DOMException && error.name === 'AbortError'
										? t('component.ifc_download_timed_out')
										: error instanceof Error
											? getErrorMessage(error)
											: t('component.ifc_load_failed')
							};
							return Effect.logError(
								'[IFCViewer] Failed to initialize or load IFC viewer.',
								error
							).pipe(
								Effect.andThen(() => {
									const runtime = myRuntime;
									if (!runtime) return Effect.void;
									myRuntime = null;
									if (viewer === runtime) viewer = null;
									return disposeRuntime(runtime).pipe(
										Effect.tapError((disposeError) =>
											Effect.logError(
												'[IFCViewer] Failed to dispose the failed viewer runtime.',
												disposeError
											)
										),
										Effect.ignore
									);
								})
							);
						})
					);
				})
			);

			return () => {
				cancelled = true;
				cancelScheduledMarkerVisualization();
				const runtime = myRuntime;
				myRuntime = null;
				if (viewer === runtime) {
					viewer = null;
				}
				if (runtime) {
					void Effect.runPromise(disposeRuntime(runtime));
				}
			};
		};
	}

	const viewerAttach = $derived(viewerAttachment(trimmedSrc));

	function syncMarkerVisualization(): Effect.Effect<void, unknown> {
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
						yield* Effect.tryPromise(() =>
							highlighter.highlightByID(styleId, fragmentIdMap, true, false)
						);
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
			yield* Effect.tryPromise(() =>
				highlighter.highlightByID(styleId, fragmentIdMap, true, false)
			);
		});
	}

	function handlePick(): Effect.Effect<void, unknown> {
		return Effect.gen(function* () {
			const runtime = viewer;
			const group = runtime?.currentGroup;
			if (!runtime || !group) return;

			const highlighter = ensureInteractionSystems(runtime);
			yield* Effect.tryPromise(() => highlighter.highlight('select', true, false));
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
				? (yield* Effect.tryPromise(() => selectedModel.getItemsData([id])))[0]
				: null;
			if (viewer !== runtime) return;

			selectedItem = buildSelectedItem(modelId, id, properties ?? null);
		});
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		void Effect.runPromise(handlePick());
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
	<div
		class={cn(
			'absolute inset-0 z-0 size-full overscroll-contain border-0 bg-transparent p-0 text-left',
			interactionLocked ? 'touch-pan-y' : 'touch-none'
		)}
		role="button"
		tabindex={0}
		aria-label={alt ?? t('component.ifc_model_preview')}
		onclick={() => void Effect.runPromise(handlePick())}
		onkeydown={handleKeydown}
		{@attach viewerAttach}
	></div>

	<Inline
		align="start"
		justify="between"
		gap="sm"
		class="pointer-events-none absolute inset-x-0 top-0 z-20 p-3"
	>
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
								{:else}
									<span class="block truncate text-[11px] text-muted-foreground">
										{t('component.ifc_element_line', {
											modelId: item.modelId,
											elementId: item.id
										})}
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
								class="max-h-80 rounded-md bg-muted/50 p-3 text-[11px] wrap-break-word whitespace-pre-wrap text-muted-foreground"
							>
								<pre>{item.properties}</pre>
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

	{#if loadBanner === 'loading'}
		<Inline
			align="center"
			justify="center"
			class="pointer-events-auto absolute inset-0 z-10 bg-background/80 p-4"
		>
			<p class="text-sm text-muted-foreground">{t('component.loading_ifc_model')}</p>
		</Inline>
	{:else if typeof loadBanner === 'object'}
		<Inline
			align="center"
			justify="center"
			class="pointer-events-auto absolute inset-0 z-10 bg-background/85 p-4"
		>
			<p class="max-w-sm text-center text-sm text-destructive">
				{loadBanner.error}
			</p>
		</Inline>
	{:else if !trimmedSrc}
		<Inline align="center" justify="center" class="absolute inset-0 z-10 p-4">
			<p class="text-sm text-muted-foreground">{t('component.no_ifc_model')}</p>
		</Inline>
	{/if}

	{#if normalizedMarkerGroups.length > 0}
		<Stack
			gap="sm"
			class="pointer-events-none absolute bottom-2 left-2 z-20 max-w-[min(16rem,85%)] rounded-md border border-border/80 bg-background/90 p-2 shadow-sm"
			aria-label={t('component.marker_legend')}
		>
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
	{/if}
</Bound>
