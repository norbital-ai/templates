<script lang="ts">
	import { bolt } from '$bolt';
	import { Button, RecordShell, Table, Show, type RecordView } from '@norbital-ai/ui';
	import RecordLink from '../../../lib/ui/record-link.svelte';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import { isMasked } from '@norbital-ai/bolt';
	let {
		view
	}: {
		view: RecordView<'transactions'>;
	} = $props();
	const fields = [
		{ name: 'reference', kind: { kind: 'text' } },
		{ name: 'kind', kind: { kind: 'enum', values: ['invoice', 'delivery'] } },
		{ name: 'status', kind: { kind: 'enum', values: ['issued', 'void'] } },
		{ name: 'currency', kind: { kind: 'currency' } },
		{ name: 'issued_on', kind: { kind: 'date', optional: true } },
		{ name: 'due_on', kind: { kind: 'date', optional: true } },
		{ name: 'total', kind: { kind: 'money', currency: 'currency', optional: true } },
		{ name: 'source_updated_at', kind: { kind: 'instant' } }
	] as const;
</script>

{#snippet details(shown: RecordView<'transactions'>)}
	{#if shown.mode !== 'create'}
		<Stack gap="md">
			<Grid as="dl" gap="md">
				{#each ['order', 'ext_sales_order', 'ext_purchase_order'] as const as relation}
					{@const value = shown.record[relation]}
					{#if value && !isMasked(value)}<div>
							<dt class="text-xs font-medium text-muted-foreground">
								{bolt.t(`models.transactions.fields.${relation}`)}
							</dt>
							<dd>
								<RecordLink
									of={relation === 'order'
										? 'orders'
										: relation === 'ext_sales_order'
											? 'ext_sales_orders'
											: 'ext_purchase_orders'}
									id={String(value)}
								/>
							</dd>
						</div>{/if}
				{/each}
				{#each fields as field (field.name)}<div>
						<dt class="text-xs font-medium text-muted-foreground">
							{bolt.t(`models.transactions.fields.${field.name}`)}
						</dt>
						<dd>
							<Show
								kind={field.kind}
								value={shown.record[field.name]}
								name={field.name}
								row={shown.record}
							/>
						</dd>
					</div>{/each}
			</Grid>
			{#if shown.record.items && !isMasked(shown.record.items)}<Table
					of={shown.record.items}
					columns={[
						{ field: 'product_name', label: bolt.t('models.order_lines.fields.product_name') },
						...(shown.record.items.some((item) => item.lot_number != null)
							? [
									{
										field: 'lot_number' as const,
										label: bolt.t('models.stock_snapshots.fields.lot_number')
									}
								]
							: []),
						{ field: 'quantity', label: bolt.t('models.orders.fields.quantity') },
						{ field: 'unit', label: bolt.t('models.order_lines.fields.unit') },
						{ field: 'unit_price', label: bolt.t('models.order_lines.fields.unit_price') },
						...(shown.record.items.some((item) => item.unit_cost != null)
							? [
									{
										field: 'unit_cost' as const,
										label: bolt.t('models.stock_snapshots.fields.unit_cost')
									}
								]
							: [])
					]}
					toolbar={{ new: false, title: bolt.t('section.lines') }}
				/>{/if}
			<h3>{bolt.t('component.transaction_documents')}</h3>
			{#if !isMasked(shown.record.documents) && shown.record.documents?.length}
				<Cluster gap="sm">
					{#each shown.record.documents as document (document.sha256)}<Button
							variant="outline"
							size="sm"
							href={document.url}
							target="_blank"
							rel="noopener noreferrer">{document.name}</Button
						>{/each}
				</Cluster>
			{:else}<p>{bolt.t('component.transaction_documents_pending')}</p>{/if}
		</Stack>
	{/if}
{/snippet}
<RecordShell
	of="transactions"
	mode={view.mode}
	{...view.mode !== 'create' ? { id: view.record.id } : { values: view.values }}
	children={details}
/>
