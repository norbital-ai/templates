<script lang="ts">
	/** One claim component. The form is `lib/ui/catalogue-form.svelte`, shared with ad hoc and allowances. */
	import { bolt } from '$bolt';
	import { Field } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import CatalogueForm from '../../../lib/ui/catalogue-form.svelte';

	let { view }: { view: RecordView<'claim_catalogue'> } = $props();
</script>

<CatalogueForm collection="claim_catalogue" {view}>
	{#snippet limitFields()}
		<Field name="evidence" label={bolt.t('component.evidence')} />
	{/snippet}
</CatalogueForm>
