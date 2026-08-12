<script lang="ts">
	/**
	 * An attendance day belongs to one employment. The auto form asked for `employment_id` as an
	 * editable uuid; it is a relationship and reads as the employee number.
	 *
	 * Every field here is a recorded fact about presence. There is no overtime field: payroll derives
	 * premium work from these intervals, the effective schedule and the statutory day type.
	 */
	import { client } from '$pod/client';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$pod/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid } from '@norbital-ai/ui/layout';
	import { RelationshipRenderer } from '@norbital-ai/ui/data-renderer/relationship';
	import DurationHoursRenderer from '../../lib/ui/duration-hours-renderer.svelte';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
</script>

<CollectionForm
	{client}
	collection="time_entries"
	recordId={record?.norbital_id}
	defaultValues={record ?? undefined}
	submitLabel={record ? t('component.save_attendance') : t('component.create_attendance')}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid gap="md" minimum="panel">
			<Field
				name="employment_id"
				label={t('component.employment')}
				renderer={RelationshipRenderer}
				rendererProps={{
					target: 'employments',
					options: {
						label: (employment) =>
							employment.employee_number != null && employment.employee_number !== ''
								? String(employment.employee_number)
								: '—',
						orderBy: { employee_number: 'asc' },
						limit: 1000
					}
				}}
			/>
			<Field name="work_date" label={t('component.day')} />
			<Field name="worked_intervals" label={t('component.worked_intervals')} />
			<Field
				name="break_minutes"
				label={t('component.unpaid_break_hours')}
				renderer={DurationHoursRenderer}
			/>
		</Grid>
	{/snippet}
</CollectionForm>
