<script lang="ts">
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import type { RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'contacts'> } = $props();
</script>

<RecordForm
	{view}
	subtitle={(r) => [r.email, r.title ?? r.department].filter(Boolean).join(' · ')}
	fields={[
		['account_id', 'component.account'],
		['first_name', 'component.first_name'],
		['last_name', 'component.last_name'],
		'email',
		'title',
		'department',
		'active'
	]}
/>
