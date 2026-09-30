<script lang="ts">
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import type { RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'contacts'> } = $props();
</script>

<RecordForm
	{view}
	subtitle={['email', 'title']}
	fields={['account_id', 'first_name', 'last_name', 'email', 'title', 'department', 'active']}
/>
