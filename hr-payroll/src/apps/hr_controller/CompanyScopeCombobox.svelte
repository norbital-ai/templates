<script lang="ts">
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { companyOptions, resolveCompanyId } from './company-scope.svelte.js';

	type Props = {
		value: string | null;
		onValueChange: (id: string | null) => void;
	};

	let { value, onValueChange }: Props = $props();

	const { t } = useI18n<TenantI18nKeys>();
	const options = $derived(companyOptions());
	const selected = $derived(resolveCompanyId(value));
</script>

<div data-company-scope-combobox>
	<Combobox
		{options}
		value={selected}
		{onValueChange}
		allowClear={false}
		ariaLabel={t('component.legal_entity')}
		searchPlaceholder={t('component.search_companies')}
		emptyPlaceholder={t('component.choose_legal_entity')}
		class="min-w-[14rem] w-56"
	/>
</div>
