<script lang="ts">
	import { Connections, type PageContext } from '@norbital-ai/bolt/page';
	import { AppShell, Inline, Scroll } from '@norbital-ai/ui/layout';
	import { Alert, Button, Icon, RecordShell, Sheet, Spinner } from '@norbital-ai/ui';

	let { ctx }: { ctx: PageContext } = $props();
	const me = $derived(ctx.actor?.kind === 'member' ? ctx.actor.id : null);
	let intakeOpen = $state(false);
	const labels = $derived({
		whatsapp: {
			name: ctx.t('connections.kind.whatsapp'),
			description: ctx.t('connections.desc.whatsapp'),
			icon: 'simple-icons:whatsapp'
		},
		email: {
			name: ctx.t('connections.kind.email'),
			description: ctx.t('connections.desc.email'),
			icon: 'lucide:mail'
		}
	});
	const ownSettings = $derived(
		intakeOpen && me !== null
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

{#snippet headerActions()}
	{#if me !== null}
		<Button variant="outline" onclick={() => (intakeOpen = true)}>
			<Icon name="lucide:list-filter" class="size-4" />{ctx.t('connections.intake_rules_title')}
		</Button>
	{/if}
{/snippet}

<AppShell
	icon="lucide:plug"
	title={ctx.t('connections.title')}
	description={ctx.t('connections.description')}
	actions={headerActions}
	variant="full"
>
	<Scroll name={ctx.t('connections.title')} size="fill" inset>
		<Connections {ctx} scope="personal" {labels}>
			{#snippet manage({ close })}
				{#if me !== null}
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div class="min-w-0">
							<p class="text-sm font-medium text-foreground">
								{ctx.t('connections.intake_rules_title')}
							</p>
							<p class="text-meta">{ctx.t('connections.intake_rules_hint')}</p>
						</div>
						<Button
							variant="outline"
							onclick={() => {
								close();
								intakeOpen = true;
							}}
						>
							<Icon name="lucide:list-filter" class="size-4" />{ctx.t(
								'connections.open_intake_rules'
							)}
						</Button>
					</div>
				{/if}
			{/snippet}
		</Connections>
	</Scroll>
</AppShell>

<Sheet
	open={intakeOpen}
	on_open_change={(open) => (intakeOpen = open)}
	title={ctx.t('connections.intake_rules_title')}
	memory="construction-intake-settings"
>
	{#if ownSettings?.loading && !ownSettings.current}
		<Inline gap="sm" align="center" aria-busy="true">
			<Spinner />
			<span class="text-sm text-muted-foreground">{ctx.t('connections.loading')}</span>
		</Inline>
	{:else if ownSettings?.error}
		<Alert.Root variant="destructive">
			<Alert.Title>{ownSettings.error.message}</Alert.Title>
		</Alert.Root>
	{:else if me !== null && settingsReady}
		{#key settingsRow?.id ?? 'new'}
			<RecordShell
				{ctx}
				of="communication_settings"
				header={false}
				mode={settingsRow ? 'view' : 'create'}
				{...settingsRow ? { id: settingsRow.id } : {}}
				on_done={() => (intakeOpen = false)}
			/>
		{/key}
	{/if}
</Sheet>
