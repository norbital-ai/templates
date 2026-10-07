<script lang="ts">
	/**
	 * A helper's day on their phone: the visit under way, the ones still to come with the drive to each from where the
	 * phone is now, the shift check to answer, and one tap to start and to finish. The native phone continues sharing while backgrounded; browser sharing requires the page. Its
	 * position is shared with the scheduler (at most every two minutes).
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Instant, PlainDate } from '@norbital-ai/std/date';
	import { AppShell, Center, Cluster, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Badge, Button, DateInput, EmptyState, Label, Sheet, Textarea } from '@norbital-ai/ui';
	import { employeeLocation } from '../../lib/employee-location.svelte.js';
	import { live } from '../../lib/live.svelte.js';
	import { driveMinutes, type Point } from '../../lib/matching.js';

	const t = bolt.t;

	const DAY_MS = 86_400_000;

	const actor = bolt.actor;
	const me = live(() =>
		actor?.kind === 'member'
			? bolt.read('helpers', {
					where: { user: { eq: actor.id } },
					select: { name: true },
					limit: 1
				})
			: null
	);
	const helper = $derived(me.current?.rows[0]);
	const today = new Intl.DateTimeFormat('en-CA').format(new Date());
	let selectedDay = $state(today);
	const midnight = $derived(new Date(`${selectedDay}T00:00:00`));
	const span = $derived({
		start: Instant(midnight.toISOString()),
		end: Instant(new Date(midnight.getTime() + DAY_MS).toISOString())
	});
	const VISIT = {
		number: true,
		slot: true,
		address: true,
		location: true,
		status: true,
		shift_check: true,
		completed_at: true,
		booking: {
			select: {
				notes: true,
				service: { select: { name: true } },
				customer: { select: { name: true, phone: true } }
			}
		}
	} as const;
	const open = live(() =>
		helper === undefined
			? null
			: bolt.read('visits', {
					where: {
						helper: { eq: helper.id },
						status: { in: ['scheduled', 'in_progress'] },
						slot: { overlaps: span }
					},
					select: VISIT,
					all: true
				})
	);
	const done = live(() =>
		helper === undefined
			? null
			: bolt.read('visits', {
					where: {
						helper: { eq: helper.id },
						status: { eq: 'done' },
						slot: { overlaps: span }
					},
					select: VISIT,
					all: true
				})
	);
	/** Leave on the chosen day: after a decline, a missed shift check, or booked time off. */
	const off = live(() =>
		helper === undefined
			? null
			: bolt.read('helper_time_off', {
					where: {
						helper: { eq: helper.id },
						period: { overlaps: { from: PlainDate(selectedDay), to: PlainDate(selectedDay) } }
					},
					limit: 1
				})
	);
	const away = $derived(off.current?.rows.length === 1);
	const visits = $derived(
		[...(open.current?.rows ?? [])].sort((a, b) => a.slot.start.localeCompare(b.slot.start))
	);
	const current = $derived(visits.find((v) => v.status === 'in_progress'));
	const upcoming = $derived(visits.filter((v) => v.status === 'scheduled'));
	const asked = $derived(upcoming.find((v) => v.shift_check === 'asked') ?? upcoming[0]);
	const route = $derived(
		[...(done.current?.rows ?? []), ...visits].sort((a, b) =>
			a.slot.start.localeCompare(b.slot.start)
		)
	);
	const stops = $derived(route.filter((v) => v.status !== 'done'));
	const routeUrl = $derived.by(() => {
		if (stops.length === 0 || stops.length > 4) return null;
		const place = (v: (typeof stops)[number]) =>
			v.location === null ? v.address : `${v.location.lat},${v.location.lng}`;
		const params = new URLSearchParams({
			api: '1',
			travelmode: 'driving',
			destination: place(stops.at(-1)!)
		});
		if (stops.length > 1) params.set('waypoints', stops.slice(0, -1).map(place).join('|'));
		return `https://www.google.com/maps/dir/?${params}`;
	});

	const here = $derived(employeeLocation.here);
	const locationReady = $derived(employeeLocation.ready);

	// ── acting ──
	let problem = $state<string | null>(null);
	let busy = $state(false);
	let completing = $state<(typeof visits)[number] | null>(null);
	let notes = $state('');
	async function run(outcome: () => Promise<{ kind: string; message?: string }>) {
		if (!locationReady) return false;
		busy = true;
		const o = await outcome();
		problem = o.kind === 'refused' ? (o.message ?? null) : null;
		busy = false;
		return o.kind === 'committed';
	}
	const start = (id: Id<'visits'>) =>
		run(() => bolt.act('visits.update', { target: id, set: { status: 'in_progress' } }));
	async function complete() {
		if (completing === null) return;
		const visit = completing;
		const ok = await run(() =>
			bolt.act('visits.update', {
				target: visit.id,
				set: { status: 'done', ...(notes.trim() === '' ? {} : { completion_notes: notes.trim() }) }
			})
		);
		if (ok) {
			completing = null;
			notes = '';
		}
	}

	// ── formatting ──
	const time = (i: string | null) =>
		i === null
			? '—'
			: new Intl.DateTimeFormat(bolt.locale, { hour: 'numeric', minute: '2-digit' }).format(
					new Date(i)
				);
	const dayOf = (i: string) =>
		new Intl.DateTimeFormat(bolt.locale, {
			weekday: 'long',
			day: 'numeric',
			month: 'short'
		}).format(new Date(i));
	const isToday = (_: string) => selectedDay === today;
	const eta = (to: Point | null) => (here === null || to === null ? null : driveMinutes(here, to));
	const directions = (v: (typeof visits)[number]) =>
		v.location === null
			? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.address)}`
			: `https://www.google.com/maps/dir/?api=1&destination=${v.location.lat},${v.location.lng}`;
