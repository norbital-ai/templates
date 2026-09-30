<script lang="ts">
	/**
	 * Taking a booking. Without a preference: customer, service, a date and time, book. With one: the customer's helpers,
	 * then a tab per helper of the times they are free this week; the time picked is booked with that helper first.
	 * Requests from the public portal that could not be booked on their own wait in Portal requests.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Instant, PlainDate } from '@norbital-ai/std/date';
	import { AppShell, Center, Cluster, Grid, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Button, DateInput, Label, Picker, Table, Tabs } from '@norbital-ai/ui';
	import { live } from '../../../lib/live.svelte.js';

	const t = bolt.t;
	const today = new Intl.DateTimeFormat('en-CA').format(new Date());
	const REPEATS = ['once', 'weekly', 'fortnightly', 'monthly'] as const;

	let customer = $state<Id<'customers'> | null>(null);
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
		if (outcome.kind === 'committed') start = null;
		booking = false;
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

{#snippet form()}
	<Scroll name="new-booking" inset>
		<!-- one form, read top to bottom: it keeps a form's width rather than the screen's -->
		<Center measure="narrow">
			<Stack gap="lg">
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
				<Stack gap="sm">
					<Label>{t('app.schedule.step_preference')}</Label>
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
				</Stack>
				{#if preference === 'preferred'}
					<Stack gap="sm">
						<Label>{t('app.schedule.preferred_helpers')}</Label>
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
					</Stack>
					<Stack gap="sm">
						<Label>{t('app.schedule.step_schedule')}</Label>
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
					</Stack>
				{:else}
					<Stack gap="sm">
						<Label>{t('app.schedule.step_when')}</Label>
						<div class="w-64">
							<DateInput of="instant" value={start} onChange={(next) => (start = next)} />
						</div>
					</Stack>
				{/if}
				<Stack gap="sm">
					<Label>{t('app.schedule.step_repeat')}</Label>
					<Cluster gap="xs">
						{#each REPEATS as r (r)}
							<Button variant={repeat === r ? 'default' : 'outline'} onclick={() => (repeat = r)}
								>{t(`component.repeat_${r}`)}</Button
							>
						{/each}
					</Cluster>
				</Stack>
				<Cluster gap="sm" align="center">
					<Button disabled={!ready || booking} onclick={book}>{t('app.schedule.book')}</Button>
					{#if message}<p class="text-sm">{message}</p>{/if}
				</Cluster>
			</Stack>
		</Center>
	</Scroll>
{/snippet}

{#snippet list()}
	<Table
		of="bookings"
		orderBy={{ number: 'desc' }}
		toolbar={{ new: false }}
		columns={['number', 'customer', 'service', 'preference', 'repeat', 'status', 'visit_count']}
		actions={[
			{
				action: 'bookings.cancel',
				label: t('app.schedule.cancel_booking'),
				confirm: t('app.schedule.cancel_booking_confirm')
			}
		]}
	/>
{/snippet}

{#snippet requests()}
	<Table
		of="booking_requests"
		orderBy={{ number: 'desc' }}
		initialFilter={{ status: { eq: 'follow_up' } }}
		toolbar={{ title: t('app.schedule.portal_requests'), new: false }}
		columns={['number', 'name', 'email', 'service', 'start', 'status', 'outcome', 'booking']}
	/>
{/snippet}

<AppShell
	icon="lucide:calendar-plus"
	title={t('app.schedule.bookings_title')}
	description={t('app.schedule.bookings_description')}
	variant="full"
>
	<Tabs
		tabs={[
			{
				name: 'new',
				title: t('app.schedule.new_booking'),
				icon: 'lucide:plus',
				body: form,
				keepAlive: true
			},
			{ name: 'all', title: t('app.schedule.all_bookings'), icon: 'lucide:list', body: list },
			{
				name: 'requests',
				title: t('app.schedule.portal_requests'),
				icon: 'lucide:inbox',
				body: requests
			}
		]}
	/>
</AppShell>
