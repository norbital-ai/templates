<script lang="ts">
	/**
	 * One roster of record: the person and the payroll cycle. The cycle's dates are resolved by the
	 * hook from the entity's cutoff, so the form asks for the period in the entity's grammar and
	 * shows the resolved window once the row exists. The days themselves are the Work board's.
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
	const defaults = $derived(
		record ??
			(scopedCompanyId == null
				? { origin: 'MANUAL' }
				: { company_id: scopedCompanyId, origin: 'MANUAL' })
	);
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
					{#if scopedCompanyId != null}
						<Field name="company_id" hidden />
					{:else}
						<Field name="company_id" label={t('component.company')} />
					{/if}
					<Field
						name="employment_id"
						label={t('component.employment')}
						relationOptions={employmentRelationOptions(scopedCompanyId)}
					/>
					<Field name="period" label={t('component.pay_period')} />
					<Field name="origin" hidden />
					{#if record}
						<Field name="range" readonly />
					{/if}
				</Grid>
			</FormSection>
		</Stack>
	{/snippet}
</CollectionForm>
