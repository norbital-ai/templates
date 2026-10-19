<script lang="ts">
	import type { QueryOutput } from '@norbital-ai/bolt';
	import { fork, bolt } from '$bolt';
	import { Effect, Schema } from 'effect';
	import { Input, Button, Show, useKinds, TimeInput, type RecordView } from '@norbital-ai/ui';
	import { PlainDate } from '@norbital-ai/std/date';
	import { Stack } from '@norbital-ai/ui/layout';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import { d } from '../../../lib/commercial.js';
	let {
		view
	}: {
		view: RecordView<'commission_rules'>;
	} = $props();
	const kinds = useKinds();
	let quantity = $state('1000');
	let net = $state('2000');
	let floor = $state('1');
	let factor = $state('0.001');
	let product = $state('');
	let unit = $state('kg');
	let party = $state('');
	let orderedOn = $state<string | null>(new Date().toISOString().slice(0, 10));
	let result = $state<QueryOutput<'commission_rules.preview'> | null>(null);
	let feedback = $state('');
	let busy = $state(false);
	class PreviewInputInvalid extends Schema.TaggedError<PreviewInputInvalid>()(
		'PreviewInputInvalid',
		{ message: Schema.String }
	) {}
	function preview() {
		const selectedDay = orderedOn;
		if (view.mode === 'create' || !selectedDay) return;
		busy = true;
		feedback = '';
		result = null;
		const rule = view.record.id;
		fork(
			Effect.try({
				try: () => ({
					rule,
					quantity: d(quantity),
					net: d(net),
					...(floor ? { floor_net: d(floor) } : {}),
					...(factor ? { factor: d(factor) } : {}),
					product_code: product,
					unit,
					party_code: party,
					ordered_on: PlainDate(selectedDay)
				}),
				catch: (cause) => new PreviewInputInvalid({ message: String(cause) })
			}).pipe(
				Effect.flatMap((input) => bolt.query('commission_rules.preview', input)),
				Effect.tap((answer) =>
					Effect.sync(() => {
						result = answer;
					})
				),
				Effect.ensuring(
					Effect.sync(() => {
						busy = false;
					})
				)
			),
			() => {
				feedback = bolt.t('errors.commission_preview_invalid');
			}
		);
	}
</script>

{#snippet reference()}
	<Stack gap="md">
		<p>{bolt.t('component.commission_expression_help')}</p>
		<p><code>net * decimal("0.05")</code></p>
		<p><code>min(net * params.rate, params.cap)</code></p>
		<p><code>quantity &gt;= 1000 ? net * decimal("0.10") : net * decimal("0.05")</code></p>
	</Stack>
{/snippet}
{#snippet testExpression()}
	{#if view.mode !== 'create' && kinds.catalog?.commission_rules?.queries?.preview}
		<Stack gap="md">
			<h3>{bolt.t('component.commission_preview')}</h3>
			<p>{bolt.t('component.commission_preview_saved')}</p>
			<label for="commission-preview-quantity">{bolt.t('models.order_lines.fields.quantity')}</label
			><Input id="commission-preview-quantity" inputmode="decimal" bind:value={quantity} />
			<label for="commission-preview-net">{bolt.t('component.commission_preview_net')}</label><Input
				id="commission-preview-net"
				inputmode="decimal"
				bind:value={net}
			/>
			<label for="commission-preview-floor">{bolt.t('models.order_lines.fields.floor_net')}</label
			><Input id="commission-preview-floor" inputmode="decimal" bind:value={floor} />
			<label for="commission-preview-factor"
				>{bolt.t('models.products.fields.commission_factor')}</label
			><Input id="commission-preview-factor" inputmode="decimal" bind:value={factor} />
			<label for="commission-preview-product"
				>{bolt.t('component.commission_preview_product')}</label
			><Input id="commission-preview-product" bind:value={product} />
			<label for="commission-preview-unit">{bolt.t('models.order_lines.fields.unit')}</label><Input
				id="commission-preview-unit"
				bind:value={unit}
			/>
			<label for="commission-preview-party">{bolt.t('component.commission_preview_party')}</label
			><Input id="commission-preview-party" bind:value={party} />
			<label for="commission-preview-date">{bolt.t('models.orders.fields.ordered_on')}</label
			><TimeInput
				id="commission-preview-date"
				value={orderedOn}
				onChange={(value: string | null) => (orderedOn = value)}
			/>
			<Button disabled={busy || !orderedOn} onclick={preview}
				>{bolt.t('component.commission_preview')}</Button
			>
			{#if result}<p role="status">
					{bolt.t(`reports.commission.${result.reason}` as import('@norbital-ai/bolt').MessageKey)} ·
					<Show
						kind={{ kind: 'money', currency: 'currency', optional: true }}
						value={result.amount}
						row={result}
					/>
				</p>{/if}
			{#if feedback}<p role="alert">{feedback}</p>{/if}
		</Stack>
	{/if}
{/snippet}
<RecordForm
	{view}
	subtitle={['basis_unit']}
	sections={[
		{
			name: 'rule',
			title: bolt.t('models.commission_rules.label'),
			fields: [
				'currency',
				'effective_on',
				'basis_unit',
				'eligibility_expression',
				'amount_expression',
				'parameters',
				'fixed_rate',
				'spread_pct',
				'active'
			]
		}
	]}
	tabs={[
		{
			name: 'reference',
			title: bolt.t('component.commission_expression_reference'),
			body: reference
		},
		...(view.mode !== 'create' && kinds.catalog?.commission_rules?.queries?.preview
			? [{ name: 'preview', title: bolt.t('component.commission_preview'), body: testExpression }]
			: [])
	]}
/>
