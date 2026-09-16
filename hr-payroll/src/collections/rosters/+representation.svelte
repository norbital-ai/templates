<script lang="ts">
	/**
	 * One roster of record: the person and the calendar month. The days themselves are the Work
	 * board's.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import FormSection from '../../lib/ui/form-section.svelte';
	import { employmentRelationOptions, hrCreateScope } from '../../lib/ui/create-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const scopedCompanyId = $derived(createScope?.companyId());
	const defaults = $derived(record ?? {});
</script>

<CollectionForm
	{client}
	collection="rosters"
	defaultValues={defaults}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Stack gap="sm">
			<FormSection first title={t('component.roster')} hint={t('component.roster_hint')}>
				<Grid gap="sm" minimum="compact">
					<Field
						name="employment_id"
						label={t('component.employment')}
						relationOptions={employmentRelationOptions(scopedCompanyId)}
					/>
					<Field name="period" label={t('component.month')} />
				</Grid>
			</FormSection>
		</Stack>
	{/snippet}
</CollectionForm>
