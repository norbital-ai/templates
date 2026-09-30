<script lang="ts">
	/**
	 * The booking portal, standalone and embeddable: 1. what, where and who — the mobile number verified on the page, which
	 * signs a newcomer up; 2. a time among the service's open starts; 3. the confirmation, as the booking settles. A signed-in
	 * customer starts with their details filled in and can open their other bookings.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Instant } from '@norbital-ai/std/date';
	import { Center, Cluster, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import {
		Badge,
		Button,
		Icon,
		Input,
		Label,
		PhoneVerify,
		Spinner,
		Textarea
	} from '@norbital-ai/ui';
	import SlotPicker from '../../lib/SlotPicker.svelte';
	import { live } from '../../lib/live.svelte.js';

	const t = bolt.t;
	const AREAS = ['central', 'north', 'north_east', 'east', 'west'] as const;
	const REPEATS = ['once', 'weekly', 'fortnightly', 'monthly'] as const;
	const me = bolt.actor?.kind === 'member' ? bolt.actor : null;
	const STEPS = ['details', 'time', 'done'] as const;

	// a returning customer starts with their details; typing replaces them
	const mine = live(() => (me === null ? null : bolt.read('customers', { limit: 1 })));
	const known = $derived(mine.current?.rows[0]);
	let service = $state<Id<'services'> | null>(null);
	let name = $derived(known?.name ?? '');
	let address = $derived(known?.address ?? '');
	let area = $derived<(typeof AREAS)[number] | null>(known?.area ?? null);
	let repeat = $state<(typeof REPEATS)[number]>('once');
	let notes = $state('');
	let step = $state<'details' | 'time' | 'done'>('details');
	let start = $state<string | null>(null);
	let request = $state<Id<'booking_requests'> | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);

	// read once verified: until then the page is the number alone
	const services = live(() =>
		me === null
			? null
			: bolt.read('services', {
					select: { name: true, duration_minutes: true, description: true },
					orderBy: { name: 'asc' },
					limit: 20
				})
	);
	const openings = live(
		() =>
			service === null
				? null
				: bolt.read('openings', {
						where: { service: { eq: service } },
						orderBy: { day: 'asc' },
						limit: 14
					}),
		['openings']
	);
	const days = $derived((openings.current?.rows ?? []).filter((o) => o.starts.length > 0));
	const settled = live(() =>
		request === null
			? null
			: bolt.get('booking_requests', request, {
					status: true,
					number: true,
					start: true,
					booking: true
				})
	);
	const chosen = $derived(services.current?.rows.find((s) => s.id === service));
	/** The booking's first visit, once it is booked: who comes, and exactly when. */
	const first = live(() => {
		const booking = settled.current?.booking;
		return booking == null
			? null
			: bolt.read('visits', {
					where: { booking: { eq: booking } },
					select: { slot: true, helper: { select: { name: true } } },
					orderBy: { number: 'asc' },
					limit: 1
				});
	}, ['visits', 'helpers']);
	const visitSpan = (slot: { start: string; end: string | null } | null, fallback: string) => {
		const from = slot?.start ?? fallback;
		const to =
			slot?.end ??
			new Date(Date.parse(from) + (chosen?.duration_minutes ?? 60) * 60_000).toISOString();
		return `${when(from)} – ${time(to)}`;
	};
	/** What the confirmation lists: the visit, where, who comes (once matched) and the reference. */
	const summary = $derived.by(() => {
		const r = settled.current;
		if (r == null) return [];
		const visit = first.current?.rows[0];
		return [
			{ icon: 'lucide:sparkles', label: t('app.portal.row_service'), value: chosen?.name ?? '' },
			{
				icon: 'lucide:calendar-clock',
				label: t('app.portal.row_when'),
				value: visitSpan(visit?.slot ?? null, r.start)
			},
			{
				icon: 'lucide:repeat',
				label: t('app.portal.row_repeat'),
				value: t(`component.repeat_${repeat}`)
			},
			{ icon: 'lucide:map-pin', label: t('app.portal.row_where'), value: address },
			...(r.status === 'booked' && visit?.helper
				? [
						{
							icon: 'lucide:user-round-check',
							label: t('app.portal.row_helper'),
							value: visit.helper.name
						}
					]
				: []),
			{ icon: 'lucide:hash', label: t('app.portal.row_reference'), value: r.number }
		];
	});
	/** The visit as a calendar file the customer's phone opens in its own calendar. */
	function addToCalendar(reference: string) {
		const slot = first.current?.rows[0]?.slot;
		if (slot == null) return;
		const stamp = (i: string) => i.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
		const end =
			slot.end ??
			new Date(Date.parse(slot.start) + (chosen?.duration_minutes ?? 60) * 60_000).toISOString();
		const ics = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//booking portal//EN',
			'BEGIN:VEVENT',
			`UID:${reference}@portal`,
			`DTSTAMP:${stamp(new Date().toISOString())}`,
			`DTSTART:${stamp(slot.start)}`,
			`DTEND:${stamp(end)}`,
			`SUMMARY:${chosen?.name ?? ''}`,
			`LOCATION:${address.replace(/[,;]/g, (c) => `\\${c}`)}`,
			`DESCRIPTION:${reference}`,
			'END:VEVENT',
			'END:VCALENDAR'
		].join('\r\n');
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
		a.download = `${reference}.ics`;
		a.click();
		URL.revokeObjectURL(a.href);
	}
	const ready = $derived(
		me !== null && service !== null && name.trim() !== '' && address.trim() !== '' && area !== null
	);

	const time = (i: string) =>
		new Intl.DateTimeFormat(bolt.locale, { hour: 'numeric', minute: '2-digit' }).format(
			new Date(i)
		);
	const when = (i: string) =>
		new Intl.DateTimeFormat(bolt.locale, {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(i));

	async function confirm() {
		if (me === null || me.phone === null || service === null || area === null || start === null)
			return;
		busy = true;
		error = null;
		const outcome = await bolt.act('booking_requests.create', {
			name: name.trim(),
			phone: me.phone,
			address: address.trim(),
			area: area,
			service: service,
			start: Instant(start),
			repeat: repeat,
			...(notes.trim() === '' ? {} : { notes: notes.trim() })
		});
		busy = false;
		if (outcome.kind !== 'committed') {
			error = outcome.kind === 'refused' ? outcome.message : t('app.portal.failed');
			return;
		}
		request = outcome.records[0]!.id as Id<'booking_requests'>;
		step = 'done';
	}
	function again() {
		request = null;
		start = null;
		step = 'details';
	}
</script>

{#snippet chip(selected: boolean, label: string, pick: () => void)}
	<Button size="sm" class="shrink-0" variant={selected ? 'default' : 'outline'} onclick={pick}
		>{label}</Button
	>
{/snippet}

<Scroll name="portal-book" inset>
	<Center measure="narrow">
		<Stack gap="lg" class="py-6">
			<Stack gap="xs">
				<p class="text-caption" data-portal-org>{bolt.org.name}</p>
				<Inline gap="sm" align="center">
					<Icon name="lucide:calendar-heart" class="size-6 text-brand" />
					<h1 class="text-title">{t('app.portal.title')}</h1>
				</Inline>
				<Cluster gap="xs">
					{#each STEPS as s, i (s)}
						<Badge variant={step === s ? 'default' : 'outline'}
							>{i + 1}. {t(`app.portal.step_${s}`)}</Badge
						>
					{/each}
				</Cluster>
			</Stack>

			{#if step === 'details'}
				<Stack gap="lg">
					{#if me === null}
						<PhoneVerify session={bolt.session} />
					{:else}
						<Stack gap="xs">
							<Label>{t('app.portal.phone')}</Label>
							<Cluster gap="xs">
								<p class="text-sm">{me.phone}</p>
								<Badge variant="success">{t('app.portal.verified')}</Badge>
							</Cluster>
						</Stack>
					{/if}
					{#if me !== null}
						<Stack gap="sm">
							<Label>{t('app.portal.service')}</Label>
							{#if services.current === undefined}
								<Spinner class="h-4 w-4" />
							{:else}
								<Stack gap="xs">
									{#each services.current.rows as s (s.id)}
										<button
											type="button"
											class="rounded-lg border p-3 text-left transition-colors hover:bg-muted aria-pressed:border-primary aria-pressed:bg-muted"
											aria-pressed={service === s.id}
											onclick={() => ((service = s.id), (start = null))}
										>
											<p class="text-sm font-medium">{s.name}</p>
											{#if s.description}<p class="text-caption">{s.description}</p>{/if}
										</button>
									{/each}
								</Stack>
							{/if}
						</Stack>
						<Stack gap="sm">
							<Label for="portal-address">{t('app.portal.address')}</Label>
							<Input id="portal-address" autocomplete="street-address" bind:value={address} />
							<Cluster gap="xs">
								{#each AREAS as a (a)}
									{@render chip(area === a, t(`component.area_${a}`), () => (area = a))}
								{/each}
							</Cluster>
						</Stack>
						<Stack gap="sm">
							<Label>{t('app.portal.repeat')}</Label>
							<Cluster gap="xs">
								{#each REPEATS as r (r)}
									{@render chip(repeat === r, t(`component.repeat_${r}`), () => (repeat = r))}
								{/each}
							</Cluster>
						</Stack>
						<Stack gap="sm">
							<Label for="portal-name">{t('app.portal.name')}</Label>
							<Input id="portal-name" autocomplete="name" bind:value={name} />
						</Stack>
						<Stack gap="sm">
							<Label for="portal-notes">{t('app.portal.notes')}</Label>
							<Textarea id="portal-notes" rows={2} bind:value={notes} />
						</Stack>
						<Button class="w-full" disabled={!ready} onclick={() => (step = 'time')}>
							{t('app.portal.choose_time')}
						</Button>
					{/if}
				</Stack>
			{:else if step === 'time'}
				<Stack gap="lg">
					<p class="text-sm text-muted-foreground">{chosen?.name} · {address}</p>
					{#if openings.current === undefined}
						<Spinner class="h-4 w-4" />
					{:else if days.length === 0}
						<p class="text-sm">{t('app.portal.no_times')}</p>
					{:else}
						<SlotPicker
							{days}
							minutes={chosen?.duration_minutes ?? 60}
							value={start}
							locale={bolt.locale}
							onPick={(s) => (start = s)}
							t={(k) => t(k as never)}
						/>
					{/if}
					{#if error !== null}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
					<Stack gap="sm">
						<Button size="lg" class="w-full" disabled={start === null || busy} onclick={confirm}>
							{#if busy}<Spinner class="h-4 w-4" />{/if}{t('app.portal.confirm')}
						</Button>
						<Button variant="ghost" class="w-full" onclick={() => (step = 'details')}
							>{t('app.portal.back')}</Button
						>
					</Stack>
				</Stack>
			{:else}
				{@const r = settled.current}
				{#if r == null || r.status === 'received'}
					<Stack gap="md" align="center" class="py-12 text-center">
						<Spinner class="h-6 w-6" />
						<p class="text-subhead">{t('app.portal.confirming')}</p>
					</Stack>
				{:else}
					{@const booked = r.status === 'booked'}
					<Stack gap="lg">
						<Stack gap="sm" align="center" class="pt-4 text-center">
							<Stack
								as="span"
								align="center"
								justify="center"
								class={[
									'size-14 rounded-full',
									booked ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
								]}
							>
								<Icon name={booked ? 'lucide:check' : 'lucide:clock'} class="size-7" />
							</Stack>
							<h2 class="text-title">
								{booked ? t('app.portal.booked_title') : t('app.portal.follow_up_title')}
							</h2>
							<p class="max-w-[40ch] text-sm text-muted-foreground">
								{booked ? t('app.portal.booked_body') : t('app.portal.follow_up_body')}
							</p>
						</Stack>
						<Stack as="dl" gap="none" divided class="rounded-xl border bg-card text-sm">
							{#each summary as row (row.label)}
								<Inline gap="sm" align="start" class="px-4 py-3">
									<Icon name={row.icon} class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
									<dt class="w-24 shrink-0 text-muted-foreground">{row.label}</dt>
									<dd class="min-w-0 font-medium">{row.value}</dd>
								</Inline>
							{/each}
						</Stack>
						<Stack gap="sm">
							{#if booked}
								<Button variant="outline" class="w-full" onclick={() => addToCalendar(r.number)}>
									<Icon name="lucide:calendar-plus" class="size-4" />{t(
										'app.portal.add_to_calendar'
									)}
								</Button>
							{/if}
							<Button class="w-full" href="visits">{t('app.portal.my_bookings')}</Button>
							<Button variant="ghost" class="w-full" onclick={again}
								>{t('app.portal.another')}</Button
							>
						</Stack>
					</Stack>
				{/if}
			{/if}

			{#if me !== null && step !== 'done'}
				<a class="text-center text-sm underline underline-offset-4" href="visits"
					>{t('app.portal.my_bookings')}</a
				>
			{/if}
		</Stack>
	</Center>
</Scroll>
