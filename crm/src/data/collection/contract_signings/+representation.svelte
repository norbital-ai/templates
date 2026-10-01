<script lang="ts">
	import { bolt } from '$bolt';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import ConfirmedPick from '../../../lib/ui/confirmed-pick.svelte';
	import type { FormState } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'contract_signings'> } = $props();
	const t = bolt.t;
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

{#snippet parent(form: FormState)}<ConfirmedPick {form} field="quote_id" of="quotes" />{/snippet}

<RecordForm
	{view}
	editors={{ quote_id: parent }}
	subtitle={['quote_id']}
	sections={[
		{
			name: 'signing',
			title: t('section.signing'),
			fields: ['quote_id', 'variant', 'status', 'owner_id']
		},
		{
			name: 'documents',
			title: t('section.documents'),
			fields: ['generated_file', 'counterparty_file']
		},
		...(record
			? [
					{
						name: 'void',
						title: t('section.void'),
						fields: ['void_reason'],
						closed: record?.['void_reason'] || t('section.not_voided')
					}
				]
			: [])
	]}
/>
