<script lang="ts">
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { jurisdictionOptions } from './jurisdiction-scope.svelte.js';

	type Props = {
		/** The selected version's id; a version is the only thing the picker names. */
		value: string | null;
		onValueChange: (versionId: string | null) => void;
	};

	let { value, onValueChange }: Props = $props();

	const { t } = useI18n<TenantI18nKeys>();
	const options = $derived(
		jurisdictionOptions().map((option) => ({
			...option,
			badge: option.badge == null ? undefined : t(option.badge)
		}))
	);
</script>

<div data-jurisdiction-scope-combobox>
	<Combobox
		{options}
		value={value ?? undefined}
		onValueChange={(next) => onValueChange(next ?? null)}
		allowClear={false}
		preserveOptionOrder
		ariaLabel={t('app.settings.jurisdiction')}
		searchPlaceholder={t('app.settings.search_jurisdictions')}
		emptyPlaceholder={t('app.settings.choose_jurisdiction')}
		class="min-w-[16rem] w-64"
	/>
</div>
