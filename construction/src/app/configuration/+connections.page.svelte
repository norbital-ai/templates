<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell, Scroll } from '@norbital-ai/ui/layout';
	import { RecordShell, Tabs } from '@norbital-ai/ui';
	import MyConnections from '../../lib/MyConnections.svelte';

	let { ctx }: { ctx: PageContext } = $props();
	const me = $derived(ctx.actor?.kind === 'member' ? ctx.actor.id : null);
	const ownSettings = $derived(
		me === null
			? null
			: ctx.query({
					communication_settings: {
						where: { owner: { eq: me } },
						limit: 1
					}
				})
	);
	const settingsReady = $derived(ownSettings !== null && !ownSettings.loading);
	const settingsRow = $derived(ownSettings?.current?.communication_settings.rows[0] ?? null);
</script>

{#snippet channelsTab()}
	<Scroll name={ctx.t('connections.tab_channels')} size="fill" inset>
		<MyConnections {ctx} />
	</Scroll>
{/snippet}

{#snippet intakeTab()}
	{#if me !== null && settingsReady}
		<RecordShell
			{ctx}
			of="communication_settings"
			header={false}
			mode={settingsRow ? 'view' : 'create'}
			{...settingsRow ? { id: settingsRow.id } : {}}
		/>
	{/if}
{/snippet}

<AppShell
	icon="lucide:plug"
	title={ctx.t('connections.title')}
	description={ctx.t('connections.description')}
	variant="full"
>
	<Tabs
		tabs={[
			{
				name: 'channels',
				title: ctx.t('connections.tab_channels'),
				icon: 'lucide:plug',
				body: channelsTab
			},
			...(me !== null
				? [
						{
							name: 'intake',
							title: ctx.t('connections.intake_rules_title'),
							icon: 'lucide:list-filter',
							keep_alive: true as const,
							body: intakeTab
						}
					]
				: [])
		]}
	/>
</AppShell>
