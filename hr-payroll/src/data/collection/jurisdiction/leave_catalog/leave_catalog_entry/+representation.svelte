<script lang="ts">
	/** One leave movement: the person narrowed to the page’s entity, the class to the employment’s governing version and what the employee is eligible for. */
	import { Form, openRecord, RecordShell, type RecordView } from '@norbital-ai/ui';
	import EntryFields from '../../../../../lib/ui/payroll/entry_fields.svelte';

	let { view }: { view: RecordView<'leave_catalog_entry'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
</script>

<RecordShell
	of="leave_catalog_entry"
	mode={view.mode}
	{...record == null ? { values } : { id: record.id }}
>
	{#key record?.revision}
		<Form
			of="leave_catalog_entry"
			mode={view.mode}
			{...record ? { id: record.id } : {}}
			{record}
			{values}
			onOutcome={(outcome) => {
				if (outcome.kind !== 'committed' || record) return;
				const created = outcome.records.find((row) => row.collection === 'leave_catalog_entry');
				if (created) openRecord('leave_catalog_entry', created.id);
			}}
		>
			{#snippet children(form)}
				<EntryFields
					catalog="leave_catalog"
					{form}
					fields={[
						'occurred_on',
						'activity',
						'from',
						'to',
						'half_day_start',
						'half_day_end',
						'days',
						'amount',
						'incurred_on',
						'label',
						'reference',
						'facts'
					]}
				/>
			{/snippet}
		</Form>
	{/key}
</RecordShell>
