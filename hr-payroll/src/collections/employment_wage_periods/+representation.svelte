<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { employmentRelationOptions, hrCreateScope } from '../../lib/ui/create-scope.js';
	import FormSection from '../../lib/ui/form-section.svelte';
	import EffectiveRangeRenderer from '../../lib/ui/effective-range-renderer.svelte';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const scopedEmploymentId = $derived(createScope?.employmentId?.());
	const formValues = $derived(
		record ?? (scopedEmploymentId ? { employment_id: scopedEmploymentId } : undefined)
	);
</script>

<RecordShell>
	<CollectionForm
		{client}
		collection="employment_wage_periods"
		defaultValues={formValues}
		submitLabel={record ? t('component.save_wage_period') : t('component.record_wage_period')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Stack gap="lg">
				<FormSection
					first
					title={t('component.wage_period_history')}
					hint={t('component.wage_period_history_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Field
							name="employment_id"
							label={t('component.person')}
							hidden={scopedEmploymentId != null}
							relationOptions={employmentRelationOptions(createScope?.companyId())}
						/>
						<Column span="all">
							<Field
								name="period"
								label={t('component.wage_period')}
								renderer={EffectiveRangeRenderer}
							/>
						</Column>
						<Field name="normal_wages" label={t('component.normal_wages')} />
						<Field name="ordinary_wages" label={t('component.ordinary_wages')} />
						<Field name="ordinary_days" label={t('component.ordinary_days')} />
						<Field name="due_on" label={t('component.wage_due_on')} />
						<Field name="paid_on" label={t('component.wage_paid_on')} />
						<Column span="all">
							<Field name="reference" label={t('component.source_reference')} />
						</Column>
					</Grid>
				</FormSection>
			</Stack>
		{/snippet}
	</CollectionForm>
</RecordShell>
