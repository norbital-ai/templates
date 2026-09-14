<script lang="ts">
	/**
	 * A roster code of one entity, entity-owned like its holidays (RFC 0001 §11). The scope names
	 * the entity, so the form does not ask; opened without a scope the field returns.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { hrCreateScope } from '../../lib/ui/create-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const scopedCompanyId = $derived(createScope?.companyId());
	const defaults = $derived(
		record ?? (scopedCompanyId == null ? undefined : { company_id: scopedCompanyId })
	);
</script>

<CollectionForm
	{client}
	collection="shift_definitions"
	defaultValues={defaults}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Stack gap="sm">
			<p class="text-meta">{t('component.shift_section_hint')}</p>
			<Grid gap="md" minimum="card">
				{#if scopedCompanyId != null}
					<Field name="company_id" hidden />
				{:else}
					<Field name="company_id" label={t('component.company')} />
				{/if}
				<Field name="code" />
				<Field name="name" />
				<Column span="all"><Field name="variant" /></Column>
			</Grid>
			<p class="text-meta">{t('component.section_period_hint')}</p>
			<Field name="effective_range" label={t('component.effective_period')} />
		</Stack>
	{/snippet}
</CollectionForm>
