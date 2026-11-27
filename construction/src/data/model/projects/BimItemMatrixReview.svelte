<script lang="ts">
	/**
	 * Step 2 — Proposed Item Matrix & Costings table:
	 * - Clean full-width scannable table of newly proposed & project-matched Item Matrix entries
	 *   (no bloated stacked multi-row form cards).
	 * - Easy 1-click Approve / Reject / Approve all right in the table, PLUS click-to-inspect side
	 *   `<Sheet>` where reviewers read System 2's rationale, inspect linked BIM assets, and modify
	 *   name / unit rate / unit / quantity basis / waste / carbon before approving or saving.
	 */
	import { new_id, type CurrencyCode, type Id, type Row } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Alert,
		Badge,
		Button,
		Combobox,
		EmptyState,
		enum_text,
		Icon,
		Input,
		open_record,
		Sheet,
		Spinner,
		toast,
		type ComboboxOption
	} from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { Bound, Cluster, Grid, Inline, Scroll, Stack, Surface } from '@norbital-ai/ui/layout';
	import { Effect } from 'effect';
	import SegmentedToggle from '../../../services/ui/SegmentedToggle.svelte';

	type ItemFilter = 'proposed' | 'all';
	type MatrixUnit = Row<'item_matrix'>['unit'];
	type MatrixBasis = Row<'item_matrix'>['quantity_basis'];
	type MatrixDiscipline = Row<'item_matrix'>['discipline'];

	type ProjectAssetLink = {
		readonly id: Id<'asset_mappings'>;
		readonly revision: number;
		readonly label: string;
		readonly ifc_class: string;
		readonly service: string | null;
		readonly source: 'system_1' | 'qs' | 'proposal';
		readonly item_id: { readonly id: Id<'item_matrix'>; readonly code: string } | null;
	};

	type ItemDraft = {
		name: string;
		unit: MatrixUnit;
		quantity_basis: MatrixBasis;
		unit_rate: string;
		waste_factor_pct: string;
		carbon_factor: string;
	};

	const UNIT_VALUES: readonly MatrixUnit[] = ['ea', 'm', 'm2', 'm3', 'kg', 'ls', 'month', 'pct'];
	const BASIS_VALUES: readonly MatrixBasis[] = ['count', 'length', 'area', 'volume', 'weight'];
	const DISCIPLINE_VALUES: readonly MatrixDiscipline[] = [
		'architecture',
		'structural',
		'mep',
		'civil',
		'preliminaries',
		'general'
	];

	let {
		ctx,
		currency,
		assetLinks = [],
		onMutated
	}: {
		ctx: PageContext;
		currency: CurrencyCode;
		assetLinks?: readonly ProjectAssetLink[];
		onMutated?: () => void;
	} = $props();

	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const rawT = (key: string): string => {
		const words: { t(k: string): string } = ctx;
		return words.t(key);
	};

	const canEdit = $derived(ctx.catalog?.item_matrix?.update !== undefined);
	const canCreate = $derived(ctx.catalog?.item_matrix?.create !== undefined);

	let createdItemIds = $state<Id<'item_matrix'>[]>([]);
	let search = $state('');

	const linkedItemIds = $derived([
		...new Set([...assetLinks.flatMap((a) => (a.item_id ? [a.item_id.id] : [])), ...createdItemIds])
	]);
	const proposalLinkedIds = $derived(
		new Set(assetLinks.flatMap((a) => (a.source === 'proposal' && a.item_id ? [a.item_id.id] : [])))
	);
	const assetLabelsByItemId = $derived.by(() => {
		const map = new Map<Id<'item_matrix'>, string[]>();
		for (const a of assetLinks) {
			if (!a.item_id) continue;
			const list = map.get(a.item_id.id) ?? [];
			list.push(a.label);
			map.set(a.item_id.id, list);
		}
		return map;
	});
	const unmatchedAssets = $derived(assetLinks.filter((a) => a.item_id == null));

	const itemsQuery = $derived(
		linkedItemIds.length > 0
			? ctx.query({
					item_matrix: {
						where: { id: { in: linkedItemIds } },
						fields: [
							'revision',
							'code',
							'name',
							'discipline',
							'trade_specialty',
							'unit',
							'quantity_basis',
							'currency',
							'unit_rate',
							'waste_factor_pct',
							'carbon_factor',
							'rate_basis',
							'active',
							'notes'
						],
						order_by: { code: 'asc' },
						limit: Math.max(linkedItemIds.length, 200)
					}
				})
			: null
	);

	type MatrixRow = NonNullable<typeof itemsQuery>['current'] extends infer A
		? A extends { item_matrix: { rows: readonly (infer R)[] } }
			? R
			: never
		: never;

	const allItems = $derived<readonly MatrixRow[]>(itemsQuery?.current?.item_matrix.rows ?? []);
	const isProposedRow = (r: MatrixRow): boolean =>
		r.$approval != null || r.rate_basis === 'assumption' || proposalLinkedIds.has(r.id);

	const proposedItems = $derived(allItems.filter(isProposedRow));
	const pendingApprovalItems = $derived(allItems.filter((r) => r.$approval != null));

	let filterOverride = $state<ItemFilter | null>(null);
	const activeFilter = $derived<ItemFilter>(
		filterOverride ?? (proposedItems.length > 0 ? 'proposed' : 'all')
	);
	const visibleItems = $derived.by(() => {
		const source = activeFilter === 'proposed' ? proposedItems : allItems;
		const q = search.trim().toLowerCase();
		const filtered = q
			? source.filter((r) =>
					[r.code, r.name, r.discipline, r.unit, r.notes ?? ''].join(' ').toLowerCase().includes(q)
				)
			: source;
		const rank = (r: MatrixRow) => (r.$approval != null ? 0 : isProposedRow(r) ? 1 : 2);
		return [...filtered].sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code));
	});

	let inspectingId = $state<Id<'item_matrix'> | null>(null);
	let editDraft = $state<ItemDraft | null>(null);
	let busyIds = $state<Record<string, boolean>>({});
	let bulkBusy = $state(false);
	let addSheetOpen = $state(false);
	let creating = $state(false);

	let newCode = $state('');
	let newName = $state('');
	let newDiscipline = $state<MatrixDiscipline>('mep');
	let newUnit = $state<MatrixUnit>('ea');
	let newBasis = $state<MatrixBasis>('count');
	let newRate = $state('0');
	let newWaste = $state('0');
	let newCarbon = $state('0');
	let newLinkAssetId = $state<Id<'asset_mappings'> | null>(null);

	const inspectedRow = $derived(
		inspectingId === null ? null : (allItems.find((r) => r.id === inspectingId) ?? null)
	);

	function openInspect(row: MatrixRow): void {
		inspectingId = row.id;
		editDraft = {
			name: row.name,
			unit: row.unit,
			quantity_basis: row.quantity_basis,
			unit_rate: String(row.unit_rate),
			waste_factor_pct: String(row.waste_factor_pct),
			carbon_factor: String(row.carbon_factor)
		};
	}

	const unitOptions = $derived<readonly ComboboxOption<MatrixUnit>[]>(
		UNIT_VALUES.map((value) => ({
			value,
			label: enum_text(value, { t: rawT, model: 'item_matrix', field: 'unit' })
		}))
	);
	const basisOptions = $derived<readonly ComboboxOption<MatrixBasis>[]>(
		BASIS_VALUES.map((value) => ({
			value,
			label: enum_text(value, { t: rawT, model: 'item_matrix', field: 'quantity_basis' })
		}))
	);
	const disciplineOptions = $derived<readonly ComboboxOption<MatrixDiscipline>[]>(
		DISCIPLINE_VALUES.map((value) => ({
			value,
			label: enum_text(value, { t: rawT, model: 'item_matrix', field: 'discipline' })
		}))
	);
	const unmatchedAssetOptions = $derived<readonly ComboboxOption<Id<'asset_mappings'>>[]>(
		unmatchedAssets.map((a) => ({
			value: a.id,
			label: `${a.label} (${a.ifc_class})`
		}))
	);

	function patchOf(row: MatrixRow, draft: ItemDraft | null): Partial<ItemDraft> | null {
		if (!draft) return null;
		const next: Partial<ItemDraft> = {};
		let changed = false;
		if (draft.name.trim() && draft.name.trim() !== row.name) {
			next.name = draft.name.trim();
			changed = true;
		}
		if (draft.unit !== row.unit) {
			next.unit = draft.unit;
			changed = true;
		}
		if (draft.quantity_basis !== row.quantity_basis) {
			next.quantity_basis = draft.quantity_basis;
			changed = true;
		}
		if (draft.unit_rate.trim() !== String(row.unit_rate)) {
			next.unit_rate = draft.unit_rate.trim();
			changed = true;
		}
		if (draft.waste_factor_pct.trim() !== String(row.waste_factor_pct)) {
			next.waste_factor_pct = draft.waste_factor_pct.trim();
			changed = true;
		}
		if (draft.carbon_factor.trim() !== String(row.carbon_factor)) {
			next.carbon_factor = draft.carbon_factor.trim();
			changed = true;
		}
		return changed ? next : null;
	}

	function errorText(err: unknown): string {
		if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
			return err.message;
		}
		return String(err);
	}

	const approveAndSaveEffect = (row: MatrixRow, patch: Partial<ItemDraft> | null) =>
		Effect.gen(function* () {
			if (row.$approval != null) {
				yield* ctx.approvals.decide(row.$approval.request_id, { decision: 'approve' });
			}
			if (patch !== null) {
				const fresh = yield* ctx.query({
					item_matrix: { where: { id: { eq: row.id } }, fields: ['revision'], limit: 1 }
				});
				const rev = fresh.item_matrix.rows[0]?.revision ?? row.revision;
				yield* ctx.act({
					'item_matrix.update': [{ target: { id: row.id, revision: rev }, set: patch }]
				});
			}
		});

	function handleSaveOrApprove(
		row: MatrixRow,
		patch: Partial<ItemDraft> | null = null,
		closeSheet = false
	): void {
		if (!canEdit || busyIds[row.id] || bulkBusy) return;
		const isApproval = row.$approval != null;
		if (!isApproval && patch === null) {
			if (closeSheet) inspectingId = null;
			return;
		}
		busyIds = { ...busyIds, [row.id]: true };
		fork(
			approveAndSaveEffect(row, patch).pipe(
				Effect.match({
					onFailure: (err) => {
						busyIds = { ...busyIds, [row.id]: false };
						toast.error(errorText(err));
					},
					onSuccess: () => {
						busyIds = { ...busyIds, [row.id]: false };
						if (closeSheet) inspectingId = null;
						toast.success(
							isApproval
								? t('bim_step.proposal_approved', { code: row.code })
								: t('bim_step.item_saved', { code: row.code })
						);
						onMutated?.();
					}
				})
			)
		);
	}

	function handleReject(row: MatrixRow, closeSheet = false): void {
		if (!canEdit || !row.$approval || busyIds[row.id] || bulkBusy) return;
		const requestId = row.$approval.request_id;
		busyIds = { ...busyIds, [row.id]: true };
		fork(
			ctx.approvals
				.decide(requestId, {
					decision: 'reject',
					reason: 'Rejected during BIM Step 2 review'
				})
				.pipe(
					Effect.match({
						onFailure: (err) => {
							busyIds = { ...busyIds, [row.id]: false };
							toast.error(errorText(err));
						},
						onSuccess: () => {
							busyIds = { ...busyIds, [row.id]: false };
							if (closeSheet) inspectingId = null;
							toast.success(t('bim_step.proposal_rejected', { code: row.code }));
							onMutated?.();
						}
					})
				)
		);
	}

	function handleApproveAllPending(): void {
		if (!canEdit || bulkBusy || pendingApprovalItems.length === 0) return;
		const targets = [...pendingApprovalItems];
		bulkBusy = true;
		fork(
			Effect.forEach(targets, (row) => approveAndSaveEffect(row, null), { concurrency: 1 }).pipe(
				Effect.match({
					onFailure: (err) => {
						bulkBusy = false;
						toast.error(errorText(err));
					},
					onSuccess: () => {
						bulkBusy = false;
						toast.success(t('bim_step.approved_all', { count: targets.length }));
						onMutated?.();
					}
				})
			)
		);
	}

	function handleCreateItem(): void {
		const code = newCode
			.trim()
			.toUpperCase()
			.replace(/[^A-Z0-9-]+/g, '-');
		const name = newName.trim();
		if (!canCreate || creating || !code || !name) return;
		const targetAsset = newLinkAssetId
			? (unmatchedAssets.find((a) => a.id === newLinkAssetId) ?? null)
			: null;
		const newItemId = new_id('item_matrix');
		creating = true;
		fork(
			ctx
				.act({
					'item_matrix.create': [
						{
							id: newItemId,
							code,
							name,
							category: 'bim_asset' as const,
							discipline: newDiscipline,
							trade_specialty: 'general' as const,
							...(targetAsset ? { ifc_classes: [targetAsset.ifc_class] } : {}),
							...(targetAsset?.service ? { system_services: [targetAsset.service] } : {}),
							unit: newUnit,
							quantity_basis: newBasis,
							currency,
							unit_rate: newRate.trim() || '0',
							waste_factor_pct: newWaste.trim() || '0',
							carbon_factor: newCarbon.trim() || '0',
							rate_basis: 'assumption' as const,
							active: true
						}
					],
					...(targetAsset
						? {
								'asset_mappings.update': [
									{
										target: { id: targetAsset.id, revision: targetAsset.revision },
										set: { item_id: newItemId }
									}
								]
							}
						: {})
				})
				.pipe(
					Effect.match({
						onFailure: (err) => {
							creating = false;
							toast.error(errorText(err));
						},
						onSuccess: () => {
							creating = false;
							createdItemIds = [...createdItemIds, newItemId];
							addSheetOpen = false;
							newCode = '';
							newName = '';
							newRate = '0';
							newWaste = '0';
							newCarbon = '0';
							newLinkAssetId = null;
							toast.success(t('bim_step.item_created', { code }));
							onMutated?.();
						}
					})
				)
		);
	}
