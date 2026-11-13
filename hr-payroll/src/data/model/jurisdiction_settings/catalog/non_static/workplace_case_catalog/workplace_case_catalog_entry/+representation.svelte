<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	let { view, ctx }: { view: RecordView<'workplace_case_catalog_entry'>; ctx: PageContext } =
		$props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const sealed = $derived(record?.payroll_run_id != null);
</script>

<RecordShell
	{ctx}
	of="workplace_case_catalog_entry"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
	badge={sealed ? ctx.t('entry.included_in_payroll') : undefined}
>
	<Form
		{ctx}
		of="workplace_case_catalog_entry"
		mode={view.mode}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
		fields={[
			'catalog_id',
			'entity_id',
			'employment_id',
			'severity',
			'occurred_on',
			'location',
			'reference',
			'description',
			'kind',
			'opened_on',
			'scheduled_on',
			'closed_on',
			'inputs',
			'evidence_file'
		]}
	/>
</RecordShell>
