<script lang="ts">
	import { Inline } from '@norbital-ai/ui/layout';
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
</script>

{#snippet periodButton(active: boolean, label: string, select: () => void, title?: string)}
	<button
		type="button"
		class="rounded-md border px-2 py-1 text-xs {active
			? 'border-foreground bg-foreground text-background'
			: 'border-border text-muted-foreground hover:bg-muted'}"
		aria-pressed={active}
		{title}
		{disabled}
		onclick={select}
	>
		{label}
	</button>
{/snippet}

<Inline gap="sm" data-month-picker>
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
		<Inline
			gap="xs"
			align="stretch"
			role="group"
			aria-label={t('app.scheduling.week_picker')}
			data-week-picker
		>
			{#each monthWeeks as week (week.sequence)}
				{@render periodButton(
					half === week.sequence,
					t('app.scheduling.week_n', { n: week.sequence }),
					() => onMonthChange(`${periodMonth(month)}-${week.sequence}`),
					`${week.salary.start} – ${week.salary.end}`
				)}
			{/each}
		</Inline>
	{:else if halves}
		<Inline
			gap="xs"
			align="stretch"
			role="group"
			aria-label={t('app.scheduling.half_picker')}
			data-half-picker
		>
			{@render periodButton(half === 1, t('app.scheduling.first_half'), () =>
				onMonthChange(`${periodMonth(month)}-1`)
			)}
			{@render periodButton(half === 2, t('app.scheduling.second_half'), () =>
				onMonthChange(`${periodMonth(month)}-2`)
			)}
		</Inline>
	{/if}
</Inline>
