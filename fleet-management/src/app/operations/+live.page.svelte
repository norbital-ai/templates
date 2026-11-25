<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { EmptyState, Map, Table } from '@norbital-ai/ui';
	import { AppShell, Split } from '@norbital-ai/ui/layout';

	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	const canRefreshEta = $derived(ctx.catalog?.routes?.update !== undefined);
	const canCheckHealth = $derived(ctx.catalog?.vehicles?.update !== undefined);
	const dashboardActions = $derived([
		...(canRefreshEta
			? [
					{
						icon: 'lucide:timer-reset',
						name: t('app.live.action_refresh_eta'),
						description: t('app.live.action_refresh_eta_desc'),
						run: () => ctx.run('refresh_route_eta', {})
					}
				]
			: []),
		...(canCheckHealth
			? [
					{
						icon: 'lucide:heart-pulse',
						name: t('app.live.action_check_health'),
						description: t('app.live.action_check_health_desc'),
						run: () => ctx.run('check_fleet_health', {})
					}
				]
			: [])
	]);

	/** Active routes supply destination pins and glowing trajectory lines from each vehicle's live GPS fix. */
	const activeRoutes = $derived(
		ctx.query({
			routes: {
				where: { status: { in: ['dispatched', 'en_route'] } },
				fields: [
					'route_number',
					'destination_name',
					'destination_location',
					'eta_minutes',
					'status',
					'vehicle_id'
				],
				vehicle_id: {
					fields: ['registration_no', 'last_location', 'current_speed_kmh']
				},
				limit: 200
			}
		})
	);

	const overlays = $derived.by(() => {
		const seen = new Set<string>();
		const lines: Array<{
			readonly lat: number;
			readonly lng: number;
			readonly text: string;
			readonly from?: { readonly lat: number; readonly lng: number };
		}> = [];

		for (const route of activeRoutes.current?.routes.rows ?? []) {
			const vehicle = route.vehicle_id;
			if (!vehicle || seen.has(vehicle.id)) continue;
			seen.add(vehicle.id);
			const etaPart =
				route.eta_minutes != null ? t('app.live.overlay_eta', { minutes: route.eta_minutes }) : '';
			const text = `${vehicle.registration_no} → ${route.destination_name}${etaPart ? ` · ${etaPart}` : ''}`;
			lines.push({
				lat: route.destination_location.lat,
				lng: route.destination_location.lng,
				text,
				...(vehicle.last_location !== null ? { from: vehicle.last_location } : {})
			});
		}
		return lines;
	});
</script>

{#snippet liveMap()}
	{#if activeRoutes.error}
		<EmptyState
			variant="inset"
			tone="danger"
			title={t('app.live.routes_load_error')}
			hint={activeRoutes.error.message}
		/>
	{:else}
		<Map
			{ctx}
			of="vehicles"
			at="last_location"
			label="registration_no"
			status="status"
			badge="current_speed_kmh"
			fields={['vehicle_name', 'driver_id', 'destination_label', 'heading_deg']}
			labels="hover"
			{overlays}
			where={{ last_location: { is_null: false } }}
			toolbar={{ title: t('app.live.map_title'), new: false }}
		/>
	{/if}
{/snippet}

{#snippet noActiveAlerts()}
	<EmptyState variant="inset" title={t('app.live.no_active_alerts')} />
{/snippet}

{#snippet liveAlerts()}
	<Table
		{ctx}
		of="fleet_alerts"
		key="live_alerts"
		empty={noActiveAlerts}
		where={{ status: { in: ['open', 'acknowledged'] } }}
		order_by={{ recorded_at: 'desc' }}
		toolbar={{
			title: t('app.live.alerts_title'),
			new: false,
			...(dashboardActions.length > 0 ? { actions: dashboardActions } : {})
		}}
		columns={['severity', 'alert_type', 'vehicle_id', 'status', 'summary', 'recorded_at']}
	/>
{/snippet}

<AppShell
	icon="lucide:map-pinned"
	title={t('app.operations.page_live')}
	description={t('app.operations.live_description')}
>
	<Split
		size="fill"
		ratio="wide"
		collapse="switch"
		start={liveMap}
		end={liveAlerts}
		switch_labels={[t('app.live.map_title'), t('app.live.alerts_title')]}
	/>
</AppShell>
