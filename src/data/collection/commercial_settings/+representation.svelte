<script lang="ts">
	import { bolt } from '$bolt';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	let {
		view
	}: {
		view: RecordView<'commercial_settings'>;
	} = $props();
</script>

<RecordForm
	{view}
	sections={[
		{
			name: 'controls',
			title: bolt.t('section.general'),
			fields: ['freight_treatment', 'require_floor', 'credit_fresh_minutes', 'stock_fresh_minutes']
		}
	]}
/>
