<script lang="ts">
	import { attach, fork, bolt } from '$bolt';
	import { Effect, Schema, Scope } from 'effect';
	import { agreements } from '../../../lib/agreements.js';
	import { isMasked } from '@norbital-ai/bolt';
	import { watch } from 'runed';
	import {
		Table,
		Section,
		Button,
		Form,
		Field,
		Show,
		Picker,
		Combobox,
		Badge,
		Tooltip,
		Dialog,
		TimeRangeInput,
		useKinds,
		useRecordController,
		type FieldEditor,
		type FormState,
		type RecordView,
		openRecord
	} from '@norbital-ai/ui';
	import { Stack, Grid, Cluster, Scroll } from '@norbital-ai/ui/layout';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import OrderItemFields from '../../../lib/ui/order-item-fields.svelte';
	import CreateTable from '../../../lib/ui/create-table.svelte';
	const moneyKind = { kind: 'money', currency: 'currency' } as const;
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
	const id = $derived(view.mode !== 'create' ? view.record.id : null);
	// credit freshness is judged against the minute, so the check re-answers as the minute turns
	const clock = bolt.clock('minute');
	const check = $derived(
		id &&
			view.mode !== 'create' &&
			view.record.status === 'draft' &&
			!isMasked(view.record.currency)
			? bolt.query('orders.confirmation_check', {
					order: id,
					revision: view.record.revision,
					as_of: clock.now
				})
			: null
	);
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
	const confirmationRows = $derived(
		id
			? bolt.query(confirmationCollection, {
					where: {
						order: { eq: id },
						...((selectedContract ?? versions.at(-1))
							? { agreement_hash: { eq: (selectedContract ?? versions.at(-1))!.seal_hash } }
							: {})
					},
					select: { reference: true, status: true },
					all: true
				})
			: null
	);
	const pushFailed = $derived(
		view.mode !== 'create' &&
			view.record.status !== 'draft' &&
			view.record.$sync?.kingdee?.status === 'failed'
	);
	const sealed = $derived(
		view.mode !== 'create' &&
			(view.record.status === 'confirmed' ||
				view.record.status === 'closed' ||
				Boolean(view.record.seal_hash) ||
				Boolean(confirmationRows?.current?.rows.length))
	);
	let transition = $state<'cancelled' | 'closed' | null>(null);
	const states = $derived(
		view.mode === 'create'
			? []
			: [
					{
						value: view.record.status,
						label: bolt.t(`models.orders.fields.status.${view.record.status}`)
					},
					...(view.record.status === 'confirmed' && kinds.automations?.orders_close
						? [
								{
									value: 'closed',
									label: bolt.t('models.orders.fields.status.closed'),
									description: bolt.t('component.close_order_help')
								}
							]
						: []),
					...(['draft', 'confirmed'].includes(view.record.status) &&
					kinds.automations?.orders_cancel
						? [
								{
									value: 'cancelled',
									label: bolt.t('models.orders.fields.status.cancelled'),
									description: bolt.t('component.cancel_order_help')
								}
							]
						: [])
				]
	);
	watch(
		() => (view.mode === 'create' ? null : view.record.status),
		(status) => {
			if (status === transition) transition = null;
		}
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
		const readiness = check?.current;
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
	{#if check && draftContract}<Stack gap="sm">
			{#if form.dirty}<p class="text-sm text-muted-foreground">
					{bolt.t('component.seal_explanation')}
				</p>{/if}

			{#if check.current}
				{#if check.current.below_inventory_cost.length}<p class="text-sm">
						{bolt.t('component.below_inventory_cost')}: {check.current.below_inventory_cost.join(
							', '
						)}
					</p>{/if}
				<Button disabled={pending || form.dirty || form.pending} onclick={confirm}
					>{bolt.t('component.confirm_seal')}</Button
				>
			{:else}<p>
					{check.error ? check.error.message : bolt.t('component.check_loading')}
				</p>{/if}
		</Stack>{/if}
	{#if feedback && draftContract}<p role="status">{feedback}</p>{/if}
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
			{@const currency = { currency: selectedContract.snapshot.currency }}
			<Scroll name="agreement-lines" axis="x" class="rounded-md border border-border">
				<table class="w-full text-sm">
					<thead class="bg-muted/50 text-left text-muted-foreground">
						<tr>
							<th class="px-3 py-2 font-medium">{bolt.t('models.order_lines.fields.product')}</th>
							{#each ['quantity', 'unit_price', 'discount_pct', 'tax_rate', 'total'] as const as name (name)}<th
									class="px-3 py-2 text-right font-medium whitespace-nowrap"
									>{bolt.t(`models.order_lines.fields.${name}`)}</th
								>{/each}
						</tr>
					</thead>
					<tbody>
						{#each selectedContract.snapshot.lines as line (line.id)}
							<tr class="border-t border-border align-top">
								<td class="px-3 py-2"
									>{line.product_name}
									<span class="block text-xs text-muted-foreground">{line.product_code}</span></td
								>
								<td class="px-3 py-2 text-right whitespace-nowrap tabular-nums"
									>{line.quantity} {line.unit}</td
								>
								<td class="px-3 py-2 text-right"
									><Show
										kind={{ ...moneyKind, scale: 4 }}
										value={line.unit_price}
										row={currency}
									/></td
								>
								<td class="px-3 py-2 text-right tabular-nums">{line.discount_pct}%</td>
								<td class="px-3 py-2 text-right tabular-nums">{line.tax_rate}%</td>
								<td class="px-3 py-2 text-right"
									><Show kind={moneyKind} value={line.total} row={currency} /></td
								>
							</tr>
						{/each}
					</tbody>
					<!-- the agreed totals under the lines -->
					<tfoot class="border-t border-border">
						{#each ['net', 'tax', 'total'] as const as name (name)}<tr
								class={name === 'total' ? 'font-medium' : 'text-muted-foreground'}
							>
								<td colspan="5" class="px-3 py-1.5 text-right"
									>{bolt.t(`models.orders.fields.${name}`)}</td
								>
								<td class="px-3 py-1.5 text-right"
									><Show
										kind={moneyKind}
										value={selectedContract.snapshot[name]}
										row={currency}
									/></td
								>
							</tr>{/each}
					</tfoot>
				</table>
			</Scroll>
		</Stack>
	{:else if view.mode !== 'create' && view.record.status === 'draft'}
		<p>{bolt.t('component.unfinalized_quotation')}</p>
	{:else}<p>{bolt.t('errors.agreement_access')}</p>{/if}
{/snippet}
{#snippet operations()}
	{#if view.mode !== 'create'}<Stack gap="md">
			{#if view.record.closure_snapshot && !isMasked(view.record.closure_snapshot)}
				<p>{bolt.t('component.closure_explanation')}</p>
				<Table
					of={view.record.closure_snapshot}
					columns={[
						{ field: 'product_name', label: bolt.t('models.order_lines.fields.product_name') },
						{ field: 'ordered', label: bolt.t('models.order_lines.fields.quantity'), align: 'end' },
						{ field: 'fulfilled', label: bolt.t('component.delivered_quantity'), align: 'end' },
						{ field: 'released', label: bolt.t('component.released_quantity'), align: 'end' },
						{ field: 'unit', label: bolt.t('models.order_lines.fields.unit') }
					]}
					toolbar={{ new: false }}
				/>
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
{#snippet confirmationLink()}{#if id && view.mode !== 'create' && sealed}
		{#if confirmationRows?.current}{#each confirmationRows.current.rows as receipt (receipt.id)}
				{@const receiptInfo = `Kingdee · ${receipt.reference} · ${bolt.t(`models.${confirmationCollection}.fields.status.${receipt.status}`)}`}
				<Tooltip text={receiptInfo}>
					{#snippet trigger({ props })}
						<button
							{...props}
							type="button"
							aria-label={receiptInfo}
							class="inline-flex rounded-full focus-visible:outline-2 focus-visible:outline-ring"
							onclick={() => openRecord(confirmationCollection, receipt.id)}
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
						</button>
					{/snippet}
				</Tooltip>
			{:else}<Tooltip
					text={view.record.$sync?.kingdee?.message ?? bolt.t('component.kingdee_waiting')}
				>
					{#snippet trigger({ props })}<Badge
							{...props}
							tabindex={0}
							class="w-fit"
							variant={pushFailed ? 'destructive' : 'warning'}
							>{bolt.t(
								pushFailed ? 'component.confirmation_error' : 'component.confirmation_pending'
							)}</Badge
						>{/snippet}</Tooltip
				>{/each}
		{:else}<Tooltip
				text={confirmationRows?.error?.message ??
					view.record.$sync?.kingdee?.message ??
					bolt.t('component.kingdee_waiting')}
			>
				{#snippet trigger({ props })}<Badge
						{...props}
						tabindex={0}
						class="w-fit"
						variant={confirmationRows?.error || pushFailed ? 'destructive' : 'warning'}
						>{bolt.t(
							confirmationRows?.error || pushFailed
								? 'component.confirmation_error'
								: 'component.confirmation_pending'
						)}</Badge
					>{/snippet}</Tooltip
			>{/if}
	{/if}{/snippet}
{#snippet contractActions()}<Cluster gap="sm" align="center">{@render versionPicker()}</Cluster
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
{#snippet orderState()}
	{#if view.mode !== 'create'}
		<Combobox
			options={states}
			variant="ghost"
			size="sm"
			value={view.record.status}
			aria-label={bolt.t('models.orders.fields.status')}
			disabled={Boolean(
				recordController?.historical ||
				recordController?.current?.dirty ||
				recordController?.current?.capabilities?.update.reasons.includes('underApproval') ||
				pending
			)}
			readonly={states.length < 2}
			onChange={(value) => {
				if ((value === 'closed' || value === 'cancelled') && value !== view.record.status)
					transition = value;
			}}
		/>
	{/if}
{/snippet}
{#snippet confirmationHeader()}{#if sealed}<Cluster gap="sm" align="center" data-order-confirmation
			>{@render confirmationLink()}</Cluster
		>{/if}{/snippet}
<span hidden {@attach actionLifetime}></span>
<RecordForm
	trailing={orderState}
	actions={confirmationHeader}
	readonly={view.mode !== 'create' && (view.record.status !== 'draft' || sealed || !draftContract)}
	readonlyReason={bolt.t(sealed ? 'component.sealed' : 'component.readonly')}
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
	{...id && draftContract ? { formActions: confirmation } : {}}
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
				'tax_inclusive',
				'notes'
			],
			wide: ['notes']
		},
		{
			name: 'contract',
			title: bolt.t('section.seal'),
			actions: contractActions,
			body: contractBody,
			fields:
				draftContract || view.mode === 'create'
					? ['valid_from', 'payment_terms', 'delivery_terms', 'supporting_documents']
					: ['supporting_documents'],
			wide: ['supporting_documents']
		}
	]}
	tabs={id
		? [
				{ name: 'activities', title: bolt.t('models.activities.label'), body: activity },
				{ name: 'transactions', title: bolt.t('section.transactions'), body: fulfillment }
			]
		: []}
/>
<Dialog.Root
	open={transition !== null}
	onOpenChange={(open) => {
		if (!open) transition = null;
	}}
>
	{#if transition && id && view.mode !== 'create'}
		<Dialog.Content class="sm:max-w-lg">
			<Dialog.Title
				>{bolt.t(
					transition === 'closed' ? 'component.close_order' : 'component.cancel_order'
				)}</Dialog.Title
			>
			<Dialog.Description
				>{bolt.t(
					transition === 'closed' ? 'component.close_order_help' : 'component.cancel_order_help'
				)}</Dialog.Description
			>
			<Form
				of={{ automation: transition === 'closed' ? 'orders_close' : 'orders_cancel' }}
				values={{ target: id, revision: view.record.revision }}
				fields={['reason']}
				submit={bolt.t(
					transition === 'closed' ? 'component.close_order' : 'component.cancel_order'
				)}
			>
				<Field name="reason" label={bolt.t('models.orders.fields.reason')} />
			</Form>
		</Dialog.Content>
	{/if}
</Dialog.Root>
