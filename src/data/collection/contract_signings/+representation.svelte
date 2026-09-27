<script lang="ts">
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import type { RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'contract_signings'> } = $props();
</script>

<RecordForm
	{view}
	subtitle={(r) => `${r.variant} · ${r.status}`}
	fields={[
		['quote_id', 'component.quote'],
		'variant',
		'status',
		['generated_file', 'component.generated_contract'],
		['counterparty_file', 'component.counterparty_copy'],
		['owner_id', 'component.owner'],
		['void_reason', 'component.void_reason']
	]}
/>
