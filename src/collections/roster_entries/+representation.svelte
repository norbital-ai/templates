<script lang="ts">
	/** A person-day references one roster code; the code itself says WORK, REST or OFF. */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid } from '@norbital-ai/ui/layout';
	import { RelationshipRenderer } from '@norbital-ai/ui/data-renderer/relationship';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
</script>

<CollectionForm
	{client}
	collection="roster_entries"
	defaultValues={record ?? undefined}
	submitLabel={record ? t('component.save_roster_day') : t('component.create_roster_day')}
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
			<Field
				name="shift_definition_id"
				label={t('component.shift')}
				renderer={RelationshipRenderer}
				rendererProps={{
					target: 'shift_definitions',
					options: {
						label: (shift) =>
							[shift.code, shift.name].filter((part) => part != null && part !== '').join(' · ') ||
							'—',
						orderBy: { code: 'asc' },
						limit: 500
					}
				}}
			/>
			<Field
				name="roster_id"
				label={t('component.drafted_month')}
				renderer={RelationshipRenderer}
				rendererProps={{
					target: 'rosters',
					options: {
						label: (roster) =>
							roster.month != null && roster.month !== '' ? String(roster.month) : '—',
						orderBy: { month: 'desc' },
						limit: 500
					}
				}}
			/>
			<Field name="assignment_code" label={t('component.source_roster_token')} />
		</Grid>
	{/snippet}
</CollectionForm>
