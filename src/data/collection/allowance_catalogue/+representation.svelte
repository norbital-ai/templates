<script lang="ts">
	/** One allowance class: the shared catalogue form, plus its authority, whether an unpaid day comes off it and whether the law owes it uncontracted. */
	import { bolt } from '$bolt';
	import { Field } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import CatalogueForm from '../../../lib/ui/catalogue-form.svelte';

	let { view }: { view: RecordView<'allowance_catalogue'> } = $props();
</script>

<CatalogueForm collection="allowance_catalogue" {view}>
	{#snippet payLineFields(form)}
		<Field name="authority" label={bolt.t('component.authority')} />
		{#if form.get('destination') === 'PAY'}
			<Field
				name="npl_prorates"
				label={bolt.t('component.npl_prorates')}
				help={bolt.t('component.npl_prorates_hint')}
			/>
			<Field name="outpatient_sick_pay" label={bolt.t('component.outpatient_sick_pay')} />
			<Field name="owed" label={bolt.t('component.owed')} help={bolt.t('component.owed_hint')} />
		{/if}
	{/snippet}
</CatalogueForm>
