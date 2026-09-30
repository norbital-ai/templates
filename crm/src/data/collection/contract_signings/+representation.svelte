<script lang="ts">
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import ConfirmedPick from '../../../lib/ui/confirmed-pick.svelte';
	import type { FormState } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'contract_signings'> } = $props();
</script>

{#snippet parent(form: FormState)}<ConfirmedPick {form} field="quote_id" of="quotes" />{/snippet}

<RecordForm
	{view}
	editors={{ quote_id: parent }}
	subtitle={['quote_id']}
	fields={[
		'quote_id',
		'variant',
		'status',
		'generated_file',
		'counterparty_file',
		'owner_id',
		'void_reason'
	]}
/>
