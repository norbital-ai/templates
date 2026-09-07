<script lang="ts">
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { jurisdictionOptions, resolveJurisdictionCode } from './jurisdiction-scope.svelte.js';

	type Props = {
		value: string | null;
		onValueChange: (code: string | null) => void;
	};

	let { value, onValueChange }: Props = $props();

	const { t } = useI18n<TenantI18nKeys>();
	const options = $derived(jurisdictionOptions());
	const selected = $derived(resolveJurisdictionCode(value));
</script>

<div data-jurisdiction-scope-combobox>
	<Combobox
		{options}
		value={selected}
		{onValueChange}
		allowClear={false}
		ariaLabel={t('app.settings.jurisdiction')}
		searchPlaceholder={t('app.settings.search_jurisdictions')}
		emptyPlaceholder={t('app.settings.choose_jurisdiction')}
		class="min-w-[14rem] w-56"
	/>
</div>
