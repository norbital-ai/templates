<script lang="ts">
	/** One principal configures its generated repayment schedule; payroll pins each consumed child to a payslip. */
	import { Form, openRecord, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import EntryFields from '../../../lib/ui/payroll/entry_fields.svelte';
	import LoanRepayments from '../../../lib/ui/payroll/loan_repayments.svelte';

	let { view }: { view: RecordView<'loan_catalog_entry'> } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
</script>

<RecordShell
	of="loan_catalog_entry"
	mode={view.mode}
	{...record == null ? { values } : { id: record.id }}
>
	<Stack gap="lg">
		{#key record?.revision}
			<Form
				of="loan_catalog_entry"
				mode={view.mode === 'create' ? 'create' : 'update'}
				{...record ? { id: record.id } : {}}
				{record}
				{values}
				onOutcome={(outcome) => {
					if (outcome.kind !== 'committed' || record) return;
					const created = outcome.records.find((row) => row.collection === 'loan_catalog_entry');
					if (created) openRecord('loan_catalog_entry', created.id);
				}}
			>
				{#snippet children(form)}
					<EntryFields
						catalog="loan_catalog"
						{form}
						fields={['principal_amount', 'repayment_period', 'repayment_frequency']}
					/>
					<LoanRepayments {form} {record} />
				{/snippet}
			</Form>
		{/key}
	</Stack>
</RecordShell>
