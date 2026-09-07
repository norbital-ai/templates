<script lang="ts">
	import { TreeCombobox } from '@norbital-ai/ui/tree-combobox';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { jurisdictionTree } from './jurisdiction-scope.svelte.js';

	type Props = {
		/** The selected version's id, which is the only thing selectable in the tree. */
		value: string | null;
		onValueChange: (versionId: string | null) => void;
	};

	let { value, onValueChange }: Props = $props();

	const { t } = useI18n<TenantI18nKeys>();
	const tree = $derived(jurisdictionTree());
</script>

<div data-jurisdiction-scope-combobox>
	<TreeCombobox
		rootItems={tree.rootItems}
		disabledIds={tree.disabledIds}
		value={value ?? undefined}
		onValueChange={(next) => onValueChange(next ?? null)}
		allowCleared={false}
		ariaLabel={t('app.settings.jurisdiction')}
		searchPlaceholder={t('app.settings.search_jurisdictions')}
		placeholder={t('app.settings.choose_jurisdiction')}
		triggerClass="min-w-[16rem] w-64"
	/>
</div>
