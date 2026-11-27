<script lang="ts">
	import { Effect } from 'effect';
	import { Badge, Button, Icon, Spinner, Surface, cn } from '@norbital-ai/ui';
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
		ViewerOperationFailed,
		applyClippingPlanes,
		applyNavigationControls,
		clearSelectionEffect,
		createViewerRuntime,
		disposeRuntime,
		focusSelectedEffect,
		framePresetEffect,
		loadFragmentsIntoRuntime,
		normalizeFileUrlForSameOrigin,
		nudgeCameraEffect,
		pickElementEffect,
		resolveFragmentBytes,
		showWholeModelEffect,
		syncMarkerVisualizationEffect,
		zoomByEffect,
		type CameraPreset,
		type IFCViewerRuntime,
		type LoadBanner,
		type ModelBounds,
		type NavMode
	} from './engine.js';
	import { messageOf, type IFCSelectedElement, type IFCViewerProps } from './types.js';

	const PICK_DRAG_THRESHOLD_PX = 5;

	let {
		t,
		src,
		alt,
		markers = [],
		markerGroups,
		tasks = [],
		focus = null,
		initialNavMode = 'orbit',
		taggedExpressIds = [],
		onToggleTag,
		onClearFocus,
		onCreateTask,
		onOpenTask,
		excludeClasses
	}: IFCViewerProps = $props();

	const normalizedExcludeClasses = $derived(
		excludeClasses && excludeClasses.length > 0
			? [...new Set(excludeClasses.map((c) => c.trim().toUpperCase()).filter(Boolean))].sort()
			: ['IFCOPENINGELEMENT', 'IFCSPACE']
	);
	const excludeCacheSuffix = $derived(normalizedExcludeClasses.join(','));
	const focusKey = $derived(focus === null ? '' : `${focus.label}:${focus.expressIds.join(',')}`);
	const trimmedSrc = $derived(src?.trim() ?? '');
	const markerKey = $derived(markers.join(','));
	const normalizedMarkerGroups = $derived(
		(markerGroups ?? [])
			.map((g) => ({ label: g.label, color: g.color, expressIds: g.expressIds }))
			.filter((g) => g.expressIds.length > 0)
	);
	const markerGroupsKey = $derived(JSON.stringify(normalizedMarkerGroups));

	let framedFocusKey = '';
	let selectedItem = $state<IFCSelectedElement | null>(null);
	let loadBanner = $state<LoadBanner>('none');
	let interactionLocked = $state(false);
	// svelte-ignore state_referenced_locally
	let navMode = $state<NavMode>(initialNavMode);
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

	const selectedElementTasks = $derived.by(() => {
		const picked = selectedItem?.expressId;
		return picked === undefined ? [] : tasks.filter((task) => task.expressIds.includes(picked));
	});
	const sectionActive = $derived(cutX < 100 || cutY < 100 || cutZ < 100);
	const effectivePan = $derived(navMode === 'pan' || shiftPanning);
	const loadingMessage = $derived(
		loadBanner === 'downloading'
			? t('component.downloading_ifc_model')
			: loadBanner === 'converting'
				? t('component.converting_ifc_model')
				: loadBanner === 'loading'
					? t('component.loading_ifc_model')
					: ''
	);
	const canvasCursorClass = $derived(
		interactionLocked
			? 'cursor-default touch-pan-y'
			: effectivePan
				? 'cursor-move touch-none'
				: navMode === 'inspect'
					? 'cursor-crosshair touch-none'
					: 'cursor-grab active:cursor-grabbing touch-none'
	);

	function resetAxes() {
		cutX = 100;
		cutY = 100;
		cutZ = 100;
	}
	function resetSelectionState() {
		propertiesOpen = false;
		selectedItem = null;
	}
	function clearSelection() {
		resetSelectionState();
		if (viewer) void run(clearSelectionEffect(viewer));
	}
	function framePreset(preset: CameraPreset) {
		if (viewer) fork(framePresetEffect(viewer, modelBounds, preset, true), () => {});
	}
	function zoomBy(direction: 1 | -1) {
		if (viewer) fork(zoomByEffect(viewer, modelBounds, direction), () => {});
	}
	function focusSelected() {
		if (viewer && selectedItem?.pin) fork(focusSelectedEffect(viewer, selectedItem.pin), () => {});
	}

	function cancelMarkerFrame() {
		if (markerSyncFrame !== 0 && typeof globalThis.cancelAnimationFrame === 'function') {
			cancelAnimationFrame(markerSyncFrame);
			markerSyncFrame = 0;
		}
	}
	function runMarkerSync() {
		const runtime = viewer;
		if (!runtime?.currentGroup) return;
		fork(
			syncMarkerVisualizationEffect(runtime, {
				focus,
				focusKey,
				framedFocusKey,
				markers,
				markerGroups: normalizedMarkerGroups
			}).pipe(
				Effect.tap((nextKey) =>
					Effect.sync(() => {
						framedFocusKey = nextKey;
					})
				)
			),
			(failure) => {
				loadBanner = { error: messageOf(failure) };
			}
		);
	}
	function scheduleMarkerVisualization() {
		if (typeof globalThis.requestAnimationFrame !== 'function') return runMarkerSync();
		cancelMarkerFrame();
		markerSyncFrame = requestAnimationFrame(() => {
			markerSyncFrame = 0;
			runMarkerSync();
		});
	}

	const viewerAttach = $derived(
		attach((node: HTMLDivElement) =>
			Effect.gen(function* () {
				if (!trimmedSrc) {
					cancelMarkerFrame();
					resetSelectionState();
					viewer = null;
					modelBounds = null;
					loadBanner = 'none';
					return;
				}
				loadBanner = 'loading';
				const { fetchUrl, cacheKey } = yield* normalizeFileUrlForSameOrigin(
					trimmedSrc,
					window.location.origin
				);
				const [runtime, fragmentBytes] = yield* Effect.all(
					[
						Effect.acquireRelease(createViewerRuntime(node, effectivePan), (rt) =>
							Effect.gen(function* () {
								if (viewer === rt) {
									viewer = null;
									resetSelectionState();
								}
								yield* disposeRuntime(rt).pipe(Effect.ignore);
							})
						),
						resolveFragmentBytes(
							fetchUrl,
							`${cacheKey}::excl=${excludeCacheSuffix}`,
							normalizedExcludeClasses,
							t,
							(b) => {
								loadBanner = b;
							}
						)
					],
					{ concurrency: 'unbounded' }
				);
				viewer = runtime;
				runtime.world.camera.enabled = !interactionLocked;
				loadBanner = 'loading';
				modelBounds = yield* loadFragmentsIntoRuntime(
					runtime,
					fetchUrl,
					fragmentBytes,
					t,
					effectivePan,
					cutX,
					cutY,
					cutZ
				);
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
				Effect.ensuring(Effect.sync(cancelMarkerFrame))
			)
		)
	);

	function handleCanvasClick(event: MouseEvent) {
		const down = pointerDown;
		pointerDown = null;
		if (
			down !== null &&
			(down.button !== 0 ||
				Math.hypot(event.clientX - down.x, event.clientY - down.y) > PICK_DRAG_THRESHOLD_PX)
		) {
			return;
		}
		if (!(navMode === 'inspect' || event.metaKey || event.ctrlKey)) return;
		const runtime = viewer;
		if (!runtime?.currentGroup) return;
		fork(
			pickElementEffect(runtime, t).pipe(
				Effect.tap((picked) =>
					Effect.sync(() => {
						if (viewer !== runtime) return;
						if (picked === null) clearSelection();
						else selectedItem = picked;
					})
				)
			),
			(failure) => {
				loadBanner = { error: messageOf(failure) };
			}
		);
	}

	function handleCanvasKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') return clearSelection();
		if (!viewer || interactionLocked) return;
		if (event.key.toLowerCase() === 'r') {
			event.preventDefault();
			return framePreset('iso');
		}
		const nudge = nudgeCameraEffect(viewer, modelBounds, event.key);
		if (nudge) {
			event.preventDefault();
			fork(nudge, () => {});
		}
	}

	watch(
		() => interactionLocked,
		(locked) => {
			if (viewer) viewer.world.camera.enabled = !locked;
		}
	);
	watch(
		() => effectivePan,
		(pan) => {
			if (viewer) applyNavigationControls(viewer, pan);
		}
	);
	watch(
		() => [markerKey, markerGroupsKey] as const,
		() => scheduleMarkerVisualization()
	);
	watch(
		() => [cutX, cutY, cutZ, modelBounds] as const,
		() => {
			if (viewer) applyClippingPlanes(viewer, modelBounds, cutX, cutY, cutZ);
		}
	);
	watch(
		() => focusKey,
		(key) => {
			if (!viewer?.currentGroup) return;
			if (key !== '') return scheduleMarkerVisualization();
			framedFocusKey = '';
			fork(
				showWholeModelEffect(viewer, modelBounds).pipe(
					Effect.andThen(Effect.sync(scheduleMarkerVisualization))
				),
				() => {}
			);
		}
	);

	const axisSliders = $derived([
		{
			id: 'y',
			label: t('component.axis_y_elevation'),
			value: cutY,
			slider: create_slider({
				min: 0,
				max: 100,
				step: 1,
				value: () => cutY,
				on_change: (v) => (cutY = v),
				label: t('component.axis_y_elevation')
			})
		},
		{
			id: 'x',
			label: t('component.axis_x_section'),
			value: cutX,
			slider: create_slider({
				min: 0,
				max: 100,
				step: 1,
				value: () => cutX,
				on_change: (v) => (cutX = v),
				label: t('component.axis_x_section')
			})
		},
		{
			id: 'z',
			label: t('component.axis_z_section'),
			value: cutZ,
			slider: create_slider({
				min: 0,
				max: 100,
				step: 1,
				value: () => cutZ,
				on_change: (v) => (cutZ = v),
				label: t('component.axis_z_section')
			})
		}
	]);

	const navModeGroup = create_toggle_group({
		items: () => ['orbit', 'pan', 'inspect'],
		mode: 'single',
		value: () => [navMode],
		on_change: (values) => {
			const next = values[0];
			navMode = next === 'orbit' || next === 'pan' || next === 'inspect' ? next : 'orbit';
		}
	});
	const propertiesDisclosure = create_disclosure({
		open: () => propertiesOpen,
		on_open_change: (n) => (propertiesOpen = n)
	});
	const sectionDisclosure = create_disclosure({
		open: () => sectionPanelOpen,
		on_open_change: (n) => (sectionPanelOpen = n)
	});
	const lockSwitch = create_switch({
		checked: () => interactionLocked,
		on_change: (n) => (interactionLocked = n)
	});

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
				reset_view: () => framePreset('iso'),
				reset_axes: resetAxes,
				clear_selection: clearSelection,
				toggle_lock: () => {
					interactionLocked = !interactionLocked;
				}
			}
		})
	);
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Shift') shiftPanning = true;
	}}
	onkeyup={(e) => {
		if (e.key === 'Shift') shiftPanning = false;
	}}
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
			onpointerdown={(e) => {
				pointerDown = { x: e.clientX, y: e.clientY, button: e.button };
			}}
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
											<span class="block truncate text-xs font-medium leading-tight text-foreground"
												>{item.title}</span
											>
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

							{#if onToggleTag}
								{@const isTagged = taggedExpressIds.includes(item.expressId)}
								<Inline align="center" justify="between" gap="xs" class="pt-1">
									<span class="text-micro leading-tight text-muted-foreground">
										{isTagged ? t('tasks.bim_element_tagged') : t('tasks.bim_element_not_tagged')}
									</span>
									<Button
										variant={isTagged ? 'outline' : 'brand'}
										class="h-6 px-2 text-micro"
										onclick={() => onToggleTag?.(item)}
									>
										<Icon name={isTagged ? 'lucide:x' : 'lucide:tag'} class="size-3" />
										{isTagged ? t('tasks.bim_untag_element') : t('tasks.bim_tag_element')}
									</Button>
								</Inline>
							{/if}

							{#if onCreateTask}
								<Inline align="center" justify="between" gap="xs" class="pt-1">
									<span class="text-micro leading-tight text-muted-foreground">
										{selectedElementTasks.length > 0
											? t('component.element_tasks_count', { count: selectedElementTasks.length })
											: t('component.element_no_task')}
									</span>
									<Button
										variant="brand"
										class="h-6 px-2 text-micro"
										onclick={() => onCreateTask?.(item)}
									>
										<Icon name="lucide:list-plus" class="size-3" />
										{t('component.create_bim_task')}
									</Button>
								</Inline>
							{/if}

							{#if selectedElementTasks.length > 0}
								<Stack gap="xs" class="pt-1">
									{#each selectedElementTasks as task (task.id)}
										<Surface tone="subtle" padding="xs" radius="control">
											<button
												type="button"
												class="w-full text-left"
												onclick={() => onOpenTask?.(task.id)}
											>
												<Inline align="center" justify="between" gap="xs">
													<span class="min-w-0 truncate text-xs font-medium text-foreground"
														>{task.label}</span
													>
												</Inline>
											</button>
										</Surface>
									{/each}
								</Stack>
							{/if}

							{#if propertiesOpen}
								<Stack {...propertiesDisclosure.content_attrs()} gap="xs" class="pt-1">
									<p class="text-overline">
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
					class="flex items-center gap-1 rounded-control border border-border bg-popover/90 p-0.5 backdrop-blur-xs"
				>
					<div class="flex items-center gap-0.5" {...navModeGroup.root_attrs()}>
						{#each [['orbit', 'lucide:orbit', t('component.nav_mode_orbit')], ['pan', 'lucide:hand', t('component.nav_mode_pan')], ['inspect', 'lucide:mouse-pointer-click', t('component.nav_mode_inspect')]] as const as [mode, icon, hint] (mode)}
							<Button
								{...navModeGroup.item_attrs(mode)}
								{@attach navModeGroup.item(mode)}
								size="icon"
								variant={navMode === mode ? 'secondary' : 'ghost'}
								class="size-7"
								{hint}
							>
								<Icon name={icon} class="size-3.5" />
							</Button>
						{/each}
					</div>
					<span class="h-4 w-px bg-border" aria-hidden="true"></span>
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
						onclick={() => framePreset('iso')}
					>
						<Icon name="lucide:maximize-2" class="size-3.5" />
					</Button>
					<span class="h-4 w-px bg-border" aria-hidden="true"></span>
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
							<Stack gap="sm">
								<Inline align="center" justify="between" gap="sm">
									<p class="text-overline">
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
								</Inline>
								{#each axisSliders as axis (axis.id)}
									<Stack gap="none">
										<Inline align="center" justify="between" class="text-micro leading-tight">
											<span class="text-muted-foreground">{axis.label}</span>
											<span class="tabular-nums text-foreground">{axis.value}%</span>
										</Inline>
										<div
											class="relative flex h-3.5 w-full cursor-pointer items-center"
											{@attach axis.slider.track}
										>
											<div class="h-1 w-full rounded-full bg-muted">
												<div
													class="h-full rounded-full bg-primary"
													style={`width: ${axis.slider.percent}%`}
												></div>
											</div>
											<div
												class="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow-xs"
												style={`left: ${axis.slider.percent}%`}
												{...axis.slider.thumb_attrs()}
											></div>
										</div>
									</Stack>
								{/each}
							</Stack>
						</Surface>
					</div>
				{/if}
			</Stack>
		</Inline>
	</Imposter>

	{#if focus}
		<Imposter placement="bottom-start" offset="sm" class="pointer-events-auto max-w-72">
			<Surface tone="popover" padding="xs" radius="control">
				<Inline align="center" justify="between" gap="sm">
					<span class="min-w-0 truncate text-micro text-foreground">
						{t('component.showing_focus_only', { label: focus.label })}
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
				<Stack gap="xs">
					<p class="text-overline">{t('component.highlights')}</p>
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
				</Stack>
			</div>
		</Imposter>
	{/if}

	{#if modelBounds && !focus}
		<Imposter placement="bottom-end" offset="sm" class="pointer-events-none">
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
