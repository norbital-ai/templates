<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Alert,
		Button,
		ChildGrid,
		Combobox,
		Form,
		Icon,
		Label,
		Picker,
		RecordShell,
		RunStatus,
		Section,
		Spinner,
		Table,
		TimeInput,
		open_record,
		type RecordSection,
		type RecordView,
		use_act
	} from '@norbital-ai/ui';
	import { attach } from '@norbital-ai/ui/effect';
	import type { Id } from '@norbital-ai/bolt';
	import { Cluster, Grid, Inline, Stack, Surface } from '@norbital-ai/ui/layout';
	import { Effect, Stream } from 'effect';
	import { getContext, untrack } from 'svelte';
	import SlotPicker from '../../../lib/SlotPicker.svelte';
	import { REPEATS } from '../../../lib/matching.js';
	import { livePool } from '../../../lib/pool.svelte.js';
	import { bookingSlots, bookingWindow } from '../../../lib/slots.js';

	const BOOKING_DONE = Symbol.for('scheduling.booking_done');

	let { view, ctx }: { view: RecordView<'bookings'>; ctx: PageContext } = $props();
	const uid = $props.id();
	const t = (...args: Parameters<PageContext['t']>) => ctx.t(...args);
	const zone = $derived(ctx.tz);
	const dayClock = $derived(ctx.clock('day'));
	const minuteClock = $derived(ctx.clock('minute'));
	const canCreate = $derived(ctx.catalog?.bookings?.create !== undefined);
	const closeParent = getContext<(() => void) | undefined>(BOOKING_DONE);

	const repeatWord = (value: (typeof REPEATS)[number]) =>
		ctx.t(`models.bookings.fields.repeat.${value}`);

	const sections = $derived<RecordSection[]>([
		{
			name: 'booking',
			icon: 'lucide:calendar-check',
			title: t('models.bookings.singular'),
			fields: [
				'number',
				'customer',
				'service',
				'status',
				'preference',
				'repeat',
				'appointment_count',
				'notes'
			]
		},
		{
			name: 'where',
			icon: 'lucide:map-pin',
			title: t('section.where'),
			fields: ['address', 'location']
		}
	]);

	let customer = $state<Id<'customers'> | null>(
		untrack(() => (view.mode === 'create' ? (view.values.customer ?? null) : null))
	);
	let service = $state<Id<'services'> | null>(
		untrack(() => (view.mode === 'create' ? (view.values.service ?? null) : null))
	);
	let preference = $state<'any' | 'preferred'>('any');
	let providers = $state<Id<'providers'>[]>([]);
	let fromOverride = $state<string | null>(null);
	const from = $derived(fromOverride ?? dayClock.today);
	let start = $state<string | null>(null);
	let repeat = $state<(typeof REPEATS)[number]>('once');
	let started = $state<string | null>(null);

	const names = $derived(
		providers.length === 0
			? null
			: ctx.query({
					providers: { where: { id: { in: providers } }, fields: ['name', 'skills'], limit: 5 }
				})
	);
	const chosen = $derived(
		customer === null || service === null
			? null
			: ctx.query({
					customers: {
						where: { id: { eq: customer } },
						fields: ['location'],
						limit: 1
					},
					services: {
						where: { id: { eq: service } },
						fields: ['skill', 'duration_minutes', 'active'],
						limit: 1
					}
				})
	);
	const target = $derived(chosen?.current?.customers.rows[0] ?? null);
	const chosenService = $derived(chosen?.current?.services.rows[0] ?? null);
	const horizon = $derived(bookingWindow({ from, days: 7, repeat }, zone));
	const pool = livePool(
		ctx,
		() =>
			chosen?.current !== undefined && (preference === 'any' || providers.length > 0)
				? { from: horizon.from, to: horizon.to, spots: [target?.location ?? null] }
				: null,
		() => zone
	);
	const offered = $derived(
		pool.current === undefined || chosen?.current === undefined
			? undefined
			: bookingSlots(
					target,
					chosenService,
					{ preference, repeat, ...(preference === 'preferred' ? { providers } : {}) },
					horizon.days,
					pool.current,
					zone,
					minuteClock.now
				)
	);
	const refusedMessage = $derived.by(() => {
		if (offered === undefined || !('key' in offered)) return null;
		return 'values' in offered ? t(offered.key, offered.values) : t(offered.key);
	});
	const shown = $derived(offered !== undefined && !('key' in offered) ? offered : undefined);
	const ready = $derived(
		canCreate &&
			customer !== null &&
			service !== null &&
			start !== null &&
			(preference === 'any' || providers.length > 0) &&
			shown?.some((d) => d.starts.some((s) => s === start)) === true
	);

	const save = use_act(ctx);
	function book() {
		if (!ready || customer === null || service === null || start === null) return;
		save.run(
			ctx.run('bookings_book', {
				customer,
				service,
				preference,
				...(preference === 'preferred' ? { providers } : {}),
				start,
				repeat
			}),
			{ then: ({ output }) => (started = output.id) }
		);
	}

	const followRun = $derived.by(() => {
		const runId = started;
		const runs = ctx.runs;
		if (runId === null || runs === undefined) return undefined;
		return attach(() =>
			Stream.runForEach(runs('bookings_book', { where: { id: { eq: runId } }, limit: 1 }), (page) =>
				Effect.sync(() => {
					const row = page.rows[0];
					if (row?.status !== 'succeeded') return;
					const out = row.result;
					const bookingId =
						typeof out === 'object' &&
						out !== null &&
						'booking' in out &&
						typeof out.booking === 'string'
							? out.booking
							: null;
					started = null;
					closeParent?.();
					if (bookingId !== null) open_record('bookings', bookingId);
				})
			).pipe(Effect.ignore)
		);
	});
