<script lang="ts">
	import { Field, Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import type { Id } from '@norbital-ai/bolt';
	import BenefitCaseFactsField from '../../../lib/ui/leave/benefit-case-facts-field.svelte';
	import FormSection from '../../../lib/ui/form-section.svelte';
	import { openCreated } from '../../../lib/ui/open-created.js';
	import { createValues } from '../../../lib/ui/create-scope.js';

	let { view }: { view: RecordView<'benefit_case_cutoffs'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

<RecordShell
	of="benefit_case_cutoffs"
	mode={view.mode}
	{...record == null ? {} : { id: record.id }}
>
	{#if record == null}
		<Form
			of="benefit_case_cutoffs"
			mode="create"
			values={createValues(view)}
			submit="Record benefit cutoff evidence"
			onOutcome={openCreated(view)}
		>
			{#snippet children(form)}
				<FormSection
					first
					title="Benefit cutoff"
					hint="Pin each leave slice and its sourced employee premium shares. A projected share must be checked against the actual payroll assessment before settlement."
				>
					<Grid gap="sm" minimum="compact">
						<Field name="benefit_case_plan_id" label="Frozen benefit pay plan" />
						<Field name="cutoff_reference" label="Cutoff reference" />
						<Field name="payroll_period" label="Payroll period" />
						<Field name="salary_window" label="Salary window" />
						<Field name="leave_slice" label="Benefit leave slice" />
						<Field name="pay_on" label="Scheduled payday" />
						<Field name="premium_basis" label="Premium evidence basis" />
						<Field name="premium_reference" label="Premium source reference" />
						<Field name="premium_file" label="Premium source file" />
						<Column span="all">
							<Field name="premium_shares" label="Employee premium shares">
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
	{:else}
		<Stack gap="sm" class="text-sm">
			<p>
				{record.cutoff_reference} · {record.payroll_period} · scheduled pay {String(record.pay_on)}
			</p>
			<p>Salary and leave periods are frozen on this cutoff evidence row.</p>
			<p>
				Employee shares: {Object.entries(record.premium_shares ?? {})
					.map(([code, amount]) => `${code} ${amount}`)
					.join(', ')} ({record.premium_basis}).
			</p>
			<p class="text-muted-foreground">
				Evidence row only. The pay run must verify the complete leave partition and actual premium
				assessment before pricing.
			</p>
		</Stack>
	{/if}
</RecordShell>
