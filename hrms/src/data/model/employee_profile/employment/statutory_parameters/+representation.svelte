<script lang="ts">
	/**
	 * One dated change to what the law is told about a person in a stint: its date and only the values it changes. Here it is edited, moved to
	 * another date or deleted.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { paidPeriods } from '../../../../../lib/ui/payroll/paid_period.svelte.js';
	import DatedChangeFields from '../../../../../lib/ui/person/dated_change_fields.svelte';
	import DeleteButton from '../../../../../lib/ui/person/delete_button.svelte';

	let { view, ctx }: { view: RecordView<'statutory_parameters'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const paid = paidPeriods(ctx);
</script>

{#snippet actions()}{#if record !== null}<DeleteButton
			{ctx}
			label={ctx.t('person.delete_change')}
			title={ctx.t('person.delete_change_title')}
			body={ctx.t('person.delete_change_body')}
			act={() =>
				ctx.act({
					'statutory_parameters.delete': [{ target: { id: record.id, revision: record.revision } }]
				})}
		/>{/if}{/snippet}

<RecordShell
	{ctx}
	of="statutory_parameters"
	mode={view.mode}
	footer_actions={actions}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		{ctx}
		of="statutory_parameters"
		mode={view.mode === 'create' ? 'create' : 'update'}
		confirm={paid.confirm(() => false, ['effective_from'])}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
	>
		{#snippet children()}<DatedChangeFields {ctx} of="statutory_parameters" />{/snippet}
	</Form>
</RecordShell>
