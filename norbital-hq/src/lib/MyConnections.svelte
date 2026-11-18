<!-- @component The signed-in member's own calendar, email and WhatsApp accounts, and the workspace's shared channels and Apollo account: connect one, then pair and manage it natively. -->
<script lang="ts">
	import { IntegrationSetup, type PageContext } from '@norbital-ai/bolt/page';
	import { Button, Icon, use_act } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	/** The personal definitions the sales policy admits: a member's own accounts, synced, never sending. */
	const ICONS = {
		whatsapp: 'simple-icons:whatsapp',
		email: 'lucide:mail',
		google_calendar: 'logos:google-calendar',
		telegram: 'simple-icons:telegram',
		slack: 'simple-icons:slack',
		discord: 'simple-icons:discord',
		apollo: 'lucide:orbit'
	} as const;
	const PERSONAL = ['whatsapp', 'email', 'google_calendar'] as const;
	/**
	 * The workspace's own accounts (no owner): the channels its envoy answers and reminders reach members by direct
	 * message on, whose customer messages are filed too, and the Apollo account leads come from. Administrators make them.
	 */
	const SHARED = ['whatsapp', 'telegram', 'slack', 'discord', 'email', 'apollo'] as const;
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
	<div class="flex flex-wrap gap-2">
		{#each PERSONAL as kind (kind)}
			<Button
				variant="outline"
				disabled={me === null || act.pending}
				onclick={() => connect(kind, me)}
				><Icon name={ICONS[kind]} class="size-4" />{t('connections.add')}
				{t(`connections.kind.${kind}`)}</Button
			>
		{/each}
	</div>
	{#if accounts?.error}<p role="alert" class="text-sm text-destructive">
			{accounts.error.message}
		</p>{/if}
	{#each mine as account (account.id)}
		<section class="rounded-lg border p-4" aria-label={account.name}>
			<h3 class="mb-2 text-sm font-medium">{account.name}</h3>
			<IntegrationSetup client={ctx.integration(account.id)} />
		</section>
	{/each}

	<h3 class="text-sm font-medium">{t('connections.shared')}</h3>
	<p class="text-sm text-muted-foreground">{t('connections.shared_help')}</p>
	{#if admin}
		<div class="flex flex-wrap gap-2">
			{#each SHARED as kind (kind)}
				<Button variant="outline" onclick={() => connect(kind, null)}
					><Icon name={ICONS[kind]} class="size-4" />{t('connections.add')}
					{t(`connections.kind.${kind}`)}</Button
				>
			{/each}
		</div>
	{/if}
	{#each shared as account (account.id)}
		<section class="rounded-lg border p-4" aria-label={account.name}>
			<h3 class="mb-2 text-sm font-medium">{account.name}</h3>
			<IntegrationSetup client={ctx.integration(account.id)} />
		</section>
	{/each}
</Stack>
