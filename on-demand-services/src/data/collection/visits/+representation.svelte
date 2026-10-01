<script lang="ts">
	/** A visit, and for dispatch the helpers who could take it instead, best match first, each one click away. */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import type { RecordSection, RecordView } from '@norbital-ai/ui';
	import { Button, RecordShell, Table, useKinds } from '@norbital-ai/ui';
	import { live } from '../../../lib/live.svelte.js';
	import { excerpt, when } from '../../../lib/summary.js';

	let { view }: { view: RecordView<'visits'> } = $props();
	const t = bolt.t;
	const kinds = useKinds();
	const record = $derived(view.mode === 'update' ? view.record : null);
	/** Only dispatch reads warnings; a helper's catalogue has no such collection. */
	const dispatcher = $derived(kinds.catalog?.['helper_warnings'] !== undefined);
	const candidates = live(
		() =>
			record !== null && dispatcher && record.status === 'scheduled'
				? bolt.query('visits.candidates', { visit: record.id })
				: null,
		['visits', 'helpers', 'helper_time_off']
	);
	let message = $state<string | null>(null);
	// when, where, who and what stay open; the dispatch checks open while the visit needs attention, completion while it
	// is under way; the map pin folds away
	const sections = $derived<RecordSection[]>(
		record === null
			? []
			: [
					{
						name: 'visit',
						title: t('models.visits.singular'),
						fields: ['number', 'slot', 'status', 'booking', 'helper', 'address', 'area', 'skill']
					},
					{
						name: 'checks',
						title: t('section.checks'),
						fields: [
							'attention',
							'shift_check',
							'shift_asked_at',
							'mc',
							'eta_minutes',
							'eta_checked_at',
							'proposed_slot',
							'proposed_helper'
						],
						defaultOpen: record.attention !== 'none',
						summary:
							record.attention !== 'none'
								? t(`models.visits.fields.attention.${record.attention}`)
								: [
										t(`models.visits.fields.shift_check.${record.shift_check}`),
										record.eta_minutes == null
											? ''
											: t('component.eta', { minutes: record.eta_minutes })
									]
										.filter(Boolean)
										.join(' · ')
					},
					{
						name: 'completion',
						title: t('section.completion'),
						fields: ['started_at', 'completed_at', 'completion_notes', 'late_cancellation'],
						defaultOpen: record.status === 'in_progress',
						summary: (r) =>
							[
								r.completed_at != null
									? t('summary.completed', { at: when(String(r.completed_at)) })
									: r.started_at != null
										? t('summary.started', { at: when(String(r.started_at)) })
										: t('summary.not_started'),
								excerpt(r.completion_notes)
							]
								.filter(Boolean)
								.join(' · ')
					},
					{
						name: 'map',
						title: t('section.map'),
						fields: ['location'],
						defaultOpen: false,
						summary: (r) => (r.location == null ? t('summary.not_set') : t('summary.pinned'))
					}
				]
	);

	async function assign(helper: Id<'helpers'>) {
		if (record === null) return;
		const outcome = await bolt.act('visits.reassign', { target: record.id, input: { helper } });
		message = outcome.kind === 'refused' ? outcome.message : null;
	}
</script>

{#snippet assignCell({ row }: { row: { helper: Id<'helpers'> } })}
	<Button size="sm" variant="outline" onclick={() => assign(row.helper)}
		>{t('app.schedule.assign')}</Button
	>
{/snippet}

{#snippet free()}
	<Table
		of={candidates.current ?? []}
		toolbar={{ title: t('app.schedule.free_helpers'), description: message ?? false }}
		columns={[
			{ field: 'name', label: t('component.helper') },
			{ field: 'drive_minutes', label: t('component.drive_minutes') },
			{ field: 'same_area', label: t('component.same_area') },
			{ field: 'week_hours', label: t('component.week_hours') },
			{ field: 'helper', label: t('app.schedule.assign'), cell: assignCell }
		]}
	/>
{/snippet}

{#if record !== null}
	<RecordShell
		of="visits"
		id={record.id}
		{sections}
		tabs={dispatcher && record.status === 'scheduled'
			? [
					{
						name: 'free',
						title: t('app.schedule.free_helpers'),
						icon: 'lucide:user-search',
						body: free
					}
				]
			: []}
	/>
{/if}
