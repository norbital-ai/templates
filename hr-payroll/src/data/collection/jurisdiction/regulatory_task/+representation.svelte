<script lang="ts">
	import { bolt } from '$bolt';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';
	import { readableTitle } from '../../../../lib/ui/format/display_formatters.js';

	let { view }: { view: RecordView<'regulatory_task'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const t = bolt.t;
</script>

<RecordShell
	of="regulatory_task"
	mode={view.mode}
	{...record == null
		? { values: view.mode === 'create' ? view.values : {} }
		: { id: record.id, title: readableTitle(record.title) }}
	sections={[
		{
			name: 'duty',
			title: t('section.duty'),
			fields: ['code', 'title', 'authority', 'occurrence_key']
		},
		{
			name: 'subject',
			title: t('section.subject'),
			fields: ['subject_collection', 'subject_id', 'trigger_ref']
		},
		{
			name: 'timing',
			title: t('section.timing'),
			fields: ['triggered_on', 'due_on', 'done_on']
		},
		{
			name: 'state',
			title: t('section.state'),
			fields: ['state', 'dismiss_reason']
		},
		{
			name: 'evidence',
			title: t('section.evidence'),
			fields: ['evidence_file', 'facts']
		}
	]}
/>
