<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
</script>

<RecordShell title={record?.summary ?? t('component.create_terms')}>
	<CollectionForm
		{client}
		collection="employment_terms"
		defaultValues={record ?? undefined}
		submitLabel={record ? t('component.save_terms') : t('component.create_terms')}
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
						limit: 10_000
					}}
				/>
				<Field name="base_salary" label={t('component.base_salary')} />
				<Field name="pay_frequency" label={t('component.pay_frequency')} />
				<Column span="all">
					<!--
						The base the terms project their days from, picked from the company's named patterns.
						Empty means rostered as assigned: every day is a roster row and nothing is projected.
					-->
					<Field
						name="shift_pattern_id"
						label={t('component.shift_pattern')}
						relationOptions={{
							label: (pattern) =>
								pattern.code != null && pattern.code !== ''
									? `${String(pattern.code)} · ${String(pattern.name ?? '')}`
									: '—',
							orderBy: { code: 'asc' },
							limit: 500
						}}
					/>
				</Column>
				<Field name="employment_type" label={t('component.employment_type')} />
				<Field name="work_classification" label={t('component.classification')} />
				<Field name="statutory_work_category" label={t('component.statutory_work_category')} />
				<Field name="job_title" label={t('component.job_title')} />
				<Field name="department" />
				<Field name="payroll_group" label={t('component.payroll_group')} />
				<Column span="all"
					><Field name="effective_range" label={t('component.effective_period')} /></Column
				>
			</Grid>
		{/snippet}
	</CollectionForm>
</RecordShell>
