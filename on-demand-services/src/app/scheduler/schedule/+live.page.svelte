<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	let { ctx }: { ctx: PageContext } = $props();
	import { EmptyState, Map, Table } from '@norbital-ai/ui';
	/**
	 * Where every helper is: the last position their app reported, named on the map, with a dashed line to where they go
	 * next (the visit under way, else their next one in the coming hours); and those visits as a list with the ETA the
	 * watch last estimated. Both refresh as helpers report.
	 */
	import { Instant } from '@norbital-ai/std/date';
	import { AppShell, Split } from '@norbital-ai/ui/layout';
	const zone = ctx.tz;
	const t = ctx.t;
	const HOUR = 3600000;
	const time = (i: string) =>
		new Intl.DateTimeFormat(ctx.locale, {
			timeZone: zone,
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(i));
	/** The under-way window moves with the clock, minute by minute. */
	const clock = ctx.clock('minute');
	const now = $derived(Date.parse(clock.now));
	const ahead = $derived(
		ctx.query({
			visits: {
				where: {
					helper: { is_null: false },
					status: { in: ['scheduled', 'in_progress'] },
					slot: {
						overlaps: {
							start: Instant(new Date(now - 6 * HOUR).toISOString()),
							end: Instant(new Date(now + 8 * HOUR).toISOString())
						}
					}
				},
				fields: ['slot', 'status', 'location', 'helper', 'booking'],
				helper: { fields: ['name', 'last_location'] },
				booking: { fields: ['customer'], customer: { fields: ['name'] } }
			}
		})
	);
	const soon = $derived(Instant(new Date(now + 4 * HOUR).toISOString()));
	/** Each helper's next stop: the visit under way, else the earliest still to start. */
	const overlays = $derived.by(() => {
		const next = new globalThis.Map<
			string,
			NonNullable<typeof ahead.current>['visits']['rows'][number]
		>();
		for (const v of ahead.current?.visits.rows ?? []) {
			if (v.location === null || v.helper === null) continue;
			if (v.status === 'scheduled' && Date.parse(v.slot.end!) < now) continue;
			const held = next.get(v.helper.id);
			const sooner = (a: typeof v) => (a.status === 'in_progress' ? 0 : Date.parse(a.slot.start));
			if (held === undefined || sooner(v) < sooner(held)) next.set(v.helper.id, v);
		}
		return [...next.values()].map((v) => ({
			lat: v.location!.lat,
			lng: v.location!.lng,
			text: `${v.helper!.name.split(' ')[0]} → ${v.booking?.customer?.name ?? ''} · ${time(v.slot.start)}`,
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
		where={{ status: { eq: 'active' }, last_location: { is_null: false } }}
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
		toolbar={{ title: t('app.schedule.under_way'), new: false }}
		where={{
			or: [
				{ status: { eq: 'in_progress' } },
				// under way, or starting within four hours — a window that moves with the clock
				{
					status: { eq: 'scheduled' },
					slot: { overlaps: { start: clock.now, end: soon } }
				}
			]
		}}
		order_by={{ number: 'asc' }}
		columns={['number', 'helper', 'booking', 'slot', 'status', 'eta_minutes', 'attention']}
	/>
{/snippet}

<AppShell
	icon="lucide:map-pinned"
	title={t('app.schedule.live_title')}
	description={t('app.schedule.live_description')}
	variant="full"
>
	<!-- the visits under way are the work: they take the wide pane, the map rides beside them -->
	<Split
		size="fill"
		ratio="wide"
		start={underWay}
		end={positions}
		switch_labels={[t('app.schedule.under_way'), t('app.schedule.helper_positions')]}
	/>
</AppShell>