</script>

{#snippet appointmentsTab()}
	{#if view.mode !== 'create'}
		<Table
			{ctx}
			of="appointments"
			key="booking-appointments"
			toolbar={{ title: t('app.providers.appointments'), new: false }}
			where={{ booking: { eq: view.record.id } }}
			order_by={{ number: 'asc' }}
			columns={['number', 'slot', 'provider', 'status', 'shift_check', 'attention']}
		/>
	{/if}
{/snippet}

{#snippet createFooter()}
	{#if started}
		<RunStatus {ctx} automation="bookings_book" run={started} />
	{/if}
{/snippet}

{#snippet createActions()}
	<Button variant="brand" disabled={!ready || save.pending} onclick={book}>
		{#if save.pending}<Spinner class="size-4" />{/if}{t('app.schedule.book')}
	</Button>
{/snippet}

{#if view.mode === 'create'}
	<span hidden {@attach followRun}></span>
	<RecordShell
		{ctx}
		of="bookings"
		mode="create"
		footer={createFooter}
		footer_actions={createActions}
	>
		<Stack gap="lg">
			<Section
				icon="lucide:map-pin"
				collapsible={false}
				first
				name="where"
				title={t('app.schedule.step_where')}
			>
				<Grid minimum="card">
					{#if view.values.customer == null}
						<Stack gap="xs">
							<Label for={`${uid}-customer`}>{t('component.customer')}</Label>
							<Picker
								{ctx}
								id={`${uid}-customer`}
								of="customers"
								value={customer}
								on_change={(id) => {
									customer = id;
									start = null;
								}}
							/>
						</Stack>
					{/if}
					<Stack gap="xs">
						<Label for={`${uid}-service`}>{t('component.service')}</Label>
						<Picker
							{ctx}
							id={`${uid}-service`}
							of="services"
							where={{ active: { eq: true } }}
							value={service}
							on_change={(id) => {
								service = id;
								start = null;
							}}
						/>
					</Stack>
				</Grid>
			</Section>

			<Section
				icon="lucide:sliders-horizontal"
				collapsible={false}
				name="options"
				title={t('app.booking.options')}
			>
				<Grid minimum="card" gap="md">
					<Stack gap="sm">
						<Label for={`${uid}-preference`}>{t('app.schedule.step_preference')}</Label>
						<Combobox
							id={`${uid}-preference`}
							value={preference}
							options={[
								{ value: 'any', label: t('app.schedule.no_preference') },
								{ value: 'preferred', label: t('app.schedule.has_preference') }
							]}
							on_change={(value) => {
								if (value !== null) {
									preference = value;
									start = null;
								}
							}}
						/>
					</Stack>
					<Stack gap="sm">
						<Label for={`${uid}-repeat`}>{t('app.schedule.step_repeat')}</Label>
						<Combobox
							id={`${uid}-repeat`}
							value={repeat}
							options={REPEATS.map((r) => ({
								value: r,
								label: repeatWord(r)
							}))}
							on_change={(value) => {
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
				<Section
					icon="lucide:users"
					collapsible={false}
					name="providers"
					title={t('app.schedule.preferred_providers')}
				>
					<Stack gap="sm">
						<Cluster gap="xs" align="center">
							{#each providers as p, i (p)}
								{@const providerName =
									names?.current?.providers.rows.find((r) => r.id === p)?.name ?? '—'}
								<Button
									variant="secondary"
									aria-label={t('app.booking.remove_provider', { name: providerName })}
									onclick={() => {
										providers = providers.filter((x) => x !== p);
										start = null;
									}}
								>
									{i + 1}. {providerName}
									<Icon name="lucide:x" class="size-3.5" />
								</Button>
							{/each}
						</Cluster>
						{#if providers.length < 5}
							<Stack gap="xs">
								<Label for={`${uid}-add-provider`}>{t('app.booking.add_provider')}</Label>
								{#key providers.length}
									<Picker
										{ctx}
										id={`${uid}-add-provider`}
										of="providers"
										where={{ status: { eq: 'active' } }}
										value={null}
										on_change={(id) => {
											if (id !== null && !providers.includes(id)) {
												providers = [...providers, id];
												start = null;
											}
										}}
									/>
								{/key}
							</Stack>
						{/if}
					</Stack>
				</Section>
			{/if}

			<Section
				icon="lucide:calendar-days"
				collapsible={false}
				name="schedule"
				title={t('app.booking.available_start')}
			>
				<Grid minimum="card">
					<Stack gap="sm">
						<Label for={`${uid}-date`}>{t('app.booking.dates_from')}</Label>
						<TimeInput
							{ctx}
							id={`${uid}-date`}
							value={from}
							on_change={(next: string | null) => {
								fromOverride = next ?? dayClock.today;
								start = null;
							}}
						/>
					</Stack>
				</Grid>
				{#if chosen?.error || pool.error || refusedMessage}
					<Alert.Root variant="destructive">
						<Alert.Title
							>{refusedMessage ?? chosen?.error?.message ?? pool.error?.message}</Alert.Title
						>
					</Alert.Root>
				{/if}
				{#if shown && shown.some((d) => d.starts.length > 0)}
					<SlotPicker
						days={shown}
						minutes={chosenService?.duration_minutes ?? 60}
						value={start}
						locale={ctx.locale}
						{zone}
						onPick={(s) => (start = s)}
						{t}
					/>
				{:else if shown}
					<p class="text-caption">{t('app.schedule.not_free')}</p>
				{:else if preference === 'preferred' && providers.length === 0}
					<p class="text-caption">{t('errors.preferred_provider_required')}</p>
				{:else if customer !== null && service !== null && !chosen?.error && !pool.error && refusedMessage === null}
					<Surface tone="subtle" padding="sm" radius="control" aria-busy="true">
						<Inline gap="sm" align="center">
							<Spinner />
							<span class="text-sm text-muted-foreground">{t('component.loading')}</span>
						</Inline>
					</Surface>
				{/if}
			</Section>
		</Stack>
	</RecordShell>
{:else}
	<RecordShell
		{ctx}
		of="bookings"
		id={view.record.id}
		title={view.record.number}
		tabs={[
			{
				name: 'appointments',
				title: t('app.providers.appointments'),
				icon: 'lucide:calendar-clock',
				body: appointmentsTab
			}
		]}
	>
		<Stack gap="lg">
			<Form
				{ctx}
				of="bookings"
				mode="update"
				id={view.record.id}
				record={view.record}
				fields={[
					'number',
					'customer',
					'service',
					'status',
					'preference',
					'repeat',
					'appointment_count',
					'address',
					'location',
					'notes'
				]}
				{sections}
				size="content"
			/>
			{#if view.record.preference === 'preferred'}
				<Section
					icon="lucide:heart-handshake"
					name="preferred_providers"
					title={t('app.schedule.preferred_providers')}
				>
					<ChildGrid
						{ctx}
						of="bookings"
						relation="preferred_providers"
						id={view.record.id}
						columns={['rank', 'provider']}
					/>
				</Section>
			{/if}
		</Stack>
	</RecordShell>
{/if}
