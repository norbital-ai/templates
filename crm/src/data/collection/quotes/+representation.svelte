<script lang="ts">
	/** A quote: its terms, the contact picked from the chosen account's people, and the export once confirmed. */
	import { Picker } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import type { Id } from '@norbital-ai/bolt';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import ExportRun from '../../../lib/ui/export-run.svelte';

	let { view }: { view: RecordView<'quotes'> } = $props();
</script>

{#snippet contact(form: import('@norbital-ai/ui').FormState)}
	{@const account = form.get('account_id')}
	{@const chosen = form.get('contact_id')}
	<Picker
		of="contacts"
		value={typeof chosen === 'string' ? chosen : null}
		onChange={(id) => form.set('contact_id', id)}
		{...typeof account === 'string'
			? { where: { account_id: { eq: account as Id<'accounts'> } } }
			: {}}
		orderBy={{ last_name: 'asc' }}
	/>
{/snippet}
{#snippet actions()}
	{#if view.mode === 'update' && view.record.status === 'confirmed'}<ExportRun
			collection="quotes"
			id={view.record.id}
		/>{/if}
{/snippet}

<RecordForm
	{view}
	{actions}
	subtitle={(r) => `${r.status}${r.currency ? ` · ${r.currency}` : ''}`}
	editors={{ contact_id: contact }}
	fields={[
		['account_id', 'component.account'],
		['contact_id', 'component.contact'],
		'title',
		'status',
		'currency',
		['tax_inclusive', 'component.tax_inclusive'],
		['valid_until', 'component.valid_until'],
		['payment_terms', 'component.payment_terms'],
		['shipping_terms', 'component.shipping_terms'],
		['place_of_loading', 'component.place_of_loading'],
		['place_of_delivery', 'component.place_of_delivery'],
		'packaging',
		['shipping_mark', 'component.shipping_mark'],
		['time_of_shipment', 'component.time_of_shipment'],
		['other_terms', 'component.other_terms'],
		['owner_id', 'component.owner'],
		['revision_of', 'component.revision_of'],
		['revision_number', 'component.revision_number'],
		'credit_acknowledged',
		'cancel_reason',
		'description'
	]}
/>
