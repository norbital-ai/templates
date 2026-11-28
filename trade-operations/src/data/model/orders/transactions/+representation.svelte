<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Badge,
		Button,
		Field,
		RecordForm,
		Section,
		Table,
		type RecordView
	} from '@norbital-ai/ui';
	import { Bound, Cluster, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	let {
		view,
		ctx
	}: {
		view: RecordView<'transactions'>;
		ctx: PageContext;
	} = $props();

	const creditBadgeVariant = (status: string | null | undefined) => {
		if (status === 'passed' || status === 'released') return 'success' as const;
		if (status === 'failed' || status === 'bypassed') return 'destructive' as const;
		return 'outline' as const;
	};
</script>

{#snippet extras()}
	{#if view.mode !== 'create'}
		<Stack gap="md">
			{#if view.record.items}<Bound size="viewport"
					><Table
						{ctx}
						of={view.record.items}
						columns={[
							{ field: 'product_name', label: ctx.t('models.order_lines.fields.product_name') },
							...(view.record.items.some((item) => item.lot_number != null)
								? [
										{
											field: 'lot_number' as const,
											label: ctx.t('models.stock_snapshots.fields.lot_number')
										}
									]
								: []),
							{
								field: 'quantity',
								label: ctx.t('models.orders.fields.quantity'),
								kind: { kind: 'decimal', scale: 3 },
								align: 'end'
							},
							{ field: 'unit', label: ctx.t('models.order_lines.fields.unit') },
							{
								field: 'unit_price',
								label: ctx.t('models.order_lines.fields.unit_price'),
								kind: { kind: 'decimal', scale: 4, optional: true },
								align: 'end'
							},
							...(view.record.items.some((item) => item.unit_cost != null)
								? [
										{
											field: 'unit_cost' as const,
											label: ctx.t('models.stock_snapshots.fields.unit_cost'),
											kind: { kind: 'decimal', scale: 8, optional: true } as const,
											align: 'end' as const
										}
									]
								: [])
						]}
						toolbar={{ new: false, title: ctx.t('section.lines') }}
					/></Bound
				>{/if}
			{#if view.record.documents !== undefined}
				<h3 class="text-sm font-medium">{ctx.t('component.transaction_documents')}</h3>
				{#if view.record.documents?.length}
					<Cluster gap="sm">
						{#each view.record.documents as document (document.sha256)}<Button
								variant="outline"
								href={document.url}
								target="_blank"
								rel="noopener noreferrer">{document.name}</Button
							>{/each}
					</Cluster>
				{:else}<p class="text-sm text-muted-foreground">
						{ctx.t('component.transaction_documents_pending')}
					</p>{/if}
			{/if}
		</Stack>
	{/if}
{/snippet}

{#snippet creditCheckView()}
	{#if view.mode !== 'create' && view.record.credit_check}
		<Inline align="center" gap="xs">
			<Badge variant={creditBadgeVariant(view.record.credit_check)}>
				{ctx.t(`models.transactions.fields.credit_check.${view.record.credit_check}`)}
			</Badge>
		</Inline>
	{:else}
		<span class="text-sm text-muted-foreground">—</span>
	{/if}
{/snippet}

<!-- a Kingdee mirror: only its sync writes it -->
<RecordForm {ctx} {view} lock={ctx.t('component.kingdee_readonly')}>
	<Section first name="transaction">
		<Grid gap="md" minimum="compact">
			<Field {ctx} name="order" />
			<Field {ctx} name="reference" />
			<Field {ctx} name="kind" />
			<Field {ctx} name="status" />
			<Field {ctx} name="currency" />
			<Field {ctx} name="issued_on" />
			<Field {ctx} name="due_on" />
			<Field {ctx} name="total" />
			<Field {ctx} name="source_updated_at" />
			{#if view.mode !== 'create' && view.record.kind === 'delivery'}
				<Field {ctx} name="credit_check" view={creditCheckView} />
				<Field {ctx} name="credit_checked_at" />
				<Field {ctx} name="credit_check_detail" wide />
			{/if}
		</Grid>
	</Section>
	{@render extras()}
</RecordForm>
