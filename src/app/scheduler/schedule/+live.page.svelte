<script lang="ts">
	/**
	 * Where every helper is: the last position their app reported, on the map, and the visits under way or starting
	 * soon with the ETA the watch last estimated. Both refresh as helpers report.
	 */
	import { bolt } from '$bolt';
	import { AppShell, Split } from '@norbital-ai/ui/layout';
	import { Map, Table } from '@norbital-ai/ui';

	const t = bolt.t;
</script>

{#snippet positions()}
	<Map
		of="helpers"
		at="last_location"
		label="name"
		where={{ status: { eq: 'active' }, last_location: { isNull: false } }}
		toolbar={{ title: t('app.schedule.helper_positions'), new: false }}
	/>
{/snippet}
{#snippet quiet()}
	<p class="text-sm text-muted-foreground">{t('app.schedule.nothing_under_way')}</p>
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
		columns={['number', 'helper', 'slot', 'status', 'eta_minutes', 'attention']}
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
