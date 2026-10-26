<script lang="ts">
	import { fork, bolt } from '$bolt';
	import { Effect } from 'effect';
	import {
		useKinds,
		Button,
		Combobox,
		TimeInput,
		Label,
		Picker,
		RecordShell,
		Section,
		Table,
		RunStatus,
		type RecordSection,
		type RecordView
	} from '@norbital-ai/ui';
	import type { Id } from '@norbital-ai/bolt';
	import { Instant, PlainDate } from '@norbital-ai/std/date';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import { untrack } from 'svelte';
	import SlotPicker from '../../../lib/SlotPicker.svelte';
	const zone = useKinds().zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
	let {
		view
	}: {
		view: RecordView<'bookings'>;
	} = $props();
	const t = bolt.t;
	const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
	const REPEATS = ['once', 'weekly', 'fortnightly', 'monthly'] as const;
	// a stored booking: what was booked, where, and its notes; the preferred helpers sit in a tab of their own
	const sections: RecordSection[] = [
		{
			name: 'booking',
			title: t('models.bookings.singular'),
			fields: ['number', 'customer', 'service', 'status', 'preference', 'repeat', 'visit_count']
		},
		{
			name: 'where',
			title: t('section.where'),
			fields: ['address', 'area', 'location']
		},
		{
			name: 'notes',
			title: t('section.notes'),
			fields: ['notes']
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
	let started = $state<string | null>(null);
	const names = $derived(
		helpers.length === 0
			? null
			: bolt.query('helpers', {
					where: { id: { in: helpers } },
					select: { name: true, skills: true },
					limit: 5
				})
	);
	const open = $derived(
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
			: null
	);
	const shown = $derived(open?.current);
	const chosenService = $derived(
		service === null
			? null
			: bolt.query('services', { id: service, select: { duration_minutes: true } })
	);
	const ready = $derived(
		customer !== null &&
			service !== null &&
			start !== null &&
			(preference === 'any' || helpers.length > 0) &&
			open?.current?.some((d) => d.starts.includes(Instant(start!))) === true
	);
	function book() {
		const selectedCustomer = customer,
			selectedService = service,
			selectedStart = start;
		if (selectedCustomer === null || selectedService === null || selectedStart === null) return;
		booking = true;
		message = null;
		const order = helpers;
		fork(
			Effect.gen(function* () {
				const call = bolt.start('bookings_book', {
					customer: selectedCustomer,
					service: selectedService,
					preference,
					...(preference === 'preferred' ? { helpers: order } : {}),
					start: Instant(selectedStart),
					repeat
				});
				const outcome = yield* call;
				if (outcome.kind === 'committed') started = call.id;
				else message = outcome.kind === 'refused' ? outcome.message : t('app.schedule.book_failed');
			}).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						booking = false;
					})
				)
			),
			() => {
				message = t('app.schedule.book_failed');
			}
		);
	}
</script>

{#snippet preferred()}
	{#if view.mode !== 'create'}<Table
			of="booking_helpers"
			key="booking-helpers"
			where={{ booking: { eq: view.record.id } }}
			orderBy={{ rank: 'asc' }}
			columns={['rank', 'helper']}
			toolbar={{ title: t('app.schedule.preferred_helpers'), new: false }}
		/>{/if}
{/snippet}

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
								}}>{i + 1}. {names?.current?.rows.find((r) => r.id === h)?.name ?? '—'} ×</Button
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
					<TimeInput
						id="booking-date"
						value={from}
						onChange={(next: string | null) => {
							from = next ?? today;
							start = null;
						}}
					/>
				</Stack>
				{#if open?.error}<p role="alert" class="text-sm text-destructive">
						{open.error.message}
					</p>{/if}
				{#if shown && shown.some((d) => d.starts.length > 0)}
					<SlotPicker
						days={shown}
						minutes={chosenService?.current?.duration_minutes ?? 60}
						value={start}
						locale={bolt.locale}
						onPick={(s) => (start = s)}
						{t}
					/>
				{:else if shown}<p class="text-caption">{t('app.schedule.not_free')}</p>
				{:else if customer !== null && service !== null && !open?.error}<p
						role="status"
						class="text-caption"
					>
						{t('component.loading')}
					</p>{/if}
			</Section>
			<Cluster gap="sm" align="center">
				<Button disabled={!ready || booking} onclick={book}>{t('app.schedule.book')}</Button>
				{#if message}<p class="text-sm">{message}</p>{/if}
				{#if started}<RunStatus automation="bookings_book" run={started} />{/if}
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
			'area',
			'location',
			'notes'
		]}
		id={view.record.id}
		{sections}
		tabs={view.record.preference === 'preferred'
			? [{ name: 'helpers', title: t('app.schedule.preferred_helpers'), body: preferred }]
			: []}
	/>
{/if}
