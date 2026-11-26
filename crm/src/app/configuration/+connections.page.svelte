<script lang="ts">
	import { Connections, type PageContext } from '@norbital-ai/bolt/page';
	import { AppShell, Cluster, Scroll } from '@norbital-ai/ui/layout';
	import { Button, EmptyState, Icon, RecordShell, Sheet, Table } from '@norbital-ai/ui';

	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	const me = $derived(ctx.actor?.kind === 'member' ? ctx.actor.id : null);
	const labels = $derived({
		whatsapp: {
			name: t('connections.kind.whatsapp'),
			description: t('connections.desc.whatsapp'),
			icon: 'simple-icons:whatsapp'
		},
		email: {
			name: t('connections.kind.email'),
			description: t('connections.desc.email'),
			icon: 'lucide:mail'
		},
		google_calendar: {
			name: t('connections.kind.google_calendar'),
			description: t('connections.desc.google_calendar'),
			icon: 'logos:google-calendar'
		}
	});

	let rulesOpen = $state(false);
	let logsOpen = $state(false);
	const intake = $derived(
		rulesOpen && me !== null
			? ctx.query({ communication_settings: { where: { owner: { eq: me } }, limit: 1 } })
			: null
	);
	const ruleset = $derived(intake?.current?.communication_settings.rows[0] ?? null);
</script>

{#snippet headerActions()}
	{#if me !== null}
		<Cluster gap="xs">
			<Button variant="outline" onclick={() => (rulesOpen = true)}>
				<Icon name="lucide:filter" class="size-4" />{t('configuration.rules')}
			</Button>
			<Button variant="outline" onclick={() => (logsOpen = true)}>
				<Icon name="lucide:messages-square" class="size-4" />{t('configuration.logs')}
			</Button>
		</Cluster>
	{/if}
{/snippet}

<AppShell
	icon="lucide:plug"
	title={t('connections.title')}
	description={t('connections.description')}
	actions={headerActions}
	variant="full"
>
	<Scroll name={t('connections.title')} size="fill" inset>
		<Connections {ctx} scope="personal" {labels}>
			{#snippet manage({ integration, close })}
				{#if me !== null && (integration === 'whatsapp' || integration === 'email')}
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div class="min-w-0">
							<p class="text-sm font-medium text-foreground">{t('configuration.rules')}</p>
							<p class="text-meta">{t('crm.accounts.rules_help')}</p>
						</div>
						<Button
							variant="outline"
							onclick={() => {
								close();
								rulesOpen = true;
							}}
						>
							<Icon name="lucide:filter" class="size-4" />{t('connections.open_rules')}
						</Button>
					</div>
				{/if}
			{/snippet}
		</Connections>
	</Scroll>
</AppShell>

<Sheet
	open={rulesOpen}
	on_open_change={(open) => (rulesOpen = open)}
	title={t('configuration.rules')}
	memory="crm-message-rules"
>
	{#if intake?.error}
		<EmptyState title={intake.error.message} />
	{:else if intake?.current !== undefined}
		{#key ruleset?.id ?? 'new'}
			<RecordShell
				{ctx}
				of="communication_settings"
				header={false}
				{...ruleset === null ? { mode: 'create' as const } : { id: ruleset.id }}
				fields={['hard_filter', 'classification_sop']}
				on_done={() => (rulesOpen = false)}
			/>
		{/key}
	{/if}
</Sheet>

<Sheet
	open={logsOpen}
	on_open_change={(open) => (logsOpen = open)}
	title={t('configuration.logs')}
	memory="crm-classified-messages"
>
	{#if logsOpen && me !== null}
		<Table
			{ctx}
			of="activities"
			toolbar={{ title: false, new: false }}
			where={{ kind: { eq: 'message' }, source_user: { eq: me } }}
			order_by={{ occurred_at: 'desc' }}
			columns={['subject', 'transport', 'company', 'occurred_at', 'classification', 'reason']}
		/>
	{/if}
</Sheet>