</script>

<Stack gap="sm">
	<Cluster align="center" justify="between" gap="sm">
		<SegmentedToggle
			options={[
				{
					value: 'proposed' as const,
					label: t('bim_step.filter_proposed', { count: proposedItems.length })
				},
				{
					value: 'all' as const,
					label: t('bim_step.filter_all_matrix', { count: allItems.length })
				}
			]}
			value={activeFilter}
			onChange={(next) => (filterOverride = next)}
			label={t('bim_step.matrix_heading')}
			control={{
				id: 'construction:bim-matrix-filter',
				label: t('bim_step.matrix_heading')
			}}
		/>
		<Cluster gap="xs" align="center">
			<Input
				bind:value={search}
				type="search"
				placeholder={`${t('models.item_matrix.fields.code')} / ${t('models.item_matrix.fields.name')}…`}
				aria-label={t('models.item_matrix.fields.name')}
				class="text-xs"
			/>
			{#if canEdit && pendingApprovalItems.length > 1}
				<Button variant="secondary" disabled={bulkBusy} onclick={handleApproveAllPending}>
					{#if bulkBusy}
						<Spinner class="size-3.5" />
					{:else}
						<Icon name="lucide:check-check" class="size-3.5" />
					{/if}
					{t('bim_step.approve_all', { count: pendingApprovalItems.length })}
				</Button>
			{/if}
			{#if canCreate}
				<Button variant="outline" onclick={() => (addSheetOpen = true)}>
					<Icon name="lucide:plus" class="size-3.5" />
					{t('bim_step.add_matrix_item')}
				</Button>
			{/if}
		</Cluster>
	</Cluster>

	{#if itemsQuery?.loading && !itemsQuery.current}
		<Inline gap="sm" align="center" aria-busy="true">
			<Spinner />
			<span class="text-sm text-muted-foreground">{t('component.loading_summary')}</span>
		</Inline>
	{:else if itemsQuery?.error}
		<Alert.Root variant="destructive">
			<Alert.Title>{itemsQuery.error.message}</Alert.Title>
		</Alert.Root>
	{:else if visibleItems.length === 0}
		<EmptyState
			variant="card"
			icon="file"
			title={t('bim_step.matrix_heading')}
			hint={activeFilter === 'proposed'
				? t('bim_step.no_pending_proposals')
				: t('bim_step.no_matrix_items')}
		/>
	{:else}
		<Surface tone="card" padding="none" radius="control" class="overflow-hidden">
			<Scroll name={t('bim_step.matrix_heading')} axis="x">
				<table class="w-full min-w-[54rem] table-fixed border-collapse text-left text-xs">
					<colgroup>
						<col class="w-[16%]" />
						<col class="w-[31%]" />
						<col class="w-[12%]" />
						<col class="w-[12%]" />
						<col class="w-[11%]" />
						<col class="w-[18%]" />
					</colgroup>
					<thead>
						<tr class="border-b border-border bg-muted/40 text-overline text-muted-foreground">
							<th class="px-3 py-2 font-medium">{t('models.item_matrix.fields.code')}</th>
							<th class="px-3 py-2 font-medium">{t('models.item_matrix.fields.name')}</th>
							<th class="px-3 py-2 font-medium">{t('models.item_matrix.fields.unit')}</th>
							<th class="px-3 py-2 text-right font-medium">
								{t('models.item_matrix.fields.unit_rate')}
							</th>
							<th class="px-3 py-2 text-right font-medium">{t('bim_review.col_waste_carbon')}</th>
							<th class="px-3 py-2 text-right font-medium">{t('bim_review.col_actions')}</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border">
						{#each visibleItems as row (row.id)}
							{@const pendingApproval = row.$approval != null}
							{@const isBusy = Boolean(busyIds[row.id]) || bulkBusy}
							{@const linkedLabels = assetLabelsByItemId.get(row.id) ?? []}
							<tr
								class="align-middle transition-colors hover:bg-muted/30 {pendingApproval
									? 'bg-tone-warning-bg/25'
									: ''}"
							>
								<td class="px-3 py-2">
									<div class="flex min-w-0 flex-col gap-1">
										<span class="truncate font-mono text-label text-foreground" title={row.code}>
											{row.code}
										</span>
										{#if pendingApproval}
											<Badge variant="warning" class="w-fit text-tiny">
												{t('bim_step.pending_approval')}
											</Badge>
										{:else}
											<span class="truncate text-micro text-muted-foreground">
												{enum_text(row.rate_basis, {
													t: rawT,
													model: 'item_matrix',
													field: 'rate_basis'
												})}
											</span>
										{/if}
									</div>
								</td>
								<td class="px-3 py-2">
									<div class="min-w-0">
										<button
											type="button"
											class="block w-full truncate text-left text-label text-foreground hover:underline"
											title={row.name}
											onclick={() => openInspect(row)}
										>
											{row.name}
										</button>
										<div
											class="mt-0.5 flex min-w-0 items-center gap-1.5 text-micro text-muted-foreground"
										>
											<span class="shrink-0">
												{enum_text(row.discipline, {
													t: rawT,
													model: 'item_matrix',
													field: 'discipline'
												})}
											</span>
											{#if linkedLabels.length > 0}
												<span>·</span>
												<span class="truncate" title={linkedLabels.join(', ')}>
													{t('bim_step.used_by_assets', { count: linkedLabels.length })}
												</span>
											{/if}
										</div>
									</div>
								</td>
								<td class="px-3 py-2">
									<div class="flex min-w-0 flex-col">
										<span class="truncate text-foreground">
											{enum_text(row.unit, { t: rawT, model: 'item_matrix', field: 'unit' })}
										</span>
										<span class="truncate text-micro text-muted-foreground">
											{enum_text(row.quantity_basis, {
												t: rawT,
												model: 'item_matrix',
												field: 'quantity_basis'
											})}
										</span>
									</div>
								</td>
								<td class="px-3 py-2 text-right font-mono tabular-nums text-foreground">
									{`${row.currency} ${row.unit_rate}`}
								</td>
								<td
									class="px-3 py-2 text-right font-mono text-micro tabular-nums text-muted-foreground"
								>
									<div>{`${row.waste_factor_pct}%`}</div>
									<div>{`${row.carbon_factor} kg`}</div>
								</td>
								<td class="px-3 py-2">
									<div class="flex items-center justify-end gap-1">
										{#if canEdit && pendingApproval}
											<Button
												variant="secondary"
												disabled={isBusy}
												onclick={() => handleSaveOrApprove(row)}
											>
												{#if isBusy}
													<Spinner class="size-3.5" />
												{:else}
													<Icon name="lucide:check" class="size-3.5" />
												{/if}
												{t('bim_step.approve')}
											</Button>
											<Button
												size="icon"
												variant="outline"
												disabled={isBusy}
												aria-label={t('bim_step.reject')}
												hint={t('bim_step.reject')}
												onclick={() => handleReject(row)}
											>
												<Icon name="lucide:x" class="size-3.5" />
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

<!-- Side Sheet to inspect System 2 rationale, linked assets, and edit/approve/reject any matrix item -->
<Sheet
	open={inspectedRow !== null}
	on_open_change={(open) => !open && (inspectingId = null)}
	title={inspectedRow
		? `${inspectedRow.code} · ${inspectedRow.name}`
		: t('bim_step.matrix_heading')}
	memory="construction:inspect-matrix-item"
>
	{#if inspectedRow && editDraft}
		{@const row = inspectedRow}
		{@const draft = editDraft}
		{@const pendingApproval = row.$approval != null}
		{@const patch = patchOf(row, draft)}
		{@const isBusy = Boolean(busyIds[row.id]) || bulkBusy}
		{@const linkedLabels = assetLabelsByItemId.get(row.id) ?? []}
		<Bound size="content" inset>
			<Stack gap="md">
				<Cluster align="center" gap="xs">
					<Badge variant="outline" class="font-mono text-tiny">{row.code}</Badge>
					{#if pendingApproval}
						<Badge variant="warning" class="text-tiny">{t('bim_step.pending_approval')}</Badge>
					{/if}
					<span class="text-meta">
						{enum_text(row.discipline, { t: rawT, model: 'item_matrix', field: 'discipline' })}
					</span>
				</Cluster>

				{#if row.notes}
					<Surface tone="subtle" padding="sm" radius="control">
						<Stack gap="xs">
							<span class="text-overline">{t('bim_review.proposal_rationale')}</span>
							<p class="text-xs text-foreground">{row.notes}</p>
						</Stack>
					</Surface>
				{/if}

				{#if linkedLabels.length > 0}
					<Surface tone="subtle" padding="sm" radius="control">
						<Stack gap="xs">
							<span class="text-overline">
								{t('bim_step.used_by_assets', { count: linkedLabels.length })}
							</span>
							<Cluster gap="xs">
								{#each linkedLabels as lbl (lbl)}
									<Badge variant="outline" class="max-w-full truncate text-tiny">{lbl}</Badge>
								{/each}
							</Cluster>
						</Stack>
					</Surface>
				{/if}

				<Grid minimum="compact" gap="sm">
					<Stack gap="xs">
						<span class="text-overline">{t('models.item_matrix.fields.name')}</span>
						<Input
							value={draft.name}
							disabled={!canEdit || isBusy}
							aria-label={t('models.item_matrix.fields.name')}
							class="text-xs"
							oninput={(e) => (editDraft = { ...draft, name: e.currentTarget.value })}
						/>
					</Stack>
					<Stack gap="xs">
						<span class="text-overline">
							{`${t('models.item_matrix.fields.unit_rate')} (${row.currency})`}
						</span>
						<Input
							value={draft.unit_rate}
							type="number"
							disabled={!canEdit || isBusy}
							aria-label={t('models.item_matrix.fields.unit_rate')}
							class="text-right font-mono text-xs tabular-nums"
							oninput={(e) => (editDraft = { ...draft, unit_rate: e.currentTarget.value })}
						/>
					</Stack>
					<Stack gap="xs">
						<span class="text-overline">{t('models.item_matrix.fields.unit')}</span>
						<Combobox
							options={unitOptions}
							value={draft.unit}
							searchable={false}
							disabled={!canEdit || isBusy}
							aria-label={t('models.item_matrix.fields.unit')}
							on_change={(next) => {
								if (next) editDraft = { ...draft, unit: next };
							}}
						/>
					</Stack>
					<Stack gap="xs">
						<span class="text-overline">{t('models.item_matrix.fields.quantity_basis')}</span>
						<Combobox
							options={basisOptions}
							value={draft.quantity_basis}
							searchable={false}
							disabled={!canEdit || isBusy}
							aria-label={t('models.item_matrix.fields.quantity_basis')}
							on_change={(next) => {
								if (next) editDraft = { ...draft, quantity_basis: next };
							}}
						/>
					</Stack>
					<Stack gap="xs">
						<span class="text-overline">{t('models.item_matrix.fields.waste_factor_pct')}</span>
						<Input
							value={draft.waste_factor_pct}
							type="number"
							disabled={!canEdit || isBusy}
							aria-label={t('models.item_matrix.fields.waste_factor_pct')}
							class="text-right font-mono text-xs tabular-nums"
							oninput={(e) => (editDraft = { ...draft, waste_factor_pct: e.currentTarget.value })}
						/>
					</Stack>
					<Stack gap="xs">
						<span class="text-overline">{t('models.item_matrix.fields.carbon_factor')}</span>
						<Input
							value={draft.carbon_factor}
							type="number"
							disabled={!canEdit || isBusy}
							aria-label={t('models.item_matrix.fields.carbon_factor')}
							class="text-right font-mono text-xs tabular-nums"
							oninput={(e) => (editDraft = { ...draft, carbon_factor: e.currentTarget.value })}
						/>
					</Stack>
				</Grid>

				<Cluster justify="between" align="center" gap="xs">
					<Button variant="ghost" onclick={() => open_record('item_matrix', row.id)}>
						<Icon name="lucide:arrow-up-right" class="size-3.5" />
						{t('bim_review.open_record')}
					</Button>
					<Cluster gap="xs">
						{#if canEdit && pendingApproval}
							<Button variant="outline" disabled={isBusy} onclick={() => handleReject(row, true)}>
								<Icon name="lucide:x" class="size-3.5" />
								{t('bim_step.reject')}
							</Button>
							<Button
								variant="brand"
								disabled={isBusy}
								onclick={() => handleSaveOrApprove(row, patch, true)}
							>
								{#if isBusy}
									<Spinner class="size-3.5" />
								{:else}
									<Icon name="lucide:check" class="size-3.5" />
								{/if}
								{patch !== null ? t('bim_step.approve_and_save') : t('bim_step.approve')}
							</Button>
						{:else if canEdit}
							<Button variant="ghost" onclick={() => (inspectingId = null)}>
								{t('bim_step.cancel')}
							</Button>
							<Button
								variant="brand"
								disabled={patch === null || isBusy}
								onclick={() => handleSaveOrApprove(row, patch, true)}
							>
								{#if isBusy}
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

<Sheet
	bind:open={addSheetOpen}
	title={t('bim_step.new_matrix_title')}
	memory="construction:new-matrix-item"
>
	<Bound size="content" inset>
		<Stack gap="md">
			<Grid minimum="compact" gap="sm">
				<Stack gap="xs">
					<span class="text-overline">{t('models.item_matrix.fields.code')}</span>
					<Input
						bind:value={newCode}
						aria-label={t('models.item_matrix.fields.code')}
						class="font-mono text-xs"
					/>
				</Stack>
				<Stack gap="xs">
					<span class="text-overline">{t('models.item_matrix.fields.name')}</span>
					<Input
						bind:value={newName}
						aria-label={t('models.item_matrix.fields.name')}
						class="text-xs"
					/>
				</Stack>
				<Stack gap="xs">
					<span class="text-overline">{t('models.item_matrix.fields.discipline')}</span>
					<Combobox
						options={disciplineOptions}
						value={newDiscipline}
						searchable={false}
						aria-label={t('models.item_matrix.fields.discipline')}
						on_change={(next) => {
							if (next) newDiscipline = next;
						}}
					/>
				</Stack>
				<Stack gap="xs">
					<span class="text-overline">{t('models.item_matrix.fields.unit')}</span>
					<Combobox
						options={unitOptions}
						value={newUnit}
						searchable={false}
						aria-label={t('models.item_matrix.fields.unit')}
						on_change={(next) => {
							if (next) newUnit = next;
						}}
					/>
				</Stack>
				<Stack gap="xs">
					<span class="text-overline">{t('models.item_matrix.fields.quantity_basis')}</span>
					<Combobox
						options={basisOptions}
						value={newBasis}
						searchable={false}
						aria-label={t('models.item_matrix.fields.quantity_basis')}
						on_change={(next) => {
							if (next) newBasis = next;
						}}
					/>
				</Stack>
				<Stack gap="xs">
					<span class="text-overline">
						{`${t('models.item_matrix.fields.unit_rate')} (${currency})`}
					</span>
					<Input
						bind:value={newRate}
						type="number"
						aria-label={t('models.item_matrix.fields.unit_rate')}
						class="text-right font-mono text-xs tabular-nums"
					/>
				</Stack>
				<Stack gap="xs">
					<span class="text-overline">{t('models.item_matrix.fields.waste_factor_pct')}</span>
					<Input
						bind:value={newWaste}
						type="number"
						aria-label={t('models.item_matrix.fields.waste_factor_pct')}
						class="text-right font-mono text-xs tabular-nums"
					/>
				</Stack>
				<Stack gap="xs">
					<span class="text-overline">{t('models.item_matrix.fields.carbon_factor')}</span>
					<Input
						bind:value={newCarbon}
						type="number"
						aria-label={t('models.item_matrix.fields.carbon_factor')}
						class="text-right font-mono text-xs tabular-nums"
					/>
				</Stack>
			</Grid>
			{#if unmatchedAssetOptions.length > 0}
				<Stack gap="xs">
					<span class="text-overline">{t('bim_step.link_unmatched_asset')}</span>
					<Combobox
						options={unmatchedAssetOptions}
						value={newLinkAssetId}
						clearable
						aria-label={t('bim_step.link_unmatched_asset')}
						on_change={(next) => (newLinkAssetId = next)}
					/>
				</Stack>
			{/if}
			<Cluster justify="end" gap="xs">
				<Button variant="ghost" disabled={creating} onclick={() => (addSheetOpen = false)}>
					{t('bim_step.cancel')}
				</Button>
				<Button
					variant="brand"
					disabled={creating || !newCode.trim() || !newName.trim()}
					onclick={handleCreateItem}
				>
					{#if creating}
						<Spinner class="size-3.5" />
					{:else}
						<Icon name="lucide:check" class="size-3.5" />
					{/if}
					{t('bim_step.create_matrix_item')}
				</Button>
			</Cluster>
		</Stack>
	</Bound>
</Sheet>
