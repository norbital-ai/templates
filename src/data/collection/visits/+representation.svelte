<script lang="ts">
	/** A visit, and for dispatch the helpers who could take it instead, best match first, each one click away. */
	import { bolt } from '$bolt';
	import type { RecordSection, RecordView } from '@norbital-ai/ui';
	import { RecordShell, useKinds } from '@norbital-ai/ui';
	import Recovery from '../../../lib/Recovery.svelte';
	import { excerpt, when } from '../../../lib/summary.js';

	let { view }: { view: RecordView<'visits'> } = $props();
	const t = bolt.t;
	const kinds = useKinds();
	const record = $derived(view.mode === 'update' ? view.record : null);
	/** Only dispatch reads warnings; a helper's catalogue has no such collection. */
	const dispatcher = $derived(kinds.catalog?.['helper_warnings'] !== undefined);
	// when, where, who and what stay open; the dispatch checks open while the visit needs attention, completion while it
	// is under way; the map pin folds away
	const sections = $derived<RecordSection[]>(
		record === null
			? []
			: [
					{
						name: 'visit',
						title: t('models.visits.singular'),
						fields: ['number', 'slot', 'status', 'booking', 'helper', 'address', 'skill']
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
</script>

{#snippet recovery()}
	{#if record !== null}<Recovery visit={record.id} />{/if}
{/snippet}

{#if record !== null}
	<RecordShell
		of="visits"
		fields={[
			'number',
			'slot',
			'status',
			'booking',
			'helper',
			'address',
			'skill',
			'attention',
			'shift_check',
			'shift_asked_at',
			'mc',
			'eta_minutes',
			'eta_checked_at',
			'proposed_slot',
			'proposed_helper',
			'unavailable_helper',
			'started_at',
			'completed_at',
			'completion_notes',
			'late_cancellation',
			'location'
		]}
		id={record.id}
		{sections}
		tabs={dispatcher && record.status === 'scheduled'
			? [
					{
						name: 'recovery',
						title: t('app.recovery.title'),
						icon: 'lucide:user-search',
						body: recovery
					}
				]
			: []}
	/>
{/if}
