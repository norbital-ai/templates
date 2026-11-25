<script lang="ts">
	import { DateTime } from 'effect';
	import {
		Alert,
		Badge,
		Button,
		Combobox,
		EmptyState,
		format,
		Icon,
		Input,
		Label,
		PhoneVerify,
		PointInput,
		Section,
		Spinner,
		Textarea,
		type Point,
		use_act
	} from '@norbital-ai/ui';
	import type { Id } from '@norbital-ai/bolt';
	import type { PublicPageContext } from '@norbital-ai/bolt/page';
	import {
		AppShell,
		Bound,
		Center,
		Cluster,
		Grid,
		Inline,
		Scroll,
		Stack,
		Surface
	} from '@norbital-ai/ui/layout';
	import SlotPicker from '../../lib/SlotPicker.svelte';
	import { formatCalendarDate } from '../../lib/format.js';
	import { normalizeSkill, REPEATS } from '../../lib/matching.js';

	let { ctx }: { ctx: PublicPageContext } = $props();
	const uid = $props.id();
	const t = (...args: Parameters<PublicPageContext['t']>) => ctx.t(...args);
	const zone = $derived(ctx.tz);
	const minuteClock = $derived(ctx.clock('minute'));
	const me = $derived(ctx.actor?.kind === 'member' ? ctx.actor : null);
	const repeatWord = (value: (typeof REPEATS)[number]) =>
		ctx.t(`models.bookings.fields.repeat.${value}`);
	const STEPS = ['details', 'time', 'done'] as const;

	const catalog = $derived(
		me !== null
			? null
			: ctx.query({
					services: {
						output: 'portal',
						fields: ['name', 'category', 'duration_minutes', 'price', 'description'],
						order_by: { name: 'asc' },
						limit: 50
					},
					openings: {
						output: 'portal',
						fields: ['service', 'day', 'starts'],
						order_by: { day: 'asc' },
						limit: 500
					}
				})
	);
	const openingSummary = $derived.by(() => {
		const by = new Map<Id<'services'>, { count: number; nextDay: string | null }>();
		for (const row of catalog?.current?.openings.rows ?? []) {
			if (row.starts.length === 0) continue;
			const cur = by.get(row.service);
			if (cur === undefined) by.set(row.service, { count: row.starts.length, nextDay: row.day });
			else cur.count += row.starts.length;
		}
		return by;
	});

	const reads = $derived(
		me === null
			? null
			: ctx.query({
					customers: { output: 'customer', fields: ['name', 'address', 'location'], limit: 1 },
					services: {
						output: 'customer',
						fields: ['name', 'duration_minutes', 'description', 'skill'],
						order_by: { name: 'asc' },
						limit: 50
					},
					providers: { output: 'customer', fields: ['name', 'skills'], limit: 100 }
				})
	);
	const answer = $derived(reads?.current);
	const known = $derived(answer?.customers?.rows[0]);

	let service = $state<Id<'services'> | null>(null);
	let nameOverride = $state<string | null>(null);
	let addressOverride = $state<string | null>(null);
	let locationOverride = $state<Point | null | undefined>(undefined);
	const name = $derived(nameOverride ?? known?.name ?? '');
	const address = $derived(addressOverride ?? known?.address ?? '');
	const location = $derived<Point | null>(
		locationOverride === undefined ? (known?.location ?? null) : locationOverride
	);

	let repeat = $state<(typeof REPEATS)[number]>('once');
	let notes = $state('');
	let preference = $state<'any' | 'preferred'>('any');
	let provider = $state<Id<'providers'> | null>(null);
	let availability = $state<Id<'availability_requests'> | null>(null);
	let step = $state<'details' | 'time' | 'done'>('details');
	let start = $state<string | null>(null);
	let request = $state<Id<'booking_requests'> | null>(null);

	function changeAddress(next: string | null) {
		if (next !== address) locationOverride = null;
		addressOverride = next ?? '';
	}

	const quote = $derived(
		availability === null
			? null
			: ctx.query({
					availability_requests: {
						output: 'customer',
						where: { id: { eq: availability } },
						limit: 1
					}
				})
	);
	const quoted = $derived(quote?.current?.availability_requests.rows[0]);
	const days = $derived.by(() => {
		const by = new Map<string, string[]>();
		for (const s of quoted?.starts ?? []) {
			const day = DateTime.formatIsoDate(DateTime.makeZonedUnsafe(s, { timeZone: zone }));
			by.set(day, [...(by.get(day) ?? []), s]);
		}
		return [...by].map(([day, starts]) => ({ day, starts }));
	});

	const settled = $derived(
		request === null
			? null
			: ctx.query({
					booking_requests: {
						output: 'customer',
						where: { id: { eq: request } },
						fields: ['status', 'number', 'start', 'booking'],
						limit: 1
					}
				})
	);
	const settledRow = $derived(settled?.current?.booking_requests.rows[0]);
	const chosen = $derived(answer?.services?.rows.find((s) => s.id === service));
	const mismatch = $derived.by(() => {
		if (preference !== 'preferred' || provider === null || chosen === undefined) return false;
		const row = answer?.providers?.rows.find((p) => p.id === provider);
		if (row === undefined) return false;
		const want = normalizeSkill(chosen.skill);
		return !row.skills.some((s) => normalizeSkill(s) === want);
	});

	const first = $derived.by(() => {
		const booking = settledRow?.booking;
		return booking == null
			? null
			: ctx.query({
					appointments: {
						output: 'customer',
						where: { booking: { eq: booking } },
						fields: ['slot', 'provider'],
						order_by: { number: 'asc' },
						limit: 1,
						provider: { fields: ['name'] }
					}
				});
	});

	const summary = $derived.by(() => {
		const r = settledRow;
		if (r == null) return [];
		const appt = first?.current?.appointments.rows[0];
		return [
			{ icon: 'lucide:briefcase', label: t('app.portal.row_service'), value: chosen?.name ?? '' },
			{
				icon: 'lucide:calendar-clock',
				label: t('app.portal.row_when'),
				value: format(
					{ kind: 'period', of: 'instant' },
					appt?.slot ?? {
						start: r.start,
						end: DateTime.formatIso(
							DateTime.add(DateTime.makeUnsafe(r.start), {
								minutes: chosen?.duration_minutes ?? 60
							})
						)
					},
					{ locale: ctx.locale, zone }
				)
			},
			{
				icon: 'lucide:repeat',
				label: t('app.portal.row_repeat'),
				value: repeatWord(repeat)
			},
			{ icon: 'lucide:map-pin', label: t('app.portal.row_where'), value: address },
			...(r.status === 'booked' && appt?.provider
				? [
						{
							icon: 'lucide:user-round-check',
							label: t('app.portal.row_provider'),
							value: appt.provider.name
						}
					]
				: []),
			{ icon: 'lucide:hash', label: t('app.portal.row_reference'), value: r.number }
		];
	});

	function addToCalendar(reference: string) {
		const slot = first?.current?.appointments.rows[0]?.slot;
		if (slot == null) return;
		const end =
			slot.end ??
			DateTime.formatIso(
				DateTime.add(DateTime.makeUnsafe(slot.start), { minutes: chosen?.duration_minutes ?? 60 })
			);
		const ics = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//booking portal//EN',
			'BEGIN:VEVENT',
			`UID:${reference}@portal`,
			`DTSTAMP:${minuteClock.now.replace(/[-:]|\.\d{3}/g, '')}`,
			`DTSTART:${slot.start.replace(/[-:]|\.\d{3}/g, '')}`,
			`DTEND:${end.replace(/[-:]|\.\d{3}/g, '')}`,
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
			(preference === 'any' || (provider !== null && !mismatch))
	);
	const save = use_act(ctx);

	function chooseTime() {
		const phone = me?.phone;
		const selectedService = service;
		if (!ready || phone == null || selectedService === null) return;
		start = null;
		availability = null;
		save.run(
			ctx.act({
				'availability_requests.create': [
					{
						phone,
						service: selectedService,
						address: address.trim(),
						...(location === null ? {} : { location }),
						preference,
						repeat,
						...(preference === 'preferred' && provider !== null ? { provider } : {})
					}
				]
			}),
			{
				then: (outcome) => {
					const record =
						outcome.kind === 'committed'
							? outcome.records.find((r) => r.model === 'availability_requests')
							: undefined;
					if (record === undefined) return;
					availability = record.id;
					step = 'time';
				}
			}
		);
	}

	function confirm() {
		const phone = me?.phone;
		const selectedService = service;
		const selectedStart = start;
		const selectedAvailability = availability;
		if (
			phone == null ||
			selectedService === null ||
			selectedStart === null ||
			selectedAvailability === null ||
			quoted?.status !== 'ready'
		)
			return;
		save.run(
			ctx.act({
				'booking_requests.create': [
					{
						availability: selectedAvailability,
						name: name.trim(),
						phone,
						address: address.trim(),
						service: selectedService,
						start: selectedStart,
						repeat,
						...(notes.trim() === '' ? {} : { notes: notes.trim() })
					}
				]
			}),
			{
				then: (outcome) => {
					const record =
						outcome.kind === 'committed'
							? outcome.records.find((r) => r.model === 'booking_requests')
							: undefined;
					if (record === undefined) return;
					request = record.id;
					step = 'done';
				}
			}
		);
	}

	function again() {
		request = null;
		start = null;
		step = 'details';
	}
