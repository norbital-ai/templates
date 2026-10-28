<script lang="ts">
	import {
		useKinds,
		Badge,
		Board,
		enumText,
		TimeInput,
		Table,
		Tabs,
		useBolt
	} from '@norbital-ai/ui';
	/**
	 * The day's schedule. By helper: one lane per helper, and dragging a visit to another lane reassigns it (the same
	 * guard as every write: skill, hours, time off and the drive between visits). As a list: row actions to hand a visit
	 * to the best match or cancel it. Open a visit for the helpers free to take it.
	 */
	import { bolt } from '$bolt';
	import type { ListRow } from '@norbital-ai/bolt';
	import { addDays, Instant } from '@norbital-ai/std/date';
	import { utcOf } from '@norbital-ai/std/zone';
	import { AppShell, Cluster, Stack } from '@norbital-ai/ui/layout';
	const zone = useKinds().zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
	const t = bolt.t;
	const ui = useBolt();
	/** A visit enum value in the catalog's words. */
	const word = (field: 'status' | 'shift_check' | 'attention', value: string) =>
		enumText(value, { t: (key) => ui.t(key), model: 'visits', field });
	const clock = bolt.clock('day');
	let day = $state<string>(clock.today);
	/** The chosen workspace day, bounded by its two local midnights. */
	const span = $derived({
		start: Instant(new Date(utcOf(day, 0, zone)).toISOString()),
		end: Instant(new Date(utcOf(addDays(day, 1), 0, zone)).toISOString())
	});
	const helpers = $derived(
		bolt.query({
			helpers: {
				where: { status: { eq: 'active' } },
				fields: ['name'],
				orderBy: { name: 'asc' },
				limit: 200
			}
		})
	);
	const lanes = $derived([
		{ value: null, label: t('app.schedule.unassigned') },
		...(helpers.current?.helpers.rows ?? []).map((h) => ({ value: h.id, label: h.name }))
	]);
	const time = (i: string | null) =>
		i === null
			? '—'
			: new Intl.DateTimeFormat(bolt.locale, {
					timeZone: zone,
					hour: 'numeric',
					minute: '2-digit'
				}).format(new Date(i));
	const where = $derived({ slot: { overlaps: span }, status: { ne: 'cancelled' as const } });
	/** Who each of the day's visits is for, and what: one read beside the board's own, keyed by visit. */
	const booked = $derived(
		bolt.query({
			visits: { where, fields: ['booking'], limit: 500 },
			'visits.booking': { fields: ['customer', 'service'] },
			'visits.booking.customer': { fields: ['name'] },
			'visits.booking.service': { fields: ['name'] }
		})
	);
	const forWhom = $derived(
		new globalThis.Map(
			(booked.current?.visits.rows ?? []).map((v) => [
				v.id,
				`${v.booking?.customer?.name ?? '—'} · ${v.booking?.service?.name ?? '—'}`
			])
		)
	);
</script>

{#snippet dayPicker()}
	<div class="w-40">
		<TimeInput value={day} onChange={(next: string | null) => (day = next ?? clock.today)} />
	</div>
{/snippet}

{#snippet card({ row }: { row: ListRow<'visits'> })}
	<Stack gap="xs">
		<Cluster gap="xs" justify="between" align="center">
			<p class="text-sm font-medium tabular-nums">
				{time(row.slot.start)} – {time(row.slot.end)}
			</p>
		</Cluster>
		<p class="line-clamp-1 text-sm">{forWhom.get(row.id) ?? '—'}</p>
		<p class="line-clamp-1 text-meta leading-snug">{row.address}</p>
		<Cluster gap="xs">
			{#if row.status !== 'scheduled'}
				<Badge variant={row.status === 'done' ? 'success' : 'info'}
					>{word('status', row.status)}</Badge
				>
			{:else if row.shift_check !== 'not_due'}
				<Badge variant={row.shift_check === 'confirmed' ? 'success' : 'outline'}
					>{word('shift_check', row.shift_check)}</Badge
				>
			{/if}
			{#if row.attention !== 'none'}
				<Badge variant="warning">{word('attention', row.attention)}</Badge>
			{/if}
			{#if row.status === 'scheduled' && row.eta_minutes !== null}
				<Badge variant="outline">{t('component.eta', { minutes: row.eta_minutes })}</Badge>
			{/if}
		</Cluster>
	</Stack>
{/snippet}

{#snippet byHelper()}
	<Board
		of="visits"
		key="by-helper"
		by="helper"
		{lanes}
		{where}
		{card}
		orderBy={{ number: 'asc' }}
		toolbar={{ title: t('app.schedule.by_helper'), new: false }}
	/>
{/snippet}

{#snippet list()}
	<Table
		of="visits"
		key="list"
		{where}
		orderBy={{ number: 'asc' }}
		toolbar={{ title: t('app.schedule.list'), new: false }}
		columns={['number', 'slot', 'helper', 'address', 'status', 'shift_check', 'eta_minutes']}
		actions={[
			{
				run: (row) => bolt.start('visits_recommend', { targets: [row.id] }),
				label: t('app.schedule.auto_reassign')
			},
			{
				run: (row) => bolt.start('visits_cancel', { targets: [row.id] }),
				label: t('app.schedule.cancel_visit'),
				confirm: t('app.schedule.cancel_visit_confirm')
			}
		]}
	/>
{/snippet}

<AppShell
	icon="lucide:kanban"
	title={t('app.schedule.board_title')}
	description={t('app.schedule.board_description')}
	variant="full"
>
	{#snippet actions()}{@render dayPicker()}{/snippet}
	<Tabs
		tabs={[
			{
				name: 'by_helper',
				title: t('app.schedule.by_helper'),
				icon: 'lucide:kanban',
				body: byHelper
			},
			{ name: 'list', title: t('app.schedule.list'), icon: 'lucide:list', body: list }
		]}
	/>
</AppShell>
