<script lang="ts">
	import { Field, Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { bolt } from '$bolt';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import type { Id } from '@norbital-ai/bolt';
	import BenefitCaseFactsField from '../../../lib/ui/leave/benefit-case-facts-field.svelte';
	import FormSection from '../../../lib/ui/form-section.svelte';
	import { openCreated } from '../../../lib/ui/open-created.js';
	import { createValues } from '../../../lib/ui/create-scope.js';

	let { view }: { view: RecordView<'benefit_case_cutoffs'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

{#if record == null}
	<RecordShell of="benefit_case_cutoffs" mode="create">
		<Form
			of="benefit_case_cutoffs"
			mode="create"
			values={createValues(view)}
			submit={bolt.t('component.benefit_cutoff_record')}
			onOutcome={openCreated(view)}
		>
			{#snippet children(form)}
				<FormSection
					first
					title={bolt.t('component.benefit_cutoff')}
					hint={bolt.t('component.benefit_cutoff_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Field name="benefit_case_plan_id" />
						<Field name="cutoff_reference" />
						<Field name="payroll_period" />
						<Field name="salary_window" />
						<Field name="leave_slice" />
						<Field name="pay_on" />
						<Field name="premium_basis" />
						<Field name="premium_reference" />
						<Field name="premium_file" />
						<Column span="all">
							<Field name="premium_shares">
								{#snippet editor(field)}
									<BenefitCaseFactsField
										view={{
											mode: 'edit',
											name: field.name,
											value: field.value as never,
											disabled: field.disabled,
											onChange: field.onChange as never
										}}
										planId={form.get('benefit_case_plan_id') as
											Id<'benefit_case_plans'> | undefined}
										schema="premium_shares"
									/>
								{/snippet}
							</Field>
						</Column>
					</Grid>
				</FormSection>
			{/snippet}
		</Form>
	</RecordShell>
{:else}
	<!-- a stored cutoff is evidence, read as stored -->
	<RecordShell
		of="benefit_case_cutoffs"
		id={record.id}
		hint={bolt.t('component.benefit_cutoff_note')}
	/>
{/if}
