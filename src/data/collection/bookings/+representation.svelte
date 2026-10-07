<script lang="ts">
	/** Customer, service, preference and recurrence determine feasible starts before booking. */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Instant, PlainDate } from '@norbital-ai/std/date';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import {
		Button,
		Combobox,
		DateInput,
		Label,
		Picker,
		RecordShell,
		Section,
		openRecord,
		type RecordSection,
		type RecordView
	} from '@norbital-ai/ui';
	import { untrack } from 'svelte';
	import { live } from '../../../lib/live.svelte.js';
	import { excerpt } from '../../../lib/summary.js';
	import SlotPicker from '../../../lib/SlotPicker.svelte';

	let { view }: { view: RecordView<'bookings'> } = $props();

	const t = bolt.t;
	const today = new Intl.DateTimeFormat('en-CA').format(new Date());
	const REPEATS = ['once', 'weekly', 'fortnightly', 'monthly'] as const;
	// a stored booking: who, what, how often and where stay open; notes and the map pin fold away
	const sections: RecordSection[] = [
		{
			name: 'booking',
			title: t('models.bookings.singular'),
			fields: [
				'number',
				'customer',
				'service',
				'status',
				'preference',
				'repeat',
				'visit_count',
				'address'
			]
		},
		{
			name: 'notes',
			title: t('section.notes'),
			fields: ['notes'],
			defaultOpen: false,
			summary: (r) => excerpt(r.notes) || t('summary.no_notes')
		},
		{
			name: 'map',
			title: t('section.map'),
			fields: ['location'],
			defaultOpen: false,
			summary: (r) => (r.location == null ? t('summary.not_set') : t('summary.pinned'))
		}
	];

	// opened from a customer, the customer is filled in
	let customer = $state<Id<'customers'> | null>(
		untrack(() => (view.mode === 'create' ? (view.values.customer ?? null) : null))
	);
	let service = $state<Id<'services'> | null>(
		untrack(() => (view.mode === 'create' ? (view.values.service ?? null) : null))
	);
	let preference = $state<'any' | 'preferred'>('any');
	let helpers = $state<Id<'helpers'>[]>([]);
	let from = $state(today);
	let start = $state<string | null>(null);
	let repeat = $state<(typeof REPEATS)[number]>('once');
	let message = $state<string | null>(null);
	let booking = $state(false);

	const names = live(() =>
		helpers.length === 0
			? null
			: bolt.read('helpers', {
					where: { id: { in: helpers } },
					select: { name: true, skills: true },
					limit: 5
				})
	);
	const open = live(
		() =>
			customer !== null && service !== null && (preference === 'any' || helpers.length > 0)
				? bolt.query('bookings.open_slots', {
						preference,
						repeat,
						...(preference === 'preferred' ? { helpers } : {}),
						customer,
						service,
						from: PlainDate(from),
						days: 7
					})
				: null,
		['visits', 'helpers', 'helper_time_off', 'drive_times', 'services', 'customers']
	);
	const shown = $derived(open.current);
	const chosenService = live(() =>
		service === null ? null : bolt.get('services', service, { duration_minutes: true })
	);
	const ready = $derived(
		customer !== null &&
			service !== null &&
			start !== null &&
			(preference === 'any' || helpers.length > 0) &&
			open.current?.some((d) => d.starts.includes(Instant(start!))) === true
	);

	async function book() {
		if (customer === null || service === null || start === null) return;
		booking = true;
		message = null;
		const order = helpers;
		const outcome = await bolt.act('bookings.book', {
			customer,
			service,
			preference,
			...(preference === 'preferred' ? { helpers: order } : {}),
			start: Instant(start),
			repeat
		});
		message =
			outcome.kind === 'committed'
				? t('app.schedule.booked', {
						assigned: outcome.output.assigned,
						unassigned: outcome.output.unassigned
					})
				: outcome.kind === 'refused'
					? outcome.message
					: t('app.schedule.book_failed');
		booking = false;
		// the booking made replaces this create sheet
		if (outcome.kind === 'committed') openRecord('bookings', outcome.output.booking);
	}
</script>

