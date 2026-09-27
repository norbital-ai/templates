<script lang="ts">
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import Regarding from '../../../lib/ui/regarding.svelte';
	import type { FormState } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'activities'> } = $props();
</script>

{#snippet regarding(form: FormState)}
	<Regarding
		{form}
		arms={[
			['accounts', 'component.account'],
			['quotes', 'component.quote']
		]}
	/>
{/snippet}

<RecordForm
	{view}
	subtitle={(r) =>
		`${r.type ?? 'activity'}${r.due_date ? ` · due ${r.due_date}` : ''}${r.completed_at ? ' · completed' : ''}`}
	editors={{ regarding }}
	fields={[
		'subject',
		'type',
		['regarding', 'component.regarding'],
		['due_date', 'component.due_date'],
		['completed_at', 'component.completed'],
		['owner_id', 'component.owner'],
		'description'
	]}
/>
