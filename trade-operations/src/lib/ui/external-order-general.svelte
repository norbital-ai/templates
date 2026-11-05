<script lang="ts">
	import { bolt } from '$bolt';
	import { Show, type RecordView } from '@norbital-ai/ui';
	import RecordLink from './record-link.svelte';
	import { Grid } from '@norbital-ai/ui/layout';
	let {
		of,
		view
	}: {
		of: 'ext_sales_orders' | 'ext_purchase_orders';
		view: RecordView;
	} = $props();
	const fields = [
		{ name: 'reference', kind: { kind: 'text' } },
		{ name: 'status', kind: { kind: 'enum', values: ['draft', 'issued', 'void'] } },
		{ name: 'currency', kind: { kind: 'currency' } },
		{ name: 'source_updated_at', kind: { kind: 'instant' } }
	] as const;
</script>

{#if view.mode !== 'create'}
	<Grid as="dl" gap="md">
		<div>
			<dt class="text-sm text-muted-foreground">{bolt.t(`models.${of}.fields.order`)}</dt>
			<dd>
				{#if view.record.order}
					<RecordLink of="orders" id={String(view.record.order)} />
				{/if}
			</dd>
		</div>
		{#each fields as field (field.name)}<div>
				<dt class="text-sm text-muted-foreground">{bolt.t(`models.${of}.fields.${field.name}`)}</dt>
				<dd><Show kind={field.kind} value={view.record[field.name]} name={field.name} /></dd>
			</div>{/each}
	</Grid>
{/if}
