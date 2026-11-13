<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { paidPeriods } from '../../../lib/ui/payroll/paid_period.svelte.js';
	let { view, ctx }: { view: RecordView<'roster_entry'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const paid = paidPeriods(ctx);
</script>

<RecordShell
	{ctx}
	of="roster_entry"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		{ctx}
		of="roster_entry"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
		confirm={paid.confirm(() => record?.payroll_run_id != null, ['work_date'])}
	/>
</RecordShell>
