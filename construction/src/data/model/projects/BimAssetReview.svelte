<script lang="ts">
	/**
	 * Step 2 — Proposed Clean BIM Assets review table:
	 * - Full-width scannable table (zero overlapping columns, zero bloated per-row cards).
	 * - Zero redundant "Needs review / Auto-cleaned" tabs.
	 * - Scope is strictly classification + metadata/label cleanup (zero physical asset/dimension edits).
	 * - Assets affected by compliance lints that require an upstream BIM model revision are clearly
	 *   flagged as read-only advisories alongside metadata/classification cleanup notes.
	 * - Clicking any row opens a side `<Sheet>` to inspect 4-angle visuals and edit classification/metadata.
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
		Sheet,
		Spinner,
		use_act,
		type ComboboxOption
	} from '@norbital-ai/ui';
	import { Bound, Cluster, Grid, Inline, Scroll, Stack, Surface } from '@norbital-ai/ui/layout';
	import {
		assetDiagnosticsFor,
		type StoredComplianceFinding
	} from '../../../services/bim/remediation.js';
	import type { BimTakeoffLine, ContinuityMode, SopRule } from '../../../services/bim/schema.js';

	let {
		ctx,
		signatures,
		bimAssets = [],
		complianceFindings = [],
		ruleByCode = new Map(),
		onInspect3d,
		onReviewProposals,
		onMutated
	}: {
		ctx: PageContext;
		signatures: readonly string[];
		bimAssets?: readonly BimTakeoffLine[];
		complianceFindings?: readonly StoredComplianceFinding[];
		ruleByCode?: ReadonlyMap<string, Pick<SopRule, 'metric' | 'threshold_num' | 'ifc_classes'>>;
		onInspect3d?: (expressIds: readonly number[], label: string) => void;
		onReviewProposals?: () => void;
		onMutated?: () => void;
	} = $props();

	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const rawT = (key: string): string => {
		const words: { t(k: string): string } = ctx;
		return words.t(key);
	};
	const canEdit = $derived(ctx.catalog?.asset_mappings?.update !== undefined);
	const saver = use_act(ctx);

	let search = $state('');
	let onlyBimRevision = $state(false);
	let inspectingId = $state<Id<'asset_mappings'> | null>(null);
	let savingRowId = $state<Id<'asset_mappings'> | null>(null);
	let classDraft = $state('');
	let serviceDraft = $state('');
	let continuityDraft = $state<ContinuityMode>('discontiguous');
	let itemDraft = $state<Id<'item_matrix'> | null>(null);

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

	const enrichedRows = $derived.by(() =>
		allRows.map((row) => {
			const expressIds = expressIdsFor(row);
			const diagnostics = assetDiagnosticsFor({
				ifc_class: row.ifc_class,
				cleanup_note: row.cleanup_note,
				expressIds,
				findings: complianceFindings,
				ruleByCode
			});
			return { row, expressIds, diagnostics };
		})
	);

	const counts = $derived.by(() => {
		let needsBimRevision = 0;
		let pendingApproval = 0;
		let verified = 0;
		let highConfPending = 0;
		for (const entry of enrichedRows) {
			const r = entry.row;
			if (entry.diagnostics.revisionAlerts.length > 0) needsBimRevision += 1;
			if (r.$approval != null) pendingApproval += 1;
			if (r.review_status === 'verified') verified += 1;
			const conf = r.confidence != null ? Number(r.confidence) : 0;
			if (r.review_status !== 'verified' && r.item_id != null && r.$approval == null && conf >= 0.9)
				highConfPending += 1;
		}
		return {
			total: enrichedRows.length,
			needsBimRevision,
			pendingApproval,
			verified,
			highConfPending
		};
	});

	const visibleEntries = $derived.by(() => {
		const q = search.trim().toLowerCase();
		const filtered = enrichedRows.filter(({ row, diagnostics }) => {
			if (onlyBimRevision && diagnostics.revisionAlerts.length === 0) return false;
			if (!q) return true;
			return [
				row.label,
				row.ifc_class,
				row.service ?? '',
				row.size_mm ?? '',
				row.item_id?.code ?? '',
				row.item_id?.name ?? '',
				row.cleanup_note ?? '',
				...diagnostics.revisionAlerts.map((a) => `${a.rule_code} ${a.rule_name}`)
			]
				.join(' ')
				.toLowerCase()
				.includes(q);
		});
		const rank = (e: (typeof enrichedRows)[number]) =>
			e.diagnostics.revisionAlerts.length > 0
				? 0
				: e.row.$approval != null
					? 1
					: e.row.item_id == null
						? 2
						: e.row.review_status !== 'verified'
							? 3
							: 4;
		return [...filtered].sort(
			(a, b) => rank(a) - rank(b) || a.row.label.localeCompare(b.row.label)
		);
	});

	const inspectedEntry = $derived(
		inspectingId === null ? null : (enrichedRows.find((e) => e.row.id === inspectingId) ?? null)
	);

	function openInspect(row: MappingRow): void {
		inspectingId = row.id;
		classDraft = row.ifc_class;
		serviceDraft = row.service ?? '';
		continuityDraft = row.continuity;
		itemDraft = row.item_id?.id ?? null;
	}

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

	function savePatch(
		row: MappingRow,
		set: {
			item_id?: Id<'item_matrix'> | null;
			ifc_class?: string;
			continuity?: ContinuityMode;
			service?: string | null;
			review_status?: 'pending' | 'verified' | 'flagged';
		},
		closeSheet = false
	): void {
		if (!canEdit || saver.pending || row.$approval != null) return;
		savingRowId = row.id;
		saver.run(
			ctx.act({
				'asset_mappings.update': [{ target: { id: row.id, revision: row.revision }, set }]
			}),
			{
				then: () => {
					savingRowId = null;
					if (closeSheet) inspectingId = null;
					onMutated?.();
				}
			}
		);
	}

	function saveInspected(): void {
		const row = inspectedEntry?.row;
		if (!row || !canEdit || row.$approval != null) return;
		const nextClass = classDraft.trim().toUpperCase();
		const nextService = serviceDraft.trim().toLowerCase() || null;
		const set: {
			ifc_class?: string;
			continuity?: ContinuityMode;
			service?: string | null;
			item_id?: Id<'item_matrix'> | null;
		} = {};
		if (nextClass && nextClass !== row.ifc_class) set.ifc_class = nextClass;
		if (continuityDraft !== row.continuity) set.continuity = continuityDraft;
		if (nextService !== (row.service ?? null)) set.service = nextService;
		if (itemDraft !== (row.item_id?.id ?? null)) set.item_id = itemDraft;
		if (Object.keys(set).length === 0) {
			inspectingId = null;
			return;
		}
		savePatch(row, set, true);
	}

	function bulkVerifyHighConfidence(): void {
		if (!canEdit || saver.pending) return;
		const targets = allRows.filter((r) => {
			const conf = r.confidence != null ? Number(r.confidence) : 0;
			return (
				r.review_status !== 'verified' && r.item_id != null && r.$approval == null && conf >= 0.9
			);
		});
		if (targets.length === 0) return;
		saver.run(
			ctx.act({
				'asset_mappings.update': targets.map((r) => ({
					target: { id: r.id, revision: r.revision },
					set: { review_status: 'verified' as const }
				}))
			}),
			{ then: () => onMutated?.() }
		);
	}
</script>

{#if mappingsQuery?.loading && !mappingsQuery.current}
	<Inline gap="sm" align="center" aria-busy="true">
		<Spinner />
		<span class="text-sm text-muted-foreground">{t('component.loading_summary')}</span>
	</Inline>
{:else if mappingsQuery?.error}
	<Alert.Root variant="destructive">
		<Alert.Title>{mappingsQuery.error.message}</Alert.Title>
	</Alert.Root>
{:else if allRows.length === 0}
	<EmptyState
		variant="card"
		icon="file"
		title={t('bim_costing.assets_title')}
		hint={t('bim_costing.assets_empty')}
	/>
{:else}
	<Stack gap="sm">
		<Cluster align="center" justify="between" gap="sm">
			<Cluster align="center" gap="xs">
				<span class="text-meta tabular-nums">
					{t('bim_review.table_summary', {
						total: counts.total,
						revisions: counts.needsBimRevision,
						verified: counts.verified
					})}
				</span>
				{#if counts.needsBimRevision > 0}
					<Button
						variant={onlyBimRevision ? 'secondary' : 'outline'}
						onclick={() => (onlyBimRevision = !onlyBimRevision)}
					>
						<Icon name="lucide:triangle-alert" class="size-3.5 text-tone-destructive-text" />
						{t('bim_review.filter_bim_revision', { count: counts.needsBimRevision })}
					</Button>
				{/if}
			</Cluster>
			<Cluster align="center" gap="xs">
				{#if canEdit && counts.highConfPending > 0}
					<Button variant="outline" disabled={saver.pending} onclick={bulkVerifyHighConfidence}>
						<Icon name="lucide:check-check" class="size-3.5" />
						{t('bim_review.bulk_verify', { count: counts.highConfPending })}
					</Button>
				{/if}
				<Input
					bind:value={search}
					type="search"
					placeholder={`${t('bim_review.col_asset')} / ${t('bim_review.col_class')}…`}
					aria-label={t('bim_review.col_asset')}
					class="text-xs"
				/>
			</Cluster>
		</Cluster>

		{#if visibleEntries.length === 0}
			<EmptyState variant="card" icon="file" title={t('bim_review.empty_filter')} />
		{:else}
			<Surface tone="card" padding="none" radius="control" class="overflow-hidden">
				<Scroll name={t('bim_step.clean_bim_heading')} axis="x">
					<table class="w-full min-w-[54rem] table-fixed border-collapse text-left text-xs">
						<colgroup>
							<col class="w-[27%]" />
							<col class="w-[24%]" />
							<col class="w-[17%]" />
							<col class="w-[18%]" />
							<col class="w-[14%]" />
						</colgroup>
						<thead>
							<tr class="border-b border-border bg-muted/40 text-overline text-muted-foreground">
								<th class="px-3 py-2 font-medium">{t('bim_review.col_asset')}</th>
								<th class="px-3 py-2 font-medium">{t('bim_review.col_cleanup_notes')}</th>
								<th class="px-3 py-2 font-medium">{t('bim_review.col_class')}</th>
								<th class="px-3 py-2 font-medium">{t('models.item_matrix.singular')}</th>
								<th class="px-3 py-2 text-right font-medium">{t('bim_review.col_actions')}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-border">
							{#each visibleEntries as { row, expressIds, diagnostics } (row.id)}
								{@const pct =
									row.confidence != null ? Math.round(Number(row.confidence) * 100) : null}
								{@const isSaving = savingRowId === row.id && saver.pending}
								{@const isVerified = row.review_status === 'verified'}
								{@const heldByProposal = row.$approval != null}
								{@const hasRevisionAlert = diagnostics.revisionAlerts.length > 0}
								<tr
									class="align-middle transition-colors hover:bg-muted/30 {hasRevisionAlert
										? 'bg-tone-destructive-bg/15'
										: ''}"
								>
									<!-- Asset identity + thumbnail -->
									<td class="px-3 py-2">
										<div class="flex min-w-0 items-center gap-2.5">
											<button
												type="button"
												class="shrink-0 overflow-hidden rounded-inset border border-border bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
												onclick={() => openInspect(row)}
												title={row.label}
											>
												{#if row.picture}
													<Image
														src={ctx.file_url(row.picture, { preview: 512 })}
														alt={row.label}
														class="size-9"
														image_class="object-cover"
													/>
												{:else}
													<span class="flex size-9 items-center justify-center">
														<Icon name="lucide:box" class="size-4 text-muted-foreground" />
													</span>
												{/if}
											</button>
											<div class="min-w-0 flex-1">
												<button
													type="button"
													class="block w-full truncate text-left text-label text-foreground hover:underline"
													title={row.label}
													onclick={() => openInspect(row)}
												>
													{row.label}
												</button>
												<div
													class="mt-0.5 flex min-w-0 items-center gap-1.5 text-micro text-muted-foreground"
												>
													{#if row.size_mm}
														<span class="shrink-0 font-mono">{row.size_mm}</span>
														<span>·</span>
													{/if}
													<span class="truncate">
														{enum_text(row.source, {
															t: rawT,
															model: 'asset_mappings',
															field: 'source'
														})}
														{pct !== null ? ` ${pct}%` : ''}
													</span>
												</div>
											</div>
										</div>
									</td>

									<!-- Metadata/label cleanup + read-only BIM revision advisory -->
									<td class="px-3 py-2">
										<div class="flex min-w-0 flex-col gap-1">
											{#if hasRevisionAlert}
												<Badge
													variant="destructive"
													class="w-fit text-tiny"
													title={diagnostics.revisionAlerts
														.map((a) => `${a.rule_code}: ${a.rule_name} (${a.expected})`)
														.join(' · ')}
												>
													<Icon name="lucide:triangle-alert" class="size-2.5" />
													{t('bim_compliance.requires_bim_revision')}
												</Badge>
											{/if}
											{#if diagnostics.cleanupFlags.length > 0}
												<span
													class="truncate text-micro text-muted-foreground"
													title={diagnostics.cleanupFlags.map((f) => f.detail).join(' · ')}
												>
													{diagnostics.cleanupFlags[0]?.detail}
													{diagnostics.cleanupFlags.length > 1
														? ` (+${diagnostics.cleanupFlags.length - 1})`
														: ''}
												</span>
											{:else if !hasRevisionAlert}
												<span class="text-micro text-muted-foreground">
													{t('bim_review.no_file_mutation')}
												</span>
											{/if}
										</div>
									</td>

									<!-- IFC Class, Continuity & Service -->
									<td class="px-3 py-2">
										<div class="flex min-w-0 flex-col gap-0.5">
											<span
												class="truncate font-mono text-micro text-foreground"
												title={row.ifc_class}
											>
												{row.ifc_class}
											</span>
											<span class="truncate text-micro text-muted-foreground">
												{enum_text(row.continuity, {
													t: rawT,
													model: 'asset_mappings',
													field: 'continuity'
												})}
												{row.service ? ` · ${row.service}` : ''}
											</span>
										</div>
									</td>

									<!-- Item Matrix assignment / Pending approval status -->
									<td class="px-3 py-2">
										{#if heldByProposal}
											<button
												type="button"
												class="inline-flex max-w-full items-center gap-1 text-left hover:underline"
												onclick={() => onReviewProposals?.()}
											>
												<Badge variant="warning" class="shrink-0 text-tiny">
													{t('bim_step.pending_approval')}
												</Badge>
												{#if row.item_id?.code}
													<span class="truncate font-mono text-micro text-foreground">
														{row.item_id.code}
													</span>
												{/if}
											</button>
										{:else if row.item_id}
											<div class="flex min-w-0 flex-col gap-0.5">
												<span class="truncate font-mono text-micro text-foreground">
													{row.item_id.code}
												</span>
												<span
													class="truncate text-micro text-muted-foreground"
													title={row.item_id.name}
												>
													{row.item_id.name}
												</span>
											</div>
										{:else}
											<Badge variant="outline" class="text-tiny text-muted-foreground">
												{t('bim_costing.status_unmatched')}
											</Badge>
										{/if}
									</td>

									<!-- Compact row actions -->
									<td class="px-3 py-2">
										<div class="flex items-center justify-end gap-1">
											{#if canEdit && !heldByProposal}
												<Button
													size="icon"
													variant={isVerified ? 'ghost' : 'outline'}
													disabled={isSaving}
													aria-label={isVerified
														? t('bim_review.verified')
														: t('bim_review.verify')}
													hint={isVerified ? t('bim_review.verified') : t('bim_review.verify')}
													onclick={() =>
														savePatch(row, {
															review_status: isVerified ? 'pending' : 'verified'
														})}
												>
													<Icon
														name={isVerified ? 'lucide:circle-check' : 'lucide:check'}
														class={isVerified ? 'size-3.5 text-tone-success-text' : 'size-3.5'}
													/>
												</Button>
											{/if}
											<Button
												size="icon"
												variant="ghost"
												aria-label={t('bim_review.inspect_edit')}
												hint={t('bim_review.inspect_edit')}
												onclick={() => openInspect(row)}
											>
												<Icon name="lucide:pencil" class="size-3.5" />
											</Button>
											{#if onInspect3d}
												<Button
													size="icon"
													variant="ghost"
													disabled={expressIds.length === 0}
													aria-label={t('bim_review.inspect_3d')}
													hint={t('bim_review.inspect_3d')}
													onclick={() => onInspect3d(expressIds, row.label)}
												>
													<Icon name="lucide:box" class="size-3.5" />
												</Button>
											{/if}
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</Scroll>
			</Surface>
		{/if}
	</Stack>
{/if}

<Sheet
	open={inspectedEntry !== null}
	on_open_change={(open) => !open && (inspectingId = null)}
	title={inspectedEntry?.row.label ?? t('bim_step.clean_bim_heading')}
	memory="construction:inspect-bim-asset"
>
	{#if inspectedEntry}
		{@const row = inspectedEntry.row}
		{@const heldByProposal = row.$approval != null}
		<Bound size="content" inset>
			<Stack gap="md">
				{#if row.picture}
					<Surface tone="subtle" padding="xs" radius="control">
						<Image
							src={ctx.file_url(row.picture, { preview: 512 })}
							alt={row.label}
							class="mx-auto size-48 rounded-inset"
							image_class="object-contain"
						/>
					</Surface>
				{/if}

				{#if inspectedEntry.diagnostics.revisionAlerts.length > 0}
					<Alert.Root variant="destructive">
						<Alert.Title>{t('bim_compliance.requires_bim_revision')}</Alert.Title>
						<Alert.Description>
							{inspectedEntry.diagnostics.revisionAlerts
								.map((a) => `${a.rule_code}: ${a.rule_name} (${a.expected})`)
								.join(' · ')}
						</Alert.Description>
					</Alert.Root>
				{/if}

				{#if inspectedEntry.diagnostics.cleanupFlags.length > 0}
					<Surface tone="subtle" padding="sm" radius="control">
						<Stack gap="xs">
							<span class="text-overline">{t('bim_review.col_cleanup_notes')}</span>
							{#each inspectedEntry.diagnostics.cleanupFlags as flag, idx (idx)}
								<Inline gap="xs" align="center">
									<Badge variant="outline" class="shrink-0 text-tiny">{flag.label}</Badge>
									<span class="text-xs text-foreground">{flag.detail}</span>
								</Inline>
							{/each}
						</Stack>
					</Surface>
				{/if}

				{#if heldByProposal}
					<Alert.Root variant="warning">
						<Alert.Title>{t('bim_step.held_by_proposal')}</Alert.Title>
					</Alert.Root>
				{/if}

				<Grid minimum="compact" gap="sm">
					<Stack gap="xs">
						<span class="text-overline">{t('models.asset_mappings.fields.ifc_class')}</span>
						<Input
							bind:value={classDraft}
							disabled={!canEdit || saver.pending || heldByProposal}
							aria-label={t('models.asset_mappings.fields.ifc_class')}
							class="font-mono text-xs"
						/>
					</Stack>
					<Stack gap="xs">
						<span class="text-overline">{t('models.asset_mappings.fields.continuity')}</span>
						<Combobox
							options={continuityOptions}
							value={continuityDraft}
							searchable={false}
							disabled={!canEdit || saver.pending || heldByProposal}
							aria-label={t('models.asset_mappings.fields.continuity')}
							on_change={(next) => {
								if (next) continuityDraft = next;
							}}
						/>
					</Stack>
					<Stack gap="xs">
						<span class="text-overline">{t('models.asset_mappings.fields.service')}</span>
						<Input
							bind:value={serviceDraft}
							disabled={!canEdit || saver.pending || heldByProposal}
							placeholder={t('bim_review.service_placeholder')}
							aria-label={t('models.asset_mappings.fields.service')}
							class="font-mono text-xs"
						/>
					</Stack>
					<Stack gap="xs">
						<span class="text-overline">{t('models.item_matrix.singular')}</span>
						<Picker
							{ctx}
							of="item_matrix"
							where={{
								category: { eq: 'bim_asset' },
								quantity_basis: { ne: 'derived' },
								active: { eq: true }
							}}
							value={itemDraft}
							disabled={!canEdit || saver.pending || heldByProposal}
							on_change={(next) => (itemDraft = next)}
						/>
					</Stack>
				</Grid>

				<Cluster justify="between" align="center" gap="xs">
					<Cluster gap="xs">
						<Button variant="ghost" onclick={() => open_record('asset_mappings', row.id)}>
							<Icon name="lucide:arrow-up-right" class="size-3.5" />
							{t('bim_review.open_record')}
						</Button>
						{#if heldByProposal && onReviewProposals}
							<Button
								variant="outline"
								onclick={() => {
									inspectingId = null;
									onReviewProposals();
								}}
							>
								<Icon name="lucide:table-2" class="size-3.5" />
								{t('bim_step.review_proposal')}
							</Button>
						{/if}
					</Cluster>
					<Cluster gap="xs">
						<Button variant="ghost" onclick={() => (inspectingId = null)}>
							{t('bim_step.cancel')}
						</Button>
						{#if canEdit && !heldByProposal}
							<Button variant="brand" disabled={saver.pending} onclick={saveInspected}>
								{#if saver.pending}
									<Spinner class="size-3.5" />
								{:else}
									<Icon name="lucide:check" class="size-3.5" />
								{/if}
								{t('bim_step.save_item')}
							</Button>
						{/if}
					</Cluster>
				</Cluster>
			</Stack>
		</Bound>
	{/if}
</Sheet>
