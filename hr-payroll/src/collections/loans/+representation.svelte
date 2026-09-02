<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';

	/**
	 * One loan agreement: who owes it, which payroll deduction recovers it, how much, and from when.
	 *
	 * The table refused to create loans at all — "requires an explicit representation" — because no
	 * representation existed. The hook behind this form is the arbiter of what a loan may be: a
	 * positive principal, recovered through a payroll-settled deduction component. The form only
	 * narrows the component list to deductions so the ordinary choice is the admissible one.
	 */
	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
</script>

<CollectionForm
	{client}
	collection="loans"
	defaultValues={record ?? undefined}
	submitLabel={record ? t('component.save_loan') : t('component.create_loan')}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid gap="md" minimum="panel">
			<Field
				name="employment_id"
				label={t('component.employment')}
				relationOptions={{
					label: (employment) =>
						employment.employee_number != null && employment.employee_number !== ''
							? String(employment.employee_number)
							: '—',
					orderBy: { employee_number: 'asc' },
					limit: 1000
				}}
			/>
			<Field
				name="pay_component_id"
				label={t('component.pay_component')}
				relationOptions={{
					label: (component) =>
						component.code != null && component.code !== '' ? String(component.code) : '—',
					where: { nature: { eq: 'DEDUCTION' } },
					orderBy: { code: 'asc' },
					limit: 200
				}}
			/>
			<Field name="principal" label={t('component.principal')} />
			<Field name="effective_range" label={t('component.effective_period')} />
			<Column span="all"><Field name="reference" label={t('component.reference')} /></Column>
			<Column span="all"><Field name="reason" label={t('component.reason')} /></Column>
		</Grid>
	{/snippet}
</CollectionForm>
