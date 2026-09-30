<script lang="ts">
	/**
	 * The day's schedule. By helper: one lane per helper, and dragging a visit to another lane reassigns it (the same
	 * guard as every write: skill, hours, time off and the drive between visits). As a list: row actions to hand a visit
	 * to the best match or cancel it. Open a visit for the helpers free to take it.
	 */
	import { bolt } from '$bolt';
	import type { ListRow } from '@norbital-ai/bolt';
	import { Instant } from '@norbital-ai/std/date';
	import { AppShell, Cluster, Stack } from '@norbital-ai/ui/layout';
	import { Badge, Board, DateInput, Table, Tabs } from '@norbital-ai/ui';
	import { live } from '../../../lib/live.svelte.js';

	const t = bolt.t;
	const today = new Intl.DateTimeFormat('en-CA').format(new Date());
	let day = $state(today);
	/** The chosen day in the viewer's zone, as instants. */
	const span = $derived.by(() => {
		const start = new Date(`${day}T00:00:00`);
		const end = new Date(start);
		end.setDate(end.getDate() + 1);
		return { start: Instant(start.toISOString()), end: Instant(end.toISOString()) };
	});
	const helpers = live(() =>
		bolt.read('helpers', {
			where: { status: { eq: 'active' } },
			select: { name: true },
			orderBy: { name: 'asc' },
			limit: 200
		})
	);
	const lanes = $derived([
		{ value: null, label: t('app.schedule.unassigned') },
		...(helpers.current?.rows ?? []).map((h) => ({ value: h.id, label: h.name }))
	]);
	const time = (i: string | null) =>
		i === null
			? '—'
			: new Intl.DateTimeFormat(bolt.locale, { hour: 'numeric', minute: '2-digit' }).format(
					new Date(i)
				);
	const where = $derived({ slot: { overlaps: span }, status: { ne: 'cancelled' as const } });
	/** Who each of the day's visits is for, and what: one read beside the board's own, keyed by visit. */
	const booked = live(() =>
		bolt.read('visits', {
			where,
			select: {
				booking: {
					select: { customer: { select: { name: true } }, service: { select: { name: true } } }
				}
			},
			limit: 500
		})
	);
	const forWhom = $derived(
		new globalThis.Map(
			(booked.current?.rows ?? []).map((v) => [
				v.id,
				`${v.booking.customer.name} · ${v.booking.service.name}`
			])
		)
	);
</script>

{#snippet dayPicker()}
	<div class="w-40">
		<DateInput value={day} onChange={(next) => (day = next ?? today)} />
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
					>{t(`component.status_${row.status}`)}</Badge
				>
			{:else if row.shift_check !== 'not_due'}
				<Badge variant={row.shift_check === 'confirmed' ? 'success' : 'outline'}
					>{t(`component.shift_${row.shift_check}`)}</Badge
				>
			{/if}
			{#if row.attention !== 'none'}
				<Badge variant="warning">{t(`component.attention_${row.attention}`)}</Badge>
			{/if}
			{#if row.eta_minutes !== null}
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
		toolbar={{ title: false, controls: dayPicker, new: false }}
	/>
{/snippet}

{#snippet list()}
	<Table
		of="visits"
		key="list"
		{where}
		orderBy={{ number: 'asc' }}
		toolbar={{ title: false, controls: dayPicker, new: false }}
		columns={['number', 'slot', 'helper', 'address', 'status', 'shift_check', 'eta_minutes']}
		actions={[
			{ action: 'visits.reassign', label: t('app.schedule.auto_reassign') },
			{
				action: 'visits.cancel',
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
