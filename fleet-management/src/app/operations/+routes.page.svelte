<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Alert,
		Badge,
		Button,
		EmptyState,
		Icon,
		RecordShell,
		Sheet,
		Spinner,
		Surface,
		Table,
		Tabs,
		enum_text,
		open_record
	} from '@norbital-ai/ui';
	import { AppShell, Cluster, Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { DateTime, Option } from 'effect';

	let { ctx }: { ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const rawT = (key: string): string => {
		const words: { t(k: string): string } = ctx;
		return words.t(key);
	};

	const clockDay = ctx.clock('day');
	const canCreate = $derived(ctx.catalog?.routes?.create !== undefined);
	const canRefreshEta = $derived(ctx.catalog?.routes?.update !== undefined);

	const routesQuery = $derived(
		ctx.query({
			routes: {
				fields: [
					'route_number',
					'title',
					'status',
					'origin_name',
					'destination_name',
					'waypoints',
					'planned_departure',
					'planned_arrival',
					'actual_departure',
					'actual_arrival',
					'planned_distance_km',
					'eta_minutes',
					'cargo_notes',
					'vehicle_id',
					'driver_id'
				],
				vehicle_id: { fields: ['registration_no', 'vehicle_name', 'status'] },
				driver_id: { fields: ['employee_code', 'full_name'] },
				order_by: { planned_departure: 'asc' },
				limit: 400
			}
		})
	);

	function isoDayOf(instant: string | null | undefined): string {
		if (!instant) return '';
		return instant.slice(0, 10);
	}

	function shiftDay(iso: string, delta: number): string {
		const parsed = DateTime.make(`${iso}T00:00:00Z`);
		if (Option.isNone(parsed)) return iso;
		return DateTime.formatIsoDateUtc(DateTime.add(parsed.value, { days: delta }));
	}

	const dayFormatter = $derived(
		new Intl.DateTimeFormat(ctx.locale, {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		})
	);

	const chipDayFormatter = $derived(
		new Intl.DateTimeFormat(ctx.locale, {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			timeZone: 'UTC'
		})
	);

	const timeFormatter = $derived(
		new Intl.DateTimeFormat(ctx.locale, {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
			timeZone: 'UTC'
		})
	);

	function formatDayHeading(iso: string): string {
		const parsed = DateTime.make(`${iso}T00:00:00Z`);
		if (Option.isNone(parsed)) return iso;
		return dayFormatter.format(DateTime.toEpochMillis(parsed.value));
	}

	function formatDayChip(iso: string): string {
		const parsed = DateTime.make(`${iso}T00:00:00Z`);
		if (Option.isNone(parsed)) return iso;
		return chipDayFormatter.format(DateTime.toEpochMillis(parsed.value));
	}

	function formatTime(instant: string | null | undefined): string {
		if (!instant) return '—';
		const parsed = DateTime.make(instant);
		if (Option.isNone(parsed)) return instant.slice(11, 16) || '—';
		return timeFormatter.format(DateTime.toEpochMillis(parsed.value));
	}

	const allRoutes = $derived(routesQuery.current?.routes.rows ?? []);

	const scheduledDays = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const r of allRoutes) {
			const d = isoDayOf(r.planned_departure);
			if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
		}
		return [...counts.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([day, count]) => ({ day, count }));
	});

	let chosenDay = $state<string | null>(null);
	const defaultDay = $derived.by(() => {
		if (scheduledDays.some((d) => d.day === clockDay.today)) return clockDay.today;
		const activeRoute = allRoutes.find(
			(r) => r.status === 'en_route' || r.status === 'dispatched' || r.status === 'planned'
		);
		if (activeRoute) return isoDayOf(activeRoute.planned_departure) || clockDay.today;
		return scheduledDays[scheduledDays.length - 1]?.day ?? clockDay.today;
	});
	const activeDay = $derived(chosenDay ?? defaultDay);

	const dayRoutes = $derived(
		allRoutes
			.filter((r) => isoDayOf(r.planned_departure) === activeDay)
			.sort((a, b) => a.planned_departure.localeCompare(b.planned_departure))
	);

	const dayStats = $derived.by(() => {
		let enRoute = 0;
		let planned = 0;
		let completed = 0;
		let totalKm = 0;
		for (const r of dayRoutes) {
			if (r.status === 'en_route' || r.status === 'dispatched') enRoute++;
			else if (r.status === 'planned') planned++;
			else if (r.status === 'arrived' || r.status === 'completed') completed++;
			const km = Number(r.planned_distance_km);
			if (Number.isFinite(km)) totalKm += km;
		}
		return {
			total: dayRoutes.length,
			enRoute,
			planned,
			completed,
			totalKm: Math.round(totalKm * 10) / 10
		};
	});

	let createOpen = $state(false);

	function statusTone(status: string): 'info' | 'success' | 'warning' | 'destructive' | 'outline' {
		switch (status) {
			case 'en_route':
				return 'info';
			case 'dispatched':
				return 'warning';
			case 'arrived':
			case 'completed':
				return 'success';
			case 'cancelled':
				return 'destructive';
			default:
				return 'outline';
		}
	}
