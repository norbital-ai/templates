<script lang="ts" generics="TRow extends MatrixRow">
	/**
	 * One statutory-scheme picker for a matrix cell: the version's schemes by code, never a
	 * hand-typed UUID. The lookup is shared with the opt-ins list editors, so a code shown here is
	 * the code those editors offer.
	 */
	import type { MatrixCellRendererProps, MatrixRow } from '@norbital-ai/ui/data-renderer/matrix';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { statutorySchemeOptions } from './scheme-options.svelte.js';

	let { value, disabled, onValueChange }: MatrixCellRendererProps<TRow> = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const schemes = statutorySchemeOptions();
	const selected = $derived(value == null || value === '' ? null : String(value));
	const code = $derived(selected == null ? '—' : schemes.codeOf(selected));
</script>

{#if disabled}
	<span class="block truncate text-sm" title={code}>{code}</span>
{:else}
	<Combobox
		ariaLabel={t('component.statutory_scheme')}
		options={schemes.options}
		value={selected}
		{disabled}
		emptyPlaceholder={t('component.choose_scheme')}
		onValueChange={(next) => onValueChange(next ?? '')}
	/>
{/if}
