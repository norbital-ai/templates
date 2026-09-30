<script lang="ts">
	/** A benefit case, its facts rendered with the case type its employment's lineage declares. */
	import { Field, Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import type { Id } from '@norbital-ai/bolt';
	import * as Predicate from 'effect/Predicate';
	import BenefitCaseFactsField from '../../../lib/ui/leave/benefit-case-facts-field.svelte';
	import FormSection from '../../../lib/ui/form-section.svelte';
	import { openCreated } from '../../../lib/ui/open-created.js';
	import { createValues } from '../../../lib/ui/create-scope.js';

	let { view }: { view: RecordView<'benefit_cases'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const text = (value: unknown) => (Predicate.isString(value) && value !== '' ? value : null);
</script>

<RecordShell of="benefit_cases" mode={view.mode} {...record == null ? {} : { id: record.id }}>
	<Form
		of="benefit_cases"
		mode={view.mode}
		{record}
		values={createValues(view)}
		submit={record == null ? 'Open benefit case' : 'Save benefit case'}
		onOutcome={openCreated(view)}
	>
		{#snippet children(form)}
			<FormSection
				first
				title="Benefit case"
				hint="The case type is the leave code whose statutory benefit the case prices. Its facts are the ones that case type declares; attach their files as fact evidence."
			>
				<Grid gap="sm" minimum="compact">
					{#if record == null}
						<Field name="employee_id" label="Person" />
						<Field name="employment_id" label="Employment" />
						<Field name="case_type" label="Case type (leave code)" />
						<Field name="case_reference" label="Application reference" />
						<Field name="application_on" label="Application date" />
					{/if}
					<Field name="expected_event_on" label="Expected event" />
					<Field name="event_kind" label="Event kind" />
					<Field name="event_on" label="Event date" />
					<Field name="leave_from" label="Planned leave from" />
					<Field name="leave_through" label="Planned leave through" />
					<Field name="notified_on" label="Scheme notified on" />
					<Field name="notification_reference" label="Notification reference" />
					<Field name="award_amount" label="Actual award" />
					<Field name="awarded_on" label="Awarded on" />
					<Field name="award_reference" label="Award reference" />
					<Field name="award_file" label="Award document" />
					<Column span="all">
						<Field name="facts" label="Case facts">
							{#snippet editor(field)}
								<BenefitCaseFactsField
									view={{
										mode: 'edit',
										name: field.name,
										value: field.value as never,
										disabled: field.disabled,
										onChange: field.onChange as never
									}}
									employmentId={(form.get('employment_id') ?? record?.employment_id) as
										Id<'employments'> | undefined}
									caseType={text(form.get('case_type') ?? record?.case_type)}
									day={text(form.get('event_on')) ??
										text(form.get('expected_event_on')) ??
										text(form.get('application_on') ?? record?.application_on)}
									schema="facts"
								/>
							{/snippet}
						</Field>
					</Column>
				</Grid>
			</FormSection>
		{/snippet}
	</Form>
</RecordShell>
