<script lang="ts">
	/**
	 * Where every helper is: the last position their app reported, named on the map, with a dashed line to where they go
	 * next (the visit under way, else their next one in the coming hours); and those visits as a list with the ETA the
	 * watch last estimated. Both refresh as helpers report.
	 */
	import { bolt } from '$bolt';
	import { Instant } from '@norbital-ai/std/date';
	import { AppShell, Split } from '@norbital-ai/ui/layout';
	import { EmptyState, Map, Table } from '@norbital-ai/ui';
	import { live } from '../../../lib/live.svelte.js';

	const t = bolt.t;
	const HOUR = 3_600_000;
	const time = (i: string) =>
		new Intl.DateTimeFormat(bolt.locale, { hour: 'numeric', minute: '2-digit' }).format(
			new Date(i)
		);
	const ahead = live(
		() =>
			bolt.read('visits', {
				where: {
					helper: { isNull: false },
					status: { in: ['scheduled', 'in_progress'] },
					slot: {
						overlaps: {
							start: Instant(new Date(Date.now() - 6 * HOUR).toISOString()),
							end: Instant(new Date(Date.now() + 8 * HOUR).toISOString())
						}
					}
				},
				select: {
					slot: true,
					status: true,
					location: true,
					helper: { select: { name: true, last_location: true } },
					booking: { select: { customer: { select: { name: true } } } }
				},
				all: true
			}),
		['visits', 'helpers']
	);
	/** Each helper's next stop: the visit under way, else the earliest still to start. */
	const overlays = $derived.by(() => {
		const next = new globalThis.Map<string, NonNullable<typeof ahead.current>['rows'][number]>();
		for (const v of ahead.current?.rows ?? []) {
			if (v.location === null || v.helper === null) continue;
			if (v.status === 'scheduled' && Date.parse(v.slot.end!) < Date.now()) continue;
			const held = next.get(v.helper.id);
			const sooner = (a: typeof v) => (a.status === 'in_progress' ? 0 : Date.parse(a.slot.start));
			if (held === undefined || sooner(v) < sooner(held)) next.set(v.helper.id, v);
		}
		return [...next.values()].map((v) => ({
			lat: v.location!.lat,
			lng: v.location!.lng,
			text: `${v.helper!.name.split(' ')[0]} → ${v.booking.customer.name} · ${time(v.slot.start)}`,
			...(v.helper!.last_location === null ? {} : { from: v.helper!.last_location })
		}));
	});
</script>

{#snippet positions()}
	<Map
		of="helpers"
		at="last_location"
		label="name"
		labels="always"
		{overlays}
		where={{ status: { eq: 'active' }, last_location: { isNull: false } }}
		toolbar={{ title: t('app.schedule.helper_positions'), new: false }}
	/>
{/snippet}
{#snippet quiet()}
	<EmptyState variant="inset" title={t('app.schedule.nothing_under_way')} />
{/snippet}
{#snippet underWay()}
	<Table
		empty={quiet}
		of="visits"
		key="live"
		every="1min"
		toolbar={{ title: t('app.schedule.under_way'), new: false }}
		where={{
			or: [
				{ status: { eq: 'in_progress' } },
				// under way, or starting within four hours — a window that moves with the clock
				{
					status: { eq: 'scheduled' },
					slot: { overlaps: { start: { now: '' }, end: { now: '+4h' } } }
				}
			]
		}}
		orderBy={{ number: 'asc' }}
		columns={['number', 'helper', 'booking', 'slot', 'status', 'eta_minutes', 'attention']}
	/>
{/snippet}

<AppShell
	icon="lucide:map-pinned"
	title={t('app.schedule.live_title')}
	description={t('app.schedule.live_description')}
	variant="full"
>
	<Split
		fill
		start={positions}
		end={underWay}
		switchLabels={[t('app.schedule.helper_positions'), t('app.schedule.under_way')]}
	/>
</AppShell>
