<script lang="ts">
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { periodWindow } from './calendar.js';

	let {
		month,
		onMonthChange,
		disabled = false,
		class: className = 'w-auto min-w-[12rem]'
	}: {
		month: string;
		onMonthChange: (month: string) => void;
		disabled?: boolean;
		class?: string;
	} = $props();

	const { t, intlLocale } = useI18n<TenantI18nKeys>();
	const monthFormatter = $derived(
		new Intl.DateTimeFormat(intlLocale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
	);
	const monthOptions = $derived.by(() => {
		const periods = periodWindow(37, 12);
		return (periods.includes(month) ? periods : [...periods, month]).toSorted().map((period) => ({
			value: period,
			label: monthFormatter.format(new Date(`${period}-01T00:00:00.000Z`))
		}));
	});
</script>

<div data-month-picker>
	<Combobox
		options={monthOptions}
		value={month}
		onValueChange={(nextMonth) => {
			if (typeof nextMonth === 'string') onMonthChange(nextMonth);
		}}
		allowClear={false}
		ariaLabel={t('app.scheduling.month_picker')}
		searchPlaceholder={t('app.scheduling.search_month')}
		emptyPlaceholder={t('app.scheduling.month_picker')}
		{disabled}
		class={className}
	/>
</div>
