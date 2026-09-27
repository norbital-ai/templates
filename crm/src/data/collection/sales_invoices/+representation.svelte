<script lang="ts">
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import type { RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'sales_invoices'> } = $props();
</script>

<RecordForm
	{view}
	subtitle={(r) => String(r.status)}
	fields={[
		['quote_id', 'component.quote'],
		'status',
		['owner_id', 'component.owner'],
		'cancel_reason'
	]}
/>
