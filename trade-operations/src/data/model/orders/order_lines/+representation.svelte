<script lang="ts">
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { run } from '@norbital-ai/ui/effect';
	import { selectOrderProduct } from '../../../../lib/ui/order-product-defaults.js';
	import {
		Badge,
		Field,
		format,
		open_record,
		type InsertOf,
		Picker,
		RecordForm,
		Section,
		type RecordView,
		type FormState,
		type FieldEditor,
		type FieldView
	} from '@norbital-ai/ui';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import PrintDetails from '../../../../lib/ui/print-details.svelte';
	import UnitPriceInput from '../../../../lib/ui/unit-price-input.svelte';
	import UnitQuantityInput from '../../../../lib/ui/unit-quantity-input.svelte';
	import { createValues } from '../../../../lib/ui/create-values.js';
	import { contractKind, currentTemplate, documentLocale } from '../../../../lib/order-document.js';
	import {
		evaluateSalesLineFloor,
		floorFor,
		floorNetInUnit,
		quoteBelowFloor
	} from '../../../../lib/commercial.js';
	import { displayUnit, isKgUnit, priceToDisplay } from '../../../../lib/unit-display.js';
	let {
		view,
		ctx
	}: {
		view: RecordView<'order_lines'>;
		ctx: PageContext;
	} = $props();
	// a new line is opened from its order (`openCreate`)
	const preset = createValues<'order_lines'>();
	const parent = $derived(
		view.mode !== 'create' ? view.record.order : (view.values.order ?? preset.order)
	);
	const order = $derived(
		parent ? ctx.query({ orders: { where: { id: { eq: parent } }, limit: 1 } }) : null
	);
	const header = $derived(order?.current?.orders.rows[0]);
	let chosenCurrency = $state<string | undefined>(undefined);
	let chosenProduct = $state<Id<'products'> | null>(null);
	const currency = $derived(
		view.mode !== 'create' ? view.record.currency : (header?.currency ?? chosenCurrency)
	);
	const selectedProductId = $derived(
		view.mode !== 'create'
			? view.record.product
			: (chosenProduct ?? view.values.product ?? preset.product ?? null)
	);
	const selectedProduct = $derived(
		view.mode === 'create' && selectedProductId
			? ctx.query({
					products: { where: { id: { eq: selectedProductId } }, fields: ['unit'], limit: 1 }
				})
			: null
	);
	const lineUnit = $derived(
		view.mode !== 'create'
			? view.record.unit
			: (selectedProduct?.current?.products.rows[0]?.unit ?? null)
	);
	// a line's print details belong to its order's current contract layout
	const layouts = ctx.query({
		document_templates: {
			where: { status: { eq: 'published' } },
			fields: ['kind', 'locale', 'status', 'version'],
			limit: 1000
		}
	});
	const layout = $derived(
		header &&
			header.currency &&
			currentTemplate(
				layouts.current?.document_templates.rows ?? [],
				contractKind(header.direction),
				documentLocale(header.currency)
			)?.id
	);
	// the floor book a sales line is priced against, read as the order stands
	const floorRead = $derived(
		header?.direction === 'sales' && header.currency && ctx.catalog?.pricing_floors
			? ctx.query({
					pricing_floors: {
						where: { currency: { eq: header.currency }, effective_on: { lte: header.ordered_on } },
						limit: 10000
					},
					warehouses: {
						where: { id: { in: header.warehouse ? [header.warehouse] : [] } },
						fields: ['group_code']
					},
					commercial_settings: {
						where: { code: { eq: 'default' } },
						fields: ['floor_rule'],
						limit: 1
					}
				})
			: null
	);
	/** The floor the line as typed meets, whether its price is below it, and what the floor rule does then. */
	function floorState(form: FormState) {
		const book = floorRead?.current;
		const productId = form.id<'products'>('product');
		if (!book || !header || !productId) return null;
		const rule = book.commercial_settings.rows[0]?.floor_rule ?? 'warn';
		const unitValue = lineUnit ?? form.get('unit');
		const resolvedUnit = typeof unitValue === 'string' && unitValue !== '' ? unitValue : undefined;
		const rawPrice = form.get('unit_price');
		const rawDiscount = form.get('discount_pct');
		const rawTax = form.get('tax_rate');
		const evaluation = evaluateSalesLineFloor({
			order: header,
			groupCode: book.warehouses.rows[0]?.group_code,
			product: productId,
			unit: resolvedUnit,
			unitPrice: rawPrice == null ? null : String(rawPrice),
			discountPct: rawDiscount == null ? null : String(rawDiscount),
			taxRate: rawTax == null ? null : String(rawTax),
			floors: book.pricing_floors.rows
		});
		return {
			floor: evaluation.floor,
			displayFloorNet:
				evaluation.floorNet !== null ? priceToDisplay(evaluation.floorNet, resolvedUnit) : null,
			displayFloorUnit: displayUnit(resolvedUnit ?? evaluation.floor?.unit, ctx.locale),
			below: evaluation.status === 'below',
			rule,
			status: evaluation.status,
			flagged: evaluation.flagged
		};
	}
	const savedFloorState = $derived.by(() => {
		if (view.mode === 'create' || header?.direction !== 'sales') return null;
		const rec = view.record;
		const book = floorRead?.current;
		const liveFloor = book
			? floorFor(
					header,
					book.warehouses.rows[0]?.group_code,
					{ product: rec.product, ...(rec.unit ? { unit: rec.unit } : {}) },
					book.pricing_floors.rows
				)
			: undefined;
		const floorNet =
			rec.floor_net ??
			(liveFloor && rec.unit
				? floorNetInUnit(liveFloor, rec.unit)
				: (liveFloor?.floor_net ?? null));
		const floorOn = rec.floor_on ?? liveFloor?.effective_on ?? null;
		if (floorNet === null) {
			return {
				status: 'missing' as const,
				displayFloorNet: null,
				displayFloorUnit: displayUnit(rec.unit, ctx.locale),
				floorOn
			};
		}
		const below = quoteBelowFloor(
			{
				unit_price: rec.unit_price,
				discount_pct: rec.discount_pct,
				tax_rate: rec.tax_rate,
				floor_net: floorNet
			},
			header.tax_inclusive
		);
		return {
			status: below ? ('below' as const) : ('met' as const),
			displayFloorNet: priceToDisplay(floorNet, rec.unit),
			displayFloorUnit: displayUnit(rec.unit, ctx.locale),
			floorOn
		};
	});
	const values: Partial<InsertOf<'order_lines'>> = $derived(
		view.mode === 'create' ? { ...preset, ...view.values } : {}
	);
	let added = $state(0);