</script>

<!-- sharing is the condition of the day: a quiet status line, nothing to switch off -->
{#snippet sharingLine()}
	<Inline gap="sm" align="center">
		<span class="size-2 shrink-0 rounded-full bg-success"></span>
		<p class="text-sm text-muted-foreground">{t('app.helper.sharing_on')}</p>
	</Inline>
{/snippet}

{#snippet visitCard(v: (typeof visits)[number], next: boolean)}
	{@const minutes = eta(v.location)}
	<div class="rounded-xl border bg-card p-5">
		<Stack gap="sm">
			<Cluster gap="xs" justify="between" align="center">
				<p class="text-lg font-semibold tabular-nums">{time(v.slot.start)} – {time(v.slot.end)}</p>
				{#if v.status === 'in_progress'}
					<Badge variant="info">{t('component.status_in_progress')}</Badge>
				{:else if next && isToday(v.slot.start) && minutes !== null}
					<!-- the next visit's drive is the one that can make them late; later ones are for planning -->
					<Badge variant={!next ? 'outline' : minutes > 30 ? 'warning' : 'success'}
						>{t('app.helper.minutes_away', { minutes })}</Badge
					>
				{/if}
			</Cluster>
			{#if !isToday(v.slot.start)}<p class="text-meta">{dayOf(v.slot.start)}</p>{/if}
			{#if next && v.shift_check === 'confirmed'}<p class="text-meta">
					{t('app.helper.day_confirmed')}
				</p>{/if}
			<Stack gap="xs">
				<p class="font-medium">{v.booking.customer.name} · {v.booking.service.name}</p>
				<p class="text-sm text-muted-foreground">{v.address}</p>
				{#if v.booking.notes}<p class="text-sm">{v.booking.notes}</p>{/if}
			</Stack>
			<Cluster gap="md">
				<a class="text-sm underline" href={directions(v)} target="_blank" rel="noopener"
					>{t('app.helper.directions')}</a
				>
				{#if v.booking.customer.phone}
					<a class="text-sm underline" href={`tel:${v.booking.customer.phone}`}
						>{t('app.helper.call_customer')}</a
					>
				{/if}
			</Cluster>
			{#if v.status === 'in_progress'}
				<Button size="lg" disabled={busy || !locationReady} onclick={() => (completing = v)}
					>{t('app.helper.complete')}</Button
				>
			{:else if next && current === undefined && isToday(v.slot.start)}
				<Button size="lg" disabled={busy || here === null} onclick={() => start(v.id)}
					>{t('app.helper.start')}</Button
				>
			{/if}
		</Stack>
	</div>
{/snippet}

<AppShell
	icon="lucide:sun"
	title={helper ? t('app.helper.greeting', { name: helper.name }) : t('app.helper.today_title')}
	description={t('app.helper.today_description')}
>
	<Scroll name="today" inset>
		<Center measure="reading">
			<Stack gap="lg" class="py-6">
				<Stack gap="sm">
					<Label for="route-date">{t('app.helper.date')}</Label>
					<DateInput
						id="route-date"
						value={selectedDay}
						onChange={(day) => (selectedDay = day ?? today)}
					/>
				</Stack>

				{#if actor?.kind === 'member' && me.current !== undefined && helper === undefined}<EmptyState
						title={t('app.helper.not_a_helper')}
					/>{/if}
				{#if helper !== undefined}
					{#if here !== null}{@render sharingLine()}{/if}
					{#if problem}<p class="text-sm text-destructive">{problem}</p>{/if}

					{#if away}
						<p role="status" class="border-b pb-5 font-medium">{t('app.helper.away_today')}</p>
					{:else if asked?.shift_check === 'declined'}
						<p role="status" class="border-b pb-5 font-medium">{t('app.helper.declined')}</p>
					{:else if asked && Date.parse(asked.slot.end!) > Date.now()}
						<Stack gap="sm" class="border-b pb-5">
							<p class="font-semibold">
								{t(
									asked.shift_check === 'confirmed'
										? 'app.helper.day_confirmed'
										: 'app.helper.confirm_title'
								)}
							</p>
							{#if asked.shift_check !== 'confirmed'}
								<p class="text-sm text-muted-foreground">
									{t('app.helper.confirm_body', { time: time(asked.slot.start) })}
								</p>
								<Button
									disabled={busy || !locationReady}
									onclick={() =>
										run(() => bolt.act('visits.confirm_shift', { target: asked.id, input: {} }))}
									>{t('app.helper.confirm_shift')}</Button
								>
							{/if}
							<details>
								<summary class="cursor-pointer py-2 text-sm"
									>{t('app.helper.decline_without_mc')}</summary
								>
								<Stack gap="sm" class="pt-2">
									<Button
										variant="outline"
										disabled={busy || !locationReady}
										onclick={() =>
											run(() =>
												bolt.act('visits.decline_shift', { target: asked.id, input: { mc: true } })
											)}>{t('app.helper.decline_with_mc')}</Button
									>
									<Button
										variant="outline"
										disabled={busy || !locationReady}
										onclick={() =>
											run(() =>
												bolt.act('visits.decline_shift', { target: asked.id, input: { mc: false } })
											)}>{t('app.helper.decline_without_mc')}</Button
									>
								</Stack>
							</details>
						</Stack>
					{/if}

					<Stack gap="md">
						<Cluster justify="between" align="center">
							<h2 class="text-lg font-semibold">{t('app.helper.route_title')}</h2>
							{#if routeUrl}<a
									class="text-sm underline"
									href={routeUrl}
									target="_blank"
									rel="noopener">{t('app.helper.route_start')}</a
								>{/if}
						</Cluster>
						<p class="text-sm text-muted-foreground">{t('app.helper.route_description')}</p>
						{#if open.current === undefined}<p>{t('component.loading')}</p>
						{:else if route.length === 0}<p>{t('app.helper.route_empty')}</p>
						{:else}
							<ol class="route">
								{#each route as v, i (v.id)}
									{@const state =
										v.status === 'done'
											? 'done'
											: v.status === 'in_progress'
												? 'now'
												: v.id === upcoming[0]?.id
													? 'next'
													: 'later'}
									{#if i > 0}
										<!-- the leg between two stops: the drive, and the slack left around it -->
										<li class="leg">
											<p class="text-caption">
												{t('app.helper.timeline_drive', {
													minutes: driveMinutes(route[i - 1]!.location, v.location)
												})} · {t('app.helper.timeline_spare', {
													minutes: Math.max(
														0,
														Math.round(
															(Date.parse(v.slot.start) - Date.parse(route[i - 1]!.slot.end!)) /
																60_000
														) - driveMinutes(route[i - 1]!.location, v.location)
													)
												})}
											</p>
										</li>
									{/if}
									<li class="stop" data-state={state}>
										{#if state === 'done'}
											<Cluster justify="between" gap="sm"
												><p class="text-sm text-muted-foreground">
													<span class="tabular-nums">{time(v.slot.start)}</span> · {v.address}
												</p>
												<Badge variant="success">{t('component.status_done')}</Badge></Cluster
											>
										{:else}{@render visitCard(v, state === 'next')}{/if}
									</li>
								{/each}
							</ol>
						{/if}
					</Stack>
				{/if}
			</Stack>
		</Center>
	</Scroll>
</AppShell>

<Sheet
	open={completing !== null}
	onOpenChange={(o) => {
		if (!o) completing = null;
	}}
	title={t('app.helper.complete_title')}
>
	{#if completing}
		<Stack gap="md">
			<p class="text-sm text-muted-foreground">
				{completing.booking.customer.name} · {completing.address}
			</p>
			<Stack gap="xs">
				<Label for="completion-notes">{t('app.helper.notes')}</Label>
				<Textarea
					id="completion-notes"
					rows={4}
					bind:value={notes}
					placeholder={t('app.helper.notes_hint')}
				/>
			</Stack>
			<Button size="lg" disabled={busy || !locationReady} onclick={complete}
				>{t('app.helper.mark_complete')}</Button
			>
		</Stack>
	{/if}
</Sheet>

<style>
	/* the day as a timeline: a line down the left, a dot per stop, a dashed line for each drive. Drawn with
	   backgrounds so the layout stays the primitives'. */
	.route li {
		--x: 0.6875rem;
		--line: linear-gradient(var(--color-border), var(--color-border)) var(--x) 0 / 2px 100%
			no-repeat;
		padding-left: 2rem;
	}
	.stop {
		--dot: var(--color-background);
		--ring: var(--color-border);
		background:
			radial-gradient(
				circle at calc(var(--x) + 1px) 1.5rem,
				var(--dot) 0.3rem,
				var(--ring) 0.32rem 0.45rem,
				transparent 0.47rem
			),
			var(--line);
	}
	.stop:first-child {
		background:
			radial-gradient(
				circle at calc(var(--x) + 1px) 1.5rem,
				var(--dot) 0.3rem,
				var(--ring) 0.32rem 0.45rem,
				transparent 0.47rem
			),
			linear-gradient(var(--color-border), var(--color-border)) var(--x) 1.5rem / 2px 100% no-repeat;
	}
	.stop:last-child {
		background:
			radial-gradient(
				circle at calc(var(--x) + 1px) 1.5rem,
				var(--dot) 0.3rem,
				var(--ring) 0.32rem 0.45rem,
				transparent 0.47rem
			),
			linear-gradient(var(--color-border), var(--color-border)) var(--x) 0 / 2px 1.5rem no-repeat;
	}
	.stop:only-child {
		background: radial-gradient(
			circle at calc(var(--x) + 1px) 1.5rem,
			var(--dot) 0.3rem,
			var(--ring) 0.32rem 0.45rem,
			transparent 0.47rem
		);
	}
	.stop[data-state='done'] {
		--dot: var(--color-success);
		--ring: var(--color-success);
	}
	.stop[data-state='next'],
	.stop[data-state='now'] {
		--dot: var(--color-primary);
		--ring: color-mix(in srgb, var(--color-primary) 35%, transparent);
	}
	.leg {
		padding-block: 0.75rem;
		background: repeating-linear-gradient(var(--color-border) 0 4px, transparent 4px 9px) var(--x)
			0 / 2px 100% no-repeat;
	}
	.stop[data-state='done'] {
		padding-block: 1.125rem;
	}
</style>
