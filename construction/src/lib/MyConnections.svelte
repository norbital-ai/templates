<!-- @component Connect personal WhatsApp/email accounts and workspace WhatsApp, Telegram, Slack, Discord, and email channels so site messages automatically funnel into projects. -->
<script lang="ts">
	import { IntegrationSetup, type PageContext } from '@norbital-ai/bolt/page';
	import { Button, Icon, use_act } from '@norbital-ai/ui';
	import { Inline, Stack } from '@norbital-ai/ui/layout';

	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;

	const ICONS = {
		whatsapp: 'simple-icons:whatsapp',
		telegram: 'simple-icons:telegram',
		email: 'lucide:mail',
		slack: 'simple-icons:slack',
		discord: 'simple-icons:discord'
	} as const;

	const PERSONAL = ['whatsapp', 'email'] as const;
	const SHARED = ['whatsapp', 'telegram', 'slack', 'discord', 'email'] as const;

	const me = $derived(ctx.actor?.kind === 'member' ? ctx.actor.id : null);
	const admin = $derived(ctx.actor?.kind === 'member' && ctx.actor.admin);
	const accounts = $derived(
		me === null
			? null
			: ctx.query({
					sys_integration: {
						where: { or: [{ owner: { eq: me } }, { owner: { is_null: true } }] },
						fields: ['name', 'integration', 'owner'],
						order_by: 'name'
					}
				})
	);
	const mine = $derived(
		(accounts?.current?.sys_integration.rows ?? []).filter((row) => row.owner !== null)
	);
	const shared = $derived(
		(accounts?.current?.sys_integration.rows ?? []).filter((row) => row.owner === null)
	);
	const act = use_act(ctx);
	const connect = (
		integration: (typeof PERSONAL)[number] | (typeof SHARED)[number],
		owner: typeof me
	) =>
		act.run(
			ctx.act({
				'sys_integration.create': [
					{ integration, name: t(`connections.kind.${integration}`), owner }
				]
			})
		);
</script>

<Stack gap="md" class="py-3" data-my-connections>
	<p class="text-sm text-muted-foreground">{t('connections.help')}</p>
	<Inline gap="sm" class="flex-wrap">
		{#each PERSONAL as kind (kind)}
			<Button
				variant="outline"
				disabled={me === null || act.pending}
				onclick={() => connect(kind, me)}
			>
				<Icon name={ICONS[kind]} class="size-4" />{t('connections.add')}
				{t(`connections.kind.${kind}`)}
			</Button>
		{/each}
	</Inline>
	{#if accounts?.error}
		<p role="alert" class="text-sm text-destructive">{accounts.error.message}</p>
	{/if}
	{#each mine as account (account.id)}
		<section class="rounded-lg border border-border bg-card p-4" aria-label={account.name}>
			<h3 class="mb-2 text-sm font-medium">{account.name}</h3>
			<IntegrationSetup client={ctx.integration(account.id)} />
		</section>
	{/each}

	<h3 class="pt-2 text-sm font-medium">{t('connections.shared')}</h3>
	<p class="text-sm text-muted-foreground">{t('connections.shared_help')}</p>
	{#if admin}
		<Inline gap="sm" class="flex-wrap">
			{#each SHARED as kind (kind)}
				<Button variant="outline" disabled={act.pending} onclick={() => connect(kind, null)}>
					<Icon name={ICONS[kind]} class="size-4" />{t('connections.add')}
					{t(`connections.kind.${kind}`)}
				</Button>
			{/each}
		</Inline>
	{/if}
	{#each shared as account (account.id)}
		<section class="rounded-lg border border-border bg-card p-4" aria-label={account.name}>
			<h3 class="mb-2 text-sm font-medium">{account.name}</h3>
			<IntegrationSetup client={ctx.integration(account.id)} />
		</section>
	{/each}
</Stack>
