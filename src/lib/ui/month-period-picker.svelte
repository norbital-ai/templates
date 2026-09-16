<script lang="ts">
	import { MonthPicker } from '@norbital-ai/ui/month-picker';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { periodHalfOf, periodMonthOf } from './calendar.js';

	let {
		month,
		onMonthChange,
		halves = false,
		ariaLabel = undefined,
		disabled = false,
		class: className = 'w-auto min-w-[12rem]'
	}: {
		/** The selected period in the entity's grammar: `YYYY-MM`, or `YYYY-MM-1` / `-2`. */
		month: string;
		onMonthChange: (month: string) => void;
		/** Offer the two halves of the month — the entity pays semi-monthly. */
		halves?: boolean;
		/** Defaults to the roster month label; the event pages name their pay period instead. */
		ariaLabel?: string;
		disabled?: boolean;
		class?: string;
	} = $props();

	const { t } = useI18n<TenantI18nKeys>();
	const half = $derived(periodHalfOf(month) ?? 1);
	const halfClass = (active: boolean) =>
		`rounded-md border px-2 py-1 text-xs ${active ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-muted'}`;
</script>

<div data-month-picker class="flex items-center gap-2">
	<MonthPicker
		value={periodMonthOf(month)}
		onValueChange={(next) => onMonthChange(halves ? `${next}-${half}` : next)}
		ariaLabel={ariaLabel ?? t('app.scheduling.month_picker')}
		{disabled}
		class={className}
	/>
	{#if halves}
		<div
			role="group"
			aria-label={t('app.scheduling.half_picker')}
			class="flex gap-1"
			data-half-picker
		>
			<button
				type="button"
				class={halfClass(half === 1)}
				aria-pressed={half === 1}
				{disabled}
				onclick={() => onMonthChange(`${periodMonthOf(month)}-1`)}
			>
				{t('app.scheduling.first_half')}
			</button>
			<button
				type="button"
				class={halfClass(half === 2)}
				aria-pressed={half === 2}
				{disabled}
				onclick={() => onMonthChange(`${periodMonthOf(month)}-2`)}
			>
				{t('app.scheduling.second_half')}
			</button>
		</div>
	{/if}
</div>
