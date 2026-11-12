<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	/** A visit, and for dispatch the helpers who could take it instead, best match first, each one click away. */
	import { type RecordSection, type RecordView, RecordShell, use_enum_text } from '@norbital-ai/ui';
	import { Schema } from 'effect';
	import Recovery from '../../../../../lib/Recovery.svelte';
	import { excerpt, useWhen } from '../../../../../lib/summary.js';
	let {
		view,
		ctx
	}: {
		view: RecordView<'visits'>;
		ctx: PageContext;
	} = $props();
	const when = useWhen(ctx);
	const t = ctx.t;
	const enumWord = use_enum_text();
	const word = (field: 'attention' | 'shift_check', value: string) => enumWord(value, field);
	const summaryText = Schema.optionalKey(
		Schema.Union([Schema.String, Schema.Null, Schema.Undefined])
	);
	const completionSummary = Schema.decodeUnknownSync(
		Schema.Struct({
			completed_at: summaryText,
			started_at: summaryText,
			completion_notes: summaryText
		})
	);
	const record = $derived(view.mode !== 'create' ? view.record : null);
	/** Only dispatch may hand the visit to another helper; a helper cannot. */
	const dispatcher = $derived(
		view.mode !== 'create' && view.capabilities?.fields['helper']?.writable === true
	);
	// when, where, who and what stay open; what dispatch must act on opens while the visit needs attention, completion
	// while it is under way; the automatic checks and the map pin fold away
	const sections = $derived<RecordSection[]>(
		record === null
			? []
			: [
					{
						name: 'visit',
						icon: 'lucide:map-pin',
						title: t('models.visits.singular'),
						fields: ['number', 'slot', 'status', 'booking', 'helper', 'address', 'skill']
					},
					{
						name: 'attention',
						icon: 'lucide:circle-alert',
						title: t('section.attention'),
						fields: ['attention', 'proposed_slot', 'proposed_helper', 'unavailable_helper'],
						// a helper's output has no attention or checks: their sections stay folded and blank
						default_open: typeof record.attention === 'string' && record.attention !== 'none',
						summary: typeof record.attention === 'string' ? word('attention', record.attention) : ''
					},
					{
						name: 'checks',
						icon: 'lucide:list-checks',
						title: t('section.checks'),
						fields: ['shift_check', 'shift_asked_at', 'mc', 'eta_minutes', 'eta_checked_at'],
						default_open: false,
						summary: [
							typeof record.shift_check === 'string' ? word('shift_check', record.shift_check) : '',
							typeof record.eta_minutes === 'number'
								? t('component.eta', { minutes: record.eta_minutes })
								: ''
						]
							.filter(Boolean)
							.join(' · ')
					},
					{
						name: 'completion',
						icon: 'lucide:circle-check',
						title: t('section.completion'),
						fields: ['started_at', 'completed_at', 'completion_notes', 'late_cancellation'],
						default_open: record.status === 'in_progress',
						summary: (row) => {
							const r = completionSummary(row);
							return [
								typeof r.completed_at === 'string'
									? t('summary.completed', { at: when(r.completed_at) })
									: typeof r.started_at === 'string'
										? t('summary.started', { at: when(r.started_at) })
										: t('summary.not_started'),
								excerpt(typeof r.completion_notes === 'string' ? r.completion_notes : null)
							]
								.filter(Boolean)
								.join(' · ');
						}
					},
					{
						name: 'map',
						icon: 'lucide:map',
						title: t('section.map'),
						fields: ['location'],
						default_open: false,
						summary: (r) => (r.location == null ? t('summary.not_set') : t('summary.pinned'))
					}
				]
	);
</script>

{#snippet recovery()}
	{#if record !== null}<Recovery {ctx} visit={record.id} />{/if}
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
