<script lang="ts">
	import { Result, Schema } from 'effect';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { TimeRangeField, type TimeRange } from '@norbital-ai/ui/time-range';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { parseTime, type Time } from '@internationalized/date';
	import { numberFrom } from '../../lib/ui/renderer-input.js';
	import { rosterCodeVariantSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(rosterCodeVariantSchema)(props.value));
	const current = $derived(Result.isSuccess(parsed) ? parsed.success : null);
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
		if (current.kind !== 'WORK') return current.kind === 'REST' ? 'Rest day' : 'Off day';
		const overnight = current.end_time <= current.start_time ? ' (+1 day)' : '';
		return `${current.start_time} → ${current.end_time}${overnight} · ${current.break_minutes / 60}h break`;
	});
	const workRange = $derived<TimeRange<Time> | undefined>(
		current?.kind === 'WORK'
			? { start: parseTime(current.start_time), end: parseTime(current.end_time) }
			: undefined
	);

	function emit(value: Value): void {
		if (props.mode === 'edit') props.onValueChange(value);
	}

	function selectKind(value: 'WORK' | 'REST' | 'OFF' | null): void {
		if (value === 'WORK') {
			emit({ kind: 'WORK', start_time: '09:00', end_time: '17:00', break_minutes: 60 });
			return;
		}
		if (value === 'REST' || value === 'OFF') emit({ kind: value });
	}

	function formatTime(value: Time): string {
		return `${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`;
	}

	function setWorkRange(range: TimeRange<Time> | undefined): void {
		if (current?.kind !== 'WORK' || range?.start == null || range.end == null) return;
		emit({
			...current,
			start_time: formatTime(range.start),
			end_time: formatTime(range.end)
		});
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

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="sm" class="rounded-md border bg-muted/20 p-3">
		<label class="grid gap-1.5 text-sm font-medium">
			Kind
			<Combobox
				ariaLabel="Roster code kind"
				options={kindOptions}
				value={current?.kind ?? null}
				{disabled}
				searchable={false}
				onValueChange={selectKind}
			/>
		</label>
		{#if current?.kind === 'WORK'}
			<Grid gap="sm" minimum="compact">
				<TimeRangeField
					label={t('component.shift_time_range')}
					value={workRange}
					placeholder={workRange?.start}
					allowStartAfterEnd
					{disabled}
					onValueChange={setWorkRange}
				/>
				<label class="grid gap-1.5 text-sm font-medium">
					{t('component.unpaid_break_hours')}
					<Input
						type="number"
						min="0"
						step="0.5"
						value={current.break_minutes / 60}
						{disabled}
						oninput={(event) => emitBreakHours(event.currentTarget.value, false)}
						onchange={(event) => emitBreakHours(event.currentTarget.value, true)}
					/>
				</label>
			</Grid>
			<p class="text-meta">{summary}</p>
		{/if}
	</Stack>
{/if}
