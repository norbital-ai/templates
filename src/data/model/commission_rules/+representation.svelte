<script lang="ts">
	import { Decimal } from '@norbital-ai/std/decimal';

	import type { QueryOutput } from '@norbital-ai/bolt';
	import { fork, bolt } from '$bolt';
	import { Effect, Schema } from 'effect';
	import { Input, Button, Show, useKinds, TimeInput, type RecordView } from '@norbital-ai/ui';
	import { PlainDate } from '@norbital-ai/std/date';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import RecordForm from '../../../lib/ui/record-form.svelte';

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
					quantity: Decimal.of(quantity),
					net: Decimal.of(net),
					...(floor ? { floor_net: Decimal.of(floor) } : {}),
					...(factor ? { factor: Decimal.of(factor) } : {}),
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
{#snippet input(
	id: string,
	label: string,
	value: string,
	set: (next: string) => void,
	decimal = true
)}
	<Stack gap="xs">
		<label class="text-xs font-medium text-muted-foreground" for={id}>{label}</label><Input
			{id}
			{...decimal ? { inputmode: 'decimal' as const } : {}}
			{value}
			oninput={(event) => set(event.currentTarget.value)}
		/>
	</Stack>
{/snippet}
{#snippet testExpression()}
	{#if view.mode !== 'create' && kinds.catalog?.commission_rules?.queries?.preview}
		<Stack gap="md">
			<p>{bolt.t('component.commission_preview_saved')}</p>
			<Grid gap="md" minimum="compact">
				{@render input(
					'commission-preview-quantity',
					bolt.t('models.order_lines.fields.quantity'),
					quantity,
					(next) => (quantity = next)
				)}
				{@render input(
					'commission-preview-net',
					bolt.t('component.commission_preview_net'),
					net,
					(next) => (net = next)
				)}
				{@render input(
					'commission-preview-floor',
					bolt.t('models.order_lines.fields.floor_net'),
					floor,
					(next) => (floor = next)
				)}
				{@render input(
					'commission-preview-factor',
					bolt.t('models.products.fields.commission_factor'),
					factor,
					(next) => (factor = next)
				)}
				{@render input(
					'commission-preview-product',
					bolt.t('component.commission_preview_product'),
					product,
					(next) => (product = next),
					false
				)}
				{@render input(
					'commission-preview-unit',
					bolt.t('models.order_lines.fields.unit'),
					unit,
					(next) => (unit = next),
					false
				)}
				{@render input(
					'commission-preview-party',
					bolt.t('component.commission_preview_party'),
					party,
					(next) => (party = next),
					false
				)}
				<Stack gap="xs">
					<label class="text-xs font-medium text-muted-foreground" for="commission-preview-date"
						>{bolt.t('models.orders.fields.ordered_on')}</label
					><TimeInput
						id="commission-preview-date"
						value={orderedOn}
						onChange={(value: string | null) => (orderedOn = value)}
					/>
				</Stack>
			</Grid>
			<!-- the answer beside the button that asks for it -->
			<Cluster gap="md" align="center">
				<Button disabled={busy || !orderedOn} onclick={preview}
					>{bolt.t('component.commission_preview')}</Button
				>
				{#if result}<p role="status">
						{bolt.t(`reports.commission.${result.reason}`)} ·
						<Show
							kind={{ kind: 'money', currency: 'currency', optional: true }}
							value={result.amount}
							row={result}
						/>
					</p>{/if}
				{#if feedback}<p role="alert">{feedback}</p>{/if}
			</Cluster>
		</Stack>
	{/if}
{/snippet}
<RecordForm
	{view}
	subtitle={['basis_unit']}
	sections={[
		{
			name: 'rule',
			fields: ['currency', 'effective_on', 'basis_unit', 'fixed_rate', 'spread_pct', 'active']
		},
		{
			name: 'formula',
			title: bolt.t('section.custom_formula'),
			closed: bolt.t('component.custom_formula_summary'),
			fields: ['eligibility_expression', 'amount_expression', 'parameters']
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
