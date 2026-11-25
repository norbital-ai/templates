<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { Id } from '@norbital-ai/bolt';
	import {
		Alert,
		Badge,
		Button,
		EmptyState,
		Label,
		Sheet,
		Spinner,
		StateBadge,
		Textarea,
		TimeInput,
		Timeline,
		type TimelineEntry,
		use_act
	} from '@norbital-ai/ui';
	import {
		AppShell,
		Center,
		Cluster,
		Inline,
		Scroll,
		Stack,
		Surface
	} from '@norbital-ai/ui/layout';
	import { DateTime, Duration } from 'effect';
	import { epochMs, formatInstant } from '../../lib/format.js';
	import { driveMinutes, type Point } from '../../lib/matching.js';
	import { providerLocation } from '../../lib/provider-location.svelte.js';

	let { ctx }: { ctx: PageContext } = $props();
	const uid = $props.id();
	const t = (...args: Parameters<PageContext['t']>) => ctx.t(...args);
	const zone = $derived(ctx.tz);
	const actor = $derived(ctx.actor);
	const dayClock = $derived(ctx.clock('day'));
	const minuteClock = $derived(ctx.clock('minute'));
	const today = $derived(dayClock.today);
	const canUpdateAppointment = $derived(ctx.catalog?.appointments?.update !== undefined);

	const me = $derived(
		actor?.kind === 'member'
			? ctx.query({
					providers: {
						output: 'provider',
						where: { user: { eq: actor.id } },
						fields: ['name'],
						limit: 1
					}
				})
			: null
	);
	const provider = $derived(me?.current?.providers.rows[0]);
	const statusWord = (value: 'in_progress' | 'completed') =>
		ctx.t(`models.appointments.fields.status.${value}`);

	let dayOverride = $state<string | null>(null);
	const selectedDay = $derived(dayOverride ?? today);
	const span = $derived({
		start: DateTime.formatIso(
			DateTime.makeZonedUnsafe(selectedDay, { timeZone: zone, adjustForTimeZone: true })
		),
		end: DateTime.formatIso(
			DateTime.add(
				DateTime.makeZonedUnsafe(selectedDay, { timeZone: zone, adjustForTimeZone: true }),
				{ days: 1 }
			)
		)
	});

	const dayRead = (
		providerId: Id<'providers'>,
		status: readonly ('scheduled' | 'in_progress' | 'completed')[]
	) =>
		ctx.query({
			appointments: {
				output: 'provider',
				where: { provider: { eq: providerId }, status: { in: status }, slot: { overlaps: span } },
				fields: [
					'revision',
					'number',
					'slot',
					'address',
					'location',
					'status',
					'shift_check',
					'completed_at',
					'booking'
				],
				limit: 50,
				booking: {
					fields: ['notes', 'service', 'customer'],
					service: { fields: ['name'] },
					customer: { fields: ['name', 'phone'] }
				}
			}
		});

	const open = $derived(
		provider === undefined ? null : dayRead(provider.id, ['scheduled', 'in_progress'])
	);
	const completed = $derived(provider === undefined ? null : dayRead(provider.id, ['completed']));
	const off = $derived(
		provider === undefined
			? null
			: ctx.query({
					provider_time_off: {
						where: {
							provider: { eq: provider.id },
							period: { overlaps: { from: selectedDay, to: selectedDay } }
						},
						limit: 1
					}
				})
	);
	const away = $derived(off?.current?.provider_time_off.rows.length === 1);
	const appointments = $derived(
		[...(open?.current?.appointments.rows ?? [])].sort(
			(a, b) => epochMs(a.slot.start) - epochMs(b.slot.start)
		)
	);
	const current = $derived(appointments.find((a) => a.status === 'in_progress'));
	const upcoming = $derived(appointments.filter((a) => a.status === 'scheduled'));
	const asked = $derived(upcoming.find((a) => a.shift_check === 'asked') ?? upcoming[0]);
	const askedActive = $derived(
		asked !== undefined &&
			asked.slot.end !== null &&
			DateTime.isGreaterThan(
				DateTime.makeUnsafe(asked.slot.end),
				DateTime.makeUnsafe(minuteClock.now)
			)
	);
	const route = $derived(
		[...(completed?.current?.appointments.rows ?? []), ...appointments].sort(
			(a, b) => epochMs(a.slot.start) - epochMs(b.slot.start)
		)
	);
	const stops = $derived(route.filter((a) => a.status !== 'completed'));
	const routeUrl = $derived.by(() => {
		const last = stops.at(-1);
		if (last === undefined || stops.length > 4) return null;
		const place = (a: (typeof stops)[number]) =>
			a.location === null ? a.address : `${a.location.lat},${a.location.lng}`;
		const params = new URLSearchParams({
			api: '1',
			travelmode: 'driving',
			destination: place(last)
		});
		if (stops.length > 1) params.set('waypoints', stops.slice(0, -1).map(place).join('|'));
		return `https://www.google.com/maps/dir/?${params}`;
	});
	const here = $derived(providerLocation.here);
	const locationReady = $derived(providerLocation.ready);

	const save = use_act(ctx);
	let completing = $state<(typeof appointments)[number] | null>(null);
	let notes = $state('');

	const confirmShift = (id: Id<'appointments'>) =>
		save.run(ctx.run('appointments_confirm_shift', { targets: [id] }));
	const declineShift = (id: Id<'appointments'>) =>
		save.run(ctx.run('appointments_decline_shift', { targets: [id] }));
	const start = (a: { readonly id: Id<'appointments'>; readonly revision: number }) =>
		save.run(
			ctx.act({
				'appointments.update': [
					{ target: { id: a.id, revision: a.revision }, set: { status: 'in_progress' } }
				]
			})
		);
	function complete() {
		if (completing === null) return;
		const row = appointments.find((a) => a.id === completing?.id) ?? completing;
		const completionNotes = notes.trim();
		save.run(
			ctx.act({
				'appointments.update': [
					{
						target: { id: row.id, revision: row.revision },
						set: {
							status: 'completed',
							...(completionNotes === '' ? {} : { completion_notes: completionNotes })
						}
					}
				]
			}),
			{
				then: (outcome) => {
					if (outcome.kind !== 'committed') return;
					completing = null;
					notes = '';
				}
			}
		);
	}

	const clockTime = (iso: string) =>
		formatInstant(iso, zone, { hour: 'numeric', minute: '2-digit' }, ctx.locale);
	const dateLine = (iso: string) =>
		formatInstant(iso, zone, { weekday: 'long', day: 'numeric', month: 'short' }, ctx.locale);
	const isToday = $derived(selectedDay === today);
	const eta = (to: Point | null) => (here === null || to === null ? null : driveMinutes(here, to));
	const directions = (a: (typeof appointments)[number]) =>
		a.location === null
			? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.address)}`
			: `https://www.google.com/maps/dir/?api=1&destination=${a.location.lat},${a.location.lng}`;

	const spareMinutes = (
		prev: (typeof route)[number] | undefined,
		next: (typeof route)[number]
	): number => {
		if (prev === undefined || prev.slot.end === null) return 0;
		const gap = Math.round(
			Duration.toMinutes(
				DateTime.distance(DateTime.makeUnsafe(prev.slot.end), DateTime.makeUnsafe(next.slot.start))
			)
		);
		return Math.max(0, gap - driveMinutes(prev.location, next.location));
	};

	type RouteEntry = TimelineEntry & {
		readonly appointment: (typeof route)[number];
		readonly stopState: 'done' | 'now' | 'next' | 'later';
		readonly legLine: string | null;
	};

	const routeEntries = $derived<RouteEntry[]>(
		route.map((a, i) => {
			const prev = i > 0 ? route[i - 1] : undefined;
			const stopState: RouteEntry['stopState'] =
				a.status === 'completed'
					? 'done'
					: a.status === 'in_progress'
						? 'now'
						: a.id === upcoming[0]?.id
							? 'next'
							: 'later';
			return {
				key: a.id,
				appointment: a,
				stopState,
				legLine:
					prev === undefined
						? null
						: `${t('app.provider.timeline_drive', { minutes: driveMinutes(prev.location, a.location) })} · ${t('app.provider.timeline_spare', { minutes: spareMinutes(prev, a) })}`,
				icon:
					stopState === 'done'
						? 'lucide:check'
						: stopState === 'now'
							? 'lucide:play'
							: 'lucide:map-pin',
				tone:
					stopState === 'done'
						? 'success'
						: stopState === 'now' || stopState === 'next'
							? 'brand'
							: 'default',
				...(stopState === 'now' || stopState === 'next'
					? { status: 'active' as const }
					: stopState === 'later'
						? { status: 'future' as const }
						: {}),
				title: `${clockTime(a.slot.start)} – ${a.slot.end === null ? '—' : clockTime(a.slot.end)}`,
				line:
					stopState === 'done'
						? [a.address]
						: [`${a.booking?.customer?.name ?? ''} · ${a.booking?.service?.name ?? ''}`]
			};
		})
	);
