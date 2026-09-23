<script lang="ts">
	/** One claim component. The form is `lib/ui/catalogue-form.svelte`, shared with ad hoc and allowances. */
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

<CatalogueForm collection="claim_catalogue" {record} {close}>
	{#snippet limitFields({ Field })}
		<Field name="evidence" label={t('component.evidence')} />
	{/snippet}
</CatalogueForm>
