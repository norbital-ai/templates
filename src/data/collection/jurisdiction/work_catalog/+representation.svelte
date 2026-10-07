<script lang="ts">
	import { bolt } from '$bolt';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'work_catalog'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const t = bolt.t;
</script>

<RecordShell
	of="work_catalog"
	mode={view.mode}
	{...record == null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
	sections={[
		{ name: 'identity', title: t('section.identity'), fields: ['code', 'name', 'component_code'] },
		{ name: 'authority', title: t('section.authority'), fields: ['authority'] },
		{ name: 'rules', title: t('section.rules'), fields: ['eligibility', 'quantity', 'rate'] },
		{
			name: 'settlement',
			title: t('section.settlement'),
			fields: ['destination', 'direction', 'counts_toward']
		}
	]}
/>
