<script lang="ts">
	import { Field, Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import FormSection from '../../../lib/ui/form-section.svelte';
	import { openCreated } from '../../../lib/ui/open-created.js';
	import { createValues } from '../../../lib/ui/create-scope.js';

	let { view }: { view: RecordView<'benefit_case_plans'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

<RecordShell of="benefit_case_plans" mode={view.mode} {...record == null ? {} : { id: record.id }}>
	{#if record == null}
		<Form
			of="benefit_case_plans"
			mode="create"
			values={createValues(view)}
			submit="Freeze advance candidate"
			onOutcome={openCreated(view)}
		>
			<FormSection
				first
				title="Benefit advance plan"
				hint="The candidate derives from the saved contribution-statement months its case type's window names. An actual award and employee payment are recorded separately."
			>
				<Grid gap="sm" minimum="compact">
					<Field name="benefit_case_id" label="Benefit case" />
					<Field name="basis_method" label="Full-pay basis method" />
					<Field name="monthly_full_pay_basis" label="Documented monthly full pay" />
					<Field name="qualifying_allowances_assessed" label="Qualifying allowances assessed" />
					<Field name="basis_reference" label="Wage-basis reference" />
					<Field name="basis_file" label="Wage-basis source file" />
				</Grid>
			</FormSection>
		</Form>
	{:else}
		<Stack gap="sm" class="text-sm">
			<p>
				Plan {record.plan_number}: candidate award {record.candidate_amount}, due {String(
					record.advance_due_on
				)}.
			</p>
			<p>
				Application {String(record.application_on_at_plan)}; event basis {record.event_basis_kind}
				on {String(record.event_basis_on)}.
			</p>
			<p>Wage source {record.basis_reference}; monthly full pay {record.monthly_full_pay_basis}.</p>
			<p class="text-muted-foreground">
				Frozen candidate only. Recorded cash and the actual award must be reconciled separately; no
				payroll settlement follows from this row.
			</p>
		</Stack>
	{/if}
</RecordShell>
