<script lang="ts">
	import { bolt } from '$bolt';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import type { RecordView } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'contacts'> } = $props();
	const t = bolt.t;
</script>

<RecordForm
	{view}
	subtitle={['email', 'title']}
	sections={[
		{
			name: 'contact',
			title: t('section.contact'),
			fields: ['account_id', 'first_name', 'last_name', 'email', 'title', 'department', 'active']
		}
	]}
/>
