<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { run } from '@norbital-ai/ui/effect';
	import { selectOrderProduct } from '../../../../lib/ui/order-product-defaults.js';
	import {
		format,
		Picker,
		MoneyInput,
		type RecordView,
		type FormState,
		type FieldEditor
	} from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import PrintDetails from '../../../../lib/ui/print-details.svelte';
	import RecordForm from '../../../../lib/ui/record-form.svelte';
	import { createValues } from '../../../../lib/ui/create-values.js';
	import { contractKind, currentTemplate, documentLocale } from '../../../../lib/order-document.js';
	import { floorFor, floorNetInUnit, quoteBelowFloor } from '../../../../lib/commercial.js';
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
	const currency = $derived(
		view.mode !== 'create' ? view.record.currency : (header?.currency ?? chosenCurrency)
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
		const unitValue = view.mode !== 'create' ? view.record.unit : form.get('unit');
		const lineUnit = typeof unitValue === 'string' && unitValue !== '' ? unitValue : undefined;
		const floor = floorFor(
			header,
			book.warehouses.rows[0]?.group_code,
			{ product: productId, ...(lineUnit ? { unit: lineUnit } : {}) },
			book.pricing_floors.rows
		);
		const floorNet =
			floor && lineUnit ? floorNetInUnit(floor, lineUnit) : (floor?.floor_net ?? null);
		const price = form.get('unit_price');
		const below =
			floor && floorNet !== null && price != null && String(price) !== ''
				? quoteBelowFloor(
						{
							unit_price: String(price),
							discount_pct: String(form.get('discount_pct') ?? '0'),
							tax_rate: String(form.get('tax_rate') ?? '0'),
							floor_net: floorNet
						},
						header.tax_inclusive
					)
				: false;
		return { floor, below, rule, flagged: !floor || floorNet === null || below };
	}
</script>

{#snippet product(form: FormState, field: FieldEditor)}
	<Picker
		{ctx}
		of="products"
		id={field.id}
		value={form.id<'products'>('product')}
		where={{ active: { eq: true } }}
		disabled={field.disabled}
		invalid={Boolean(field.error)}
		on_change={(id) =>
			void run(
				selectOrderProduct(
					ctx,
					form,
					field,
					id,
					(value) => {
						chosenCurrency = value;
					},
					view.mode === 'create'
				)
			)}
	/>
{/snippet}
{#snippet unitPrice(form: FormState, field: FieldEditor)}
	{@const state = floorState(form)}
	<Stack gap="xs">
		<MoneyInput
			{ctx}
			id={field.id}
			value={field.value}
			on_change={field.on_change}
			{...currency ? { currency } : {}}
			scale={4}
			disabled={field.disabled}
			invalid={Boolean(field.error) || Boolean(state?.flagged && state.rule === 'refuse')}
		/>
		{#if state}
			<p
				id={`${field.id}-floor`}
				class="text-xs"
				class:text-destructive={state.flagged && state.rule !== 'warn'}
				class:text-warning={state.flagged && state.rule === 'warn'}
				class:text-muted-foreground={!state.flagged}
			>
				{#if state.floor}
					{ctx.t('component.quote_floor_minimum')}: {header?.currency}
					{format({ kind: 'decimal', scale: 8 }, state.floor.floor_net, {
						locale: ctx.locale
					})}/{state.floor.unit} · {state.floor.effective_on}
					· {ctx.t(state.below ? 'errors.floor_below' : 'component.quote_floor_met')}
				{:else}
					{ctx.t('component.floor_none')}
				{/if}
				{#if state.flagged && state.rule !== 'warn'}
					· {ctx.t(`component.floor_rule_${state.rule}`)}
				{/if}
			</p>
		{/if}
	</Stack>
{/snippet}
{#snippet printDetails(_form: FormState, field: FieldEditor)}
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
{#snippet printDetailsView(form: FormState)}
	<PrintDetails {ctx} {layout} scope="line" value={form.get('print_values')} />
{/snippet}
<RecordForm
	{ctx}
	{view}
	readonly={Boolean(header?.archived)}
	readonly_reason={ctx.t('component.order_archived')}
	editors={{ product, unit_price: unitPrice, print_values: printDetails }}
	viewers={{ print_values: printDetailsView }}
	sections={[
		{
			name: 'line',
			icon: 'lucide:list',
			title: ctx.t('section.lines'),
			fields: [
				'product',
				'quantity',
				'unit_price',
				'discount_pct',
				'tax_rate',
				...(layout ? ['print_values'] : [])
			],
			wide: ['print_values']
		}
	]}
/>
