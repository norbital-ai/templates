<!-- @component Connect personal WhatsApp/email accounts and workspace WhatsApp, email, and Autodesk ACC integrations. -->
<script lang="ts">
	import { IntegrationSetup, type PageContext } from '@norbital-ai/bolt/page';
	import { Alert, Button, Icon, Spinner, Surface, use_act } from '@norbital-ai/ui';
	import { Cluster, Inline, Stack } from '@norbital-ai/ui/layout';

	let { ctx }: { ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);

	const ICONS = {
		whatsapp: 'simple-icons:whatsapp',
		email: 'lucide:mail',
		autodesk_acc: 'lucide:blocks'
	} as const;

	const PERSONAL = ['whatsapp', 'email'] as const;
	const SHARED = ['whatsapp', 'email', 'autodesk_acc'] as const;

	const me = $derived(ctx.actor?.kind === 'member' ? ctx.actor.id : null);
	const admin = $derived(ctx.actor?.kind === 'member' && ctx.actor.admin);
	const canConnect = $derived(ctx.catalog?.sys_integration?.create !== undefined);
	const accounts = $derived(
		me === null
			? null
			: ctx.query({
					sys_integration: {
						where: { or: [{ owner: { eq: me } }, { owner: { is_null: true } }] },
						fields: ['name', 'integration', 'owner'],
						order_by: 'name',
						limit: 100
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

<Stack gap="md" data-my-connections>
	<p class="text-sm text-muted-foreground">{t('connections.help')}</p>
	{#if canConnect}
		<Cluster gap="sm">
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
		</Cluster>
	{/if}
	{#if accounts?.loading && !accounts.current}
		<Inline gap="sm" align="center" aria-busy="true">
			<Spinner />
			<span class="text-sm text-muted-foreground">{t('connections.loading')}</span>
		</Inline>
	{:else if accounts?.error}
		<Alert.Root variant="destructive">
			<Alert.Title>{accounts.error.message}</Alert.Title>
		</Alert.Root>
	{/if}
	{#each mine as account (account.id)}
		<Surface as="section" tone="card" padding="md" radius="control" aria-label={account.name}>
			<Stack gap="sm">
				<h3 class="text-heading">{account.name}</h3>
				<IntegrationSetup client={ctx.integration(account.id)} />
			</Stack>
		</Surface>
	{/each}

	{#if (admin && canConnect) || shared.length > 0}
		<Stack gap="sm">
			<h3 class="text-overline">{t('connections.shared')}</h3>
			<p class="text-sm text-muted-foreground">{t('connections.shared_help')}</p>
		</Stack>
		{#if admin && canConnect}
			<Cluster gap="sm">
				{#each SHARED as kind (kind)}
					<Button variant="outline" disabled={act.pending} onclick={() => connect(kind, null)}>
						<Icon name={ICONS[kind]} class="size-4" />{t('connections.add')}
						{t(`connections.kind.${kind}`)}
					</Button>
				{/each}
			</Cluster>
		{/if}
		{#each shared as account (account.id)}
			<Surface as="section" tone="card" padding="md" radius="control" aria-label={account.name}>
				<Stack gap="sm">
					<h3 class="text-heading">{account.name}</h3>
					<IntegrationSetup client={ctx.integration(account.id)} />
				</Stack>
			</Surface>
		{/each}
	{/if}
</Stack>
