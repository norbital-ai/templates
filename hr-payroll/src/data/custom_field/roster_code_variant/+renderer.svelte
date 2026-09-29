<script lang="ts">
	import Labelled from '../../../lib/ui/Labelled.svelte';
	import { t } from '../../../lib/ui/t.js';
	import { Combobox, Input, TimeRangeInput, type TimeRange } from '@norbital-ai/ui';
	import { Grid, Inline } from '@norbital-ai/ui/layout';

	import { numberFrom } from '../../../lib/ui/renderer-input.js';
	import type { CustomFieldView } from '@norbital-ai/ui';
	import type { RosterCodeVariant as Value } from '../../../lib/datatypes/roster_code_variant.js';

	let { view }: { view: CustomFieldView<Value> } = $props();
	const disabled = $derived(view.mode === 'edit' ? view.disabled : true);
	const current = $derived(view.value);
	const kindOptions: Array<{
		value: 'WORK' | 'REST' | 'OFF';
		label: string;
		description: string;
	}> = [
		{ value: 'WORK', label: 'Work shift', description: 'A scheduled clock window' },
		{ value: 'REST', label: 'Rest day', description: 'Protected weekly rest' },
		{ value: 'OFF', label: 'Off day', description: 'Another planned non-working day' }
	];

	/** One input step, in stored minutes — 0.5 h. */
	const STEP_MINUTES = 30;

	const summary = $derived.by(() => {
		if (current == null) return '—';
		if (current.kind !== 'WORK')
			return current.kind === 'REST'
				? current.statutory === true
					? 'Statutory rest day'
					: 'Rest day'
				: 'Off day';
		const overnight = current.end_time <= current.start_time ? ' (+1 day)' : '';
		return `${current.start_time} → ${current.end_time}${overnight} · ${current.break_minutes / 60}h break${current.break_start_time == null ? '' : ` from ${current.break_start_time}`}`;
	});
	function emit(value: Value): void {
		if (view.mode === 'edit') view.onChange(value);
	}

	function selectKind(value: string): void {
		if (value === 'WORK') {
			emit({
				kind: 'WORK',
				start_time: '09:00',
				end_time: '17:00',
				break_minutes: 60,
				break_start_time: '12:00'
			});
			return;
		}
		if (value === 'REST' || value === 'OFF') emit({ kind: value });
	}

	/** A window is two clock readings; a half-typed one is not written. */
	function setWindow(next: TimeRange): void {
		const clock = /^\d{2}:\d{2}$/;
		const start = next.start ?? '';
		const end = next.end ?? '';
		if (current?.kind !== 'WORK' || !clock.test(start) || !clock.test(end)) return;
		emit({ ...current, start_time: start, end_time: end });
	}

	function emitBreakHours(raw: string, snap: boolean): void {
		if (current?.kind !== 'WORK') return;
		if (raw.trim().length === 0) {
			emit({ ...current, break_minutes: 0 });
			return;
		}
		const typed = numberFrom(raw, Number.NaN);
		if (!Number.isFinite(typed) || typed < 0) return;
		const asMinutes = typed * 60;
		emit({
			...current,
			break_minutes: snap
				? Math.round(asMinutes / STEP_MINUTES) * STEP_MINUTES
				: Math.round(asMinutes)
		});
	}
</script>

{#if view.mode === 'show'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Grid gap="sm" minimum="panel">
		<Labelled label="Kind" class="text-xs" muted>
			<Combobox
				class="w-64 max-w-full"
				size="sm"
				aria-label="Roster code kind"
				options={kindOptions}
				value={current?.kind ?? null}
				{disabled}
				onChange={selectKind}
			/>
		</Labelled>
		{#if current?.kind === 'REST'}
			<label class="text-xs"
				><Inline as="span" gap="sm">
					<input
						type="checkbox"
						checked={current.statutory === true}
						{disabled}
						onchange={(event) => emit({ kind: 'REST', statutory: event.currentTarget.checked })}
					/>
					<span>{t('component.statutory_rest_day')}</span>
				</Inline></label
			>
		{/if}
		{#if current?.kind === 'WORK'}
			<Labelled label={t('component.shift_time_range')} class="text-xs" muted>
				<TimeRangeInput
					value={{ start: current.start_time, end: current.end_time }}
					{disabled}
					onChange={setWindow}
				/>
			</Labelled>
			<Labelled label={t('component.unpaid_break_hours')} class="text-xs" muted>
				<Input
					class="h-8"
					type="number"
					min="0"
					step="0.5"
					value={current.break_minutes / 60}
					{disabled}
					oninput={(event) => emitBreakHours(event.currentTarget.value, false)}
					onchange={(event) => emitBreakHours(event.currentTarget.value, true)}
				/>
			</Labelled>
			<Labelled label="Scheduled break starts" class="text-xs" muted>
				<Input
					class="h-8"
					type="time"
					value={current.break_start_time ?? ''}
					{disabled}
					onchange={(event) =>
						emit({ ...current, break_start_time: event.currentTarget.value || null })}
				/>
			</Labelled>
			<p class="col-span-full text-meta">{summary}</p>
		{/if}
	</Grid>
{/if}
