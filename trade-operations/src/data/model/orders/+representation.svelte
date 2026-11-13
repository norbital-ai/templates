<script lang="ts">
	import { translated } from '../../../lib/ui/message.js';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { attach, fork } from '@norbital-ai/ui/effect';
	import { BigDecimal, Effect, Result, Schema, Scope } from 'effect';
	import { observe_once } from '@norbital-ai/ui/effect';
	import { deliveredByLine, orderDeliveries } from '../../../lib/order-delivery.js';
	import { reportPages } from '../../../lib/reports.js';
	import { dec, div, round, text, type DecimalLike } from '../../../lib/values.js';
	import {
		confirmationCheck,
		confirmationHash,
		confirmationRead,
		quotationFifoCosts
	} from '../../../lib/confirmation.js';
	import { purchaseLotCostRead } from '../../../lib/lot-cost.js';
	import {
		Table,
		Button,
		Show,
		Picker,
		Combobox,
		Badge,
		Progress,
		Tooltip,
		Icon,
		TimeRangeInput,
		use_record_controller,
		type FieldEditor,
		type FormState,
		type RecordView,
		type RowOf
	} from '@norbital-ai/ui';
	import { Stack, Cluster } from '@norbital-ai/ui/layout';
	import { kingdeeConnectionStatus } from '../../../integration/kingdee/connection-status.js';
	import OrderDocumentDialog from './order-document-dialog.svelte';
	import PrintDetails from '../../../lib/ui/print-details.svelte';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import { createValues, openCreate } from '../../../lib/ui/create-values.js';
	const moneyKind = { kind: 'money', currency: 'currency' } as const;
	function displayDecimal(value: DecimalLike) {
		const exact = text(value);
		return exact.includes('.') ? exact.replace(/0+$/, '').replace(/\.$/, '') : exact;
	}

	const DateBounds = Schema.Struct({
		from: Schema.NullOr(Schema.String),
		to: Schema.NullOr(Schema.String)
	});
	let {
		view,
		ctx
	}: {
		view: RecordView<'orders'>;
		ctx: PageContext;
	} = $props();
	// a narrower output (logistics) carries no commercial terms
	const commercial = $derived(ctx.catalog?.orders?.output === undefined);
	const recordController = use_record_controller();
	let pending = $state(false);
	const id = $derived(view.mode !== 'create' ? view.record.id : null);
	const preset = createValues();
	const purchase = $derived(
		view.mode === 'create'
			? (view.values && 'direction' in view.values
					? view.values.direction
					: 'direction' in preset
						? preset.direction
						: undefined) === 'purchasing'
			: view.record.direction === 'purchasing'
	);
	const draft = $derived(view.mode === 'create' || view.record.status === 'draft');
	const ledgerRead = $derived(
		id && commercial && !purchase
			? ctx.query({
					orders: {
						where: { id: { eq: id } },
						fields: ['ledger'],
						limit: 1,
						ledger: { fields: ['active', 'status'] }
					}
				})
			: null
	);
	const ledger = $derived(ledgerRead?.current?.orders.rows[0]?.ledger);
	const sourceState = $derived(ledger ? kingdeeConnectionStatus(ledger) : null);
	// credit freshness is judged against the minute, so the check re-answers as the minute turns
	const clock = ctx.clock('minute');
	const checkRead = $derived(
		id && view.mode !== 'create' && view.record.status === 'draft' && commercial
			? ctx.query(confirmationRead(id))
			: null
	);
	const check = $derived(
		checkRead?.current && view.mode !== 'create'
			? confirmationCheck(checkRead.current, {
					revision: view.record.revision,
					as_of: clock.now
				})
			: null
	);
	const quote = $derived(checkRead?.current?.orders.rows[0]);
	const quoteFloors = $derived(
		new Map(
			check && Result.isSuccess(check) ? check.success.floors.map((line) => [line.id, line]) : []
		)
	);
	const purchaseCostRead = $derived(
		quote?.direction === 'sales' && quote.ledger && ctx.catalog?.source_lot_costs
			? ctx.query(purchaseLotCostRead(quote.ledger))
			: null
	);
	const purchaseCosts = $derived(purchaseCostRead?.current?.source_lot_costs.rows[0]);
	const fifoCosts = $derived(
		checkRead?.current && purchaseCosts
			? quotationFifoCosts(checkRead.current, purchaseCosts, clock.now)
			: []
	);
	const archived = $derived(view.mode !== 'create' && view.record.archived);
	let documentOpen = $state(false);
	const deliveryRequest = $derived(
		id &&
			!draft &&
			commercial &&
			ctx.catalog?.transactions &&
			ctx.catalog.transactions.output === undefined
			? orderDeliveries(id)
			: null
	);
	const deliveryRead = $derived(deliveryRequest ? ctx.query(deliveryRequest) : null);
	const deliveryPage = $derived(deliveryRead?.current?.transactions);
	const remainingDeliveries = observe_once(() => {
		const request = deliveryRequest;
		const first = deliveryPage;
		return request && first?.next
			? reportPages(first, (after) =>
					ctx
						.query({
							transactions: { ...request.transactions, after }
						})
						.pipe(Effect.map((answer) => answer.transactions))
				)
			: null;
	});
	const deliveryTotals = $derived.by(() => {
		const rows = deliveryPage?.next === null ? deliveryPage.rows : remainingDeliveries.current;
		return rows ? deliveredByLine(rows) : undefined;
	});
	const disabled = $derived(
		Boolean(
			recordController?.historical ||
			recordController?.current?.dirty ||
			recordController?.current?.capabilities?.update.reasons.includes('under_approval') ||
			pending
		)
	);
	// the Kingdee SO as last read, or why there is none yet
	const kingdee = $derived.by(() => {
		if (view.mode === 'create' || purchase || draft) return null;
		const so = view.record.kingdee;
		const failed = view.record.$sync?.kingdee?.status === 'failed';
		if (failed)
			return {
				label: ctx.t('component.confirmation_error'),
				variant: 'destructive' as const,
				detail: view.record.$sync?.kingdee?.message ?? ''
			};
		if (!so)
			return sourceState && sourceState !== 'connected'
				? {
						label: ctx.t(`component.kingdee_${sourceState}`),
						variant: 'outline' as const,
						detail: ''
					}
				: {
						label: ctx.t('component.contract_pending'),
						variant: 'warning' as const,
						detail: ctx.t('component.kingdee_waiting')
					};
		const presentation = so.closed
			? { label: ctx.t('component.kingdee_status_closed'), variant: 'outline' as const }
			: so.status === 'issued'
				? { label: ctx.t('component.confirmation_confirmed'), variant: 'success' as const }
				: so.status === 'void'
					? { label: ctx.t('component.kingdee_status_void'), variant: 'destructive' as const }
					: { label: ctx.t('component.contract_pending'), variant: 'warning' as const };
		return {
			...presentation,
			detail: `Kingdee · ${so.reference} · ${ctx.t('component.kingdee_version')} ${so.version}`
		};
	});
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
		if (!id || view.mode === 'create' || !check || Result.isFailure(check) || pending || archived)
			return;
		const revision = view.record.revision;
		const check_hash = yield* confirmationHash(check.success);
		const target = id;
		const awaiting = ctx.t('component.awaiting_approval');
		const uncertain = ctx.t('component.seal_uncertain');
		pending = true;
		const result = yield* ctx.act({
			'orders.update': [
				{ target: { id: target, revision }, set: { status: 'confirmed', check_hash } }
			]
		});
		const controller = recordController?.current;
		if (
			result.kind === 'committed' &&
			controller?.spec.target.of === 'model' &&
			controller.spec.target.model === 'orders' &&
			controller.spec.target.id === target
		)
			controller.view();
		feedback =
			result.kind === 'committed' ? '' : result.kind === 'pending_approval' ? awaiting : uncertain;
	});
	const archiveOrder = Effect.fn('Trading.archiveOrder')(function* (archive: boolean) {
		if (!id || view.mode === 'create' || pending) return;
		pending = true;
		feedback = '';
		const result = yield* ctx.act({
			'orders.update': [
				{ target: { id, revision: view.record.revision }, set: { archived: archive } }
			]
		});
		if (result.kind === 'pending_approval') feedback = ctx.t('component.awaiting_approval');
		else if (result.kind !== 'committed') feedback = ctx.t('component.seal_uncertain');
	});
	function run(action: Effect.Effect<void, { readonly _tag: string; readonly message?: string }>) {
		const owner = actionScope;
		if (owner === undefined) return;
		fork(
			Effect.forkIn(
				action.pipe(
					Effect.catch((failure) =>
						Effect.sync(() => {
							feedback =
								failure._tag === 'ActRefused'
									? translated(ctx, failure.message ?? '')
									: failure._tag === 'ActConflict'
										? ctx.t('component.order_changed')
										: ctx.t('component.seal_uncertain');
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
		{ctx}
		of="date"
		precision="day"
		id={field.id}
		value={{ from: form.get('valid_from'), to: form.get('valid_until') }}
		on_change={(range) => {
			if (Schema.is(DateBounds)(range)) {
				form.set('valid_from', range.from ?? null);
				form.set('valid_until', range.to ?? null);
			}
		}}
	/>
{/snippet}
{#snippet party(form: FormState, field: FieldEditor)}
	<Picker
		{ctx}
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
		on_change={field.on_change}
	/>
{/snippet}
{#snippet printDetails(form: FormState, field: FieldEditor)}
	<PrintDetails
		{ctx}
		layout={form.id<'document_templates'>('document_template')}
		scope="order"
		value={field.value}
		on_change={field.on_change}
		id={field.id}
		disabled={field.disabled}
	/>
{/snippet}

{#snippet printDetailsView(form: FormState)}
	<PrintDetails
		{ctx}
		layout={form.id<'document_templates'>('document_template')}
		scope="order"
		value={form.get('print_values')}
	/>
{/snippet}

{#snippet confirmationNotices(form: FormState)}
	{#if checkRead && draft}
		{#if check && Result.isSuccess(check)}
			{#if !purchaseCosts && check.success.below_inventory_cost.length}<p class="text-sm">
					{ctx.t('component.below_inventory_cost')}: {check.success.below_inventory_cost.join(', ')}
				</p>{/if}
			{#if purchaseCosts && !form.dirty}
				{#if !quote?.warehouse}
					<p class="text-sm text-muted-foreground">{ctx.t('stock.fifo.choose_warehouse')}</p>
				{:else if fifoCosts.length}
					<details class="rounded-md border border-input px-3 py-2 text-sm">
						<summary class="cursor-pointer font-medium">{ctx.t('stock.fifo.title')}</summary>
						<p class="mt-2 text-muted-foreground">{ctx.t('stock.fifo.scope')}</p>
						<ul class="mt-2 space-y-2">
							{#each fifoCosts as row (row.key)}
								<li>
									<span class="font-medium">{row.product}</span> · {text(row.quantity)}
									{row.unit}
									{#if row.estimate}
										· {purchaseCosts.currency}
										{text(round(row.estimate.unit_cost, 4))} / {row.unit}
										{#if row.below}
											· {ctx.t('stock.fifo.below_quote')}{/if}
										<div class="text-muted-foreground">
											{row.estimate.lots
												.map((lot) => `${lot.lot_number} × ${text(lot.quantity)}`)
												.join(' · ')}
										</div>
									{:else}
										· {ctx.t('component.inventory_cost_unavailable')}{/if}
								</li>
							{/each}
						</ul>
					</details>
				{/if}
			{/if}
		{/if}
	{/if}
{/snippet}
{#snippet sealButton(form: FormState)}
	{#if checkRead && draft}
		{@const blocked = archived
			? ctx.t('component.order_archived')
			: form.dirty
				? ctx.t(purchase ? 'component.commitment_save_first' : 'component.seal_explanation')
				: check && Result.isFailure(check)
					? ctx.t(check.failure)
					: !check
						? (checkRead.error?.message ?? ctx.t('component.check_loading'))
						: null}
		<Button
			disabled={pending || form.pending || Boolean(blocked)}
			aria-describedby={blocked ? 'seal-blocked' : undefined}
			onclick={() => run(confirmOrder())}
			>{ctx.t(purchase ? 'component.record_commitment' : 'component.confirm_seal')}</Button
		>
		{#if blocked}<span id="seal-blocked" class="text-xs text-muted-foreground">{blocked}</span>{/if}
	{/if}
{/snippet}
{#snippet lineUnitPrice({
	row,
	value
}: {
	row: RowOf<'order_lines'>;
	value: RowOf<'order_lines'>['unit_price'] | undefined;
})}
	{@const floor = draft ? quoteFloors.get(row.id) : undefined}
	{#if floor?.net != null && quote && value != null}
		{@const status = ctx.t(floor.below ? 'errors.floor_below' : 'component.quote_floor_met')}
		{@const minimum = `${quote.currency} ${displayDecimal(floor.net)}/${floor.unit}`}
		{@const hint = `${status} ${ctx.t('component.quote_floor_minimum')}: ${minimum} · ${floor.effective_on}`}
		<Tooltip text={hint}>
			{#snippet trigger({ props })}
				<button
					{...props}
					type="button"
					aria-label={`${quote.currency} ${displayDecimal(value)}. ${hint}`}
					class="inline-flex items-center gap-1 rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-ring"
					class:text-destructive={floor.below}
					class:text-success={!floor.below}
				>
					<Show {ctx} kind={moneyKind} {value} {row} />
					<Icon name={floor.below ? 'lucide:arrow-down' : 'lucide:check'} class="size-3 shrink-0" />
				</button>
			{/snippet}
		</Tooltip>
	{:else}
		<Show {ctx} kind={moneyKind} {value} {row} />
	{/if}
{/snippet}
{#snippet lineQuantity({
	row,
	value
}: {
	row: RowOf<'order_lines'>;
	value: RowOf<'order_lines'>['quantity'] | undefined;
})}
	{@const delivered = deliveryTotals?.get(`${row.id}/${row.unit}`)}
	{#if value != null}{displayDecimal(value)}{/if}
	{#if delivered && value != null && BigDecimal.isPositive(dec(value))}
		{@const label = ctx.t('component.line_delivery_progress', {
			quantity: displayDecimal(delivered),
			unit: row.unit
		})}
		<Progress
			class="mt-1 h-1"
			value={Math.max(
				0,
				Math.min(
					100,
					BigDecimal.toNumberUnsafe(div(BigDecimal.multiply(delivered, dec(100)), value, 2))
				)
			)}
			aria-label={label}
		/>
		<span class="mt-1 block text-xs text-muted-foreground">{label}</span>
	{/if}
{/snippet}
{#snippet lines()}{#if id}<Table
			{ctx}
			of="order_lines"
			where={{ order: { eq: id } }}
			columns={[
				'product_name',
				{ field: 'quantity', cell: lineQuantity },
				'unit',
				{ field: 'unit_price', cell: lineUnitPrice },
				'discount_pct',
				'tax_rate',
				'total'
			]}
			toolbar={{
				new:
					ctx.catalog?.order_lines?.create && view.mode !== 'create' && !archived
						? () => openCreate('order_lines', { order: id })
						: false
			}}
		/>{/if}{/snippet}
{#snippet fulfillment()}{#if id}<Table
			{ctx}
			of="transactions"
			where={{ order: { eq: id }, kind: { in: ['delivery', 'invoice'] } }}
			columns={['reference', 'kind', 'status', 'source_updated_at']}
			toolbar={{ new: false }}
		/>{/if}{/snippet}
{#snippet filed()}{#if id}<Table
			{ctx}
			of="order_files"
			where={{ order: { eq: id } }}
			columns={['title', 'file', 'created_at']}
			toolbar={{
				new:
					ctx.catalog?.order_files?.create && !draft && !archived
						? () => openCreate('order_files', { order: id })
						: false
			}}
		/>{/if}{/snippet}
{#snippet activity()}{#if id}
		<Stack gap="md">
			<Table
				{ctx}
				of="activities"
				where={{ order: { eq: id } }}
				columns={['title', 'kind', 'owner', 'due_on', 'done']}
				toolbar={{
					new:
						ctx.catalog?.activities?.create && !archived
							? () => openCreate('activities', { order: id })
							: false
				}}
			/>
		</Stack>{/if}{/snippet}
{#snippet contractActions(form: FormState | undefined)}
	<Cluster gap="sm" class="max-w-full">
		{#if kingdee}
			<Tooltip text={kingdee.detail || kingdee.label}>
				{#snippet trigger({ props })}<Badge {...props} tabindex={0} variant={kingdee.variant}
						>{kingdee.label}</Badge
					>{/snippet}
			</Tooltip>
		{/if}
		{#if id && commercial && !recordController?.historical}
			<Button type="button" variant="outline" onclick={() => (documentOpen = true)}
				>{ctx.t('component.preview_document')}</Button
			>
		{/if}
		{#if form}{@render sealButton(form)}{/if}
	</Cluster>{/snippet}
{#snippet contractBody(form: FormState)}<Stack gap="md">
		{#if feedback}<p
				role={feedback === ctx.t('component.awaiting_approval') ? 'status' : 'alert'}
				class={[
					'rounded-md border px-3 py-2 text-sm font-medium',
					feedback === ctx.t('component.awaiting_approval')
						? 'border-info/50 bg-info/10 text-info'
						: 'border-destructive/50 bg-destructive/10 text-destructive'
				]}
			>
				{feedback}
			</p>{/if}
		{@render confirmationNotices(form)}
		{#if purchase && draft}
			<p class="text-sm text-muted-foreground">{ctx.t('component.commitment_help')}</p>
		{/if}
		{@render lines()}
	</Stack>{/snippet}
{#snippet orderState()}
	{#if view.mode !== 'create'}
		<Combobox
			options={[
				{ value: 'active', label: ctx.t('component.order_active') },
				{ value: 'archived', label: ctx.t('component.order_archived') }
			]}
			variant="ghost"
			value={archived ? 'archived' : 'active'}
			aria-label={ctx.t('models.orders.fields.archived')}
			{disabled}
			readonly={!ctx.catalog?.orders?.update}
			on_change={(value) => {
				if (value && (value === 'archived') !== archived) run(archiveOrder(value === 'archived'));
			}}
		/>
	{/if}
{/snippet}
<span hidden {@attach actionLifetime}></span>
<RecordForm
	{ctx}
	editable_presets={['document_template']}
	trailing={orderState}
	readonly={archived}
	readonly_reason={ctx.t('component.order_archived')}
	history={{
		fields: [
			'title',
			'direction',
			'party',
			'owner',
			'warehouse',
			'status',
			'archived',
			'total',
			'ordered_on',
			'document_template',
			'currency',
			'valid_from',
			'valid_until',
			'payment_terms',
			'delivery_terms',
			'shipping_terms',
			'place_of_loading',
			'place_of_delivery',
			'packaging',
			'shipping_mark',
			'time_of_shipment',
			'other_terms',
			'payment_method',
			'buyer_contact',
			'buyer_mobile',
			'delivery_address',
			'delivery_date',
			'logistics_handler',
			'notes',
			'supporting_documents'
		],
		sources: id
			? [
					'activities',
					'order_lines',
					'transactions',
					...(purchase ? ['ext_purchase_orders'] : []),
					...(commercial ? ['source_payments', 'source_sales_lines', 'order_files'] : [])
				].map((of) => ({ of, where: { order: { eq: id } } }))
			: []
	}}
	editors={{
		party,
		valid_from: validity,
		print_values: printDetails
	}}
	viewers={{ print_values: printDetailsView }}
	{view}
	sections={[
		{
			name: 'order',
			readonlyFields: draft ? [] : ['party', 'owner'],
			fields: ['title', 'party', 'owner', 'notes']
		},
		{
			name: 'contract',
			icon: 'lucide:file-signature',
			title: ctx.t(purchase ? 'component.purchase_commitment' : 'section.seal'),
			actions: contractActions,
			body: contractBody,
			fields: [
				'warehouse',
				'ordered_on',
				'currency',
				'tax_inclusive',
				'valid_from',
				'payment_terms',
				'delivery_terms',
				'shipping_terms',
				'place_of_loading',
				'place_of_delivery',
				'packaging',
				'shipping_mark',
				'time_of_shipment',
				'other_terms',
				'payment_method',
				'buyer_contact',
				'buyer_mobile',
				'delivery_address',
				'delivery_date',
				'logistics_handler',
				'document_template',
				'supporting_documents',
				'print_values'
			],
			// a confirmed order, or one with lines, keeps the basis its lines were priced on
			readonlyFields:
				view.mode !== 'create' &&
				(!draft || (typeof view.record.line_count === 'number' && view.record.line_count > 0))
					? ['warehouse', 'ordered_on', 'currency', 'tax_inclusive']
					: [],
			wide: ['print_values']
		}
	]}
	tabs={id
		? [
				{ name: 'activities', title: ctx.t('models.activities.label'), body: activity },
				{ name: 'transactions', title: ctx.t('section.transactions'), body: fulfillment },
				...(commercial && ctx.catalog?.order_files
					? [{ name: 'files', title: ctx.t('models.order_files.label'), body: filed }]
					: [])
			]
		: []}
/>

{#if id && documentOpen}
	<OrderDocumentDialog {ctx} order={id} on_close={() => (documentOpen = false)} />
{/if}
