<script lang="ts">
	/**
	 * Co-located human-in-the-loop BIM asset verification workbench (`projects` → BIM → Assets).
	 *
	 * - Roving-focus filter bar via `create_toggle_group` (Norbius-observable).
	 * - Intrinsic responsive layout (`Surface`, `Stack`, `Inline`, `Cluster`, `Grid`) — zero
	 *   viewport breakpoints, zero margins, zero layout shifts when verifying or amending rows.
	 * - One path per action: click thumbnail for full record details; amend Item Matrix, class,
	 *   continuity, or service directly inline; fixed-slot Verify toggle per row.
	 */
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Alert,
		Badge,
		Button,
		Combobox,
		EmptyState,
		enum_text,
		Icon,
		Image,
		Input,
		open_record,
		Picker,
		Progress,
		Spinner,
		use_act,
		type ComboboxOption
	} from '@norbital-ai/ui';
	import { Bound, Cluster, Grid, Inline, Scroll, Stack, Surface } from '@norbital-ai/ui/layout';
	import type { BimTakeoffLine, ContinuityMode } from '../../../services/bim/schema.js';
	import SegmentedToggle from '../../../services/ui/SegmentedToggle.svelte';

	type ReviewFilter = 'needs_review' | 'unmatched' | 'cleaned' | 'verified' | 'all';
	const FILTERS: readonly ReviewFilter[] = [
		'needs_review',
		'unmatched',
		'cleaned',
		'verified',
		'all'
	];

	let {
		ctx,
		signatures,
		bimAssets = [],
		onInspect3d,
		onRecalculate,
		onRetakeoff,
		recalculating = false,
		costingLocked = false
	}: {
		ctx: PageContext;
		signatures: readonly string[];
		bimAssets?: readonly BimTakeoffLine[];
		onInspect3d?: (expressIds: readonly number[], label: string) => void;
		onRecalculate?: () => void;
		onRetakeoff?: () => void;
		recalculating?: boolean;
		costingLocked?: boolean;
	} = $props();

	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const rawT = (key: string): string => {
		const words: { t(k: string): string } = ctx;
		return words.t(key);
	};
	const canEdit = $derived(ctx.catalog?.asset_mappings?.update !== undefined);
	const saver = use_act(ctx);

	let activeFilter = $state<ReviewFilter>('needs_review');
	let search = $state('');
	let dirtyForRecalc = $state(false);
	let savingRowId = $state<Id<'asset_mappings'> | null>(null);
	let serviceDrafts = $state<Record<string, string>>({});
	let classDrafts = $state<Record<string, string>>({});

	const mappingsQuery = $derived(
		signatures.length > 0
			? ctx.query({
					asset_mappings: {
						where: { signature: { in: [...signatures] } },
						fields: [
							'revision',
							'signature',
							'label',
							'ifc_class',
							'continuity',
							'service',
							'size_mm',
							'picture',
							'source',
							'review_status',
							'confidence',
							'cleanup_note',
							'note'
						],
						item_id: { fields: ['code', 'name', 'unit', 'active'] },
						order_by: { label: 'asc' },
						limit: Math.max(signatures.length, 250)
					}
				})
			: null
	);

	type MappingRow = NonNullable<typeof mappingsQuery>['current'] extends infer A
		? A extends { asset_mappings: { rows: readonly (infer R)[] } }
			? R
			: never
		: never;

	const allRows = $derived<readonly MappingRow[]>(
		mappingsQuery?.current?.asset_mappings.rows ?? []
	);

	const counts = $derived.by(() => {
		let needsReview = 0;
		let flagged = 0;
		let unmatched = 0;
		let cleaned = 0;
		let verified = 0;
		let highConfPending = 0;
		for (const r of allRows) {
			if (r.review_status === 'verified') verified += 1;
			else needsReview += 1;
			if (r.review_status === 'flagged') flagged += 1;
			if (r.item_id == null) unmatched += 1;
			if (r.cleanup_note != null && r.cleanup_note.trim() !== '') cleaned += 1;
			const conf = r.confidence != null ? Number(r.confidence) : 0;
			if (r.review_status !== 'verified' && r.item_id != null && conf >= 0.9) highConfPending += 1;
		}
		return {
			total: allRows.length,
			needsReview,
			flagged,
			unmatched,
			cleaned,
			verified,
			highConfPending
		};
	});

	const verifiedPct = $derived(
		counts.total > 0 ? Math.round((counts.verified / counts.total) * 100) : 0
	);

	function filterLabel(f: ReviewFilter): string {
		if (f === 'needs_review')
			return t('bim_review.filter_needs_review', { count: counts.needsReview });
		if (f === 'unmatched') return t('bim_review.filter_unmatched', { count: counts.unmatched });
		if (f === 'cleaned') return t('bim_review.filter_cleaned', { count: counts.cleaned });
		if (f === 'verified') return t('bim_review.filter_verified', { count: counts.verified });
		return t('bim_review.filter_all', { count: counts.total });
	}

	const visibleRows = $derived.by(() => {
		const q = search.trim().toLowerCase();
		const filtered = allRows.filter((r) => {
			if (activeFilter === 'needs_review' && r.review_status === 'verified') return false;
			if (activeFilter === 'unmatched' && r.item_id != null) return false;
			if (activeFilter === 'cleaned' && (!r.cleanup_note || r.cleanup_note.trim() === ''))
				return false;
			if (activeFilter === 'verified' && r.review_status !== 'verified') return false;
			if (!q) return true;
			return [
				r.label,
				r.ifc_class,
				r.service ?? '',
				r.size_mm ?? '',
				r.continuity,
				r.item_id?.code ?? '',
				r.item_id?.name ?? '',
				r.cleanup_note ?? '',
				r.note ?? ''
			]
				.join(' ')
				.toLowerCase()
				.includes(q);
		});
		const rank = (r: MappingRow) =>
			r.review_status === 'flagged' && r.item_id == null
				? 0
				: r.review_status === 'flagged'
					? 1
					: r.item_id == null
						? 2
						: r.review_status === 'pending'
							? 3
							: 4;
		return [...filtered].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
	});

	const continuityOptions = $derived<readonly ComboboxOption<ContinuityMode>[]>([
		{
			value: 'discontiguous',
			label: enum_text('discontiguous', { t: rawT, model: 'asset_mappings', field: 'continuity' }),
			icon: 'lucide:box'
		},
		{
			value: 'contiguous_linear',
			label: enum_text('contiguous_linear', {
				t: rawT,
				model: 'asset_mappings',
				field: 'continuity'
			}),
			icon: 'lucide:git-commit-horizontal'
		},
		{
			value: 'contiguous_planar',
			label: enum_text('contiguous_planar', {
				t: rawT,
				model: 'asset_mappings',
				field: 'continuity'
			}),
			icon: 'lucide:layers'
		}
	]);

	const expressIdsByCode = $derived.by(() => {
		const map = new Map<string, number[]>();
		for (const line of bimAssets) {
			if (!line.matrix_code || !line.sample_express_ids?.length) continue;
			const list = map.get(line.matrix_code) ?? [];
			for (const eid of line.sample_express_ids) {
				if (list.length >= 40) break;
				if (!list.includes(eid)) list.push(eid);
			}
			map.set(line.matrix_code, list);
		}
		return map;
	});

	const expressIdsByClass = $derived.by(() => {
		const map = new Map<string, number[]>();
		for (const line of bimAssets) {
			if (!line.ifc_class || !line.sample_express_ids?.length) continue;
			const key = line.ifc_class.toUpperCase();
			const list = map.get(key) ?? [];
			for (const eid of line.sample_express_ids) {
				if (list.length >= 40) break;
				if (!list.includes(eid)) list.push(eid);
			}
			map.set(key, list);
		}
		return map;
	});

	function expressIdsFor(row: MappingRow): readonly number[] {
		if (row.item_id?.code) {
			const hit = expressIdsByCode.get(row.item_id.code);
			if (hit && hit.length > 0) return hit;
		}
		return expressIdsByClass.get(row.ifc_class.toUpperCase()) ?? [];
	}

	function savePatch(
		row: MappingRow,
		set: {
			item_id?: Id<'item_matrix'> | null;
			ifc_class?: string;
			continuity?: ContinuityMode;
			service?: string | null;
			review_status?: 'pending' | 'verified' | 'flagged';
		}
	): void {
		if (!canEdit || saver.pending) return;
		savingRowId = row.id;
		saver.run(
			ctx.act({
				'asset_mappings.update': [{ target: { id: row.id, revision: row.revision }, set }]
			}),
			{
				then: () => {
					savingRowId = null;
					dirtyForRecalc = true;
				}
			}
		);
	}

	function commitService(row: MappingRow): void {
		const raw = serviceDrafts[row.id];
		if (raw === undefined) return;
		const next = raw.trim().toLowerCase() || null;
		if (next !== (row.service ?? null)) savePatch(row, { service: next });
	}

	function commitClass(row: MappingRow): void {
		const raw = classDrafts[row.id];
		if (raw === undefined) return;
		const next = raw.trim().toUpperCase();
		if (next && next !== row.ifc_class) savePatch(row, { ifc_class: next });
	}

	function bulkVerifyHighConfidence(): void {
		if (!canEdit || saver.pending) return;
		const targets = allRows.filter((r) => {
			const conf = r.confidence != null ? Number(r.confidence) : 0;
			return r.review_status !== 'verified' && r.item_id != null && conf >= 0.9;
		});
		if (targets.length === 0) return;
		saver.run(
			ctx.act({
				'asset_mappings.update': targets.map((r) => ({
					target: { id: r.id, revision: r.revision },
					set: { review_status: 'verified' as const }
				}))
			}),
			{ then: () => (dirtyForRecalc = true) }
		);
	}

	function statusBadgeVariant(
		status: MappingRow['review_status']
	): 'success' | 'warning' | 'outline' {
		if (status === 'verified') return 'success';
		if (status === 'flagged') return 'warning';
		return 'outline';
	}