{#if view.mode === 'create'}
	<RecordShell
		of="bookings"
		fields={[
			'number',
			'customer',
			'service',
			'status',
			'preference',
			'repeat',
			'visit_count',
			'address',
			'notes',
			'location'
		]}
		mode="create"
	>
		<Stack gap="lg">
			<Section collapsible={false} first name="where" title={t('app.schedule.step_where')}>
				<Grid minimum="compact">
					{#if view.values.customer == null}
						<Stack gap="xs">
							<Label for="booking-customer">{t('component.customer')}</Label>
							<Picker
								id="booking-customer"
								of="customers"
								value={customer}
								onChange={(id) => {
									customer = id;
									start = null;
								}}
							/>
						</Stack>
					{/if}
					<Stack gap="xs">
						<Label for="booking-service">{t('component.service')}</Label>
						<Picker
							id="booking-service"
							of="services"
							where={{ active: { eq: true } }}
							value={service}
							onChange={(id) => {
								service = id;
								start = null;
							}}
						/>
					</Stack>
				</Grid>
			</Section>
			<Section collapsible={false} name="options" title={t('app.booking.options')}>
				<Grid minimum="compact" gap="md">
					<Stack gap="sm">
						<Label for="booking-preference">{t('app.schedule.step_preference')}</Label>
						<Combobox
							id="booking-preference"
							value={preference}
							options={[
								{ value: 'any', label: t('app.schedule.no_preference') },
								{ value: 'preferred', label: t('app.schedule.has_preference') }
							]}
							onChange={(value) => {
								if (value !== null) {
									preference = value;
									start = null;
								}
							}}
						/>
					</Stack>
					<Stack gap="sm">
						<Label for="booking-repeat">{t('app.schedule.step_repeat')}</Label>
						<Combobox
							id="booking-repeat"
							value={repeat}
							options={REPEATS.map((r) => ({
								value: r,
								label: t(`component.repeat_${r}`)
							}))}
							onChange={(value) => {
								if (value !== null) {
									repeat = value;
									start = null;
								}
							}}
						/>
					</Stack>
				</Grid>
			</Section>
			{#if preference === 'preferred'}
				<Section collapsible={false} name="helpers" title={t('app.schedule.preferred_helpers')}>
					<Cluster gap="xs" align="center">
						{#each helpers as h, i (h)}
							<Button
								size="sm"
								variant="secondary"
								onclick={() => {
									helpers = helpers.filter((x) => x !== h);
									start = null;
								}}>{i + 1}. {names.current?.rows.find((r) => r.id === h)?.name ?? '—'} ×</Button
							>
						{/each}
					</Cluster>
					{#if helpers.length < 5}
						<!-- a fresh picker after each pick, so it offers the next helper -->
						{#key helpers.length}
							<Picker
								of="helpers"
								where={{ status: { eq: 'active' } }}
								value={null}
								onChange={(id) => {
									if (id !== null && !helpers.includes(id)) {
										helpers = [...helpers, id];
										start = null;
									}
								}}
							/>
						{/key}
					{/if}
				</Section>
			{/if}
			<Section collapsible={false} name="schedule" title={t('app.booking.available_start')}>
				<Stack gap="sm" class="max-w-xs">
					<Label for="booking-date">{t('app.booking.dates_from')}</Label>
					<DateInput
						id="booking-date"
						value={from}
						onChange={(next) => {
							from = next ?? today;
							start = null;
						}}
					/>
				</Stack>
				{#if open.error}<p role="alert" class="text-sm text-destructive">{open.error}</p>{/if}
				{#if shown && shown.some((d) => d.starts.length > 0)}
					<SlotPicker
						days={shown}
						minutes={chosenService.current?.duration_minutes ?? 60}
						value={start}
						locale={bolt.locale}
						onPick={(s) => (start = s)}
						{t}
					/>
				{:else if shown}<p class="text-caption">{t('app.schedule.not_free')}</p>
				{:else if customer !== null && service !== null && !open.error}<p
						role="status"
						class="text-caption"
					>
						{t('component.loading')}
					</p>{/if}
			</Section>
			<Cluster gap="sm" align="center">
				<Button disabled={!ready || booking} onclick={book}>{t('app.schedule.book')}</Button>
				{#if message}<p class="text-sm">{message}</p>{/if}
			</Cluster>
		</Stack>
	</RecordShell>
{:else}
	<RecordShell
		of="bookings"
		fields={[
			'number',
			'customer',
			'service',
			'status',
			'preference',
			'repeat',
			'visit_count',
			'address',
			'notes',
			'location'
		]}
		id={view.record.id}
		{sections}
	/>
{/if}
