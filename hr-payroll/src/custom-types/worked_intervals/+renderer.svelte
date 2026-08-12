<script lang="ts">
	import { Button } from '@norbital-ai/ui/button';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$pod/i18n-keys';
	import { Input } from '@norbital-ai/ui/input';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import { workedIntervalsSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(workedIntervalsSchema.safeParse(props.value));
	const current = $derived(parsed.success ? parsed.data : []);
	const summary = $derived(
		current
			.map(
				(interval) => `${interval.start_at} → ${interval.end_at ?? t('component.attendance_open')}`
			)
			.join(' · ') || '—'
	);

	function localInputValue(instant: string | null): string {
		if (instant == null) return '';
		const date = new Date(instant);
		if (Number.isNaN(date.getTime())) return '';
		const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
		return local.toISOString().slice(0, 16);
	}

	function emit(value: Value): void {
		if (props.mode === 'edit') props.onValueChange(value);
	}

	function setInterval(index: number, patch: Partial<Value[number]>): void {
		emit(current.map((interval, at) => (at === index ? { ...interval, ...patch } : interval)));
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
				<label class="grid flex-1 gap-1.5 text-sm font-medium">
					{t('component.interval_started')}
					<Input
						type="datetime-local"
						value={localInputValue(interval.start_at)}
						{disabled}
						oninput={(event) =>
							setInterval(index, { start_at: new Date(event.currentTarget.value).toISOString() })}
					/>
				</label>
				<label class="grid flex-1 gap-1.5 text-sm font-medium">
					{t('component.interval_ended')}
					<Input
						type="datetime-local"
						value={localInputValue(interval.end_at)}
						{disabled}
						oninput={(event) =>
							setInterval(index, {
								end_at:
									event.currentTarget.value === ''
										? null
										: new Date(event.currentTarget.value).toISOString()
							})}
					/>
				</label>
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
