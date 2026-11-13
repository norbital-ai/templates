<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { paidPeriods } from '../../../../../../../../lib/ui/payroll/paid_period.svelte.js';
	let { view, ctx }: { view: RecordView<'loan_catalog_entry_repayment'>; ctx: PageContext } =
		$props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const paid = paidPeriods(ctx);
</script>

<RecordShell
	{ctx}
	of="loan_catalog_entry_repayment"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		{ctx}
		of="loan_catalog_entry_repayment"
		mode={view.mode}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
		fields={['amount', 'paid_on', 'payment_reference']}
		confirm={paid.confirm(() => record?.payroll_run_id != null, ['paid_on'])}
	/>
</RecordShell>
