<script lang="ts">
	import { attach, fork, live, bolt } from '$bolt';
	import { Effect, Schema, Scope } from 'effect';
	import { agreements } from '../../../lib/agreements.js';
	import { isMasked } from '../../../lib/access.js';
	import { liveState } from '../../../lib/ui/live-state.js';
	import {
		Table,
		Section,
		Button,
		Show,
		Picker,
		Combobox,
		Badge,
		TimeRangeInput,
		useKinds,
		useRecordController,
		type FieldEditor,
		type FormState,
		type RecordView,
		openRecord
	} from '@norbital-ai/ui';
	import { Stack, Grid, Cluster } from '@norbital-ai/ui/layout';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import OrderItemFields from '../../../lib/ui/order-item-fields.svelte';
	import CreateTable from '../../../lib/ui/create-table.svelte';
	const DateBounds = Schema.Struct({
		from: Schema.NullOr(Schema.String),
		to: Schema.NullOr(Schema.String)
	});
	let {
		view
	}: {
		view: RecordView<'orders'>;
	} = $props();
	const kinds = useKinds();
	const recordController = useRecordController();
	let revising = $state(false);
	const id = $derived(view.mode !== 'create' ? view.record.id : null);
	const operational = $derived(
		view.mode !== 'create' && ['confirmed', 'closed'].includes(view.record.status)
	);
	const checkSource = live(() =>
		id &&
		view.mode !== 'create' &&
		view.record.status === 'draft' &&
		!isMasked(view.record.currency)
			? bolt.live(
					bolt.query('orders.confirmation_check', { order: id, revision: view.record.revision }),
					{
						on: [
							'orders',
							'order_lines',
							'credit_snapshots',
							'commercial_settings',
							'pricing_floors',
							'warehouses',
							'stock_snapshots'
						],
						every: '1min'
					}
				)
			: null
	);
	const check = liveState(checkSource);
	const versions = $derived(view.mode !== 'create' ? agreements(view.record) : []);
	let selectedVersion = $state<string | null>(null);
	const draftContract = $derived(
		view.mode !== 'create' &&
			view.record.status === 'draft' &&
			(selectedVersion === null || selectedVersion === 'draft')
	);
	const selectedContract = $derived(
		draftContract
			? undefined
			: (versions.find((v) => String(v.version) === selectedVersion) ?? versions.at(-1))
	);
	const confirmationCollection = $derived(
		view.mode !== 'create' && view.record.direction === 'purchasing'
			? 'ext_purchase_orders'
			: 'ext_sales_orders'
	);
	const confirmationRows = liveState(
		live(() =>
			id
				? bolt.live(
						bolt.read(confirmationCollection, {
							where: {
								order: { eq: id },
								...((selectedContract ?? versions.at(-1))
									? { agreement_hash: { eq: (selectedContract ?? versions.at(-1))!.seal_hash } }
									: {})
							},
							select: { reference: true, status: true },
							all: true
						})
					)
				: null
		)
	);
	const pushFailed = $derived(
		view.mode !== 'create' &&
			view.record.status !== 'draft' &&
			view.record.$outbound?.['kingdee.orders']?.status === 'failed'
	);
	let pending = $state(false);
	let feedback = $state('');
	let actionScope = $state.raw<Scope.Scope | undefined>(undefined);
	const actionLifetime = attach(() =>
		Effect.gen(function* () {
			actionScope = yield* Scope.Scope;
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					actionScope = undefined;
				})
			);
			yield* Effect.never;
		})
	);
	const confirmOrder = Effect.fn('Trading.confirmOrder')(function* () {
		const readiness = $check.value;
		if (!id || !readiness || pending) return;
		const target = id;
		const saved = bolt.t('component.seal_saved');
		const awaiting = bolt.t('component.awaiting_approval');
		const uncertain = bolt.t('component.seal_uncertain');
		pending = true;
		const result = yield* bolt.act('orders.update', {
			target,
			set: { status: 'confirmed', check_hash: readiness.check_hash }
		});
		const controller = recordController?.current;
		if (
			result.kind === 'committed' &&
			controller?.spec.target.of === 'collection' &&
			controller.spec.target.collection === 'orders' &&
			controller.spec.target.id === target
		)
			controller.view();
		feedback =
			result.kind === 'committed'
				? saved
				: result.kind === 'pendingApproval'
					? awaiting
					: uncertain;
	});
	const reviseOrder = Effect.fn('Trading.reviseOrder')(function* () {
		if (!id || revising) return;
		const target = id;
		const uncertain = bolt.t('component.seal_uncertain');
		const refresh = Effect.all(
			[bolt.get('orders', target), bolt.recordCapabilities('orders', target)],
			{ concurrency: 'unbounded' }
		);
		revising = true;
		const outcome = yield* bolt.act('orders.revise', { target, input: {} });
		if (outcome.kind === 'committed') {
			selectedVersion = 'draft';
			feedback = '';
			const [fresh, capabilities] = yield* refresh;
			const controller = recordController?.current;
			if (
				!recordController?.historical &&
				fresh?.status === 'draft' &&
				capabilities?.revision === fresh.revision &&
				controller?.spec.target.of === 'collection' &&
				controller.spec.target.collection === 'orders' &&
				controller.spec.target.id === target
			) {
				const encoded = JSON.stringify(fresh);
				controller.refresh(
					Schema.decodeUnknownSync(
						Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))
					)(encoded)
				);
				controller.capabilities = capabilities;
				controller.edit();
			}
		} else feedback = uncertain;
	});
	function confirm() {
		const owner = actionScope;
		if (owner === undefined) return;
		const uncertain = bolt.t('component.seal_uncertain');
		fork(
			Effect.forkIn(
				confirmOrder().pipe(
					Effect.catch((failure) =>
						Effect.sync(() => {
							feedback = failure._tag === 'ActRefused' ? failure.message : uncertain;
						})
					),
					Effect.ensuring(
						Effect.sync(() => {
							pending = false;
						})
					)
				),
				owner
			)
		);
	}
	function revise() {
		const owner = actionScope;
		if (owner === undefined) return;
		const uncertain = bolt.t('component.seal_uncertain');
		fork(
			Effect.forkIn(
				reviseOrder().pipe(
					Effect.catch((failure) =>
						Effect.sync(() => {
							feedback = failure._tag === 'ActRefused' ? failure.message : uncertain;
						})
					),
					Effect.ensuring(
						Effect.sync(() => {
							revising = false;
						})
					)
				),
				owner
			)
		);
	}
