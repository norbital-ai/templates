<script lang="ts">
	/** Who gets the daily report, and which connected envoy channel delivers it. */
	import { Effect, Predicate } from 'effect';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Combobox, Table, toast } from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { AppShell, Cover, Inline, Stack } from '@norbital-ai/ui/layout';

	let { ctx }: { ctx: PageContext } = $props();

	const CHAT_DRIVERS = new Set(['whatsapp', 'telegram', 'slack', 'discord']);
	const isConnected = (status: unknown): boolean =>
		Predicate.isObject(status) && status['state'] === 'connected';

	const overview = ctx.query({
		portfolio_settings: {
			fields: ['base_currency', 'report_channel', 'revision'],
			limit: 1
		},
		sys_envoy: {
			where: { active: { eq: true } },
			fields: ['name'],
			limit: 100
		},
		sys_envoy_channel: {
			where: { active: { eq: true } },
			fields: ['envoy', 'integration'],
			limit: 100
		},
		sys_integration: {
			where: { active: { eq: true }, owner: { is_null: true } },
			fields: ['name', 'integration', 'status'],
			limit: 100
		}
	});

	const settingsRow = $derived(overview.current?.portfolio_settings.rows[0] ?? null);
	const selectedId = $derived(settingsRow?.report_channel ?? null);

	const channels = $derived.by(() => {
		const data = overview.current;
		if (data === undefined) return [];
		const envoyById = new Map(data.sys_envoy.rows.map((e) => [e.id, e.name]));
		const envoysByChannel = new Map<string, string[]>();
		for (const ec of data.sys_envoy_channel.rows) {
			const name = envoyById.get(ec.envoy);
			if (name === undefined) continue;
			const list = envoysByChannel.get(ec.integration) ?? [];
			list.push(name);
			envoysByChannel.set(ec.integration, list);
		}
		return data.sys_integration.rows
			.filter(
				(one) =>
					CHAT_DRIVERS.has(one.integration) &&
					(envoysByChannel.has(one.id) || one.id === selectedId)
			)
			.map((one) => ({
				id: one.id,
				name: one.name,
				integration: one.integration,
				connected: isConnected(one.status),
				envoys: envoysByChannel.get(one.id) ?? []
			}));
	});

	const connectedChannels = $derived(channels.filter((c) => c.connected));
	const selectedChannel = $derived(
		selectedId === null ? null : (channels.find((c) => c.id === selectedId) ?? null)
	);

	let saving = $state(false);
	const saveChannel = (next: string | null) => {
		if (saving) return;
		const channelId =
			next === null || next === '__auto__'
				? null
				: (channels.find((c) => c.id === next)?.id ?? null);
		if (channelId === selectedId) return;
		saving = true;
		const write: Effect.Effect<void, { readonly message: string }> =
			settingsRow !== null
				? ctx
						.act({
							'portfolio_settings.update': [
								{
									target: { id: settingsRow.id, revision: settingsRow.revision },
									set: { report_channel: channelId }
								}
							]
						})
						.pipe(Effect.asVoid)
				: ctx
						.act({
							'portfolio_settings.create': [
								{
									base_currency: 'USD',
									report_channel: channelId
								}
							]
						})
						.pipe(Effect.asVoid);
		fork(
			write.pipe(
				Effect.tap(() =>
					Effect.sync(() => toast.success(ctx.t('component.subscribers.channel_saved')))
				),
				Effect.catch((cause) => Effect.sync(() => toast.error(cause.message))),
				Effect.ensuring(
					Effect.sync(() => {
						saving = false;
					})
				)
			)
		);
	};

	const channelOptions = $derived([
		{
			value: '__auto__',
			label: ctx.t('component.subscribers.channel_auto')
		},
		...channels.map((one) => ({
			value: one.id,
			label: `${one.name} (${one.integration})`,
			description: [
				one.connected
					? ctx.t('component.subscribers.connected')
					: ctx.t('component.subscribers.not_connected'),
				...(one.envoys.length > 0 ? [one.envoys.join(', ')] : [])
			].join(' · ')
		}))
	]);

	const statusNote = $derived.by((): { tone: 'meta' | 'warning'; text: string } => {
		if (selectedChannel !== null) {
			return selectedChannel.connected
				? {
						tone: 'meta',
						text: ctx.t('component.subscribers.sent_through', {
							accounts: `${selectedChannel.name} (${selectedChannel.integration})`
						})
					}
				: {
						tone: 'warning',
						text: ctx.t('component.subscribers.selected_unpaired', {
							channel: `${selectedChannel.name} (${selectedChannel.integration})`
						})
					};
		}
		const [sole] = connectedChannels;
		if (connectedChannels.length === 1 && sole !== undefined) {
			return {
				tone: 'meta',
				text: ctx.t('component.subscribers.auto_single', {
					channel: `${sole.name} (${sole.integration})`
				})
			};
		}
		if (connectedChannels.length > 1) {
			return {
				tone: 'warning',
				text: ctx.t('component.subscribers.multiple_envoys', {
					count: String(connectedChannels.length)
				})
			};
		}
		if (channels.length > 0) {
			return {
				tone: 'warning',
				text: ctx.t('component.subscribers.unpaired_envoy')
			};
		}
		return {
			tone: 'meta',
			text: ctx.t('component.subscribers.no_envoy')
		};
	});
</script>

{#snippet deliveryBar()}
	<Stack gap="xs" class="rounded-control border border-border bg-card p-3.5">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="min-w-0">
				<p class="text-sm font-medium text-foreground">
					{ctx.t('component.subscribers.delivery_channel')}
				</p>
				<p class={statusNote.tone === 'warning' ? 'text-xs text-warning' : 'text-meta'}>
					{statusNote.text}
				</p>
			</div>
			{#if channels.length > 0}
				<Inline gap="xs" align="center" class="w-full sm:w-72">
					<Combobox
						aria-label={ctx.t('component.subscribers.delivery_channel')}
						disabled={saving}
						options={channelOptions}
						value={selectedId ?? '__auto__'}
						on_change={(value) => saveChannel(value)}
					/>
				</Inline>
			{/if}
		</div>
	</Stack>
{/snippet}

<AppShell
	title={ctx.t('component.subscribers.title')}
	description={ctx.t('component.subscribers.description')}
	icon="lucide:bell"
>
	<Cover size="fill" gap="md" {...overview.current !== undefined ? { top: deliveryBar } : {}}>
		<Table
			{ctx}
			of="report_subscription"
			columns={['user']}
			toolbar={{ title: ctx.t('component.subscribers.title'), new: true }}
		/>
	</Cover>
</AppShell>
