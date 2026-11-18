<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, RecordShell, Sheet, Table } from '@norbital-ai/ui';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	let settingsOpen = $state(false);
	const settings = $derived(settingsOpen ? ctx.query({ outreach_settings: { limit: 1 } }) : null);
	const outreach = $derived(settings?.current?.outreach_settings.rows[0] ?? null);
</script>

<AppShell
	icon="lucide:list-ordered"
	title={t('sequences.title')}
	description={t('sequences.description')}
	variant="full"
>
	<Table
		{ctx}
		of="sequences"
		toolbar={{
			title: false,
			actions: [
				{
					name: t('configuration.outreach'),
					icon: 'lucide:settings-2',
					run: () => {
						settingsOpen = true;
					}
				}
			]
		}}
		order_by={{ name: 'asc' }}
		columns={['name', 'steps']}
	/>
</AppShell>
<Sheet
	open={settingsOpen}
	on_open_change={(open) => (settingsOpen = open)}
	title={t('configuration.outreach')}
>
	{#if settings?.error}<EmptyState title={settings.error.message} />
	{:else if settings?.current !== undefined}{#key outreach?.id ?? 'new'}<RecordShell
				{ctx}
				of="outreach_settings"
				{...outreach === null ? { mode: 'create' as const } : { id: outreach.id }}
				fields={['projects_prompt', 'sender_name', 'apollo_projects_variable']}
				on_done={() => (settingsOpen = false)}
			/>{/key}{/if}
</Sheet>
