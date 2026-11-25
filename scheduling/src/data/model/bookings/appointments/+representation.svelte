<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		type RecordSection,
		type RecordView,
		format,
		RecordShell,
		use_enum_text
	} from '@norbital-ai/ui';
	import { Schema } from 'effect';
	import Recovery from '../../../../lib/Recovery.svelte';
	import { excerpt } from '../../../../lib/summary.js';

	let { view, ctx }: { view: RecordView<'appointments'>; ctx: PageContext } = $props();
	const t = (...args: Parameters<PageContext['t']>) => ctx.t(...args);
	const enumWord = use_enum_text(() => ctx);
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
	const dispatcher = $derived(
		view.mode !== 'create' && view.capabilities?.fields['provider']?.writable === true
	);

	const sections = $derived<RecordSection[]>(
		record === null
			? []
			: [
					{
						name: 'appointment',
						icon: 'lucide:calendar-clock',
						title: t('models.appointments.singular'),
						fields: ['number', 'slot', 'status', 'provider', 'address', 'skill']
					},
					{
						name: 'attention',
						icon: 'lucide:circle-alert',
						title: t('section.attention'),
						fields: ['attention', 'proposed_slot', 'proposed_provider', 'unavailable_provider'],
						default_open: typeof record.attention === 'string' && record.attention !== 'none',
						summary: typeof record.attention === 'string' ? word('attention', record.attention) : ''
					},
					{
						name: 'checks',
						icon: 'lucide:list-checks',
						title: t('section.checks'),
						fields: ['shift_check', 'shift_asked_at', 'eta_minutes', 'eta_checked_at'],
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
									? t('summary.completed', {
											at: format({ kind: 'instant' }, r.completed_at, {
												locale: ctx.locale,
												zone: ctx.tz
											})
										})
									: typeof r.started_at === 'string'
										? t('summary.started', {
												at: format({ kind: 'instant' }, r.started_at, {
													locale: ctx.locale,
													zone: ctx.tz
												})
											})
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
	{#if record !== null}
		<Recovery {ctx} appointment={record.id} />
	{/if}
{/snippet}

{#if record !== null}
	<RecordShell
		{ctx}
		of="appointments"
		fields={[
			'number',
			'slot',
			'status',
			'provider',
			'address',
			'skill',
			'attention',
			'proposed_slot',
			'proposed_provider',
			'unavailable_provider',
			'shift_check',
			'shift_asked_at',
			'eta_minutes',
			'eta_checked_at',
			'started_at',
			'completed_at',
			'completion_notes',
			'late_cancellation',
			'location'
		]}
		id={record.id}
		title={record.number}
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
