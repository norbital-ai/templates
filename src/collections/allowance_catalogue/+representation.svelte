<script lang="ts">
	/** One allowance component: the shared catalogue form, plus its authority and NPL proration. */
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

<CatalogueForm collection="allowance_catalogue" {record} {close}>
	{#snippet payLineFields({ Field, form })}
		<Field name="authority" label={t('component.authority')} />
		{#if form.values().destination === 'PAY'}
			<Field
				name="npl_prorates"
				label={t('component.npl_prorates')}
				description={t('component.npl_prorates_hint')}
			/>
		{:else}
			<Field name="npl_prorates" hidden />
		{/if}
	{/snippet}
</CatalogueForm>
