<script lang="ts">
	/**
	 * One named shift: its code, its clock times and break, and its range. Roster codes on pattern
	 * days and roster entries name these.
	 */
	import { bolt } from '$bolt';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'shift_definition'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const t = bolt.t;
</script>

<RecordShell
	of="shift_definition"
	mode={view.mode}
	{...record == null
		? { values: view.mode === 'create' ? view.values : {} }
		: { id: record.id, subtitle: ['code'] }}
	sections={[
		{ name: 'identity', title: t('section.identity'), fields: ['code', 'name', 'effective_range'] },
		{ name: 'variant', title: t('shift_definition.variant'), fields: ['variant'] }
	]}
/>
