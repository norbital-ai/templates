<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { commissionPreview, previewRead } from '../../../../lib/commission-expressions.js';
	import { dec, text } from '../../../../lib/values.js';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect, Schema } from 'effect';
	import { Input, Button, Show, TimeInput, type RecordView } from '@norbital-ai/ui';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import RecordForm from '../../../../lib/ui/record-form.svelte';

	let {
		view,
		ctx
	}: {
		view: RecordView<'commission_rules'>;
		ctx: PageContext;
	} = $props();
	let quantity = $state('1000');
	let net = $state('2000');
	let floor = $state('1');
	let factor = $state('0.001');
	let product = $state('');
	let unit = $state('kg');
	let party = $state('');
	const day = ctx.clock('day');
	let orderedOn = $state<string | null>(day.today);
	let result = $state<ReturnType<typeof commissionPreview>>(null);
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
					quantity: dec(quantity),
					net: dec(net),
					...(floor ? { floor_net: dec(floor) } : {}),
					...(factor ? { factor: dec(factor) } : {}),
					product_code: product,
					unit,
					party_code: party,
					ordered_on: selectedDay
				}),
				catch: (cause) => new PreviewInputInvalid({ message: String(cause) })
			}).pipe(
				Effect.flatMap((sample) =>
					ctx.query(previewRead(rule)).pipe(
						Effect.flatMap((answer) => {
							const outcome = commissionPreview(answer, sample);
							return outcome === null
								? Effect.fail(new PreviewInputInvalid({ message: 'rule unavailable' }))
								: Effect.succeed(outcome);
						})
					)
				),
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
				feedback = ctx.t('errors.commission_preview_invalid');
			}
		);
	}
</script>

{#snippet reference()}
	<Stack gap="md">
		<p>{ctx.t('component.commission_expression_help')}</p>
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
	{#if view.mode !== 'create' && ctx.catalog?.commission_rules?.update}
		<Stack gap="md">
			<p>{ctx.t('component.commission_preview_saved')}</p>
			<Grid gap="md" minimum="compact">
				{@render input(
					'commission-preview-quantity',
					ctx.t('models.order_lines.fields.quantity'),
					quantity,
					(next) => (quantity = next)
				)}
				{@render input(
					'commission-preview-net',
					ctx.t('component.commission_preview_net'),
					net,
					(next) => (net = next)
				)}
				{@render input(
					'commission-preview-floor',
					ctx.t('models.order_lines.fields.floor_net'),
					floor,
					(next) => (floor = next)
				)}
				{@render input(
					'commission-preview-factor',
					ctx.t('models.products.fields.commission_factor'),
					factor,
					(next) => (factor = next)
				)}
				{@render input(
					'commission-preview-product',
					ctx.t('component.commission_preview_product'),
					product,
					(next) => (product = next),
					false
				)}
				{@render input(
					'commission-preview-unit',
					ctx.t('models.order_lines.fields.unit'),
					unit,
					(next) => (unit = next),
					false
				)}
				{@render input(
					'commission-preview-party',
					ctx.t('component.commission_preview_party'),
					party,
					(next) => (party = next),
					false
				)}
				<Stack gap="xs">
					<label class="text-xs font-medium text-muted-foreground" for="commission-preview-date"
						>{ctx.t('models.orders.fields.ordered_on')}</label
					><TimeInput
						{ctx}
						id="commission-preview-date"
						value={orderedOn}
						on_change={(value: string | null) => (orderedOn = value)}
					/>
				</Stack>
			</Grid>
			<!-- the answer beside the button that asks for it -->
			<Cluster gap="md" align="center">
				<Button disabled={busy || !orderedOn} onclick={preview}
					>{ctx.t('component.commission_preview')}</Button
				>
				{#if result}<p role="status">
						{ctx.t(`reports.commission.${result.reason}`)} ·
						<Show
							{ctx}
							kind={{ kind: 'money', currency: 'currency', optional: true }}
							value={result.amount === null ? null : text(result.amount)}
							row={{ currency: result.currency }}
						/>
					</p>{/if}
				{#if feedback}<p role="alert">{feedback}</p>{/if}
			</Cluster>
		</Stack>
	{/if}
{/snippet}
<RecordForm
	{ctx}
	{view}
	subtitle={['basis_unit']}
	sections={[
		{
			name: 'rule',
			fields: ['currency', 'effective_on', 'basis_unit', 'fixed_rate', 'spread_pct', 'active']
		},
		{
			name: 'formula',
			icon: 'lucide:sigma',
			title: ctx.t('section.custom_formula'),
			closed: ctx.t('component.custom_formula_summary'),
			fields: ['eligibility_expression', 'amount_expression', 'parameters']
		}
	]}
	tabs={[
		{
			name: 'reference',
			title: ctx.t('component.commission_expression_reference'),
			body: reference
		},
		...(view.mode !== 'create' && ctx.catalog?.commission_rules?.update
			? [{ name: 'preview', title: ctx.t('component.commission_preview'), body: testExpression }]
			: [])
	]}
/>
