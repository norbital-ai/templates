<script lang="ts">
	import { MonthPicker } from '@norbital-ai/ui/month-picker';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';

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

	const { t } = useI18n<TenantI18nKeys>();
</script>

<div data-month-picker>
	<MonthPicker
		value={month}
		onValueChange={onMonthChange}
		ariaLabel={t('app.scheduling.month_picker')}
		{disabled}
		class={className}
	/>
</div>
