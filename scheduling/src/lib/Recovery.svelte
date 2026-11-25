<script lang="ts">
	import {
		Alert,
		Button,
		Combobox,
		EmptyState,
		format,
		Label,
		RunStatus,
		Spinner,
		TimeInput,
		use_act
	} from '@norbital-ai/ui';
	import { DateTime, Duration } from 'effect';
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Cluster, Inline, Stack, Surface } from '@norbital-ai/ui/layout';
	import Countdown from './Countdown.svelte';
	import SlotPicker from './SlotPicker.svelte';
	import { closedSlot } from './matching.js';
	import { livePool } from './pool.svelte.js';
	import { candidatesFor, rebookingSlots, rebookingWindow, type Rematch } from './slots.js';

	let {
		ctx,
		appointment
	}: {
		ctx: PageContext;
		appointment: Id<'appointments'>;
	} = $props();

	const uid = $props.id();
	const t = (...args: Parameters<PageContext['t']>) => ctx.t(...args);
	const zone = $derived(ctx.tz);
	const dayClock = $derived(ctx.clock('day'));
	const minuteClock = $derived(ctx.clock('minute'));
	const canUpdate = $derived(
		ctx.catalog?.scheduling_settings !== undefined &&
			ctx.catalog?.appointments?.update !== undefined
	);

	const stored = $derived(
		ctx.query({
			appointments: {
				where: { id: { eq: appointment } },
				fields: [
					'number',
					'slot',
					'status',
					'provider',
					'address',
					'location',
					'skill',
					'attention',
					'proposed_provider',
					'unavailable_provider',
					'booking'
				],
				limit: 1,
				unavailable_provider: { fields: ['name'] },
				booking: {
					fields: ['customer', 'service'],
					customer: { fields: ['name'] },
					service: { fields: ['name'] }
				}
			}
		})
	);
	const a = $derived(stored.current?.appointments.rows[0]);
	const closed = $derived(a === undefined ? null : closedSlot(a.slot));
	const rematch = $derived<Rematch | undefined>(
		a === undefined || closed === null
			? undefined
			: { ...a, slot: closed, unavailable_provider: a.unavailable_provider?.id ?? null }
	);

	let newTime = $state(false);
	let picked = $state<string | null>(null);
	let chosen = $state<Id<'providers'> | null>(null);
	let fromOverride = $state<string | null>(null);
	const from = $derived(fromOverride ?? dayClock.today);
	const start = $derived(newTime ? picked : (a?.slot.start ?? null));

	const around = livePool(
		ctx,
		() =>
			!canUpdate || rematch === undefined || start === null
				? null
				: { from: start, to: start, spots: [rematch.location] },
		() => zone
	);
	const candidates = $derived(
		rematch === undefined || start === null || around.current === undefined
			? undefined
			: candidatesFor(rematch, newTime ? start : undefined, around.current, zone)
	);
	const best = $derived(
		candidates?.find((c) => c.provider === chosen) ??
			(!newTime ? candidates?.find((c) => c.provider === a?.proposed_provider) : undefined) ??
			candidates?.[0]
	);

	const fortnight = $derived(
		Array.from({ length: 14 }, (_, i) =>
			DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(from), { days: i }))
		)
	);
	const ahead = livePool(
		ctx,
		() =>
			!canUpdate || !newTime || rematch === undefined
				? null
				: { ...rebookingWindow(from, 14, zone), spots: [rematch.location] },
		() => zone
	);
	const days = $derived(
		!newTime || rematch === undefined || ahead.current === undefined
			? undefined
			: rebookingSlots(rematch, fortnight, ahead.current, zone, minuteClock.now)
	);
	const durationMinutes = $derived(
		closed === null
			? 60
			: Duration.toMinutes(
					DateTime.distance(DateTime.makeUnsafe(closed.start), DateTime.makeUnsafe(closed.end))
				)
	);
	const startInPast = $derived(
		start === null ||
			DateTime.isLessThanOrEqualTo(DateTime.makeUnsafe(start), DateTime.makeUnsafe(minuteClock.now))
	);

	const save = use_act(ctx);
	let started = $state<{ id: string; automation: string } | null>(null);
	const follow = (then?: () => void) => ({
		then: ({
			output
		}: {
			readonly output: { readonly id: string; readonly automation: string };
		}) => {
			started = { id: output.id, automation: output.automation };
			then?.();
		}
	});

	function approve() {
		if (!canUpdate || start === null || best === undefined) return;
		save.run(
			ctx.run('appointments_rebook', { targets: [appointment], start, provider: best.provider }),
			follow()
		);
	}
	const refresh = () => {
		if (!canUpdate) return;
		save.run(
			ctx.run('appointments_recommend', { targets: [appointment] }),
			follow(() => (chosen = null))
		);
	};
	const reportUnavailable = () => {
		if (!canUpdate) return;
		save.run(ctx.run('appointments_report_unavailable', { targets: [appointment] }), follow());
	};
