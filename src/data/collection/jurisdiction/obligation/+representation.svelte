<script lang="ts">
	import { bolt } from '$bolt';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'obligation'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const t = bolt.t;
</script>

<RecordShell
	of="obligation"
	mode={view.mode}
	{...record == null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
	sections={[
		{
			name: 'duty',
			title: t('section.duty'),
			fields: ['duty_code', 'authority', 'occurrence_key', 'trigger_ref']
		},
		{
			name: 'timing',
			title: t('section.timing'),
			fields: ['triggered_on', 'due_on', 'fulfilled_on']
		},
		{
			name: 'amounts',
			title: t('section.amounts'),
			fields: ['amount_due', 'amount_settled', 'state', 'waive_reason']
		},
		{
			name: 'evidence',
			title: t('section.evidence'),
			fields: ['reference', 'evidence_file', 'facts']
		}
	]}
/>
