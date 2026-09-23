<script lang="ts">
	import { MonthPicker } from '@norbital-ai/ui/month-picker';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { periodHalf, periodMonth } from '../../collections/payroll_runs/lib/dates.js';
	import { weeklyInstalments } from '../../collections/payroll_runs/lib/period.js';

	let {
		month,
		onMonthChange,
		halves = false,
		weeks = false,
		ariaLabel = undefined,
		disabled = false,
		class: className = 'w-auto min-w-[12rem]'
	}: {
		/** The selected period in the entity's grammar: `YYYY-MM`, or `YYYY-MM-1` / `-2`. */
		month: string;
		onMonthChange: (month: string) => void;
		/** Offer the two halves of the month — the entity pays semi-monthly. */
		halves?: boolean;
		/** Offer the weeks paid in the month — the entity pays weekly. */
		weeks?: boolean;
		/** Defaults to the roster month label; the event pages name their pay period instead. */
		ariaLabel?: string;
		disabled?: boolean;
		class?: string;
	} = $props();

	const { t } = useI18n<TenantI18nKeys>();
	const half = $derived(periodHalf(month) ?? 1);
	const monthWeeks = $derived(weeks ? weeklyInstalments(periodMonth(month)) : []);
	const halfClass = (active: boolean) =>
		`rounded-md border px-2 py-1 text-xs ${active ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-muted'}`;
</script>

<div data-month-picker class="flex items-center gap-2">
	<MonthPicker
		value={periodMonth(month)}
		onValueChange={(next) =>
			onMonthChange(
				halves
					? `${next}-${half}`
					: weeks
						? `${next}-${Math.min(half, weeklyInstalments(next).length)}`
						: next
			)}
		ariaLabel={ariaLabel ?? t('app.scheduling.month_picker')}
		{disabled}
		class={className}
	/>
	{#if weeks}
		<div
			role="group"
			aria-label={t('app.scheduling.week_picker')}
			class="flex gap-1"
			data-week-picker
		>
			{#each monthWeeks as week (week.sequence)}
				<button
					type="button"
					class={halfClass(half === week.sequence)}
					aria-pressed={half === week.sequence}
					title={`${week.salary.start} – ${week.salary.end}`}
					{disabled}
					onclick={() => onMonthChange(`${periodMonth(month)}-${week.sequence}`)}
				>
					{t('app.scheduling.week_n', { n: week.sequence })}
				</button>
			{/each}
		</div>
	{:else if halves}
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
				onclick={() => onMonthChange(`${periodMonth(month)}-1`)}
			>
				{t('app.scheduling.first_half')}
			</button>
			<button
				type="button"
				class={halfClass(half === 2)}
				aria-pressed={half === 2}
				{disabled}
				onclick={() => onMonthChange(`${periodMonth(month)}-2`)}
			>
				{t('app.scheduling.second_half')}
			</button>
		</div>
	{/if}
</div>
