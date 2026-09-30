<script lang="ts">
	/** One ad hoc class: the shared catalogue form, plus its authority and who raises it. */
	import { bolt } from '$bolt';
	import { Field } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import CatalogueForm from '../../../lib/ui/catalogue-form.svelte';

	let { view }: { view: RecordView<'adhoc_catalogue'> } = $props();
</script>

<CatalogueForm collection="adhoc_catalogue" {view}>
	{#snippet payLineFields()}
		<Field name="authority" label={bolt.t('component.authority')} />
	{/snippet}
	{#snippet limitFields()}
		<Field name="evidence" label={bolt.t('component.evidence')} />
		<Field
			name="request_facts"
			label={bolt.t('component.request_facts')}
			help={bolt.t('component.request_facts_declaration_hint')}
		/>
		<Field
			name="raised_by"
			label={bolt.t('component.raised_by')}
			help={bolt.t('component.raised_by_hint')}
		/>
	{/snippet}
</CatalogueForm>
