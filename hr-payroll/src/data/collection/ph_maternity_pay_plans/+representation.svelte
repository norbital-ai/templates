<script lang="ts">
	import { Field, Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import FormSection from '../../../lib/ui/form-section.svelte';
	import { openCreated } from '../../../lib/ui/open-created.js';
	import { createValues } from '../../../lib/ui/create-scope.js';

	let { view }: { view: RecordView<'ph_maternity_pay_plans'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

<RecordShell
	of="ph_maternity_pay_plans"
	mode={view.mode}
	{...record == null ? {} : { id: record.id }}
>
	{#if record == null}
		<Form
			of="ph_maternity_pay_plans"
			mode="create"
			values={createValues(view)}
			submit="Freeze SSS advance candidate"
			onOutcome={openCreated(view)}
		>
			<FormSection
				first
				title="PH maternity advance plan"
				hint="The candidate derives from twelve saved SSS contribution months. An actual award and employee payment are recorded separately."
			>
				<Grid gap="sm" minimum="compact">
					<Field name="ph_maternity_case_id" label="Maternity case" />
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
				Plan {record.plan_number}: candidate SSS benefit ₱{record.candidate_sss_amount}, due {String(
					record.advance_due_on
				)}.
			</p>
			<p>
				Application {String(record.application_on_at_plan)}; contingency basis {record.contingency_basis_kind}
				on {String(record.contingency_basis_on)}.
			</p>
			<p>
				Wage source {record.basis_reference}; monthly full pay ₱{record.monthly_full_pay_basis}.
			</p>
			<p class="text-muted-foreground">
				Frozen candidate only. Recorded cash and the actual SSS award must be reconciled separately;
				no payroll settlement follows from this row.
			</p>
		</Stack>
	{/if}
</RecordShell>
