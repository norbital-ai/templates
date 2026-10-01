<script lang="ts">
	import { bolt } from '$bolt';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import Regarding from '../../../lib/ui/regarding.svelte';
	import type { FormState } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'settlements'> } = $props();
	const t = bolt.t;
</script>

{#snippet regarding(form: FormState)}
	<Regarding
		{form}
		confirmed
		arms={[
			['quotes', 'component.quote'],
			['purchase_orders', 'component.purchase_order'],
			['purchase_invoices', 'component.purchase_invoice']
		]}
	/>
{/snippet}

<RecordForm
	{view}
	subtitle={['settled_on']}
	editors={{ regarding }}
	sections={[
		{
			name: 'settlement',
			title: t('section.settlement'),
			fields: ['regarding', 'amount', 'currency', 'settled_on', 'reference', 'owner_id']
		}
	]}
/>
