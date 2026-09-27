<script lang="ts">
	/**
	 * One leave entry: the person, the leave it is taken as, the activity and its certificate.
	 *
	 * The type picker offers only the leaves whose eligibility holds for the person today
	 * (`EligibleTypes`); the transform measures the same rule on every charged day. The activity is
	 * flat fields — which activity it is follows from the fields present — and `LeaveActivityEditor`
	 * owns all of them. The ledger is append-only: an entry on record has no update, so it opens
	 * read-only in the generated record view, and the frame says so.
	 */
	import EmploymentField from '../../../lib/ui/EmploymentField.svelte';
	import { t } from '../../../lib/ui/t.js';
	import type { Id } from '@norbital-ai/bolt';
	import { Field, Form, Picker } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';
	import { todayKey } from '../../../lib/ui/calendar.js';
	import {
		defaultTimeOffFields,
		type LeaveEntryActivity
	} from '../../../lib/leave/activity-fields.js';
	import { createValues, hrCreateScope } from '../../../lib/ui/create-scope.js';
	import { openCreated } from '../../../lib/ui/open-created.js';
	import EligibleTypes from '../../../lib/ui/eligible-types.svelte';
	import FormSection from '../../../lib/ui/form-section.svelte';
	import LeaveActivityEditor from '../../../lib/ui/leave/leave-activity-editor.svelte';
	import * as Predicate from 'effect/Predicate';

	let { view }: { view: RecordView<'leave_entries'> } = $props();
	const scope = hrCreateScope();
	const scopedEmploymentId = $derived(scope?.employmentId?.());
	const values = $derived(
		createValues(view, {
			employment_id: scopedEmploymentId,
			...defaultTimeOffFields(todayKey())
		})
	);
	/** A form value is text: the employment it names is asserted here, where it enters. */
	const employmentOf = (value: unknown) =>
		Predicate.isString(value) && value !== '' ? (value as Id<'employments'>) : undefined;
	const text = (value: unknown) => (Predicate.isString(value) && value !== '' ? value : null);
</script>

{#if view.mode === 'update'}
	<RecordShell
		of="leave_entries"
		id={view.record.id}
		icon="lucide:lock-keyhole"
		badge={t('leave.entry_read_only')}
		hint={`${t('component.leave_entry_sealed_note')} ${t('leave.immutable')}`}
		fields={[
			'catalogue_id',
			'reference',
			'activity',
			'from_date',
			'half_day_start',
			'to_date',
			'half_day_end',
			'days',
			'hours',
			'reason',
			'certificate_file',
			'employment_id'
		]}
	/>
{:else}
	<RecordShell of="leave_entries" mode="create" {values}>
		<Form of="leave_entries" mode="create" {values} onOutcome={openCreated(view)}>
			{#snippet children(form)}
				{@const employmentId = scopedEmploymentId ?? employmentOf(form.get('employment_id'))}
				<Stack gap="lg">
					<FormSection
						first
						title={t('component.leave_section_identity')}
						hint={t('component.leave_entry_section_leave_hint')}
					>
						<Grid gap="sm" minimum="compact">
							{#if scopedEmploymentId == null}
								<EmploymentField label={t('component.person')} companyId={scope?.companyId()} />
							{/if}
							<EligibleTypes
								catalogue="leave_catalogue"
								{employmentId}
								settingsCode={scope?.settingsCode()}
							>
								{#snippet children(where)}
									<Field name="catalogue_id" label={t('component.type')}>
										{#snippet editor(field)}
											<Picker
												of="leave_catalogue"
												label={['code', 'name']}
												{...where == null ? {} : { where }}
												orderBy={{ code: 'asc' }}
												value={text(field.value)}
												onChange={field.onChange}
												disabled={field.disabled}
											/>
										{/snippet}
									</Field>
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
							values={form.values}
							selfService={scopedEmploymentId != null}
							disabled={form.pending}
							employmentId={employmentId ?? null}
							catalogueId={text(form.get('catalogue_id')) as Id<'leave_catalogue'> | null}
							onValuesChange={(patch: LeaveEntryActivity) => {
								for (const [name, value] of Object.entries(patch))
									form.set(name, (value ?? null) as never);
							}}
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
		</Form>
	</RecordShell>
{/if}
