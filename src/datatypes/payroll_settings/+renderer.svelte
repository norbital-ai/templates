<script lang="ts">
	/**
	 * The payroll facts of one settings version (RFC 0001 §4): currency, the IANA zone its wall
	 * clock sits at, and the month its tax year opens. Machine facts, not prose: each is a real
	 * field here so the drift automation and the engine read the same value the operator typed.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import TimezonePicker from '../../collections/jurisdiction_settings/TimezonePicker.svelte';
	import { numberFrom } from '../../lib/ui/renderer-input.js';
	import type { RendererProps, Value } from './$types.js';

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const current = $derived<Value | null>(props.value ?? null);
	const summary = $derived(current == null ? '—' : `${current.currency} · ${current.timezone}`);

	function emit(next: Value): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else if current != null}
	<Grid class="rounded-md border border-border bg-muted/20 p-3" gap="sm" minimum="compact">
		<label class="text-sm font-medium">
			<Stack gap="xs">
				{t('component.currency')}
				<Input
					value={current.currency}
					maxlength={3}
					{disabled}
					oninput={(event) =>
						emit({ ...current, currency: event.currentTarget.value.toUpperCase() })}
				/>
			</Stack>
		</label>
		<label class="text-sm font-medium">
			<Stack gap="xs">
				{t('component.timezone')}
				<TimezonePicker
					value={current.timezone}
					onValueChange={(timezone) => {
						if (typeof timezone === 'string') emit({ ...current, timezone });
					}}
				/>
			</Stack>
		</label>
		<label class="text-sm font-medium">
			<Stack gap="xs">
				{t('component.tax_year_start_month')}
				<Input
					type="number"
					min="1"
					max="12"
					step="1"
					value={current.tax_year_start_month}
					{disabled}
					oninput={(event) =>
						emit({
							...current,
							tax_year_start_month: numberFrom(event.currentTarget.value, 1)
						})}
				/>
			</Stack>
		</label>
	</Grid>
{/if}
