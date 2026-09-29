<script lang="ts">
	import { Field, Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import FormSection from '../../../lib/ui/form-section.svelte';
	import { openCreated } from '../../../lib/ui/open-created.js';
	import { createValues } from '../../../lib/ui/create-scope.js';

	let { view }: { view: RecordView<'ph_maternity_pay_cutoffs'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

<RecordShell
	of="ph_maternity_pay_cutoffs"
	mode={view.mode}
	{...record == null ? {} : { id: record.id }}
>
	{#if record == null}
		<Form
			of="ph_maternity_pay_cutoffs"
			mode="create"
			values={createValues(view)}
			submit="Record maternity cutoff evidence"
			onOutcome={openCreated(view)}
		>
			<FormSection
				first
				title="PH maternity cutoff"
				hint="Pin each leave slice and its sourced employee premium shares. A projected share must be checked against the actual payroll assessment before settlement."
			>
				<Grid gap="sm" minimum="compact">
					<Field name="ph_maternity_pay_plan_id" label="Frozen maternity pay plan" />
					<Field name="cutoff_reference" label="Cutoff reference" />
					<Field name="payroll_period" label="Payroll period" />
					<Field name="salary_window" label="Salary window" />
					<Field name="leave_slice" label="Maternity leave slice" />
					<Field name="pay_on" label="Scheduled payday" />
					<Field name="premium_basis" label="Premium evidence basis" />
					<Field name="employee_sss_share" label="Employee SSS share" />
					<Field name="employee_philhealth_share" label="Employee PhilHealth share" />
					<Field name="employee_pagibig_share" label="Employee Pag-IBIG share" />
					<Field name="premium_reference" label="Premium source reference" />
					<Field name="premium_file" label="Premium source file" />
				</Grid>
			</FormSection>
		</Form>
	{:else}
		<Stack gap="sm" class="text-sm">
			<p>
				{record.cutoff_reference} · {record.payroll_period} · scheduled pay {String(record.pay_on)}
			</p>
			<p>Salary and leave periods are frozen on this cutoff evidence row.</p>
			<p>
				Employee shares: SSS ₱{record.employee_sss_share}, PhilHealth ₱{record.employee_philhealth_share},
				Pag-IBIG ₱{record.employee_pagibig_share} ({record.premium_basis}).
			</p>
			<p class="text-muted-foreground">
				Evidence row only. The pay run must verify the complete leave partition and actual premium
				assessment before pricing.
			</p>
		</Stack>
	{/if}
</RecordShell>
