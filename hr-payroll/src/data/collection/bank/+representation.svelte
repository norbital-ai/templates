<script lang="ts">
	import { bolt } from '$bolt';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'bank'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const t = bolt.t;
</script>

<RecordShell
	of="bank"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
	sections={[
		{
			name: 'identity',
			title: t('bank.identity'),
			fields: ['code', 'name', 'bank_codes', 'currencies', 'enabled']
		},
		{ name: 'template', title: t('bank.template'), fields: ['template'] }
	]}
/>
