<script lang="ts">
	/**
	 * One leave entry: the person, the leave it is taken as, the activity and its certificate.
	 *
	 * The type picker offers only the leaves whose eligibility holds for the person today
	 * (`EligibleTypes`); the transform measures the same rule on every charged day. The activity itself
	 * is flat fields — no discriminator column — and `LeaveActivityEditor` owns all of them.
	 */
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { useI18n, type UiKeys } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { client } from '../../lib/workspace-client.js';
	import type { RepresentationProps } from './$types.js';
	import { todayKey } from '../../lib/ui/calendar.js';
	import { defaultTimeOffFields } from '../../lib/leave/activity-fields.js';
	import { employmentRelationOptions, hrCreateScope } from '../../lib/ui/create-scope.js';
	import EligibleTypes from '../../lib/ui/eligible-types.svelte';
	import FormSection from '../../lib/ui/form-section.svelte';
	import LeaveActivityEditor from '../../lib/ui/leave/leave-activity-editor.svelte';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys | UiKeys>();
	const scope = hrCreateScope();
	const selfService = $derived(scope?.employmentId != null);
	const scopedEmploymentId = $derived(scope?.employmentId?.());
	const defaultValues = $derived(
		record ?? {
			...(scopedEmploymentId == null ? {} : { employment_id: scopedEmploymentId }),
			...defaultTimeOffFields(todayKey())
		}
	);
</script>

<!-- The ledger is append-only: an entry on record is read-only, and the shell says so. -->
<RecordShell
	icon={record != null ? 'lucide:lock-keyhole' : undefined}
	badge={record != null ? t('recordMetadata.readOnly') : undefined}
	hint={record != null ? t('component.leave_entry_sealed_note') : undefined}
>
	<CollectionForm
		{client}
		collection="leave_entries"
		{defaultValues}
		disabled={record != null}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field, form })}
			{@const values = form.values()}
			{@const employmentId =
				scopedEmploymentId ?? (String(values.employment_id ?? '') || undefined)}
			<!-- The activity fields are flat and the editor below owns every one of them. -->
			<Field name="as_adjustment_entry" hidden />
			<Field name="from_date" hidden />
			<Field name="to_date" hidden />
			<Field name="half_day_start" hidden />
			<Field name="half_day_end" hidden />
			<Field name="days" hidden />
			<Field name="encash_days" hidden />
			<Field name="reversal_of_id" hidden />
			<Field name="effective_on" hidden />
			<Field name="due_on" hidden />
			<Field name="destination_from" hidden />
			<Field name="destination_to" hidden />
			<Field name="available_from" hidden />
			<Field name="expires_on" hidden />
			<Field name="reason" hidden />
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
									name="catalogue_id"
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
					<LeaveActivityEditor
						{values}
						{selfService}
						disabled={record != null}
						employmentId={employmentId ?? null}
						catalogueId={typeof values.catalogue_id === 'string' ? values.catalogue_id : null}
						onValuesChange={(patch) => form.setValues(patch)}
					/>
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