</script>

<AppShell
	icon="lucide:calendar-heart"
	title={t('app.portal.tab_book')}
	description={t('app.portal.description')}
	variant="full"
>
	<Scroll name="portal-book" size="fill" inset>
		<Center measure="reading">
			<Stack gap="lg">
				<Surface as="header" tone="subtle" padding="sm" radius="control">
					<Stack gap="sm">
						<p class="text-sm text-muted-foreground" data-portal-org>{ctx.org.name}</p>
						<Inline as="ol" gap="lg" class="text-sm" aria-label={t('app.portal.title')}>
							{#each STEPS as s, i (s)}
								<li
									aria-current={step === s ? 'step' : undefined}
									class={step === s ? 'text-label' : 'text-muted-foreground'}
								>
									{i + 1}. {t(`app.portal.step_${s}`)}
								</li>
							{/each}
						</Inline>
					</Stack>
				</Surface>

				{#if step === 'details'}
					{#if me === null}
						<Stack gap="lg">
							{#if catalog?.error}
								<Alert.Root variant="destructive">
									<Alert.Title>{catalog.error.message}</Alert.Title>
								</Alert.Root>
							{:else if catalog?.current === undefined}
								<Surface tone="subtle" padding="md" radius="control" role="status" aria-busy="true">
									<Inline gap="sm" align="center">
										<Spinner />
										<span class="text-sm text-muted-foreground">{t('component.loading')}</span>
									</Inline>
								</Surface>
							{:else if catalog.current.services.rows.length > 0}
								<Stack gap="sm">
									<h2 class="text-overline">{t('app.portal.browse_services')}</h2>
									<Grid minimum="card" gap="sm">
										{#each catalog.current.services.rows as item (item.id)}
											{@const stats = openingSummary.get(item.id)}
											{@const selected = service === item.id}
											<Bound
												as="button"
												type="button"
												pad="sm"
												aria-pressed={selected}
												onclick={() => (service = item.id)}
												class={[
													'rounded-control border text-left transition-colors',
													selected
														? 'border-brand bg-surface-hover'
														: 'border-border-control bg-surface-card hover:bg-surface-hover'
												]}
											>
												<Stack gap="xs">
													<Cluster gap="xs" justify="between" align="center">
														<span class="text-heading">{item.name}</span>
														{#if item.category}
															<Badge variant="outline">{item.category}</Badge>
														{/if}
													</Cluster>
													{#if item.description}
														<p class="text-sm text-muted-foreground">{item.description}</p>
													{/if}
													<p class="text-meta tabular-nums">
														{t('app.booking.duration', { minutes: item.duration_minutes })} · {format(
															{ kind: 'money' },
															item.price,
															{ locale: ctx.locale }
														)}
													</p>
													{#if stats && stats.nextDay !== null}
														<p class="text-caption">
															{t('app.portal.open_slots_next', {
																count: stats.count,
																day: formatCalendarDate(
																	stats.nextDay,
																	{ weekday: 'short', day: 'numeric', month: 'short' },
																	ctx.locale
																)
															})}
														</p>
													{/if}
												</Stack>
											</Bound>
										{/each}
									</Grid>
								</Stack>
							{/if}

							<Stack gap="sm">
								<p class="text-sm text-muted-foreground">{t('app.portal.verify_to_book')}</p>
								<PhoneVerify {ctx} session={ctx.session} />
							</Stack>
						</Stack>
					{:else if reads?.error}
						<Alert.Root variant="destructive">
							<Alert.Title>{reads.error.message}</Alert.Title>
						</Alert.Root>
					{:else if answer === undefined}
						<Surface tone="subtle" padding="md" radius="control" role="status" aria-busy="true">
							<Inline gap="sm" align="center">
								<Spinner />
								<span class="text-sm text-muted-foreground">{t('component.loading')}</span>
							</Inline>
						</Surface>
					{:else}
						<Stack gap="lg">
							<p class="text-sm text-muted-foreground">{me.phone} · {t('app.portal.verified')}</p>
							<Grid minimum="card" gap="md">
								<Stack gap="sm">
									<Label for={`${uid}-service`}>{t('app.portal.service')}</Label>
									<Combobox
										id={`${uid}-service`}
										value={service}
										clearable
										placeholder={t('app.booking.select_service')}
										options={(answer.services?.rows ?? []).map((s) => ({
											value: s.id,
											label: s.name
										}))}
										on_change={(value) => {
											service = value;
											start = null;
										}}
									/>
									{#if chosen}
										<p class="text-caption">
											{chosen.description ? `${chosen.description} · ` : ''}{t(
												'app.booking.duration',
												{ minutes: chosen.duration_minutes }
											)}
										</p>
									{/if}
								</Stack>
								<Stack gap="sm">
									<Label for={`${uid}-repeat`}>{t('app.portal.repeat')}</Label>
									<Combobox
										id={`${uid}-repeat`}
										value={repeat}
										options={REPEATS.map((r) => ({
											value: r,
											label: repeatWord(r)
										}))}
										on_change={(value) => {
											if (value !== null) repeat = value;
										}}
									/>
								</Stack>
							</Grid>

							<Stack gap="sm">
								<Label for={`${uid}-address`}>{t('app.portal.address')}</Label>
								<PointInput
									{ctx}
									id={`${uid}-address`}
									value={location}
									{address}
									on_address={changeAddress}
									on_change={(next) => {
										queueMicrotask(() => {
											locationOverride = next;
										});
									}}
								/>
							</Stack>

							<Grid minimum="card" gap="md">
								<Stack gap="sm">
									<Label for={`${uid}-name`}>{t('app.portal.name')}</Label>
									<Input
										id={`${uid}-name`}
										autocomplete="name"
										value={name}
										oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
											nameOverride = e.currentTarget.value;
										}}
									/>
								</Stack>
								<Stack gap="sm">
									<Label for={`${uid}-provider`}>{t('app.booking.provider')}</Label>
									<Combobox
										id={`${uid}-provider`}
										value={provider}
										clearable
										placeholder={t('app.booking.no_preference')}
										options={(answer.providers?.rows ?? []).map((p) => ({
											value: p.id,
											label: p.name
										}))}
										on_change={(value) => {
											provider = value;
											preference = provider === null ? 'any' : 'preferred';
										}}
									/>
									{#if mismatch}
										<Alert.Root variant="destructive">
											<Alert.Title>{t('app.booking.skill_mismatch')}</Alert.Title>
										</Alert.Root>
									{/if}
								</Stack>
							</Grid>

							<Section
								icon="lucide:notebook-pen"
								name="notes"
								title={t('app.portal.notes')}
								default_open={false}
								summary={notes.trim() || t('app.portal.no_notes')}
							>
								<Textarea
									id={`${uid}-notes`}
									aria-label={t('app.portal.notes')}
									rows={3}
									bind:value={notes}
								/>
							</Section>

							<Button
								variant="brand"
								size="lg"
								class="w-full"
								disabled={!ready || save.pending}
								onclick={chooseTime}
							>
								{#if save.pending}<Spinner class="size-4" />{/if}{t('app.portal.choose_time')}
							</Button>
						</Stack>
					{/if}
				{:else if step === 'time'}
					<Stack gap="lg">
						<p class="text-sm text-muted-foreground">{chosen?.name} · {address}</p>
						{#if quote?.error}
							<Alert.Root variant="destructive">
								<Alert.Title>{quote.error.message}</Alert.Title>
							</Alert.Root>
						{:else if quoted == null || quoted.status === 'pending'}
							<Surface tone="subtle" padding="md" radius="control" role="status" aria-busy="true">
								<Inline gap="sm" align="center">
									<Spinner />
									<span class="text-sm text-muted-foreground">{t('component.loading')}</span>
								</Inline>
							</Surface>
						{:else if quoted.status === 'failed'}
							<Alert.Root variant="destructive">
								<Alert.Title>{quoted.problem}</Alert.Title>
							</Alert.Root>
						{:else if days.length === 0}
							<EmptyState variant="inset" title={t('app.portal.no_times')} />
						{:else}
							<SlotPicker
								{days}
								minutes={chosen?.duration_minutes ?? 60}
								value={start}
								locale={ctx.locale}
								{zone}
								onPick={(s) => (start = s)}
								{t}
							/>
						{/if}
						{#if quoted?.estimated}
							<p class="text-caption">{t('app.booking.travel_estimated')}</p>
						{/if}
						<Stack gap="sm">
							<Button
								variant="brand"
								size="lg"
								class="w-full"
								disabled={start === null || save.pending || quoted?.status !== 'ready'}
								onclick={confirm}
							>
								{#if save.pending}<Spinner class="size-4" />{/if}{t('app.portal.confirm')}
							</Button>
							<Button
								variant="ghost"
								class="w-full"
								onclick={() => {
									step = 'details';
									start = null;
									availability = null;
								}}
							>
								{t('app.portal.back')}
							</Button>
						</Stack>
					</Stack>
				{:else}
					{@const r = settledRow}
					{#if settled?.error}
						<Alert.Root variant="destructive">
							<Alert.Title>{settled.error.message}</Alert.Title>
						</Alert.Root>
					{:else if r == null || r.status === 'received'}
						<Surface tone="subtle" padding="lg" radius="control" role="status" aria-busy="true">
							<Stack gap="md" align="center" class="text-center">
								<Spinner class="size-6" />
								<p class="text-subhead">{t('app.portal.confirming')}</p>
							</Stack>
						</Surface>
					{:else}
						{@const booked = r.status === 'booked'}
						<Stack gap="lg">
							<Stack gap="sm" align="center" class="text-center">
								<span
									class={[
										'inline-flex size-14 items-center justify-center rounded-full',
										booked
											? 'bg-tone-success-bg text-tone-success-text'
											: 'bg-tone-warning-bg text-tone-warning-text'
									]}
								>
									<Icon name={booked ? 'lucide:check' : 'lucide:clock'} class="size-7" />
								</span>
								<h2 class="text-title">
									{booked ? t('app.portal.booked_title') : t('app.portal.follow_up_title')}
								</h2>
								<p class="max-w-prose text-sm text-muted-foreground">
									{booked ? t('app.portal.booked_body') : t('app.portal.follow_up_body')}
								</p>
							</Stack>

							<Surface tone="card" padding="md" radius="control">
								<Stack as="dl" gap="sm" divided class="text-sm">
									{#each summary as row (row.label)}
										<Grid tracks="auto minmax(6rem,8rem) minmax(0,1fr)" gap="sm" align="center">
											<Icon name={row.icon} class="size-4 shrink-0 text-muted-foreground" />
											<dt class="text-muted-foreground">{row.label}</dt>
											<dd class="min-w-0 font-medium">{row.value}</dd>
										</Grid>
									{/each}
								</Stack>
							</Surface>

							<Stack gap="sm">
								{#if booked}
									<Button variant="outline" class="w-full" onclick={() => addToCalendar(r.number)}>
										<Icon name="lucide:calendar-plus" class="size-4" />{t(
											'app.portal.add_to_calendar'
										)}
									</Button>
								{/if}
								<Button variant="brand" class="w-full" href="appointments">
									{t('app.portal.my_bookings')}
								</Button>
								<Button variant="ghost" class="w-full" onclick={again}>
									{t('app.portal.another')}
								</Button>
							</Stack>
						</Stack>
					{/if}
				{/if}

				{#if me !== null && step !== 'done'}
					<a class="text-center text-sm underline underline-offset-4" href="appointments">
						{t('app.portal.my_bookings')}
					</a>
				{/if}
			</Stack>
		</Center>
	</Scroll>
</AppShell>
