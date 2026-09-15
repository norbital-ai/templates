<script lang="ts">
	/**
	 * A roster code of one entity, entity-owned like its holidays. The scope names
	 * the entity, so the form does not ask; opened without a scope the field returns.
	 *
	 * The variant is the row's substance, so it sits first and uses the width: kind, clock window
	 * and break on one row. Identity and effective period follow in a uniform two-column grid.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import FormSection from '../../lib/ui/form-section.svelte';
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
			<FormSection first title={t('component.shift')} hint={t('component.shift_section_hint')}>
				<Field name="variant" />
				<Grid gap="sm" minimum="compact">
					{#if scopedCompanyId != null}
						<Field name="company_id" hidden />
					{:else}
						<Field name="company_id" label={t('component.company')} />
					{/if}
					<Field name="code" />
					<Field name="name" />
					<Field
						name="effective_range"
						label={t('component.effective_period')}
						description={t('component.section_period_hint')}
					/>
				</Grid>
			</FormSection>
		</Stack>
	{/snippet}
</CollectionForm>
