<script lang="ts">
	/**
	 * One leave entry: the person, the leave it is taken as, the activity and its certificate.
	 *
	 * The type picker offers only the leaves whose eligibility holds for the person today
	 * (`EligibleTypes`); the hook measures the same rule on every charged day.
	 */
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { client } from '../../lib/workspace-client.js';
	import type { RepresentationProps } from './$types.js';
	import { todayKey } from '../../lib/ui/calendar.js';
	import { defaultTimeOffEvent } from '../../datatypes/leave_event/+definition.js';
	import { employmentRelationOptions, hrCreateScope } from '../../lib/ui/create-scope.js';
	import EligibleTypes from '../../lib/ui/eligible-types.svelte';
	import FormSection from '../../lib/ui/form-section.svelte';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const scope = hrCreateScope();
	const scopedEmploymentId = $derived(scope?.employmentId?.());
	const defaultValues = $derived(
		record ?? {
			...(scopedEmploymentId == null ? {} : { employment_id: scopedEmploymentId }),
			event: defaultTimeOffEvent(todayKey())
		}
	);
</script>

<RecordShell title={record?.reference ?? t('component.create_leave_entry')}>
	<CollectionForm
		{client}
		collection="leave_entries"
		{defaultValues}
		disabled={record != null}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field, form })}
			{@const employmentId =
				scopedEmploymentId ?? (String(form.values().employment_id ?? '') || undefined)}
			<!-- Resolved and frozen by the before hook; callers never supply them. -->
			<Field name="leave_code" hidden />
			<Field name="charges" hidden />
			<Field name="allocations" hidden />
			<Stack gap="lg">
				<FormSection
					first
					title={t('component.leave_section_identity')}
					hint={t('component.leave_entry_section_leave_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Field
							name="employment_id"
							label={t('component.person')}
							hidden={scopedEmploymentId != null}
							relationOptions={employmentRelationOptions(scope?.companyId())}
						/>
						<EligibleTypes
							catalogue="leave_catalogue"
							{employmentId}
							settingsCode={scope?.settingsCode()}
						>
							{#snippet children(where)}
								<Field
									name="leave_catalogue_id"
									label={t('component.type')}
									relationOptions={{
										label: (row) => [row.code, row.name].filter(Boolean).join(' · '),
										where,
										orderBy: { code: 'asc' },
										limit: 500
									}}
								/>
							{/snippet}
						</EligibleTypes>
						<Field name="reference" label={t('component.reference')} />
					</Grid>
				</FormSection>

				<FormSection
					title={t('leave.activity')}
					hint={t('component.leave_entry_section_activity_hint')}
				>
					<Field name="event" />
				</FormSection>

				<FormSection
					title={t('component.leave_entry_section_certificate')}
					hint={t('component.leave_entry_section_certificate_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Field name="certificate_file" />
					</Grid>
				</FormSection>
			</Stack>
		{/snippet}
	</CollectionForm>
	{#if record != null}<p class="text-meta">{t('leave.immutable')}</p>{/if}
</RecordShell>
