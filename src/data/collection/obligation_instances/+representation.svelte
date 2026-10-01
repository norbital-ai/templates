<script lang="ts">
	/** One duty: what is owed and when, and its completion recorded on it — the day, the reference, the file. */
	import { Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { t } from '../../../lib/ui/t.js';
	import { createValues } from '../../../lib/ui/create-scope.js';
	import { openCreated } from '../../../lib/ui/open-created.js';

	let { view }: { view: RecordView<'obligation_instances'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

{#if record}
	<RecordShell
		of="obligation_instances"
		id={record.id}
		subtitle={['trigger_ref', 'due_on', 'amount_due']}
	>
		<Form
			of="obligation_instances"
			mode="update"
			{record}
			sections={[
				{
					name: 'completion',
					title: t('app.payroll.obligation_completion'),
					fields: [
						'state',
						'fulfilled_on',
						'amount_settled',
						'reference',
						'evidence_file',
						'waive_reason'
					]
				},
				{
					name: 'facts',
					title: t('app.payroll.obligation_facts'),
					fields: ['facts'],
					defaultOpen: false,
					summary: (row) =>
						t('app.payroll.obligation_facts_count', {
							count: Object.keys((row.facts as object | null) ?? {}).length
						})
				}
			]}
		/>
	</RecordShell>
{:else}
	<RecordShell of="obligation_instances" mode="create">
		<Form
			of="obligation_instances"
			mode="create"
			values={createValues(view)}
			onOutcome={openCreated(view)}
		/>
	</RecordShell>
{/if}
