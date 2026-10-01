<script lang="ts">
	import { bolt } from '$bolt';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import Regarding from '../../../lib/ui/regarding.svelte';
	import type { FormState } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'activities'> } = $props();
	const t = bolt.t;
	const record = $derived(view.mode === 'update' ? view.record : null);
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
	subtitle={['type', 'due_date']}
	editors={{ regarding }}
	sections={[
		{
			name: 'activity',
			title: t('section.activity'),
			fields: ['subject', 'type', 'regarding', 'due_date', 'completed_at', 'owner_id']
		},
		{
			name: 'notes',
			title: t('section.notes'),
			fields: ['description'],
			closed: record?.['description'] || t('section.no_notes')
		}
	]}
/>