</script>

{#snippet sharingLine()}
	<Inline gap="sm" align="center">
		<span class="size-2 shrink-0 rounded-full bg-tone-success-text"></span>
		<p class="text-sm text-muted-foreground">{t('app.provider.sharing_on')}</p>
	</Inline>
{/snippet}

{#snippet appointmentCard(a: (typeof appointments)[number], next: boolean)}
	{@const minutes = eta(a.location)}
	<Surface tone="card" padding="md" radius="control">
		<Stack gap="sm">
			<Cluster gap="xs" justify="between" align="center">
				<p class="text-base font-medium tabular-nums">
					{clockTime(a.slot.start)} – {a.slot.end === null ? '—' : clockTime(a.slot.end)}
				</p>
				{#if a.status === 'in_progress'}
					<StateBadge {ctx} state="in_progress" label={statusWord('in_progress')} />
				{:else if next && isToday && minutes !== null}
					<Badge variant={minutes > 30 ? 'warning' : 'success'}>
						{t('app.provider.minutes_away', { minutes })}
					</Badge>
				{/if}
			</Cluster>
			{#if !isToday}
				<p class="text-meta">{dateLine(a.slot.start)}</p>
			{/if}
			{#if next && a.shift_check === 'confirmed'}
				<p class="text-meta">{t('app.provider.day_confirmed')}</p>
			{/if}
			<Stack gap="xs">
				<p class="text-sm font-medium">
					{a.booking?.customer?.name ?? ''} · {a.booking?.service?.name ?? ''}
				</p>
				<p class="text-sm text-muted-foreground">{a.address}</p>
				{#if a.booking?.notes}
					<p class="text-sm">{a.booking.notes}</p>
				{/if}
			</Stack>
			<Cluster gap="md">
				<a class="text-sm underline" href={directions(a)} target="_blank" rel="noopener">
					{t('app.provider.directions')}
				</a>
				{#if a.booking?.customer?.phone}
					<a class="text-sm underline" href={`tel:${a.booking.customer.phone}`}>
						{t('app.provider.call_customer')}
					</a>
				{/if}
			</Cluster>
			{#if canUpdateAppointment}
				{#if a.status === 'in_progress'}
					<Button
						variant="brand"
						size="lg"
						disabled={save.pending || !locationReady}
						onclick={() => (completing = a)}
					>
						{t('app.provider.complete')}
					</Button>
				{:else if next && current === undefined && isToday}
					<Button
						variant="brand"
						size="lg"
						disabled={save.pending || here === null}
						onclick={() => start(a)}
					>
						{t('app.provider.start')}
					</Button>
				{/if}
			{/if}
		</Stack>
	</Surface>
{/snippet}

{#snippet routeItem(entry: RouteEntry)}
	<Stack gap="xs">
		{#if entry.legLine !== null}
			<p class="text-caption">{entry.legLine}</p>
		{/if}
		{#if entry.stopState === 'done'}
			<Cluster justify="between" gap="sm" align="center">
				<p class="text-sm text-muted-foreground">{entry.appointment.address}</p>
				<StateBadge {ctx} state="completed" label={statusWord('completed')} />
			</Cluster>
		{:else}
			{@render appointmentCard(entry.appointment, entry.stopState === 'next')}
		{/if}
	</Stack>
{/snippet}

<AppShell
	icon="lucide:sun"
	title={provider
		? t('app.provider.greeting', { name: provider.name })
		: t('app.provider.today_title')}
	description={t('app.provider.today_description')}
	variant="full"
>
	{#snippet actions()}
		<Label for={`${uid}-date`} class="sr-only">{t('app.provider.date')}</Label>
		<TimeInput
			{ctx}
			id={`${uid}-date`}
			value={selectedDay}
			on_change={(day: string | null) => (dayOverride = day ?? today)}
		/>
	{/snippet}

	<Scroll name="today" size="fill" inset>
		<Center measure="reading">
			<Stack gap="lg">
				{#if me?.error}
					<Alert.Root variant="destructive">
						<Alert.Title>{me.error.message}</Alert.Title>
					</Alert.Root>
				{:else if actor?.kind === 'member' && me?.current === undefined}
					<Surface tone="subtle" padding="md" radius="control" role="status" aria-busy="true">
						<Inline gap="sm" align="center">
							<Spinner />
							<span class="text-sm text-muted-foreground">{t('component.loading')}</span>
						</Inline>
					</Surface>
				{:else if actor?.kind === 'member' && provider === undefined}
					<EmptyState title={t('app.provider.not_a_provider')} />
				{/if}

				{#if provider !== undefined}
					{#if here !== null}
						{@render sharingLine()}
					{/if}
					{#if off?.error}
						<Alert.Root variant="destructive">
							<Alert.Title>{off.error.message}</Alert.Title>
						</Alert.Root>
					{:else if away}
						<Surface tone="subtle" padding="md" radius="control" role="status">
							<p class="text-sm font-medium">{t('app.provider.away_today')}</p>
						</Surface>
					{:else if asked?.shift_check === 'declined'}
						<Surface tone="subtle" padding="md" radius="control" role="status">
							<p class="text-sm font-medium">{t('app.provider.declined')}</p>
						</Surface>
					{:else if asked && askedActive && canUpdateAppointment}
						<Surface tone="subtle" padding="md" radius="control">
							<Stack gap="sm">
								<p class="text-heading">
									{t(
										asked.shift_check === 'confirmed'
											? 'app.provider.day_confirmed'
											: 'app.provider.confirm_title'
									)}
								</p>
								{#if asked.shift_check !== 'confirmed'}
									<p class="text-sm text-muted-foreground">
										{t('app.provider.confirm_body', { time: clockTime(asked.slot.start) })}
									</p>
								{/if}
								<Cluster gap="sm">
									{#if asked.shift_check !== 'confirmed'}
										<Button
											disabled={save.pending || !locationReady}
											onclick={() => confirmShift(asked.id)}
										>
											{t('app.provider.confirm_shift')}
										</Button>
									{/if}
									<Button
										variant="outline"
										disabled={save.pending || !locationReady}
										onclick={() => declineShift(asked.id)}
									>
										{t('app.provider.decline_shift')}
									</Button>
								</Cluster>
							</Stack>
						</Surface>
					{/if}

					<Stack gap="md">
						<Cluster justify="between" align="center">
							<h2 class="text-heading">{t('app.provider.route_title')}</h2>
							{#if routeUrl}
								<a class="text-sm underline" href={routeUrl} target="_blank" rel="noopener">
									{t('app.provider.route_start')}
								</a>
							{/if}
						</Cluster>
						<p class="text-sm text-muted-foreground">{t('app.provider.route_description')}</p>

						{#if open?.error || completed?.error}
							<Alert.Root variant="destructive">
								<Alert.Title>{(open?.error ?? completed?.error)?.message}</Alert.Title>
							</Alert.Root>
						{:else if open?.current === undefined}
							<Surface tone="subtle" padding="md" radius="control" role="status" aria-busy="true">
								<Inline gap="sm" align="center">
									<Spinner />
									<span class="text-sm text-muted-foreground">{t('component.loading')}</span>
								</Inline>
							</Surface>
						{:else}
							<Timeline
								entries={routeEntries}
								label={t('app.provider.route_title')}
								item={routeItem}
							>
								{#snippet empty()}
									<EmptyState variant="inset" title={t('app.provider.route_empty')} />
								{/snippet}
							</Timeline>
						{/if}
					</Stack>
				{/if}
			</Stack>
		</Center>
	</Scroll>
</AppShell>

<Sheet
	open={completing !== null}
	on_open_change={(o) => {
		if (!o) completing = null;
	}}
	title={t('app.provider.complete_title')}
>
	{#if completing}
		<Stack gap="md">
			<p class="text-sm text-muted-foreground">
				{completing.booking?.customer?.name ?? ''} · {completing.address}
			</p>
			<Stack gap="xs">
				<Label for={`${uid}-notes`}>{t('app.provider.notes')}</Label>
				<Textarea
					id={`${uid}-notes`}
					rows={4}
					bind:value={notes}
					placeholder={t('app.provider.notes_hint')}
				/>
			</Stack>
			<Button
				variant="brand"
				size="lg"
				disabled={save.pending || !locationReady}
				onclick={complete}
			>
				{t('app.provider.mark_complete')}
			</Button>
		</Stack>
	{/if}
</Sheet>