</script>

{#if mappingsQuery?.loading && !mappingsQuery.current}
	<Bound size="content" inset>
		<Inline gap="sm" align="center" aria-busy="true">
			<Spinner />
			<span class="text-sm text-muted-foreground">{t('component.loading_summary')}</span>
		</Inline>
	</Bound>
{:else if mappingsQuery?.error}
	<Bound size="content" inset>
		<Alert.Root variant="destructive">
			<Alert.Title>{mappingsQuery.error.message}</Alert.Title>
		</Alert.Root>
	</Bound>
{:else if allRows.length === 0}
	<Bound size="content" inset>
		<EmptyState
			variant="card"
			icon="file"
			title={t('bim_costing.assets_title')}
			hint={t('bim_costing.assets_empty')}
		/>
	</Bound>
{:else}
	<Scroll name={t('bim_costing.assets_title')} size="fill" inset>
		<Stack gap="md">
			<Surface tone="card" padding="md" radius="control">
				<Stack gap="sm">
					<Cluster align="center" justify="between" gap="sm">
						<Stack gap="xs">
							<Inline gap="sm" align="center">
								<span class="text-label">{t('bim_costing.assets_title')}</span>
								<span class="text-meta tabular-nums">
									{t('bim_review.summary_progress', {
										verified: counts.verified,
										total: counts.total,
										flagged: counts.flagged,
										unmatched: counts.unmatched
									})}
								</span>
							</Inline>
							<Progress value={verifiedPct} max={100} class="h-1.5" />
						</Stack>
						<Cluster gap="xs" align="center">
							{#if canEdit}
								<Button
									variant="outline"
									disabled={saver.pending || counts.highConfPending === 0}
									onclick={bulkVerifyHighConfidence}
								>
									<Icon name="lucide:check-check" class="size-3.5" />
									{t('bim_review.bulk_verify', { count: counts.highConfPending })}
								</Button>
							{/if}
							{#if onRetakeoff}
								<Button
									variant="outline"
									disabled={recalculating || costingLocked}
									onclick={() => {
										dirtyForRecalc = false;
										onRetakeoff();
									}}
								>
									<Icon name="lucide:scan-line" class="size-3.5" />
									{t('bim_review.rescan_3d')}
								</Button>
							{/if}
							{#if onRecalculate}
								<Button
									variant={dirtyForRecalc ? 'brand' : 'outline'}
									disabled={recalculating || costingLocked}
									onclick={() => {
										dirtyForRecalc = false;
										onRecalculate();
									}}
								>
									{#if recalculating}
										<Spinner class="size-3.5" />
										{t('bim_review.recalculating')}
									{:else}
										<Icon name="lucide:refresh-cw" class="size-3.5" />
										{t('bim_review.recalculate')}
									{/if}
								</Button>
							{/if}
						</Cluster>
					</Cluster>

					<Cluster align="center" justify="between" gap="sm">
						<SegmentedToggle
							options={FILTERS.map((f) => ({ value: f, label: filterLabel(f) }))}
							value={activeFilter}
							onChange={(next) => (activeFilter = next)}
							label={t('bim_costing.assets_title')}
							control={{
								id: 'construction:bim-review-filter',
								label: t('bim_costing.assets_title')
							}}
						/>
						<Input
							bind:value={search}
							type="search"
							placeholder={`${t('bim_review.col_asset')} / ${t('bim_review.col_class')}…`}
							aria-label={t('bim_review.col_asset')}
							class="text-xs"
						/>
					</Cluster>
				</Stack>
			</Surface>

			{#if visibleRows.length === 0}
				<EmptyState variant="card" icon="file" title={t('bim_review.empty_filter')} />
			{:else}
				<Surface tone="card" padding="none" radius="control">
					<Stack gap="none" divided>
						{#each visibleRows as row (row.id)}
							{@const rowExpressIds = expressIdsFor(row)}
							{@const pct =
								row.confidence != null ? Math.round(Number(row.confidence) * 100) : null}
							{@const isSaving = savingRowId === row.id && saver.pending}
							{@const isVerified = row.review_status === 'verified'}
							<Surface
								tone={row.review_status === 'flagged' ? 'subtle' : 'transparent'}
								padding="sm"
								radius="none"
								bordered={false}
							>
								<Grid minimum="card" gap="sm" align="start">
									<!-- Identity, 4-angle picture & auto-cleanup audit -->
									<Inline gap="sm" align="start">
										<button
											type="button"
											class="shrink-0 overflow-hidden rounded-inset border border-border bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
											onclick={() => open_record('asset_mappings', row.id)}
											title={row.label}
										>
											{#if row.picture}
												<Image
													src={ctx.file_url(row.picture, { preview: 512 })}
													alt={row.label}
													class="size-12"
													image_class="object-cover"
												/>
											{:else}
												<span class="flex size-12 items-center justify-center">
													<Icon name="lucide:box" class="size-4 text-muted-foreground" />
												</span>
											{/if}
										</button>
										<Stack gap="xs">
											<Cluster gap="xs" align="center">
												<span class="text-label" title={row.label}>{row.label}</span>
												{#if row.size_mm}
													<Badge variant="outline" class="font-mono text-tiny">{row.size_mm}</Badge>
												{/if}
											</Cluster>
											<Cluster gap="xs" align="center">
												<Badge variant={statusBadgeVariant(row.review_status)} class="text-tiny">
													{enum_text(row.review_status, {
														t: rawT,
														model: 'asset_mappings',
														field: 'review_status'
													})}
												</Badge>
												<span class="text-meta">
													{enum_text(row.source, {
														t: rawT,
														model: 'asset_mappings',
														field: 'source'
													})}
												</span>
												{#if pct !== null}
													<span class="font-mono text-xs tabular-nums text-muted-foreground"
														>{`${pct}%`}</span
													>
												{/if}
											</Cluster>
											{#if row.cleanup_note}
												<Inline gap="xs" align="center" class="text-micro text-tone-info-text">
													<Icon name="lucide:sparkles" class="size-3 shrink-0" />
													<span class="line-clamp-2">{row.cleanup_note}</span>
												</Inline>
											{/if}
										</Stack>
									</Inline>

									<!-- Class, continuity & service (inline editable) -->
									<Stack gap="xs">
										{#if canEdit}
											<Input
												value={classDrafts[row.id] ?? row.ifc_class}
												oninput={(e) => {
													classDrafts = { ...classDrafts, [row.id]: e.currentTarget.value };
												}}
												onblur={() => commitClass(row)}
												onkeydown={(e) => {
													if (e.key === 'Enter') e.currentTarget.blur();
												}}
												disabled={isSaving}
												aria-label={t('models.asset_mappings.fields.ifc_class')}
												class="font-mono text-micro"
											/>
										{:else}
											<span class="font-mono text-micro text-foreground">{row.ifc_class}</span>
										{/if}
										<Grid minimum="compact" gap="xs">
											<Combobox
												options={continuityOptions}
												value={row.continuity}
												searchable={false}
												disabled={!canEdit || isSaving}
												aria-label={t('models.asset_mappings.fields.continuity')}
												on_change={(next) => {
													if (next && next !== row.continuity) savePatch(row, { continuity: next });
												}}
											/>
											{#if canEdit}
												<Input
													value={serviceDrafts[row.id] ?? row.service ?? ''}
													oninput={(e) => {
														serviceDrafts = { ...serviceDrafts, [row.id]: e.currentTarget.value };
													}}
													onblur={() => commitService(row)}
													onkeydown={(e) => {
														if (e.key === 'Enter') e.currentTarget.blur();
													}}
													disabled={isSaving}
													placeholder={t('bim_review.service_placeholder')}
													aria-label={t('models.asset_mappings.fields.service')}
													class="font-mono text-micro"
												/>
											{:else if row.service}
												<Badge variant="outline" class="font-mono text-tiny">{row.service}</Badge>
											{/if}
										</Grid>
									</Stack>

									<!-- Item Matrix picker + fixed-slot Verify & 3D actions (zero shift) -->
									<Stack gap="xs">
										<Picker
											{ctx}
											of="item_matrix"
											where={{
												category: { eq: 'bim_asset' },
												quantity_basis: { ne: 'derived' },
												active: { eq: true }
											}}
											value={row.item_id?.id ?? null}
											disabled={!canEdit || isSaving}
											on_change={(next) => {
												if (next !== (row.item_id?.id ?? null)) savePatch(row, { item_id: next });
											}}
										/>
										<Cluster gap="xs" justify="end" align="center">
											{#if canEdit}
												<Button
													variant={isVerified ? 'ghost' : 'secondary'}
													disabled={isSaving}
													onclick={() =>
														savePatch(row, { review_status: isVerified ? 'pending' : 'verified' })}
												>
													<Icon
														name={isVerified ? 'lucide:circle-check' : 'lucide:check'}
														class="size-3.5"
													/>
													{isVerified ? t('bim_review.verified') : t('bim_review.verify')}
												</Button>
											{/if}
											{#if onInspect3d}
												<Button
													variant="ghost"
													disabled={rowExpressIds.length === 0}
													onclick={() => onInspect3d(rowExpressIds, row.label)}
												>
													<Icon name="lucide:box" class="size-3.5" />
													{t('bim_review.inspect_3d')}
												</Button>
											{/if}
										</Cluster>
									</Stack>
								</Grid>
							</Surface>
						{/each}
					</Stack>
				</Surface>
			{/if}
		</Stack>
	</Scroll>
{/if}
