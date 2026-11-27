<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell, Bound, Inline } from '@norbital-ai/ui/layout';
	import { Alert, RecordShell, Spinner } from '@norbital-ai/ui';

	let { ctx }: { ctx: PageContext } = $props();
	const me = $derived(ctx.actor?.kind === 'member' ? ctx.actor.id : null);
	const ownSettings = $derived(
		me !== null
			? ctx.query({
					communication_settings: {
						where: { owner: { eq: me } },
						limit: 1
					}
				})
			: null
	);
	const settingsReady = $derived(
		ownSettings !== null &&
			!ownSettings.error &&
			(ownSettings.current !== undefined || !ownSettings.loading)
	);
	const settingsRow = $derived(ownSettings?.current?.communication_settings.rows[0] ?? null);
</script>

<AppShell
	icon="lucide:list-filter"
	title={ctx.t('connections.intake_rules_title')}
	description={ctx.t('connections.intake_rules_hint')}
	variant="full"
>
	{#if ownSettings?.loading && !ownSettings.current}
		<Bound size="content" inset>
			<Inline gap="sm" align="center" aria-busy="true">
				<Spinner />
				<span class="text-sm text-muted-foreground">{ctx.t('connections.loading')}</span>
			</Inline>
		</Bound>
	{:else if ownSettings?.error}
		<Bound size="content" inset>
			<Alert.Root variant="destructive">
				<Alert.Title>{ownSettings.error.message}</Alert.Title>
			</Alert.Root>
		</Bound>
	{:else if me !== null && settingsReady}
		{#key settingsRow?.id ?? 'new'}
			<RecordShell
				{ctx}
				of="communication_settings"
				header={false}
				mode={settingsRow ? 'view' : 'create'}
				{...settingsRow ? { id: settingsRow.id } : {}}
				on_done={() => {}}
			/>
		{/key}
	{/if}
</AppShell>
