<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	let { view, ctx }: { view: RecordView<'warehouses'>; ctx: PageContext } = $props();
</script>

<!-- a Kingdee mirror: only its sync writes it -->
<RecordForm
	{ctx}
	{view}
	readonly
	readonly_reason={ctx.t('component.kingdee_readonly')}
	sections={[
		{
			name: 'warehouses',
			fields: [
				'name',
				'external_code',
				'source_number',
				'group_code',
				'active',
				'source_updated_at'
			]
		}
	]}
/>
