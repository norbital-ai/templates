<script lang="ts">
	import { IntegrationSetup, type PageContext } from '@norbital-ai/bolt/page';
	import { Alert, Button, EmptyState, Icon, Spinner, use_act } from '@norbital-ai/ui';
	import { AppShell, Cluster, Inline, Scroll, Stack, Surface } from '@norbital-ai/ui/layout';

	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;

	const KINDS = ['gps_transponder', 'google_routes'] as const;
	const ICONS = {
		gps_transponder: 'lucide:radio',
		google_routes: 'lucide:map'
	} as const;

	const canRead = $derived(ctx.catalog?.sys_integration !== undefined);
	const canCreate = $derived(ctx.catalog?.sys_integration?.create !== undefined);
	const accounts = $derived(
		canRead
			? ctx.query({
					sys_integration: {
						where: {
							owner: { is_null: true },
							integration: { in: [...KINDS] }
						},
						fields: ['name', 'integration', 'owner'],
						order_by: { name: 'asc' },
						limit: 50
					}
				})
			: null
	);
	const rows = $derived(accounts?.current?.sys_integration.rows ?? []);
	const act = use_act(ctx);

	const connect = (kind: (typeof KINDS)[number]) =>
		act.run(
			ctx.act({
				'sys_integration.create': [
					{ integration: kind, name: t(`connections.kind.${kind}`), owner: null }
				]
			})
		);
</script>

<AppShell
	icon="lucide:plug"
	title={t('app.configuration.page_connections')}
	description={t('app.configuration.connections_description')}
	variant="full"
>
	<Scroll name={t('app.configuration.page_connections')} size="fill" inset>
		<Stack gap="md">
			<p class="text-sm text-muted-foreground">{t('connections.help')}</p>
			{#if canCreate}
				<Cluster gap="sm">
					{#each KINDS as kind (kind)}
						<Button variant="outline" disabled={act.pending} onclick={() => connect(kind)}>
							<Icon name={ICONS[kind]} class="size-4" />
							{t('connections.add')}
							{t(`connections.kind.${kind}`)}
						</Button>
					{/each}
				</Cluster>
			{/if}

			{#if accounts === null}
				<EmptyState
					variant="inset"
					title={t('connections.empty_title')}
					hint={t('connections.empty_description')}
				/>
			{:else if accounts.loading && accounts.current === undefined}
				<Surface tone="subtle" padding="md" radius="control" aria-busy="true">
					<Inline gap="sm" align="center">
						<Spinner />
						<span class="text-sm text-muted-foreground">{t('connections.loading')}</span>
					</Inline>
				</Surface>
			{:else if accounts.error}
				<Alert.Root variant="destructive">
					<Alert.Title>{accounts.error.message}</Alert.Title>
				</Alert.Root>
			{:else if rows.length === 0}
				<EmptyState
					variant="inset"
					title={t('connections.empty_title')}
					hint={t('connections.empty_description')}
				/>
			{:else}
				{#each rows as account (account.id)}
					<Surface as="section" tone="card" padding="md" radius="control" aria-label={account.name}>
						<Stack gap="sm">
							<h3 class="text-heading">{account.name}</h3>
							<IntegrationSetup client={ctx.integration(account.id)} />
						</Stack>
					</Surface>
				{/each}
			{/if}
		</Stack>
	</Scroll>
</AppShell>
