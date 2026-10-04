<script lang="ts">
	/**
	 * The booking portal, standalone and embeddable: 1. what, where and who — the mobile number verified on the page, which
	 * signs a newcomer up; 2. a time among the service's open starts; 3. the confirmation, as the booking settles. A signed-in
	 * customer starts with their details filled in and can open their other bookings.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Instant } from '@norbital-ai/std/date';
	import { Center, Cluster, Grid, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import {
		Button,
		Icon,
		Input,
		Label,
		Section,
		PhoneVerify,
		PointInput,
		Spinner,
		Textarea
	} from '@norbital-ai/ui';
	import SlotPicker from '../../lib/SlotPicker.svelte';
	import Choice from '../../lib/Choice.svelte';
	import { live } from '../../lib/live.svelte.js';

	const t = bolt.t;
	const REPEATS = ['once', 'weekly', 'fortnightly', 'monthly'] as const;
	const me = bolt.actor?.kind === 'member' ? bolt.actor : null;
	const STEPS = ['details', 'time', 'done'] as const;
	function changeAddress(next: string | null) {
		if (next !== address) location = null;
		address = next ?? '';
	}

	// a returning customer starts with their details; typing replaces them
	const mine = live(() => (me === null ? null : bolt.read('customers', { limit: 1 })));
	const known = $derived(mine.current?.rows[0]);
	let service = $state<Id<'services'> | null>(null);
	let name = $derived(known?.name ?? '');
	let address = $derived(known?.address ?? '');
	let location = $derived<{ lat: number; lng: number } | null>(known?.location ?? null);
	let repeat = $state<(typeof REPEATS)[number]>('once');
	let notes = $state('');
	let preference = $state<'any' | 'preferred'>('any');
	let helper = $state<Id<'helpers'> | null>(null);
	let availability = $state<Id<'availability_requests'> | null>(null);
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
					select: { name: true, duration_minutes: true, description: true, skill: true },
					orderBy: { name: 'asc' },
					limit: 20
				})
	);
	const helpers = live(() =>
		me === null
			? null
			: bolt.read('helpers', {
					select: { name: true, skills: true },
					all: true
				})
	);
	const quote = live(() =>
		availability === null ? null : bolt.get('availability_requests', availability)
	);
	const days = $derived.by(() => {
		const by = new Map<string, string[]>();
		for (const start of quote.current?.starts ?? []) {
			const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(
				new Date(start)
			);
			by.set(day, [...(by.get(day) ?? []), start]);
		}
		return [...by].map(([day, starts]) => ({ day, starts }));
	});
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
	const mismatch = $derived(
		preference === 'preferred' &&
			helper !== null &&
			chosen !== undefined &&
			!helpers.current?.rows.find((h) => h.id === helper)?.skills.includes(chosen.skill)
	);
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
		me !== null &&
			service !== null &&
			name.trim() !== '' &&
			address.trim() !== '' &&
			(preference === 'any' || (helper !== null && !mismatch))
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

	async function chooseTime() {
		if (!ready || me?.phone == null || service === null) return;
		busy = true;
		error = null;
		start = null;
		availability = null;
		const outcome = await bolt.act('availability_requests.create', {
			phone: me.phone,
			service,
			address: address.trim(),
			...(location === null ? {} : { location }),
			preference,
			repeat,
			...(preference === 'preferred' && helper !== null ? { helper } : {})
		});
		busy = false;
		if (outcome.kind !== 'committed') {
			error = outcome.kind === 'refused' ? outcome.message : t('app.portal.failed');
			return;
		}
		availability = outcome.records[0]!.id as Id<'availability_requests'>;
		step = 'time';
	}
	async function confirm() {
		if (
			me === null ||
			me.phone === null ||
			service === null ||
			start === null ||
			availability === null ||
			quote.current?.status !== 'ready'
		)
			return;
		busy = true;
		error = null;
		const outcome = await bolt.act('booking_requests.create', {
			availability,
			name: name.trim(),
			phone: me.phone,
			address: address.trim(),
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

<Scroll name="portal-book" inset>
	<Center measure="reading">
		<Stack gap="lg" class="py-6 sm:py-8">
			<Stack as="header" gap="md">
				<h1 class="text-title">{t('app.portal.title')}</h1>
				<p class="text-sm text-muted-foreground" data-portal-org>{bolt.org.name}</p>
				<Inline as="ol" gap="lg" class="border-b pb-3 text-sm" aria-label={t('app.portal.title')}>
					{#each STEPS as s, i (s)}
						<li
							aria-current={step === s ? 'step' : undefined}
							class={step === s ? 'font-semibold' : 'text-muted-foreground'}
						>
							{i + 1}. {t(`app.portal.step_${s}`)}
						</li>
					{/each}
				</Inline>
			</Stack>

			{#if step === 'details'}
				{#if me === null}
					<Stack gap="md">
						<PhoneVerify session={bolt.session} />
					</Stack>
				{:else}
					<Stack gap="lg">
						<p class="text-sm text-muted-foreground">{me.phone} · {t('app.portal.verified')}</p>
						<Grid minimum="compact" gap="md">
							<Stack gap="sm">
								<Label for="portal-service">{t('app.portal.service')}</Label>
								<Choice
									id="portal-service"
									value={service ?? ''}
									onChange={(value) => {
										service = value ? (value as Id<'services'>) : null;
										start = null;
									}}
								>
									<option value="">{t('app.booking.select_service')}</option>
									{#each services.current?.rows ?? [] as s (s.id)}<option value={s.id}
											>{s.name}</option
										>{/each}
								</Choice>
								{#if chosen}<p class="text-caption">
										{chosen.description} · {t('app.booking.duration', {
											minutes: chosen.duration_minutes
										})}
									</p>{/if}
							</Stack>
							<Stack gap="sm">
								<Label for="portal-repeat">{t('app.portal.repeat')}</Label>
								<Choice
									id="portal-repeat"
									value={repeat}
									onChange={(value) => (repeat = value as typeof repeat)}
								>
									{#each REPEATS as r (r)}<option value={r}>{t(`component.repeat_${r}`)}</option
										>{/each}
								</Choice>
							</Stack>
						</Grid>
						<Stack gap="sm" class="booking-destination">
							<Label for="portal-address">{t('app.portal.address')}</Label>
							<PointInput
								id="portal-address"
								value={location}
								{address}
								onAddress={changeAddress}
								onChange={(next) => {
									// The picker sets a point before its address callback; apply the point after address invalidation.
									queueMicrotask(() => {
										location = next === null ? null : (next as { lat: number; lng: number });
									});
								}}
							/>
						</Stack>
						<Grid minimum="compact" gap="md">
							<Stack gap="sm">
								<Label for="portal-name">{t('app.portal.name')}</Label>
								<Input id="portal-name" class="min-h-11" autocomplete="name" bind:value={name} />
							</Stack>
							<Stack gap="sm">
								<Label for="preferred-helper">{t('app.booking.cleaner')}</Label>
								<Choice
									id="preferred-helper"
									value={helper ?? ''}
									onChange={(value) => {
										helper = value ? (value as Id<'helpers'>) : null;
										preference = helper === null ? 'any' : 'preferred';
									}}
								>
									<option value="">{t('app.booking.no_preference')}</option>
									{#each helpers.current?.rows ?? [] as h (h.id)}<option value={h.id}
											>{h.name}</option
										>{/each}
								</Choice>
								{#if mismatch}<p role="alert" class="text-sm text-destructive">
										{t('app.booking.skill_mismatch')}
									</p>{/if}
							</Stack>
						</Grid>
						<Section
							name="notes"
							title={t('app.portal.notes')}
							defaultOpen={false}
							summary={notes.trim() || t('app.portal.no_notes')}
						>
							<Textarea
								id="portal-notes"
								aria-label={t('app.portal.notes')}
								rows={3}
								bind:value={notes}
							/>
						</Section>
						{#if error !== null}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
						<Button size="lg" class="w-full" disabled={!ready || busy} onclick={chooseTime}>
							{#if busy}<Spinner class="size-4" />{/if}{t('app.portal.choose_time')}
						</Button>
					</Stack>
				{/if}
			{:else if step === 'time'}
				<Stack gap="lg">
					<p class="text-sm text-muted-foreground">{chosen?.name} · {address}</p>
					{#if quote.current == null || quote.current.status === 'pending'}
						<Spinner class="h-4 w-4" />
					{:else if quote.current.status === 'failed'}
						<p role="alert" class="text-sm text-destructive">{quote.current.problem}</p>
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
					{#if quote.current?.estimated}<p class="text-caption">
							{t('app.booking.travel_estimated')}
						</p>{/if}
					{#if error !== null}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
					<Stack gap="sm">
						<Button
							size="lg"
							class="w-full"
							disabled={start === null || busy || quote.current?.status !== 'ready'}
							onclick={confirm}
						>
							{#if busy}<Spinner class="h-4 w-4" />{/if}{t('app.portal.confirm')}
						</Button>
						<Button
							variant="ghost"
							class="w-full"
							onclick={() => {
								step = 'details';
								start = null;
								availability = null;
							}}>{t('app.portal.back')}</Button
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
