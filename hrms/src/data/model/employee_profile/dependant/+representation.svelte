<script lang="ts">
	/** One member of a person's family, dated by its own birth or expected date: edited where it stands, or deleted. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { paidPeriods } from '../../../../lib/ui/payroll/paid_period.svelte.js';
	import DeleteButton from '../../../../lib/ui/person/delete_button.svelte';

	let { view, ctx }: { view: RecordView<'dependant'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const paid = paidPeriods(ctx);
</script>

{#snippet actions()}{#if record !== null}<DeleteButton
			{ctx}
			label={ctx.t('person.delete_dependant')}
			title={ctx.t('person.delete_dependant_title')}
			body={ctx.t('person.delete_dependant_body')}
			act={() =>
				ctx.act({ 'dependant.delete': [{ target: { id: record.id, revision: record.revision } }] })}
		/>{/if}{/snippet}

<RecordShell
	{ctx}
	of="dependant"
	mode={view.mode}
	footer_actions={actions}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		{ctx}
		of="dependant"
		mode={view.mode === 'create' ? 'create' : 'update'}
		confirm={paid.confirm(() => false, ['born_on', 'expected_on'])}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
	/>
</RecordShell>
