<script lang="ts">
	/**
	 * Step 1 section body: inline editor & commercial approval workbench for proposed Item Matrix
	 * entries and project-matched catalog costings (`item_matrix`).
	 *
	 * - Zero competing `Button variant="brand"` controls (step header owns the sole primary CTA).
	 * - Secondary creation form opens in a native `<Sheet>` (zero layout shift) with visible labels.
	 * - Pending System 2 proposals (`$approval` open) approve first, then save inline edits cleanly.
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
	import { Bound, Cluster, Grid, Inline, Stack, Surface } from '@norbital-ai/ui/layout';
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
		const rank = (r: MatrixRow) => (r.$approval != null ? 0 : isProposedRow(r) ? 1 : 2);
		return [...source].sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code));
	});

	let drafts = $state<Record<string, Partial<ItemDraft>>>({});
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

	function draftValue(row: MatrixRow): ItemDraft {
		const d = drafts[row.id];
		return {
			name: d?.name ?? row.name,
			unit: d?.unit ?? row.unit,
			quantity_basis: d?.quantity_basis ?? row.quantity_basis,
			unit_rate: d?.unit_rate ?? String(row.unit_rate),
			waste_factor_pct: d?.waste_factor_pct ?? String(row.waste_factor_pct),
			carbon_factor: d?.carbon_factor ?? String(row.carbon_factor)
		};
	}

	function patchOf(row: MatrixRow): Partial<ItemDraft> | null {
		const d = drafts[row.id];
		if (!d) return null;
		const next: Partial<ItemDraft> = {};
		let changed = false;
		if (d.name !== undefined && d.name.trim() && d.name.trim() !== row.name) {
			next.name = d.name.trim();
			changed = true;
		}
		if (d.unit !== undefined && d.unit !== row.unit) {
			next.unit = d.unit;
			changed = true;
		}
		if (d.quantity_basis !== undefined && d.quantity_basis !== row.quantity_basis) {
			next.quantity_basis = d.quantity_basis;
			changed = true;
		}
		if (d.unit_rate !== undefined && d.unit_rate.trim() !== String(row.unit_rate)) {
			next.unit_rate = d.unit_rate.trim();
			changed = true;
		}
		if (
			d.waste_factor_pct !== undefined &&
			d.waste_factor_pct.trim() !== String(row.waste_factor_pct)
		) {
			next.waste_factor_pct = d.waste_factor_pct.trim();
			changed = true;
		}
		if (d.carbon_factor !== undefined && d.carbon_factor.trim() !== String(row.carbon_factor)) {
			next.carbon_factor = d.carbon_factor.trim();
			changed = true;
		}
		return changed ? next : null;
	}

	function setDraftField<K extends keyof ItemDraft>(
		rowId: Id<'item_matrix'>,
		key: K,
		value: ItemDraft[K]
	): void {
		drafts = { ...drafts, [rowId]: { ...(drafts[rowId] ?? {}), [key]: value } };
	}

	function clearDraft(rowId: Id<'item_matrix'>): void {
		const next = { ...drafts };
		delete next[rowId];
		drafts = next;
	}

	function errorText(err: unknown): string {
		if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
			return err.message;
		}
		return String(err);
	}

	const approveAndSaveEffect = (row: MatrixRow) =>
		Effect.gen(function* () {
			const patch = patchOf(row);
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

	function handleSaveOrApprove(row: MatrixRow): void {
		if (!canEdit || busyIds[row.id] || bulkBusy) return;
		const isApproval = row.$approval != null;
		const patch = patchOf(row);
		if (!isApproval && patch === null) return;
		busyIds = { ...busyIds, [row.id]: true };
		fork(
			approveAndSaveEffect(row).pipe(
				Effect.match({
					onFailure: (err) => {
						busyIds = { ...busyIds, [row.id]: false };
						toast.error(errorText(err));
					},
					onSuccess: () => {
						busyIds = { ...busyIds, [row.id]: false };
						clearDraft(row.id);
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

	function handleReject(row: MatrixRow): void {
		if (!canEdit || !row.$approval || busyIds[row.id] || bulkBusy) return;
		const requestId = row.$approval.request_id;
		busyIds = { ...busyIds, [row.id]: true };
		fork(
			ctx.approvals
				.decide(requestId, {
					decision: 'reject',
					reason: 'Rejected during BIM Step 1 review'
				})
				.pipe(
					Effect.match({
						onFailure: (err) => {
							busyIds = { ...busyIds, [row.id]: false };
							toast.error(errorText(err));
						},
						onSuccess: () => {
							busyIds = { ...busyIds, [row.id]: false };
							clearDraft(row.id);
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
			Effect.forEach(targets, (row) => approveAndSaveEffect(row), { concurrency: 1 }).pipe(
				Effect.match({
					onFailure: (err) => {
						bulkBusy = false;
						toast.error(errorText(err));
					},
					onSuccess: () => {
						bulkBusy = false;
						for (const row of targets) clearDraft(row.id);
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
		<Surface tone="card" padding="none" radius="control">
			<Stack gap="none" divided>
				{#each visibleItems as row (row.id)}
					{@const val = draftValue(row)}
					{@const dirty = patchOf(row) !== null}
					{@const pendingApproval = row.$approval != null}
					{@const isBusy = Boolean(busyIds[row.id]) || bulkBusy}
					{@const linkedLabels = assetLabelsByItemId.get(row.id) ?? []}
					<Surface
						tone={pendingApproval ? 'subtle' : 'transparent'}
						padding="sm"
						radius="none"
						bordered={false}
					>
						<Stack gap="sm">
							<Cluster align="center" justify="between" gap="sm">
								<Cluster gap="xs" align="center">
									<Badge variant="outline" class="font-mono text-tiny">{row.code}</Badge>
									{#if pendingApproval}
										<Badge variant="warning" class="text-tiny">
											{t('bim_step.pending_approval')}
										</Badge>
									{:else}
										<Badge variant="outline" class="text-tiny">
											{enum_text(row.rate_basis, {
												t: rawT,
												model: 'item_matrix',
												field: 'rate_basis'
											})}
										</Badge>
									{/if}
									<span class="text-meta">
										{enum_text(row.discipline, {
											t: rawT,
											model: 'item_matrix',
											field: 'discipline'
										})}
									</span>
									{#if linkedLabels.length > 0}
										<span class="text-meta">
											{`· ${t('bim_step.used_by_assets', { count: linkedLabels.length })}`}
										</span>
									{/if}
								</Cluster>

								<Cluster gap="xs" align="center">
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
											{dirty ? t('bim_step.approve_and_save') : t('bim_step.approve')}
										</Button>
										<Button variant="outline" disabled={isBusy} onclick={() => handleReject(row)}>
											<Icon name="lucide:x" class="size-3.5" />
											{t('bim_step.reject')}
										</Button>
									{:else if canEdit}
										<Button
											variant={dirty ? 'secondary' : 'outline'}
											disabled={!dirty || isBusy}
											onclick={() => handleSaveOrApprove(row)}
										>
											{#if isBusy}
												<Spinner class="size-3.5" />
											{:else}
												<Icon name="lucide:check" class="size-3.5" />
											{/if}
											{t('bim_step.save_item')}
										</Button>
									{/if}
									<Button
										size="icon"
										variant="ghost"
										aria-label={row.code}
										onclick={() => open_record('item_matrix', row.id)}
									>
										<Icon name="lucide:arrow-up-right" class="size-3.5" />
									</Button>
								</Cluster>
							</Cluster>

							<Grid minimum="compact" gap="xs">
								<Stack gap="xs">
									<span class="text-overline">{t('models.item_matrix.fields.name')}</span>
									<Input
										value={val.name}
										disabled={!canEdit || isBusy}
										aria-label={t('models.item_matrix.fields.name')}
										class="text-xs"
										oninput={(e) => setDraftField(row.id, 'name', e.currentTarget.value)}
									/>
								</Stack>
								<Stack gap="xs">
									<span class="text-overline">
										{`${t('models.item_matrix.fields.unit_rate')} (${row.currency})`}
									</span>
									<Input
										value={val.unit_rate}
										type="number"
										disabled={!canEdit || isBusy}
										aria-label={t('models.item_matrix.fields.unit_rate')}
										class="text-right font-mono text-xs tabular-nums"
										oninput={(e) => setDraftField(row.id, 'unit_rate', e.currentTarget.value)}
									/>
								</Stack>
								<Stack gap="xs">
									<span class="text-overline">{t('models.item_matrix.fields.unit')}</span>
									<Combobox
										options={unitOptions}
										value={val.unit}
										searchable={false}
										disabled={!canEdit || isBusy}
										aria-label={t('models.item_matrix.fields.unit')}
										on_change={(next) => {
											if (next) setDraftField(row.id, 'unit', next);
										}}
									/>
								</Stack>
								<Stack gap="xs">
									<span class="text-overline">{t('models.item_matrix.fields.quantity_basis')}</span>
									<Combobox
										options={basisOptions}
										value={val.quantity_basis}
										searchable={false}
										disabled={!canEdit || isBusy}
										aria-label={t('models.item_matrix.fields.quantity_basis')}
										on_change={(next) => {
											if (next) setDraftField(row.id, 'quantity_basis', next);
										}}
									/>
								</Stack>
								<Stack gap="xs">
									<span class="text-overline">
										{t('models.item_matrix.fields.waste_factor_pct')}
									</span>
									<Input
										value={val.waste_factor_pct}
										type="number"
										disabled={!canEdit || isBusy}
										aria-label={t('models.item_matrix.fields.waste_factor_pct')}
										class="text-right font-mono text-xs tabular-nums"
										oninput={(e) =>
											setDraftField(row.id, 'waste_factor_pct', e.currentTarget.value)}
									/>
								</Stack>
								<Stack gap="xs">
									<span class="text-overline">{t('models.item_matrix.fields.carbon_factor')}</span>
									<Input
										value={val.carbon_factor}
										type="number"
										disabled={!canEdit || isBusy}
										aria-label={t('models.item_matrix.fields.carbon_factor')}
										class="text-right font-mono text-xs tabular-nums"
										oninput={(e) => setDraftField(row.id, 'carbon_factor', e.currentTarget.value)}
									/>
								</Stack>
							</Grid>

							{#if row.notes}
								<p class="line-clamp-2 text-meta">{row.notes}</p>
							{/if}
						</Stack>
					</Surface>
				{/each}
			</Stack>
		</Surface>
	{/if}
</Stack>

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