</script>

{#snippet dailySchedule()}
	<Scroll name={t('dispatch.tab_daily')} size="fill" inset>
		<Stack gap="md">
			<Surface tone="card" padding="md" radius="control">
				<Stack gap="md">
					<Cluster align="center" justify="between" gap="sm">
						<Cluster align="center" gap="xs">
							<Button
								variant="outline"
								onclick={() => (chosenDay = shiftDay(activeDay, -1))}
								aria-label={t('dispatch.prev_day')}
							>
								<Icon name="lucide:chevron-left" class="size-4" />
							</Button>
							<Inline align="center" gap="xs">
								<span class="text-heading tabular-nums">{formatDayHeading(activeDay)}</span>
								{#if activeDay === clockDay.today}
									<Badge variant="info">{t('dispatch.today')}</Badge>
								{/if}
							</Inline>
							<Button
								variant="outline"
								onclick={() => (chosenDay = shiftDay(activeDay, 1))}
								aria-label={t('dispatch.next_day')}
							>
								<Icon name="lucide:chevron-right" class="size-4" />
							</Button>
							{#if activeDay !== clockDay.today}
								<Button variant="ghost" onclick={() => (chosenDay = clockDay.today)}>
									{t('dispatch.jump_today')}
								</Button>
							{/if}
						</Cluster>

						<Cluster align="center" gap="xs">
							{#if canRefreshEta}
								<Button variant="outline" onclick={() => ctx.run('refresh_route_eta', {})}>
									<Icon name="lucide:timer-reset" class="size-3.5" />
									{t('app.live.action_refresh_eta')}
								</Button>
							{/if}
							{#if canCreate}
								<Button variant="default" onclick={() => (createOpen = true)}>
									<Icon name="lucide:plus" class="size-3.5" />
									{t('dispatch.new_dispatch')}
								</Button>
							{/if}
						</Cluster>
					</Cluster>

					{#if scheduledDays.length > 0}
						<Cluster align="center" gap="xs">
							{#each scheduledDays as item (item.day)}
								<Button
									variant={item.day === activeDay ? 'secondary' : 'outline'}
									onclick={() => (chosenDay = item.day)}
								>
									<span>{formatDayChip(item.day)}</span>
									<Badge variant="outline">{item.count}</Badge>
								</Button>
							{/each}
						</Cluster>
					{/if}

					<Grid minimum="card" gap="md">
						<Stack gap="xs">
							<span class="text-meta">{t('dispatch.stat_total')}</span>
							<span class="text-label tabular-nums">{dayStats.total}</span>
						</Stack>
						<Stack gap="xs">
							<span class="text-meta">{t('dispatch.stat_active')}</span>
							<span class="text-label tabular-nums">{dayStats.enRoute}</span>
						</Stack>
						<Stack gap="xs">
							<span class="text-meta">{t('dispatch.stat_planned')}</span>
							<span class="text-label tabular-nums">{dayStats.planned}</span>
						</Stack>
						<Stack gap="xs">
							<span class="text-meta">{t('dispatch.stat_completed')}</span>
							<span class="text-label tabular-nums">{dayStats.completed}</span>
						</Stack>
						<Stack gap="xs">
							<span class="text-meta">{t('dispatch.stat_distance')}</span>
							<span class="text-label tabular-nums">{dayStats.totalKm} km</span>
						</Stack>
					</Grid>
				</Stack>
			</Surface>

			{#if routesQuery.loading && !routesQuery.current}
				<Inline gap="sm" align="center" aria-busy="true">
					<Spinner />
					<span class="text-sm text-muted-foreground">{t('dispatch.loading')}</span>
				</Inline>
			{:else if routesQuery.error}
				<Alert.Root variant="destructive">
					<Alert.Title>{routesQuery.error.message}</Alert.Title>
				</Alert.Root>
			{:else if dayRoutes.length === 0}
				<EmptyState
					variant="card"
					icon="file"
					title={t('dispatch.empty_day_title')}
					hint={t('dispatch.empty_day_hint', { day: activeDay })}
				/>
			{:else}
				<Stack gap="sm">
					{#each dayRoutes as route (route.id)}
						{@const stopCount = route.waypoints?.length ?? 0}
						<button
							type="button"
							class="w-full text-left"
							onclick={() => open_record('routes', route.id)}
						>
							<Surface
								tone="card"
								padding="md"
								radius="control"
								class="transition-colors hover:bg-surface-hover"
							>
								<Stack gap="sm">
									<Cluster align="center" justify="between" gap="sm">
										<Cluster align="center" gap="sm">
											<span
												class="rounded-control bg-muted px-2 py-1 font-mono text-xs font-medium tabular-nums"
											>
												{formatTime(route.planned_departure)} – {formatTime(route.planned_arrival)}
											</span>
											<span class="font-mono text-xs text-muted-foreground">
												{route.route_number}
											</span>
											<span class="text-label font-medium">{route.title}</span>
										</Cluster>
										<Cluster align="center" gap="xs">
											{#if route.eta_minutes != null && (route.status === 'dispatched' || route.status === 'en_route')}
												<Badge variant="info">
													{t('app.live.overlay_eta', { minutes: route.eta_minutes })}
												</Badge>
											{/if}
											<Badge variant={statusTone(route.status)}>
												{enum_text(route.status, {
													t: rawT,
													model: 'routes',
													field: 'status'
												})}
											</Badge>
										</Cluster>
									</Cluster>

									<Cluster
										align="center"
										justify="between"
										gap="md"
										class="text-sm text-muted-foreground"
									>
										<Cluster align="center" gap="sm">
											<Inline align="center" gap="xs">
												<Icon name="lucide:map-pin" class="size-3.5 shrink-0" />
												<span>{route.origin_name}</span>
												<Icon name="lucide:arrow-right" class="size-3.5 shrink-0" />
												<span class="text-foreground">{route.destination_name}</span>
											</Inline>
											{#if stopCount > 0}
												<Badge variant="outline">
													{t('dispatch.stops_count', { count: stopCount })}
												</Badge>
											{/if}
										</Cluster>

										<Cluster align="center" gap="md" class="text-xs tabular-nums">
											{#if route.vehicle_id}
												<Inline align="center" gap="xs">
													<Icon name="lucide:truck" class="size-3.5 shrink-0" />
													<span class="font-medium text-foreground">
														{route.vehicle_id.registration_no}
													</span>
													<span>· {route.vehicle_id.vehicle_name}</span>
												</Inline>
											{/if}
											{#if route.driver_id}
												<Inline align="center" gap="xs">
													<Icon name="lucide:user" class="size-3.5 shrink-0" />
													<span>{route.driver_id.full_name}</span>
												</Inline>
											{/if}
											<span>{route.planned_distance_km} km</span>
										</Cluster>
									</Cluster>

									{#if route.cargo_notes}
										<p class="text-micro text-muted-foreground">{route.cargo_notes}</p>
									{/if}
								</Stack>
							</Surface>
						</button>
					{/each}
				</Stack>
			{/if}
		</Stack>
	</Scroll>
{/snippet}

{#snippet allRoutesTable()}
	<Table
		{ctx}
		of="routes"
		order_by={{ planned_departure: 'desc' }}
		toolbar={{ title: false }}
		columns={[
			'route_number',
			'title',
			'vehicle_id',
			'driver_id',
			'status',
			'origin_name',
			'destination_name',
			'planned_departure',
			'planned_distance_km',
			'eta_minutes'
		]}
	/>
{/snippet}

<AppShell
	icon="lucide:route"
	title={t('app.operations.page_routes')}
	description={t('app.operations.routes_description')}
	variant="full"
>
	<Tabs
		tabs={[
			{
				name: 'daily',
				title: t('dispatch.tab_daily'),
				icon: 'lucide:calendar-clock',
				body: dailySchedule
			},
			{
				name: 'all',
				title: t('dispatch.tab_all'),
				icon: 'lucide:table-2',
				body: allRoutesTable
			}
		]}
	/>
</AppShell>

<Sheet open={createOpen} on_open_change={(open) => !open && (createOpen = false)}>
	{#if createOpen}
		<RecordShell
			{ctx}
			of="routes"
			mode="create"
			values={{
				planned_departure: `${activeDay}T08:00:00.000Z`,
				planned_arrival: `${activeDay}T09:30:00.000Z`
			}}
			on_done={() => (createOpen = false)}
		/>
	{/if}
</Sheet>
