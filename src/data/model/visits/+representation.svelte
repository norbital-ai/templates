<script lang="ts">
	/** A visit, and for dispatch the helpers who could take it instead, best match first, each one click away. */
	import { bolt } from '$bolt';
	import { isMasked, type Masked } from '@norbital-ai/bolt';
	import {
		type RecordSection,
		type RecordView,
		enumText,
		RecordShell,
		useBolt,
		useKinds
	} from '@norbital-ai/ui';
	import { Schema } from 'effect';
	import Recovery from '../../../lib/Recovery.svelte';
	import { excerpt, useWhen } from '../../../lib/summary.js';
	const when = useWhen();
	let {
		view
	}: {
		view: RecordView<'visits'>;
	} = $props();
	const t = bolt.t;
	const kinds = useKinds();
	const ui = useBolt();
	const word = (field: 'attention' | 'shift_check', value: string) =>
		enumText(value, { t: (key) => ui.t(key), model: 'visits', field });
	const summaryText = Schema.optionalKey(
		Schema.Union([Schema.String, Schema.Null, Schema.Undefined, Schema.declare<Masked>(isMasked)])
	);
	const completionSummary = Schema.decodeUnknownSync(
		Schema.Struct({
			completed_at: summaryText,
			started_at: summaryText,
			completion_notes: summaryText
		})
	);
	const record = $derived(view.mode !== 'create' ? view.record : null);
	/** Only dispatch reads warnings; a helper's catalogue has no such model. */
	const dispatcher = $derived(kinds.catalog?.['helper_warnings'] !== undefined);
	// when, where, who and what stay open; what dispatch must act on opens while the visit needs attention, completion
	// while it is under way; the automatic checks and the map pin fold away
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
						name: 'attention',
						title: t('section.attention'),
						fields: ['attention', 'proposed_slot', 'proposed_helper', 'unavailable_helper'],
						defaultOpen: !isMasked(record.attention) && record.attention !== 'none',
						summary: isMasked(record.attention) ? '' : word('attention', record.attention)
					},
					{
						name: 'checks',
						title: t('section.checks'),
						fields: ['shift_check', 'shift_asked_at', 'mc', 'eta_minutes', 'eta_checked_at'],
						defaultOpen: false,
						summary: [
							isMasked(record.shift_check) ? '' : word('shift_check', record.shift_check),
							typeof record.eta_minutes === 'number'
								? t('component.eta', { minutes: record.eta_minutes })
								: ''
						]
							.filter(Boolean)
							.join(' · ')
					},
					{
						name: 'completion',
						title: t('section.completion'),
						fields: ['started_at', 'completed_at', 'completion_notes', 'late_cancellation'],
						defaultOpen: record.status === 'in_progress',
						summary: (row) => {
							const r = completionSummary(row);
							return [
								typeof r.completed_at === 'string'
									? t('summary.completed', { at: when(r.completed_at) })
									: typeof r.started_at === 'string'
										? t('summary.started', { at: when(r.started_at) })
										: isMasked(r.completed_at) || isMasked(r.started_at)
											? ''
											: t('summary.not_started'),
								excerpt(typeof r.completion_notes === 'string' ? r.completion_notes : null)
							]
								.filter(Boolean)
								.join(' · ');
						}
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
			'proposed_slot',
			'proposed_helper',
			'unavailable_helper',
			'shift_check',
			'shift_asked_at',
			'mc',
			'eta_minutes',
			'eta_checked_at',
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