</script>

{#snippet product(field: FieldEditor)}
	<Picker
		{ctx}
		of="products"
		id={field.id}
		value={field.form.id<'products'>('product')}
		where={{ active: { eq: true } }}
		disabled={field.disabled}
		invalid={Boolean(field.error)}
		on_change={(id) => {
			chosenProduct = id;
			void run(
				selectOrderProduct(
					ctx,
					field.form,
					field,
					id,
					(value) => {
						chosenCurrency = value;
					},
					view.mode === 'create'
				)
			);
		}}
	/>
{/snippet}
{#snippet quantityEditor(field: FieldEditor)}
	<UnitQuantityInput
		{ctx}
		id={field.id}
		value={field.value}
		unit={lineUnit}
		on_change={field.on_change}
		disabled={field.disabled}
		invalid={Boolean(field.error)}
	/>
{/snippet}
{#snippet quantityView(field: FieldView)}
	<UnitQuantityInput {ctx} value={field.value} unit={lineUnit} readonly />
{/snippet}
{#snippet unitPrice(field: FieldEditor)}
	{@const state = floorState(field.form)}
	<Stack gap="xs">
		<UnitPriceInput
			{ctx}
			id={field.id}
			value={field.value}
			unit={lineUnit}
			on_change={field.on_change}
			{...currency ? { currency } : {}}
			disabled={field.disabled}
			invalid={Boolean(field.error) || Boolean(state?.flagged)}
		/>
		{#if state}
			<Inline id={`${field.id}-floor`} align="center" gap="xs">
				{#if state.status === 'met'}
					<Badge variant="success">{ctx.t('component.floor_status_pass')}</Badge>
				{:else if state.status === 'below'}
					<Badge variant="destructive">{ctx.t('component.floor_status_fail')}</Badge>
				{:else if state.status === 'missing'}
					<Badge variant="destructive">{ctx.t('component.floor_status_missing')}</Badge>
				{/if}
				<p
					class="text-xs font-medium"
					class:text-destructive={state.flagged}
					class:text-success={state.status === 'met'}
					class:text-muted-foreground={state.status === 'guide'}
				>
					{#if state.floor && state.displayFloorNet !== null}
						{ctx.t('component.quote_floor_minimum')}: {header?.currency}
						{format({ kind: 'decimal', scale: isKgUnit(lineUnit) ? 2 : 4 }, state.displayFloorNet, {
							locale: ctx.locale
						})}/{state.displayFloorUnit} · {state.floor.effective_on}
						{#if state.status !== 'guide'}
							· {ctx.t(state.below ? 'errors.floor_below' : 'component.quote_floor_met')}
						{/if}
					{:else}
						{ctx.t('component.floor_none')}
					{/if}
					{#if state.flagged && state.rule !== 'warn'}
						· {ctx.t(`component.floor_rule_${state.rule}`)}
					{/if}
				</p>
			</Inline>
		{/if}
	</Stack>
{/snippet}
{#snippet unitPriceView(field: FieldView)}
	<Stack gap="xs">
		<UnitPriceInput
			{ctx}
			value={field.value}
			unit={lineUnit}
			{...currency ? { currency } : {}}
			readonly
		/>
		{#if savedFloorState}
			<Inline align="center" gap="xs">
				{#if savedFloorState.status === 'met'}
					<Badge variant="success">{ctx.t('component.floor_status_pass')}</Badge>
				{:else if savedFloorState.status === 'below'}
					<Badge variant="destructive">{ctx.t('component.floor_status_fail')}</Badge>
				{:else}
					<Badge variant="destructive">{ctx.t('component.floor_status_missing')}</Badge>
				{/if}
				{#if savedFloorState.displayFloorNet !== null}
					<span
						class="text-xs font-medium"
						class:text-success={savedFloorState.status === 'met'}
						class:text-destructive={savedFloorState.status !== 'met'}
					>
						{ctx.t('component.quote_floor_minimum')}: {header?.currency}
						{format(
							{ kind: 'decimal', scale: isKgUnit(lineUnit) ? 2 : 4 },
							savedFloorState.displayFloorNet,
							{ locale: ctx.locale }
						)}/{savedFloorState.displayFloorUnit}{#if savedFloorState.floorOn}
							· {savedFloorState.floorOn}{/if}
					</span>
				{:else}
					<span class="text-xs font-medium text-destructive">{ctx.t('component.floor_none')}</span>
				{/if}
			</Inline>
		{/if}
	</Stack>
{/snippet}
{#snippet printDetails(field: FieldEditor)}
	<PrintDetails
		{ctx}
		{layout}
		scope="line"
		value={field.value}
		on_change={field.on_change}
		id={field.id}
		disabled={field.disabled}
	/>
{/snippet}
{#snippet printDetailsView(field: FieldView)}
	<PrintDetails {ctx} {layout} scope="line" value={field.value} />
{/snippet}
{#key added}
	<RecordForm
		{ctx}
		on_done={(o) => {
			if (view.mode !== 'create' || o.kind !== 'committed' || !o.records[0]) return;
			// a create its opener scopes stays open for the next one
			if (Object.keys(values).length > 0) added++;
			else open_record(view.model, o.records[0].id);
		}}
		view={view.mode === 'create' ? { ...view, values } : view}
		{...header?.archived ? { lock: ctx.t('component.order_archived') } : {}}
	>
		<Section first name="line" icon="lucide:list" title={ctx.t('section.lines')}>
			<Grid gap="md" minimum="compact">
				<Field {ctx} name="product" editor={product} />
				<Field {ctx} name="quantity" editor={quantityEditor} view={quantityView} />
				<Field {ctx} name="unit_price" editor={unitPrice} view={unitPriceView} />
				<Field {ctx} name="discount_pct" />
				<Field {ctx} name="tax_rate" />
				{#if layout}<Field
						{ctx}
						name="print_values"
						wide
						editor={printDetails}
						view={printDetailsView}
					/>{/if}
			</Grid>
		</Section>
	</RecordForm>{/key}
