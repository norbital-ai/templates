<script lang="ts">
	/**
	 * The dated life events of a person's stints, by date, newest first. A stint's events are added, edited and removed
	 * together, where they stand: one write of the stint.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Button,
		Editor,
		EmptyState,
		Section,
		Sheet,
		format,
		value_object,
		type Kind,
		type Value
	} from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import { Effect } from 'effect';
	import VersionTimeline from '../components/version_timeline.svelte';
	import { paidPeriods } from '../payroll/paid_period.svelte.js';
	import { fieldLabel } from './change_summary.js';
	import type { PersonRead, StintRow } from './person_read.svelte.js';
	import { saved } from './save.js';

	let { ctx, read }: { ctx: PageContext; read: PersonRead } = $props();
	const t: PageContext['t'] = (key, vars) => ctx.t(key, vars);
	const paid = paidPeriods(ctx);
	/** The stint's `events`, for the sheet's editor. */
	const EVENTS: Kind = {
		kind: 'object',
		many: true,
		fields: {
			kind: { kind: 'text' },
			on: { kind: 'date' },
			opened_on: { kind: 'date', optional: true },
			ended_on: { kind: 'date', optional: true },
			allocated_days: { kind: 'int', optional: true }
		}
	};
	let editing = $state<StintRow | null>(null);
	let edit = $state<Value | null>(null);
	let saving = $state(false);
	const day = (value: unknown) => format({ kind: 'date' }, String(value), { locale: ctx.locale });
	const period = (stint: StintRow) =>
		format({ kind: 'period', of: 'date' }, stint.effective_range, { locale: ctx.locale });
	const timeline = (stint: StintRow) =>
		(stint.events ?? [])
			.toSorted((left, right) => String(right.on).localeCompare(String(left.on)))
			.map((event, index) => ({
				id: String(index),
				period: day(event.on),
				status: fieldLabel(event.kind.toLowerCase()),
				detail: [
					...(event.opened_on == null
						? []
						: [`${fieldLabel('opened_on')}: ${day(event.opened_on)}`]),
					...(event.ended_on == null ? [] : [`${fieldLabel('ended_on')}: ${day(event.ended_on)}`]),
					...(event.allocated_days == null
						? []
						: [`${fieldLabel('allocated_days')}: ${event.allocated_days}`])
				].join(' · ')
			}));
	/** The events as the stint stores them: the editor answers plain values. */
	const events = $derived(
		edit === null
			? (editing?.events ?? [])
			: (Array.isArray(edit) ? edit : []).flatMap((item) =>
					value_object(item) && typeof item.kind === 'string' && typeof item.on === 'string'
						? [
								{
									kind: item.kind,
									on: item.on,
									...(typeof item.opened_on === 'string' ? { opened_on: item.opened_on } : {}),
									...(typeof item.ended_on === 'string' ? { ended_on: item.ended_on } : {}),
									...(typeof item.allocated_days === 'number'
										? { allocated_days: item.allocated_days }
										: {})
								}
							]
						: []
				)
	);
	function begin(stint: StintRow) {
		edit = null;
		editing = stint;
	}
	function save() {
		const stint = editing;
		if (stint === null || saving) return;
		saving = true;
		const next = events;
		// an event dated in a paid period amends it: HR is asked first, as on an entry
		const reaches = [...(stint.events ?? []), ...next].some((event) =>
			paid.covers(event.on, stint.entity_id)
		);
		fork(
			saved(ctx, reaches, () =>
				ctx.act({
					'employment.update': [
						{ target: { id: stint.id, revision: stint.revision }, set: { events: next } }
					]
				})
			).pipe(
				Effect.tap((done) => Effect.sync(() => done && (editing = null))),
				Effect.ensuring(Effect.sync(() => (saving = false)))
			)
		);
	}
</script>

<Stack gap="md">
	{#if !read.loading && read.stints.length === 0}
		<EmptyState title={t('person.events_empty')} />
	{/if}
	{#each read.stints as stint, index (stint.id)}
		{@const items = timeline(stint)}
		{#snippet change()}<Button variant="outline" onclick={() => begin(stint)}
				>{t('person.edit_events')}</Button
			>{/snippet}
		<Section
			name="events_{stint.id}"
			title="{read.company(stint.entity_id)?.name ?? ''} · {period(stint)}"
			first={index === 0}
			collapsible={false}
			actions={change}
		>
			{#if items.length === 0}
				<EmptyState title={t('person.events_empty')} />
			{:else}
				<VersionTimeline label={t('person.tab_events')} {items} onOpen={() => begin(stint)} />
			{/if}
		</Section>
	{/each}
</Stack>

<Sheet
	open={editing !== null}
	on_open_change={(open) => !open && !saving && (editing = null)}
	title={t('person.tab_events')}
>
	<Stack gap="md">
		<Editor
			{ctx}
			id="stint-events"
			name="events"
			kind={EVENTS}
			value={events}
			disabled={saving}
			on_change={(next) => (edit = next)}
		/>
		<Cluster gap="sm" justify="end">
			<Button variant="outline" disabled={saving} onclick={() => (editing = null)}
				>{t('component.cancel')}</Button
			>
			<Button disabled={saving} onclick={save}>{t('person.save')}</Button>
		</Cluster>
	</Stack>
</Sheet>