</script>

<Stack gap="lg">
	{#if stored.error}
		<Alert.Root variant="destructive">
			<Alert.Title>{stored.error.message}</Alert.Title>
		</Alert.Root>
	{:else if a === undefined}
		<Surface tone="subtle" padding="md" radius="control" aria-busy="true">
			<Inline gap="sm" align="center">
				<Spinner />
				<span class="text-sm text-muted-foreground">{t('component.loading')}</span>
			</Inline>
		</Surface>
	{:else}
		<Surface tone="subtle" padding="md" radius="control">
			<Stack gap="xs">
				<p class="text-heading">
					{a.booking?.customer?.name ?? ''} · {a.booking?.service?.name ?? ''}
				</p>
				<p class="text-sm">
					{format({ kind: 'instant' }, a.slot.start, { locale: ctx.locale, zone })} · {a.address}
				</p>
				<Countdown {ctx} start={a.slot.start} />
				{#if a.unavailable_provider}
					<p class="text-sm text-muted-foreground">
						{t('app.recovery.absent', { name: a.unavailable_provider.name })}
					</p>
				{/if}
			</Stack>
		</Surface>

		{#if a.status === 'scheduled' && canUpdate}
			{#if newTime}
				<Stack gap="sm">
					<Label for={`${uid}-from`}>{t('app.recovery.from')}</Label>
					<TimeInput
						{ctx}
						id={`${uid}-from`}
						value={from}
						on_change={(d: string | null) => {
							fromOverride = d ?? dayClock.today;
							picked = null;
							chosen = null;
						}}
					/>
					{#if ahead.error}
						<Alert.Root variant="destructive">
							<Alert.Title>{ahead.error.message}</Alert.Title>
						</Alert.Root>
					{:else if days === undefined}
						<Surface tone="subtle" padding="sm" radius="control" aria-busy="true">
							<Inline gap="sm" align="center">
								<Spinner />
								<span class="text-sm text-muted-foreground">{t('component.loading')}</span>
							</Inline>
						</Surface>
					{:else}
						<SlotPicker
							{days}
							minutes={durationMinutes}
							value={picked}
							locale={ctx.locale}
							{zone}
							onPick={(s) => {
								picked = s;
								chosen = null;
							}}
							{t}
						/>
					{/if}
					<p class="text-sm text-muted-foreground">{t('app.recovery.date_change')}</p>
				</Stack>
			{/if}

			{#if around.error}
				<Alert.Root variant="destructive">
					<Alert.Title>{around.error.message}</Alert.Title>
				</Alert.Root>
			{:else if candidates === undefined && start !== null}
				<Surface tone="subtle" padding="sm" radius="control" aria-busy="true">
					<Inline gap="sm" align="center">
						<Spinner />
						<span class="text-sm text-muted-foreground">{t('component.loading')}</span>
					</Inline>
				</Surface>
			{:else if best !== undefined}
				<Stack gap="sm">
					<Label for={`${uid}-replacement`}>{t('app.recovery.recommended')}</Label>
					<Combobox
						id={`${uid}-replacement`}
						value={chosen ?? best.provider}
						options={(candidates ?? []).map((c) => ({
							value: c.provider,
							label: c.name
						}))}
						on_change={(id) => {
							if (id !== null) chosen = id;
						}}
					/>
					<p class="text-sm text-muted-foreground">
						{t('app.recovery.metrics', { drive: best.drive_minutes, hours: best.week_hours })}
					</p>
					<p class="text-sm text-muted-foreground">{t('app.recovery.planning')}</p>
					<Cluster gap="sm">
						<Button variant="brand" disabled={save.pending || startInPast} onclick={approve}>
							{t('app.recovery.approve', { name: best.name })}
						</Button>
					</Cluster>
				</Stack>
			{:else if start !== null}
				<EmptyState variant="inset" title={t('app.recovery.no_match')} />
			{/if}

			<Cluster gap="sm">
				<Button variant="outline" disabled={save.pending} onclick={refresh}>
					{t('app.recovery.refresh')}
				</Button>
				<Button
					variant="ghost"
					disabled={save.pending}
					onclick={() => {
						newTime = !newTime;
						picked = null;
						chosen = null;
					}}
				>
					{t('app.recovery.other_time')}
				</Button>
				{#if a.provider !== null}
					<Button variant="outline" disabled={save.pending} onclick={reportUnavailable}>
						{t('app.recovery.report_absence')}
					</Button>
				{/if}
			</Cluster>

			<p class="text-caption">{t('app.recovery.scope')}</p>
		{/if}

		{#if started}
			<RunStatus {ctx} automation={started.automation} run={started.id} />
		{/if}
	{/if}
</Stack>
