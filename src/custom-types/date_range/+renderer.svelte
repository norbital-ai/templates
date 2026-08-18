<script lang="ts">
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid } from '@norbital-ai/ui/layout';
	import {
		PAYROLL_TIME_ZONE,
		calendarDateInTimeZone,
		startOfDayInstant
	} from '../../lib/ui/calendar.js';
	import { formatEffectiveRange } from '../../lib/ui/display-formatters.js';
	import { dateRangeSchema } from './+definition.js';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import type { RendererProps } from './$types.js';

	const { t } = useI18n<TenantI18nKeys>();

	/**
	 * The platform hands every custom renderer the full `CollectionField` (name, kind, nullable,
	 * options, …); the generated `$types` only declare the `{ name, type }` minimum, so the field is
	 * restated against the design-system shape the callers and the runtime actually speak.
	 */
	type WithStdField<P> = P extends unknown
		? Omit<P, 'field'> & { readonly field: CollectionField }
		: never;
	type Props = WithStdField<RendererProps>;
	let props: Props = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(
		Schema.decodeUnknownResult(dateRangeSchema)(props.value, { onExcessProperty: 'error' })
	);
	const current = $derived(Result.isSuccess(parsed) ? parsed.success : null);
	const summary = $derived(current === null ? '—' : formatEffectiveRange(current));

	/**
	 * A bound is a stored instant; the picker offers a calendar day. Both directions resolve through
	 * the payroll timezone. Slicing the instant, or appending `Z` to the picked day, would place the
	 * boundary eight hours into the adjacent local day — which is what `dates-and-time.md` forbids,
	 * and effective dating is what decides which layer prices a run.
	 */
	function dayOf(instant: string): string {
		const at = new Date(instant);
		return Number.isNaN(at.getTime()) ? '' : calendarDateInTimeZone(at, PAYROLL_TIME_ZONE);
	}

	/** Clearing a picker keeps the bound it had: a range with one end missing prices nothing. */
	function pick(bound: 'start' | 'end', picked: string): void {
		if (props.mode !== 'edit' || current === null) return;
		props.onValueChange({
			...current,
			[bound]:
				picked.trim().length === 0 ? current[bound] : startOfDayInstant(picked, PAYROLL_TIME_ZONE)
		});
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Grid class="rounded-md border border-border bg-muted/20 p-3" gap="sm" minimum="compact">
		<label class="grid gap-1.5 text-sm font-medium">
			{t('component.effective_from')}
			<Input
				type="date"
				value={current === null ? '' : dayOf(current.start)}
				disabled={disabled || current === null}
				oninput={(event) => pick('start', event.currentTarget.value)}
			/>
		</label>
		<label class="grid gap-1.5 text-sm font-medium">
			{t('component.effective_to')}
			<Input
				type="date"
				value={current === null ? '' : dayOf(current.end)}
				disabled={disabled || current === null}
				oninput={(event) => pick('end', event.currentTarget.value)}
			/>
		</label>
	</Grid>
{/if}
