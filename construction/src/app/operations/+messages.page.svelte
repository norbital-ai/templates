<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';

	let { ctx }: { ctx: PageContext } = $props();
	const canRunPipeline = $derived(ctx.catalog?.project_messages?.update !== undefined);
</script>

<AppShell
	icon="lucide:message-square-text"
	title={ctx.t('app.operations.page_messages')}
	description={ctx.t('app.operations.messages_description')}
>
	<Table
		{ctx}
		of="project_messages"
		order_by={{ occurred_at: 'desc' }}
		page_size={50}
		toolbar={{
			title: false,
			...(canRunPipeline
				? {
						actions: [
							{
								icon: 'lucide:refresh-cw',
								name: ctx.t('messages.action_sync'),
								description: ctx.t('messages.action_sync_desc'),
								run: () => ctx.run('sync_messages', {})
							},
							{
								icon: 'lucide:sparkles',
								name: ctx.t('messages.action_classify'),
								description: ctx.t('messages.action_classify_desc'),
								run: () => ctx.run('classify_messages', {})
							},
							{
								icon: 'lucide:wand-sparkles',
								name: ctx.t('messages.action_extract'),
								description: ctx.t('messages.action_extract_desc'),
								run: () => ctx.run('extract_project_updates', {})
							}
						]
					}
				: {})
		}}
		columns={[
			'occurred_at',
			'transport',
			'sender_name',
			'subject',
			'project_id',
			'classification',
			'extraction_status'
		]}
	/>
</AppShell>
