<script lang="ts">
	/** One ad hoc class: the shared catalogue form, plus its authority and who raises it. */
	import type { RepresentationProps } from './$types.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import CatalogueForm from '../../lib/ui/catalogue-form.svelte';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/record-media/catalogue-banner.svg"
	/>
</svelte:head>

<CatalogueForm collection="adhoc_catalogue" {record} {close}>
	{#snippet payLineFields({ Field })}
		<Field name="authority" label={t('component.authority')} />
	{/snippet}
	{#snippet limitFields({ Field })}
		<Field name="evidence" label={t('component.evidence')} />
		<Field
			name="raised_by"
			label={t('component.raised_by')}
			description={t('component.raised_by_hint')}
		/>
	{/snippet}
</CatalogueForm>
