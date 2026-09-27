<script lang="ts">
	/** A purchase order: its terms, and the export once confirmed. */
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import ExportRun from '../../../lib/ui/export-run.svelte';

	let { view }: { view: RecordView<'purchase_orders'> } = $props();
</script>

{#snippet actions()}
	{#if view.mode === 'update' && view.record.status === 'confirmed'}<ExportRun
			collection="purchase_orders"
			id={view.record.id}
		/>{/if}
{/snippet}

<RecordForm
	{view}
	{actions}
	subtitle={(r) => `${r.status} · ${r.supplier_name}`}
	fields={[
		['supplier_id', 'component.supplier'],
		'status',
		'currency',
		['tax_inclusive', 'component.tax_inclusive'],
		['expected_date', 'component.expected_date'],
		['owner_id', 'component.owner'],
		'cancel_reason'
	]}
/>
