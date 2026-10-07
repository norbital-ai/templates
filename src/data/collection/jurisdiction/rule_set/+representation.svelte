<script lang="ts">
	import { bolt } from '$bolt';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'rule_set'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const t = bolt.t;
</script>

<RecordShell
	of="rule_set"
	mode={view.mode}
	{...record == null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
	sections={[
		{
			name: 'identity',
			title: t('section.identity'),
			fields: ['scope', 'family', 'code', 'name', 'content_hash', 'source_identity']
		},
		{ name: 'rules', title: t('section.rules'), fields: ['rules'] }
	]}
/>
