<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Alert, EmptyState, Map, Table } from '@norbital-ai/ui';
	import { AppShell, Split, Stack } from '@norbital-ai/ui/layout';
	import { DateTime } from 'effect';
	import { epochMs, formatInstant } from '../../lib/format.js';

	let { ctx }: { ctx: PageContext } = $props();
	const t = (...args: Parameters<PageContext['t']>) => ctx.t(...args);
	const zone = $derived(ctx.tz);
	const clock = $derived(ctx.clock('minute'));
	const now = $derived(DateTime.makeUnsafe(clock.now));

	const ahead = $derived(
		ctx.query({
			appointments: {
				where: {
					provider: { is_null: false },
					status: { in: ['scheduled', 'in_progress'] },
					slot: {
						overlaps: {
							start: DateTime.formatIso(DateTime.subtract(now, { hours: 6 })),
							end: DateTime.formatIso(DateTime.add(now, { hours: 8 }))
						}
					}
				},
				fields: ['slot', 'status', 'location', 'provider', 'booking'],
				limit: 500,
				provider: { fields: ['name', 'last_location'] },
				booking: { fields: ['customer'], customer: { fields: ['name'] } }
			}
		})
	);
	const soon = $derived(DateTime.formatIso(DateTime.add(now, { hours: 4 })));

	const overlays = $derived.by(() => {
		const next = new globalThis.Map<
			string,
			NonNullable<typeof ahead.current>['appointments']['rows'][number]
		>();
		for (const a of ahead.current?.appointments.rows ?? []) {
			if (a.location === null || a.provider === null) continue;
			if (
				a.status === 'scheduled' &&
				a.slot.end != null &&
				DateTime.isLessThan(DateTime.makeUnsafe(a.slot.end), now)
			)
				continue;
			const held = next.get(a.provider.id);
			const sooner = (row: typeof a) =>
				row.status === 'in_progress' ? 0 : epochMs(row.slot.start);
			if (held === undefined || sooner(a) < sooner(held)) next.set(a.provider.id, a);
		}
		return [...next.values()].flatMap((a) =>
			a.location === null || a.provider === null
				? []
				: [
						{
							lat: a.location.lat,
							lng: a.location.lng,
							text: `${a.provider.name.split(' ')[0]} → ${a.booking?.customer?.name ?? ''} · ${formatInstant(a.slot.start, zone, { hour: 'numeric', minute: '2-digit' }, ctx.locale)}`,
							...(a.provider.last_location === null ? {} : { from: a.provider.last_location })
						}
					]
		);
	});
</script>

{#snippet positions()}
	<Stack size="fill" gap="sm">
		{#if ahead.error}
			<Alert.Root variant="destructive">
				<Alert.Title>{ahead.error.message}</Alert.Title>
			</Alert.Root>
		{/if}
		<Map
			{ctx}
			of="providers"
			at="last_location"
			label="name"
			labels="always"
			{overlays}
			where={{ status: { eq: 'active' }, last_location: { is_null: false } }}
			toolbar={{ title: t('app.schedule.provider_positions'), new: false }}
		/>
	</Stack>
{/snippet}

{#snippet quiet()}
	<EmptyState variant="inset" title={t('app.schedule.nothing_under_way')} />
{/snippet}

{#snippet underWay()}
	<Table
		{ctx}
		empty={quiet}
		of="appointments"
		key="live"
		toolbar={{ title: t('app.schedule.under_way'), new: false }}
		where={{
			or: [
				{ status: { eq: 'in_progress' } },
				{
					status: { eq: 'scheduled' },
					slot: { overlaps: { start: clock.now, end: soon } }
				}
			]
		}}
		order_by={{ number: 'asc' }}
		columns={['number', 'provider', 'booking', 'slot', 'status', 'eta_minutes', 'attention']}
	/>
{/snippet}

<AppShell
	icon="lucide:map-pinned"
	title={t('app.schedule.live_title')}
	description={t('app.schedule.live_description')}
>
	<Split
		size="fill"
		ratio="wide"
		collapse="switch"
		start={underWay}
		end={positions}
		switch_labels={[t('app.schedule.under_way'), t('app.schedule.provider_positions')]}
	/>
</AppShell>
