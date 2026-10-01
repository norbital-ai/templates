<script lang="ts">
	/** Dated wage evidence for one contract: the period, the wages and days it records, and where they come from. */
	import EmploymentField from '../../../lib/ui/EmploymentField.svelte';
	import { t } from '../../../lib/ui/t.js';
	import { Field, Form } from '@norbital-ai/ui';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';
	import { createValues, hrCreateScope } from '../../../lib/ui/create-scope.js';
	import FormSection from '../../../lib/ui/form-section.svelte';

	let { view }: { view: RecordView<'employment_wage_periods'> } = $props();
	const scope = hrCreateScope();
	const scopedEmploymentId = $derived(scope?.employmentId?.());
	const record = $derived(view.mode === 'update' ? view.record : null);
	const values = $derived(createValues(view, { employment_id: scopedEmploymentId }));
</script>

<RecordShell
	of="employment_wage_periods"
	{...record == null ? {} : { id: record.id }}
	mode={view.mode}
>
	<Form
		of="employment_wage_periods"
		mode={view.mode}
		{record}
		{values}
		submit={record ? t('component.save_wage_period') : t('component.record_wage_period')}
	>
		<FormSection
			name="wage_period_history"
			first
			title={t('component.wage_period_history')}
			hint={t('component.wage_period_history_hint')}
		>
			<Grid gap="sm" minimum="compact">
				{#if record == null && scopedEmploymentId == null}
					<EmploymentField label={t('component.person')} companyId={scope?.companyId?.()} />
				{/if}
				<Column span="all">
					<Field name="period" label={t('component.wage_period')} />
				</Column>
				<Field name="currency" label={t('component.currency')} />
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
	</Form>
</RecordShell>
