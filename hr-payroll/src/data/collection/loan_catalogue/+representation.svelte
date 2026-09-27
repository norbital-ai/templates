<script lang="ts">
	/** One loan component: a debt's pay line, with whose it is and the least a month may recover. */
	import { Field, type RecordView } from '@norbital-ai/ui';
	import { Column } from '@norbital-ai/ui/layout';
	import CatalogueForm from '../../../lib/ui/catalogue-form.svelte';
	import { t } from '../../../lib/ui/t.js';

	let { view }: { view: RecordView<'loan_catalogue'> } = $props();
</script>

<CatalogueForm collection="loan_catalogue" {view}>
	{#snippet payLineFields()}
		<Field name="loan_type" label={t('component.loan_type')} />
		<Field
			name="minimum_repayment"
			label={t('component.minimum_repayment')}
			help={t('component.minimum_repayment_hint')}
		/>
		<Field name="evidence" label={t('component.evidence')} />
		<Column span="all"><Field name="bands" label={t('component.rate_bands')} /></Column>
	{/snippet}
</CatalogueForm>
