<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../lib/ui/record-form.svelte';
	let { view, ctx }: { view: RecordView<'credit_snapshots'>; ctx: PageContext } = $props();
</script>

<!-- a Kingdee mirror: only its sync writes it -->
<RecordForm
	{ctx}
	{view}
	readonly
	readonly_reason={ctx.t('component.kingdee_readonly')}
	sections={[
		{
			name: 'credit_snapshots',
			fields: [
				'party',
				'currency',
				'credit_limit',
				'credit_used',
				'credit_available',
				'credit_hold',
				'external_code',
				'as_of'
			]
		}
	]}
/>
