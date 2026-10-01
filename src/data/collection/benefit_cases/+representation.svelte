<script lang="ts">
	/**
	 * A benefit case, its type, event kind and facts chosen from the case types its employment's
	 * lineage declares.
	 */
	import { bolt } from '$bolt';
	import { Field, Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import type { Id } from '@norbital-ai/bolt';
	import * as Predicate from 'effect/Predicate';
	import BenefitCaseFactsField from '../../../lib/ui/leave/benefit-case-facts-field.svelte';
	import CaseTypeSelect from '../../../lib/ui/leave/case-type-select.svelte';
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
		submit={bolt.t(record == null ? 'component.benefit_case_open' : 'component.benefit_case_save')}
		onOutcome={openCreated(view)}
	>
		{#snippet children(form)}
			<FormSection
				name="benefit_case"
				first
				title={bolt.t('component.benefit_case')}
				hint={bolt.t('component.benefit_case_hint')}
			>
				<Grid gap="sm" minimum="compact">
					{#if record == null}
						<Field name="employee_id" />
						<Field name="employment_id" />
						<Field name="case_type">
							{#snippet editor(field)}
								<CaseTypeSelect
									employmentId={text(form.get('employment_id'))}
									day={text(form.get('application_on'))}
									value={text(field.value)}
									disabled={field.disabled}
									onChange={(next) => field.onChange(next as never)}
								/>
							{/snippet}
						</Field>
						<Field name="case_reference" />
						<Field name="application_on" />
					{/if}
					<Field name="expected_event_on" />
					<Field name="event_kind">
						{#snippet editor(field)}
							<CaseTypeSelect
								employmentId={text(form.get('employment_id') ?? record?.employment_id)}
								day={text(form.get('event_on')) ??
									text(form.get('expected_event_on')) ??
									text(form.get('application_on') ?? record?.application_on)}
								caseType={text(form.get('case_type') ?? record?.case_type)}
								value={text(field.value)}
								disabled={field.disabled}
								onChange={(next) => field.onChange(next as never)}
							/>
						{/snippet}
					</Field>
					<Field name="event_on" />
					<Field name="leave_from" />
					<Field name="leave_through" />
					<Field name="notified_on" />
					<Field name="notification_reference" />
					<Field name="award_amount" />
					<Field name="awarded_on" />
					<Field name="award_reference" />
					<Field name="award_file" />
					<Column span="all">
						<Field name="facts">
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