</script>

{#snippet validity(form: FormState, field: FieldEditor)}
	<TimeRangeInput
		of="date"
		precision="day"
		id={field.id}
		value={{ from: form.get('valid_from'), to: form.get('valid_until') }}
		onChange={(range) => {
			if (Schema.is(DateBounds)(range)) {
				form.set('valid_from', range.from ?? null);
				form.set('valid_until', range.to ?? null);
			}
		}}
	/>
{/snippet}
{#snippet party(form: FormState, field: FieldEditor)}
	<Picker
		of="parties"
		id={field.id}
		value={form.id<'parties'>('party')}
		where={{
			active: { eq: true },
			kind: {
				in:
					form.get('direction') === 'sales'
						? ['customer', 'both']
						: form.get('direction') === 'purchasing'
							? ['supplier', 'both']
							: ['customer', 'supplier', 'both']
			}
		}}
		disabled={field.disabled}
		invalid={Boolean(field.error)}
		onChange={field.onChange}
	/>
{/snippet}
{#snippet confirmation(form: FormState)}
	{#if checkSource && draftContract}<Stack gap="sm">
			{#if form.dirty}<p class="text-sm text-muted-foreground">
					{bolt.t('component.seal_explanation')}
				</p>{/if}

			{#if $check.value}
				{#if $check.value.below_inventory_cost.length}<p class="text-sm">
						{bolt.t('component.below_inventory_cost')}: {$check.value.below_inventory_cost.join(
							', '
						)}
					</p>{/if}
				<Button disabled={pending || form.dirty || form.pending} onclick={confirm}
					>{bolt.t('component.confirm_seal')}</Button
				>
			{:else}<p>
					{$check.error
						? bolt.t($check.error.message as import('@norbital-ai/bolt').MessageKey)
						: bolt.t('component.check_loading')}
				</p>{/if}
		</Stack>{/if}
	{#if feedback}<p role="status">{feedback}</p>{/if}
{/snippet}
{#snippet agreement()}
	{#if versions.length && selectedContract}
		<Stack gap="md">
			<Grid as="dl" gap="md" minimum="compact">
				<div>
					<dt class="text-xs font-medium text-muted-foreground">
						{bolt.t('models.orders.fields.sealed_at')}
					</dt>
					<dd class="text-sm">
						<Show kind={{ kind: 'instant' }} value={selectedContract.approved_at} />
					</dd>
				</div>
				<div>
					<dt class="text-xs font-medium text-muted-foreground">
						{bolt.t('models.orders.fields.payment_terms')}
					</dt>
					<dd class="text-sm">{selectedContract.snapshot.payment_terms}</dd>
				</div>
				<div>
					<dt class="text-xs font-medium text-muted-foreground">
						{bolt.t('models.orders.fields.delivery_terms')}
					</dt>
					<dd class="text-sm">{selectedContract.snapshot.delivery_terms || '—'}</dd>
				</div>
				<div>
					<dt class="text-xs font-medium text-muted-foreground">
						{bolt.t('models.orders.fields.valid_from')}
					</dt>
					<dd class="text-sm">
						<Show
							kind={{ kind: 'period', of: 'date', precision: 'day' }}
							value={selectedContract.snapshot.valid_from || selectedContract.snapshot.valid_until
								? {
										from: selectedContract.snapshot.valid_from ?? null,
										to: selectedContract.snapshot.valid_until ?? null
									}
								: null}
						/>
					</dd>
				</div>
			</Grid>
			<Stack as="ul" gap="sm" class="rounded-md border border-border">
				{#each selectedContract.snapshot.lines as line (line.id)}
					<li class="p-3 text-sm">
						<strong>{line.product_name}</strong>
						<p>
							{line.product_code}
						</p>
						<p>
							{bolt.t('models.order_lines.fields.quantity')}: {line.quantity}
							{line.unit}
						</p>
						<p>
							{bolt.t('models.order_lines.fields.unit_price')}: {selectedContract.snapshot.currency}
							{line.unit_price}
						</p>
					</li>
				{/each}
			</Stack>
		</Stack>
	{:else if view.mode !== 'create' && view.record.status === 'draft'}
		<p>{bolt.t('component.unfinalized_quotation')}</p>
	{:else}<p>{bolt.t('errors.agreement_access')}</p>{/if}
{/snippet}
{#snippet operations()}
	{#if view.mode !== 'create'}<Stack gap="md">
			{#if view.record.closure_snapshot && !isMasked(view.record.closure_snapshot)}
				<h3>{bolt.t('models.orders.fields.closure_snapshot')}</h3>
				<p>{bolt.t('component.closure_explanation')}</p>
				{#each view.record.closure_snapshot as line (line.order_line)}
					<p>
						{line.product_name}: {line.fulfilled} / {line.ordered}
						{line.unit} · {bolt.t('component.released_quantity')}: {line.released}
						{line.unit}
					</p>
				{/each}
			{/if}
		</Stack>{/if}
{/snippet}
{#snippet itemFields(form: FormState)}<OrderItemFields {form} />{/snippet}
{#snippet lines()}{#if id}<CreateTable
			of="order_lines"
			where={{ order: { eq: id } }}
			columns={[
				'product_name',
				'quantity',
				'unit',
				'unit_price',
				'discount_pct',
				'tax_rate',
				'total'
			]}
			createValues={{ order: id }}
			createFields={[]}
			createForm={itemFields}
			allowCreate={view.mode !== 'create' && view.record.status === 'draft'}
		/>{/if}{/snippet}
{#snippet fulfillment()}{#if id}<Stack gap="md">
			<p>{bolt.t('component.transaction_quota')}</p>
			<Table
				of="transactions"
				where={{ order: { eq: id }, kind: { in: ['delivery', 'invoice'] } }}
				columns={['reference', 'kind', 'status', 'source_updated_at']}
				toolbar={{ new: false }}
			/>
		</Stack>{/if}{/snippet}
{#snippet activity()}{#if id}
		<Stack gap="md">
			<CreateTable
				of="activities"
				where={{ order: { eq: id } }}
				columns={['title', 'kind', 'owner', 'due_on', 'done']}
				createValues={{ order: id }}
				createFields={['title', 'kind', 'owner', 'due_on', 'done', 'notes']}
			/>
		</Stack>{/if}{/snippet}
{#snippet versionPicker()}{#if versions.length}<label class="w-44">
			<span class="sr-only">{bolt.t('models.orders.fields.contract_version')}</span>
			<Combobox
				size="sm"
				readonly={false}
				options={[
					...(view.mode !== 'create' && view.record.status === 'draft'
						? [
								{
									value: 'draft',
									label: `${bolt.t('component.contract_draft')} · ${String(versions.length + 1).padStart(3, '0')}`
								}
							]
						: []),
					...versions.map((v) => ({
						value: String(v.version),
						label: `${bolt.t('section.seal')} ${String(v.version).padStart(3, '0')}`
					}))
				]}
				value={draftContract ? 'draft' : String(selectedContract?.version)}
				onChange={(v) => {
					selectedVersion = v;
				}}
			/>
		</label>{/if}{/snippet}
{#snippet confirmationLink()}{#if id && view.mode !== 'create'}
		<Stack gap="sm">
			<span class="text-xs font-medium text-muted-foreground"
				>{bolt.t(`models.${confirmationCollection}.singular`)}</span
			>
			{#if $confirmationRows.value}{#each $confirmationRows.value.rows as receipt (receipt.id)}
					<Cluster gap="sm" align="center">
						<button
							type="button"
							class="w-fit text-left text-primary underline-offset-4 hover:underline"
							onclick={() => openRecord(confirmationCollection, receipt.id)}
							>{receipt.reference}</button
						>
						<Badge
							variant={receipt.status === 'issued'
								? 'success'
								: receipt.status === 'void'
									? 'destructive'
									: 'warning'}
							>{bolt.t(
								receipt.status === 'issued'
									? 'component.confirmation_confirmed'
									: receipt.status === 'void'
										? `models.${confirmationCollection}.fields.status.void`
										: 'component.confirmation_pending'
							)}</Badge
						>
					</Cluster>
				{:else}<Badge class="w-fit" variant={pushFailed ? 'destructive' : 'warning'}
						>{bolt.t(
							pushFailed ? 'component.confirmation_error' : 'component.confirmation_pending'
						)}</Badge
					>{/each}
			{:else}<Badge
					class="w-fit"
					variant={$confirmationRows.error || pushFailed ? 'destructive' : 'warning'}
					>{bolt.t(
						$confirmationRows.error || pushFailed
							? 'component.confirmation_error'
							: 'component.confirmation_pending'
					)}</Badge
				>{/if}
		</Stack>
	{/if}{/snippet}
{#snippet amendment()}{#if id && view.mode !== 'create' && view.record.status === 'confirmed' && kinds.catalog?.orders?.actions?.revise}
		<Button size="sm" variant="outline" disabled={revising} onclick={revise}
			>{bolt.t('component.new_contract_version')}</Button
		>
	{/if}{/snippet}
{#snippet contractActions()}<Cluster gap="sm" align="center"
		>{@render amendment()}{@render versionPicker()}</Cluster
	>{/snippet}
{#snippet generalDetails()}{#if id}<Stack gap="md">
			{#if view.mode !== 'create' && view.record.closure_snapshot && !isMasked(view.record.closure_snapshot)}
				<Section
					name="closure"
					title={bolt.t('models.orders.fields.closure_snapshot')}
					defaultOpen={false}
				>
					{@render operations()}
				</Section>
			{/if}
		</Stack>{/if}{/snippet}
{#snippet contractBody()}{#if draftContract || view.mode === 'create'}{@render lines()}{:else}{@render agreement()}{/if}{/snippet}
{#snippet confirmationHeader()}<div class="w-64 max-w-full shrink-0" data-order-confirmation>
		{@render confirmationLink()}
	</div>{/snippet}
<span hidden {@attach actionLifetime}></span>
<RecordForm
	actions={confirmationHeader}
	readonly={view.mode !== 'create' && (view.record.status !== 'draft' || !draftContract)}
	history={{
		fields: [
			'title',
			'direction',
			'party',
			'owner',
			'warehouse',
			'status',
			'total',
			'ordered_on',
			'currency',
			'valid_from',
			'valid_until',
			'payment_terms',
			'delivery_terms',
			'notes',
			'supporting_documents',
			'contract_version'
		],
		sources: id
			? [
					...[
						'activities',
						'order_lines',
						'transactions',
						view.mode !== 'create' && view.record.direction === 'purchasing'
							? 'ext_purchase_orders'
							: 'ext_sales_orders',
						...(view.mode !== 'create' && !isMasked(view.record.currency)
							? ['source_payments', 'source_sales_lines']
							: [])
					].map((of) => ({ of, query: { where: { order: { eq: id } }, all: true } }))
				]
			: []
	}}
	mainTitle={bolt.t('section.general')}
	afterForm={generalDetails}
	editors={{ party, valid_from: validity }}
	{view}
	formActions={confirmation}
	subtitle={['party', 'status']}
	sections={[
		{
			name: 'order',
			readonlyFields:
				view.mode !== 'create'
					? [
							...(versions.length ? ['party', 'owner', 'warehouse', 'currency', 'ordered_on'] : []),
							...(typeof view.record.line_count === 'number' && view.record.line_count > 0
								? ['party', 'warehouse', 'currency', 'ordered_on', 'tax_inclusive']
								: [])
						]
					: [],

			fields: [
				'title',
				'party',
				'owner',
				'warehouse',
				'ordered_on',
				...(view.mode !== 'create' && ['closed', 'cancelled'].includes(view.record.status)
					? ['reason']
					: []),
				'currency',
				'tax_inclusive'
			]
		},
		{
			name: 'contract',
			title: bolt.t('section.seal'),
			actions: contractActions,
			body: contractBody,
			fields:
				draftContract || view.mode === 'create'
					? ['valid_from', 'payment_terms', 'delivery_terms', 'notes']
					: []
		},
		{
			name: 'documents',
			title: bolt.t('section.documents'),
			fields: ['supporting_documents']
		}
	]}
	tabs={id
		? [
				{ name: 'activities', title: bolt.t('models.activities.label'), body: activity },
				{ name: 'transactions', title: bolt.t('section.transactions'), body: fulfillment }
			]
		: []}
/>
