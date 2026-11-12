<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	let {
		view,
		ctx
	}: {
		view: RecordView<'commercial_settings'>;
		ctx: PageContext;
	} = $props();
</script>

<RecordForm
	{ctx}
	{view}
	sections={[
		{
			name: 'controls',
			icon: 'lucide:sliders-horizontal',
			title: ctx.t('section.general'),
			fields: ['freight_treatment', 'require_floor']
		}
	]}
/>
