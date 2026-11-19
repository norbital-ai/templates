<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { BigDecimal, DateTime, Effect, Schema } from 'effect';
	import type { Id } from '@norbital-ai/bolt';
	import { observe_once, run } from '@norbital-ai/ui/effect';
	import { deliveredByLine, orderDeliveries } from '../../../lib/order-delivery.js';
	import { reportPages } from '../../../lib/reports.js';
	import {
		belowInventoryCost,
		quotationCostRead,
		quotationScopeRead,
		quotationFifoCosts
	} from '../../../lib/quotation.js';
	import { quoteBelowFloor } from '../../../lib/commercial.js';
	import { purchaseLotCostRead } from '../../../lib/lot-cost.js';
	import {
		Table,
		Button,
		format,
		Show,
		Picker,
		Combobox,
		Badge,
		Progress,
		Tooltip,
		Icon,
		TimeRangeInput,
		use_record_controller,
		use_act,
		type FieldEditor,
		type FormState,
		type RecordView,
		type RowOf
	} from '@norbital-ai/ui';
	import { Bound, Stack, Cluster } from '@norbital-ai/ui/layout';
	import { kingdeeConnectionStatus } from '../../../integration/kingdee/connection-status.js';
	import PrintDetails from '../../../lib/ui/print-details.svelte';
	import { contractKind, currentTemplate } from '../../../lib/order-document.js';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import { createValues, openCreate } from '../../../lib/ui/create-values.js';
	const moneyKind = { kind: 'money', currency: 'currency' } as const;

	const DateBounds = Schema.Struct({
		from: Schema.NullOr(Schema.String),
		to: Schema.NullOr(Schema.String)
	});
	// "within N days" of the order date, the way contracts state a shipment
	const shipWithin = [7, 15, 30, 45, 60, 90] as const;
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
	// the contract layout the order's print details belong to: its case's current version
	const layouts = ctx.query({
		document_templates: {
			where: { status: { eq: 'published' } },
			fields: ['kind', 'locale', 'status', 'version'],
			limit: 1000
		}
	});
	const contractLayout = (form: FormState) =>
		currentTemplate(
			layouts.current?.document_templates.rows ?? [],
			contractKind(form.get('direction') === 'purchasing' ? 'purchasing' : 'sales'),
			form.get('document_locale') === 'zh' ? 'zh' : 'en'
		)?.id;
	const ledgerRead = $derived(
		id && commercial
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
	// FIFO costs are judged against the minute's stock feed
	const clock = ctx.clock('minute');
	const day = ctx.clock('day');
	const costScopeRead = $derived(
		id && view.mode !== 'create' && view.record.status === 'draft' && commercial
			? ctx.query(quotationScopeRead(id))
			: null
	);
	const costScope = $derived(costScopeRead?.current?.orders.rows[0]);
	const costRead = $derived(costScope ? ctx.query(quotationCostRead(costScope)) : null);
	const quote = $derived(costRead?.current?.orders.rows[0]);
	const belowCost = $derived(costRead?.current ? belowInventoryCost(costRead.current) : []);
	// a line a commercial manager has yet to decide holds the sync: root rows carry their open request
	const linesRead = $derived(
		id && draft
			? ctx.query({ order_lines: { where: { order: { eq: id } }, fields: ['id'], limit: 200 } })
			: null
	);
	const linesPending = $derived(
		Boolean(linesRead?.current?.order_lines.rows.some((line) => line.$approval))
	);
	const purchaseCostRead = $derived(
		quote?.direction === 'sales' && quote.ledger && ctx.catalog?.source_lot_costs
			? ctx.query(purchaseLotCostRead(quote.ledger))
			: null
	);
	const purchaseCosts = $derived(purchaseCostRead?.current?.source_lot_costs.rows[0]);
	const fifoCosts = $derived(
		costRead?.current && purchaseCosts && ledger
			? quotationFifoCosts(costRead.current, purchaseCosts, clock.now, ledger)
			: []
	);
	const archived = $derived(view.mode !== 'create' && view.record.archived);
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
	const save = use_act(ctx);
	const disabled = $derived(
		Boolean(
			recordController?.historical ||
			recordController?.current?.dirty ||
			recordController?.current?.capabilities?.update.reasons.includes('under_approval') ||
			save.pending
		)
	);
	// the Kingdee SO or PO as last read, or why there is none yet
	const kingdee = $derived.by(() => {
		if (view.mode === 'create' || draft) return null;
		const so = view.record.kingdee;
		const sync = view.record.$sync?.kingdee;
		const failed = sync?.status === 'failed';
		if (failed)
			return {
				label: ctx.t('component.confirmation_error'),
				variant: 'destructive' as const,
				detail: sync?.message ?? ''
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
			detail: `${ctx.t('component.kingdee')} · ${so.reference} · ${ctx.t('component.kingdee_version')} ${so.version}`
		};
	});
	// once: from then on the order and its Kingdee SO or PO stay in step
	function syncOrder() {
		if (!id || view.mode === 'create' || archived) return;
		save.run(
			ctx.act({
				'orders.update': [
					{ target: { id, revision: view.record.revision }, set: { status: 'confirmed' } }
				]
			})
		);
	}
	// the warehouse and party fill the places and the buyer while the form still holds their previous defaults
	const follow = (
		form: FormState,
		field: 'place_of_loading' | 'place_of_delivery' | 'delivery_address',
		was: string | null,
		next: string | null
	) => {
		const current = form.get(field);
		if (!current || current === was) form.set(field, next);
	};
	function pickWarehouse(form: FormState, field: FieldEditor, next: Id<'warehouses'> | null) {
		const before = form.id<'warehouses'>('warehouse');
		field.on_change(next);
		const site = form.get('direction') === 'purchasing' ? 'place_of_delivery' : 'place_of_loading';
		void run(
			ctx
				.query({
					warehouses: {
						where: { id: { in: [before, next].flatMap((w) => (w ? [w] : [])) } },
						fields: ['name']
					}
				})
				.pipe(
					Effect.map(({ warehouses }) => {
						const name = (w: Id<'warehouses'> | null) =>
							warehouses.rows.find((row) => row.id === w)?.name ?? null;
						if (form.id<'warehouses'>('warehouse') === next)
							follow(form, site, name(before), name(next));
					})
				)
		);
	}
	function pickParty(form: FormState, field: FieldEditor, next: Id<'parties'> | null) {
		const before = form.id<'parties'>('party');
		field.on_change(next);
		if (next === null) return form.set('buyer_contact', null);
		void run(
			ctx
				.query({
					parties: {
						where: { id: { in: [before, next].flatMap((p) => (p ? [p] : [])) } },
						fields: ['address']
					},
					contacts: {
						where: { party: { eq: next }, primary: { eq: true } },
						fields: ['id'],
						limit: 1
					}
				})
				.pipe(
					Effect.map(({ parties, contacts }) => {
						if (form.id<'parties'>('party') !== next) return;
						const address = (p: Id<'parties'> | null) =>
							parties.rows.find((row) => row.id === p)?.address ?? null;
						if (form.get('direction') !== 'purchasing')
							follow(form, 'delivery_address', address(before), address(next));
						form.set('buyer_contact', contacts.rows[0]?.id ?? null);
					})
				)
		);
	}
	function archiveOrder(archive: boolean) {
		if (!id || view.mode === 'create') return;
		save.run(
			ctx.act({
				'orders.update': [
					{ target: { id, revision: view.record.revision }, set: { archived: archive } }
				]
			})
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
		on_change={(next) => pickParty(form, field, next)}
	/>
{/snippet}
{#snippet warehouse(form: FormState, field: FieldEditor)}
	<Picker
		{ctx}
		of="warehouses"
		id={field.id}
		value={form.id<'warehouses'>('warehouse')}
		where={{ active: { eq: true } }}
		disabled={field.disabled}
		invalid={Boolean(field.error)}
		on_change={(next) => pickWarehouse(form, field, next)}
	/>
{/snippet}
{#snippet buyer(form: FormState, field: FieldEditor)}
	{@const party = form.id<'parties'>('party')}
	<Picker
		{ctx}
		of="contacts"
		id={field.id}
		value={form.id<'contacts'>('buyer_contact')}
		where={party ? { party: { eq: party } } : { id: { in: [] } }}
		disabled={field.disabled || !party}
		invalid={Boolean(field.error)}
		on_change={field.on_change}
	/>
{/snippet}
{#snippet shipment(form: FormState, field: FieldEditor)}
	{@const window = form.get('shipment')}
	<Cluster gap="sm" class="max-w-full">
		<TimeRangeInput
			{ctx}
			of="date"
			precision="day"
			id={field.id}
			value={Schema.is(DateBounds)(window) ? window : { from: null, to: null }}
			disabled={field.disabled}
			on_change={(range) => {
				if (Schema.is(DateBounds)(range))
					field.on_change(range.from ? { from: range.from, to: range.to } : null);
			}}
		/>
		<div class="w-40">
			<Combobox
				options={shipWithin.map((days) => ({
					value: String(days),
					label: ctx.t('component.ship_within', { days })
				}))}
				value={null}
				placeholder={ctx.t('component.ship_within_placeholder')}
				aria-label={ctx.t('component.ship_within_placeholder')}
				disabled={field.disabled}
				on_change={(days) => {
					const from = String(form.get('ordered_on') ?? day.today);
					if (days)
						field.on_change({
							from,
							to: DateTime.formatIsoDateUtc(
								DateTime.add(DateTime.makeUnsafe(from), { days: Number(days) })
							)
						});
				}}
			/>
		</div>
	</Cluster>
{/snippet}
{#snippet printDetails(form: FormState, field: FieldEditor)}
	<PrintDetails
		{ctx}
		layout={contractLayout(form)}
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
		layout={contractLayout(form)}
		scope="order"
		value={form.get('print_values')}
	/>
{/snippet}

{#snippet confirmationNotices(form: FormState)}
	{#if costRead && draft}
		{#if costRead.current}
			{#if !purchaseCosts && belowCost.length}<p class="text-sm">
					{ctx.t('component.below_inventory_cost')}: {belowCost.join(', ')}
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
									<span class="font-medium">{row.product}</span> · {format(
										{ kind: 'decimal', scale: 3 },
										BigDecimal.format(row.quantity),
										{ locale: ctx.locale }
									)}
									{row.unit}
									{#if row.estimate}
										· {purchaseCosts.currency}
										{format(
											{ kind: 'decimal', scale: 4 },
											BigDecimal.format(BigDecimal.round(row.estimate.unit_cost, { scale: 4 })),
											{ locale: ctx.locale }
										)}
										/ {row.unit}
										{#if row.below}
											· {ctx.t('stock.fifo.below_quote')}{/if}
										<div class="text-muted-foreground">
											{row.estimate.lots
												.map(
													(lot) =>
														`${lot.lot_number} × ${format({ kind: 'decimal', scale: 3 }, BigDecimal.format(lot.quantity), { locale: ctx.locale })}`
												)
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
{#snippet syncButton(form: FormState)}
	{#if view.mode !== 'create' && draft && commercial}
		{@const blocked = archived
			? ctx.t('component.order_archived')
			: form.dirty
				? ctx.t('component.sync_save_first')
				: view.record.$approval || linesPending
					? ctx.t('component.sync_pending_approval')
					: !view.record.line_count
						? ctx.t('errors.lines_required')
						: !view.record.payment_terms
							? ctx.t('errors.payment_terms')
							: sourceState && sourceState !== 'connected'
								? ctx.t(`component.kingdee_${sourceState}`)
								: null}
		<Button
			disabled={save.pending || form.pending || Boolean(blocked)}
			aria-describedby={blocked ? 'sync-blocked' : undefined}
			onclick={syncOrder}>{ctx.t('component.sync_kingdee')}</Button
		>
		{#if blocked}<span id="sync-blocked" class="text-xs text-muted-foreground">{blocked}</span>{/if}
	{/if}
{/snippet}
{#snippet lineUnitPrice({
	row,
	value
}: {
	row: RowOf<'order_lines'>;
	value: RowOf<'order_lines'>['unit_price'] | undefined;
})}
	{@const floor =
		view.mode !== 'create' &&
		row.floor_net != null &&
		row.unit_price != null &&
		row.discount_pct != null &&
		row.tax_rate != null
			? {
					net: row.floor_net,
					effective_on: row.floor_on,
					below: quoteBelowFloor(
						{
							unit_price: row.unit_price,
							discount_pct: row.discount_pct,
							tax_rate: row.tax_rate,
							floor_net: row.floor_net
						},
						view.record.tax_inclusive
					)
				}
			: undefined}
	{#if floor && value != null}
		{@const status = ctx.t(floor.below ? 'errors.floor_below' : 'component.quote_floor_met')}
		{@const minimum = `${row.currency} ${format({ kind: 'decimal', scale: 8 }, floor.net, { locale: ctx.locale })}/${row.unit}`}
		{@const hint = `${status} ${ctx.t('component.quote_floor_minimum')}: ${minimum} · ${floor.effective_on ?? ''}`}
		<Tooltip text={hint}>
			{#snippet trigger({ props })}
				<button
					{...props}
					type="button"
					aria-label={`${row.currency} ${format({ kind: 'decimal', scale: 4 }, value, { locale: ctx.locale })}. ${hint}`}
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
	{#if value != null}{format({ kind: 'decimal', scale: 3 }, value, { locale: ctx.locale })}{/if}
	{#if delivered && value != null && BigDecimal.isPositive(BigDecimal.fromStringUnsafe(value))}
		{@const label = ctx.t('component.line_delivery_progress', {
			quantity: format({ kind: 'decimal', scale: 3 }, BigDecimal.format(delivered), {
				locale: ctx.locale
			}),
			unit: row.unit
		})}
		<Progress
			class="mt-1 h-1"
			value={Math.max(
				0,
				Math.min(
					100,
					BigDecimal.toNumberUnsafe(
						BigDecimal.round(
							BigDecimal.divideUnsafe(
								BigDecimal.multiply(delivered, BigDecimal.fromBigInt(100n)),
								BigDecimal.fromStringUnsafe(value)
							),
							{ scale: 2 }
						)
					)
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
		/>{/if}{/snippet}
{#snippet contractActions(form: FormState | undefined)}
	<Cluster gap="sm" class="max-w-full">
		{#if kingdee}
			<Tooltip text={kingdee.detail || kingdee.label}>
				{#snippet trigger({ props })}<Badge {...props} tabindex={0} variant={kingdee.variant}
						>{kingdee.label}</Badge
					>{/snippet}
			</Tooltip>
		{/if}
		{#if form}{@render syncButton(form)}{/if}
	</Cluster>{/snippet}
{#snippet contractBody(form: FormState)}<Stack gap="md">
		{@render confirmationNotices(form)}
		<Bound size="viewport">{@render lines()}</Bound>
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
				if (value && (value === 'archived') !== archived) archiveOrder(value === 'archived');
			}}
		/>
	{/if}
{/snippet}
<RecordForm
	{ctx}
	editable_presets={['document_locale']}
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
			'document_locale',
			'currency',
			'valid_from',
			'valid_until',
			'payment_terms',
			'shipping_terms',
			'place_of_loading',
			'place_of_delivery',
			'packaging',
			'shipping_mark',
			'shipment',
			'other_terms',
			'payment_method',
			'buyer_contact',
			'delivery_address',
			'logistics_handler',
			'notes',
			'supporting_documents'
		],
		sources: id
			? [
					'activities',
					'order_lines',
					'transactions',
					...(commercial ? ['source_payments', 'source_sales_lines', 'order_files'] : [])
				].map((of) => ({ of, where: { order: { eq: id } } }))
			: []
	}}
	editors={{
		party,
		warehouse,
		buyer_contact: buyer,
		shipment,
		valid_from: validity,
		print_values: printDetails
	}}
	viewers={{ print_values: printDetailsView }}
	{view}
	sections={[
		{
			name: 'order',
			// Kingdee keeps a synced order's header
			readonlyFields: draft ? [] : ['party', 'owner'],
			fields: ['title', 'party', 'owner', 'notes']
		},
		{
			name: 'contract',
			icon: 'lucide:file-signature',
			title: ctx.t('section.seal'),
			actions: contractActions,
			body: contractBody,
			fields: [
				'warehouse',
				'ordered_on',
				'currency',
				'tax_inclusive',
				'valid_from',
				'payment_terms',
				'shipping_terms',
				'place_of_loading',
				'place_of_delivery',
				'packaging',
				'shipping_mark',
				'shipment',
				'other_terms',
				'payment_method',
				'buyer_contact',
				'delivery_address',
				'logistics_handler',
				'document_locale',
				'supporting_documents',
				'print_values'
			],
			readonlyFields: draft ? [] : ['ordered_on', 'currency', 'payment_terms'],
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
