<script lang="ts">
	/**
	 * A helper's day on their phone: the visit under way, the ones still to come with the drive to each from where the
	 * phone is now, the shift check to answer, and one tap to start and to finish. While the page is open the phone's
	 * position is shared with the scheduler (at most every two minutes).
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Instant } from '@norbital-ai/std/date';
	import { AppShell, Cluster, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Badge, Button, Label, Sheet, Textarea } from '@norbital-ai/ui';
	import { live } from '../../lib/live.svelte.js';
	import { driveMinutes, type Point } from '../../lib/matching.js';

	const t = bolt.t;
	/** Position reports at most this often. */
	const EVERY_MS = 120_000;
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
	const midnight = new Date();
	midnight.setHours(0, 0, 0, 0);
	const VISIT = {
		number: true,
		slot: true,
		address: true,
		location: true,
		status: true,
		shift_check: true,
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
						slot: {
							overlaps: {
								start: Instant(midnight.toISOString()),
								end: Instant(new Date(midnight.getTime() + 7 * DAY_MS).toISOString())
							}
						}
					},
					select: VISIT,
					limit: 50
				})
	);
	const done = live(() =>
		helper === undefined
			? null
			: bolt.read('visits', {
					where: {
						helper: { eq: helper.id },
						status: { eq: 'done' },
						completed_at: { gte: Instant(midnight.toISOString()) }
					},
					select: { number: true, slot: true, address: true, completed_at: true },
					limit: 20
				})
	);
	const visits = $derived(
		[...(open.current?.rows ?? [])].sort((a, b) => a.slot.start.localeCompare(b.slot.start))
	);
	const current = $derived(visits.find((v) => v.status === 'in_progress'));
	const upcoming = $derived(visits.filter((v) => v.status === 'scheduled'));
	const asked = $derived(upcoming.find((v) => v.shift_check === 'asked'));

	// ── position ──
	let here = $state<Point | null>(null);
	let sharing = $state(true);
	let denied = $state(false);
	let sent = $state(0);
	$effect(() => {
		if (!sharing || helper === undefined || !('geolocation' in navigator)) return;
		const id = helper.id;
		const watch = navigator.geolocation.watchPosition(
			({ coords }) => {
				here = { lat: coords.latitude, lng: coords.longitude };
				denied = false;
				if (Date.now() - sent < EVERY_MS) return;
				sent = Date.now();
				void bolt.act('helpers.update', { target: id, set: { last_location: here } });
			},
			() => (denied = true),
			{ enableHighAccuracy: true }
		);
		return () => navigator.geolocation.clearWatch(watch);
	});

	// ── acting ──
	let problem = $state<string | null>(null);
	let busy = $state(false);
	let completing = $state<(typeof visits)[number] | null>(null);
	let notes = $state('');
	async function run(outcome: Promise<{ kind: string; message?: string }>) {
		busy = true;
		const o = await outcome;
		problem = o.kind === 'refused' ? (o.message ?? null) : null;
		busy = false;
		return o.kind === 'committed';
	}
	const start = (id: Id<'visits'>) =>
		run(bolt.act('visits.update', { target: id, set: { status: 'in_progress' } }));
	async function complete() {
		if (completing === null) return;
		const ok = await run(
			bolt.act('visits.update', {
				target: completing.id,
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
	const isToday = (i: string) => Date.parse(i) < midnight.getTime() + DAY_MS;
	const eta = (to: Point | null) => (here === null || to === null ? null : driveMinutes(here, to));
	const directions = (v: (typeof visits)[number]) =>
		v.location === null
			? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.address)}`
			: `https://www.google.com/maps/dir/?api=1&destination=${v.location.lat},${v.location.lng}`;
</script>

<!-- where the phone's position stands: one quiet line, not a header button -->
{#snippet sharingLine()}
	<Cluster gap="sm" justify="between" align="center">
		<p class="text-sm text-muted-foreground">
			{sharing ? t('app.helper.sharing_on') : t('app.helper.sharing_off')}
		</p>
		<Button size="sm" variant="ghost" onclick={() => (sharing = !sharing)}
			>{sharing ? t('app.helper.stop_sharing') : t('app.helper.share_location')}</Button
		>
	</Cluster>
{/snippet}

{#snippet visitCard(v: (typeof visits)[number], next: boolean)}
	{@const minutes = eta(v.location)}
	<div class="rounded-xl border bg-card p-4 shadow-sm">
		<Stack gap="sm">
			<Cluster gap="xs" justify="between" align="center">
				<p class="text-lg font-semibold tabular-nums">{time(v.slot.start)} – {time(v.slot.end)}</p>
				{#if v.status === 'in_progress'}
					<Badge variant="info">{t('component.status_in_progress')}</Badge>
				{:else if minutes !== null}
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
				<Button size="lg" disabled={busy} onclick={() => (completing = v)}
					>{t('app.helper.complete')}</Button
				>
			{:else if next && current === undefined}
				<Button size="lg" disabled={busy} onclick={() => start(v.id)}
					>{t('app.helper.start')}</Button
				>
			{/if}
		</Stack>
	</div>
{/snippet}

<AppShell
	icon="lucide:sun"
	title={helper ? t('app.helper.greeting', { name: helper.name }) : t('app.helper.today_title')}
	description={denied ? t('app.helper.location_denied') : t('app.helper.today_description')}
>
	<Scroll name="today" inset>
		<Stack gap="lg">
			{#if helper !== undefined}{@render sharingLine()}{/if}
			{#if actor?.kind === 'member' && me.current !== undefined && helper === undefined}
				<p class="text-caption">{t('app.helper.not_a_helper')}</p>
			{/if}
			{#if problem}<p class="text-sm text-destructive">{problem}</p>{/if}

			{#if asked}
				<div class="rounded-xl border border-warning bg-card p-4 shadow-sm">
					<Stack gap="sm">
						<p class="font-semibold">{t('app.helper.confirm_title')}</p>
						<p class="text-sm text-muted-foreground">
							{t('app.helper.confirm_body', { time: time(asked.slot.start) })}
						</p>
						<Cluster gap="xs">
							<Button
								disabled={busy}
								onclick={() =>
									run(bolt.act('visits.confirm_shift', { target: asked.id, input: {} }))}
								>{t('app.helper.confirm_shift')}</Button
							>
							<Button
								variant="outline"
								disabled={busy}
								onclick={() =>
									run(bolt.act('visits.decline_shift', { target: asked.id, input: { mc: true } }))}
								>{t('app.helper.decline_with_mc')}</Button
							>
							<Button
								variant="ghost"
								disabled={busy}
								onclick={() =>
									run(bolt.act('visits.decline_shift', { target: asked.id, input: { mc: false } }))}
								>{t('app.helper.decline_without_mc')}</Button
							>
						</Cluster>
					</Stack>
				</div>
			{/if}

			{#if current}
				<Stack gap="sm">
					<Label>{t('app.helper.now')}</Label>
					{@render visitCard(current, false)}
				</Stack>
			{/if}

			<Stack gap="sm">
				<Label>{t('app.helper.next')}</Label>
				{#if open.current === undefined && helper !== undefined}
					<p class="text-caption">{t('component.loading')}</p>
				{:else if upcoming.length === 0}
					<p class="text-caption">{t('app.helper.nothing_next')}</p>
				{:else}
					{#each upcoming as v, i (v.id)}
						{@render visitCard(v, i === 0)}
					{/each}
				{/if}
			</Stack>

			{#if (done.current?.rows.length ?? 0) > 0}
				<Stack gap="sm">
					<Label>{t('app.helper.done_today')}</Label>
					{#each done.current?.rows ?? [] as v (v.id)}
						<Cluster gap="xs" justify="between">
							<p class="text-sm">{time(v.slot.start)} · {v.address}</p>
							<Badge variant="success"
								>{t('app.helper.finished_at', { time: time(v.completed_at) })}</Badge
							>
						</Cluster>
					{/each}
				</Stack>
			{/if}
		</Stack>
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
			<Button size="lg" disabled={busy} onclick={complete}>{t('app.helper.mark_complete')}</Button>
		</Stack>
	{/if}
</Sheet>
