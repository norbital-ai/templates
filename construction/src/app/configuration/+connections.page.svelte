<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell, Inline, Scroll } from '@norbital-ai/ui/layout';
	import { Alert, RecordShell, Spinner, Tabs } from '@norbital-ai/ui';
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
	const settingsReady = $derived(
		ownSettings !== null &&
			!ownSettings.error &&
			(ownSettings.current !== undefined || !ownSettings.loading)
	);
	const settingsRow = $derived(ownSettings?.current?.communication_settings.rows[0] ?? null);
</script>

{#snippet channelsTab()}
	<Scroll name={ctx.t('connections.tab_channels')} size="fill" inset>
		<MyConnections {ctx} />
	</Scroll>
{/snippet}

{#snippet intakeTab()}
	{#if ownSettings?.loading && !ownSettings.current}
		<Scroll name={ctx.t('connections.intake_rules_title')} size="fill" inset>
			<Inline gap="sm" align="center" aria-busy="true">
				<Spinner />
				<span class="text-sm text-muted-foreground">{ctx.t('connections.loading')}</span>
			</Inline>
		</Scroll>
	{:else if ownSettings?.error}
		<Scroll name={ctx.t('connections.intake_rules_title')} size="fill" inset>
			<Alert.Root variant="destructive">
				<Alert.Title>{ownSettings.error.message}</Alert.Title>
			</Alert.Root>
		</Scroll>
	{:else if me !== null && settingsReady}
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
