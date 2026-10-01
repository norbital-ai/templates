<script lang="ts">
	/**
	 * A booking. Taken by `book` (the toolbar's New): without a preference, customer, service, a date and time; with one,
	 * the customer's helpers, then a tab per helper of the times they are free this week — the time picked is booked with
	 * that helper first. A stored booking is the generated view.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Instant, PlainDate } from '@norbital-ai/std/date';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import {
		Button,
		DateInput,
		Label,
		Picker,
		RecordShell,
		Section,
		Tabs,
		openRecord,
		type RecordSection,
		type RecordView
	} from '@norbital-ai/ui';
	import { untrack } from 'svelte';
	import { live } from '../../../lib/live.svelte.js';
	import { excerpt } from '../../../lib/summary.js';

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
				'address',
				'area'
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
		untrack(() =>
			view.mode === 'create'
				? ((view.values['customer'] as Id<'customers'> | undefined) ?? null)
				: null
		)
	);
	let service = $state<Id<'services'> | null>(null);
	let preference = $state<'any' | 'preferred'>('any');
	let helpers = $state<Id<'helpers'>[]>([]);
	let from = $state(today);
	let start = $state<string | null>(null);
	let chosen = $state<Id<'helpers'> | null>(null);
	let tab = $state<string | undefined>(undefined);
	let repeat = $state<(typeof REPEATS)[number]>('once');
	let message = $state<string | null>(null);
	let booking = $state(false);

	const names = live(() =>
		helpers.length === 0
			? null
			: bolt.read('helpers', { where: { id: { in: helpers } }, select: { name: true }, limit: 5 })
	);
	const open = live(
		() =>
			preference === 'preferred' && customer !== null && service !== null && helpers.length > 0
				? bolt.query('helpers.open_slots', {
						helpers,
						customer,
						service,
						from: PlainDate(from),
						days: 7
					})
				: null,
		['visits', 'helpers', 'helper_time_off']
	);
	const shown = $derived(open.current?.find((h) => h.helper === tab) ?? open.current?.[0]);
	const day = (d: string) =>
		new Intl.DateTimeFormat(bolt.locale, {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		}).format(new Date(`${d}T00:00:00`));
	const time = (i: string) =>
		new Intl.DateTimeFormat(bolt.locale, { hour: 'numeric', minute: '2-digit' }).format(
			new Date(i)
		);
	const ready = $derived(
		customer !== null &&
			service !== null &&
			start !== null &&
			(preference === 'any' || helpers.length > 0)
	);

	async function book() {
		if (customer === null || service === null || start === null) return;
		booking = true;
		message = null;
		const order = chosen === null ? helpers : [chosen, ...helpers.filter((h) => h !== chosen)];
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

{#snippet slots()}
	{#if shown}
		<Stack gap="sm">
			{#each shown.days as d (d.day)}
				<Stack gap="xs">
					<Label>{day(d.day)}</Label>
					{#if d.starts.length === 0}
						<p class="text-caption">{t('app.schedule.not_free')}</p>
					{:else}
						<Cluster gap="xs">
							{#each d.starts as s (s)}
								<Button
									size="sm"
									variant={start === s && chosen === shown.helper ? 'default' : 'outline'}
									onclick={() => {
										start = s;
										chosen = shown.helper;
									}}>{time(s)}</Button
								>
							{/each}
						</Cluster>
					{/if}
				</Stack>
			{/each}
		</Stack>
	{/if}
{/snippet}

{#if view.mode === 'create'}
	<RecordShell of="bookings" mode="create">
		<Stack gap="lg">
			<Section first name="where" title={t('app.schedule.step_where')}>
				<Grid minimum="card">
					<Stack gap="xs">
						<Label for="booking-customer">{t('component.customer')}</Label>
						<Picker
							id="booking-customer"
							of="customers"
							value={customer}
							onChange={(id) => (customer = id)}
						/>
					</Stack>
					<Stack gap="xs">
						<Label for="booking-service">{t('component.service')}</Label>
						<Picker
							id="booking-service"
							of="services"
							where={{ active: { eq: true } }}
							value={service}
							onChange={(id) => (service = id)}
						/>
					</Stack>
				</Grid>
			</Section>
			<Section name="preference" title={t('app.schedule.step_preference')}>
				<Cluster gap="xs">
					<Button
						variant={preference === 'any' ? 'default' : 'outline'}
						onclick={() => (preference = 'any')}>{t('app.schedule.no_preference')}</Button
					>
					<Button
						variant={preference === 'preferred' ? 'default' : 'outline'}
						onclick={() => {
							preference = 'preferred';
							start = null;
						}}>{t('app.schedule.has_preference')}</Button
					>
				</Cluster>
			</Section>
			{#if preference === 'preferred'}
				<Section name="helpers" title={t('app.schedule.preferred_helpers')}>
					<Cluster gap="xs" align="center">
						{#each helpers as h, i (h)}
							<Button
								size="sm"
								variant="secondary"
								onclick={() => (helpers = helpers.filter((x) => x !== h))}
								>{i + 1}. {names.current?.rows.find((r) => r.id === h)?.name ?? '—'} ×</Button
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
									if (id !== null && !helpers.includes(id)) helpers = [...helpers, id];
								}}
							/>
						{/key}
					{/if}
				</Section>
				<Section name="schedule" title={t('app.schedule.step_schedule')}>
					<div class="w-48">
						<DateInput value={from} onChange={(next) => (from = next ?? today)} />
					</div>
					{#if open.current && open.current.length > 0}
						<Tabs
							value={shown?.helper ?? ''}
							onValueChange={(v) => (tab = v)}
							tabs={open.current.map((h) => ({ name: h.helper, title: h.name, body: slots }))}
						/>
					{/if}
				</Section>
			{:else}
				<Section name="when" title={t('app.schedule.step_when')}>
					<div class="w-64">
						<DateInput of="instant" value={start} onChange={(next) => (start = next)} />
					</div>
				</Section>
			{/if}
			<!-- defaults to once: a rarely changed choice, its current value shown while closed -->
			<Section
				name="repeat"
				title={t('app.schedule.step_repeat')}
				defaultOpen={false}
				summary={t(`component.repeat_${repeat}`)}
			>
				<Cluster gap="xs">
					{#each REPEATS as r (r)}
						<Button variant={repeat === r ? 'default' : 'outline'} onclick={() => (repeat = r)}
							>{t(`component.repeat_${r}`)}</Button
						>
					{/each}
				</Cluster>
			</Section>
			<Cluster gap="sm" align="center">
				<Button disabled={!ready || booking} onclick={book}>{t('app.schedule.book')}</Button>
				{#if message}<p class="text-sm">{message}</p>{/if}
			</Cluster>
		</Stack>
	</RecordShell>
{:else}
	<RecordShell of="bookings" id={view.record.id} {sections} />
{/if}
