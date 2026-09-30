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
	subtitle={['type', 'due_date']}
	editors={{ regarding }}
	fields={['subject', 'type', 'regarding', 'due_date', 'completed_at', 'owner_id', 'description']}
/>
