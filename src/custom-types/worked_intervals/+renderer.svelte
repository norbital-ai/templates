<script lang="ts">
	import { Result, Schema } from 'effect';
	import { Button } from '@norbital-ai/ui/button';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { TimeRangeField, type TimeRange } from '@norbital-ai/ui/time-range';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import { parseAbsoluteToLocal, type ZonedDateTime } from '@internationalized/date';
	import { workedIntervalsSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(workedIntervalsSchema)(props.value));
	const current = $derived(Result.isSuccess(parsed) ? parsed.success : []);
	const summary = $derived(
		current
			.map(
				(interval) => `${interval.start_at} → ${interval.end_at ?? t('component.attendance_open')}`
			)
			.join(' · ') || '—'
	);

	function intervalRange(interval: Value[number]): TimeRange<ZonedDateTime> {
		return {
			start: parseAbsoluteToLocal(interval.start_at),
			end: interval.end_at == null ? undefined : parseAbsoluteToLocal(interval.end_at)
		};
	}

	function emit(value: Value): void {
		if (props.mode === 'edit') props.onValueChange(value);
	}

	function setInterval(index: number, patch: Partial<Value[number]>): void {
		emit(current.map((interval, at) => (at === index ? { ...interval, ...patch } : interval)));
	}

	function setIntervalRange(index: number, range: TimeRange<ZonedDateTime> | undefined): void {
		if (range?.start == null) return;
		setInterval(index, {
			start_at: range.start.toAbsoluteString(),
			end_at: range.end?.toAbsoluteString() ?? null
		});
	}

	function addInterval(): void {
		const now = new Date();
		const later = new Date(now.getTime() + 8 * 60 * 60 * 1000);
		emit([...current, { start_at: now.toISOString(), end_at: later.toISOString() }]);
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="sm" class="rounded-md border bg-muted/20 p-3">
		{#each current as interval, index (index)}
			<Inline gap="sm" align="end">
				<TimeRangeField
					class="flex-1"
					label={t('component.worked_interval')}
					value={intervalRange(interval)}
					placeholder={parseAbsoluteToLocal(interval.start_at)}
					hideTimeZone={false}
					{disabled}
					onValueChange={(range) => setIntervalRange(index, range)}
				/>
				<Button
					type="button"
					variant="outline"
					disabled={disabled || current.length === 1}
					onclick={() => emit(current.filter((_interval, at) => at !== index))}
				>
					{t('component.remove_interval')}
				</Button>
			</Inline>
		{/each}
		<Button type="button" variant="outline" {disabled} onclick={addInterval}>
			{t('component.add_worked_interval')}
		</Button>
		<p class="text-xs text-muted-foreground">
			{t('component.worked_intervals_hint')}
		</p>
	</Stack>
{/if}
