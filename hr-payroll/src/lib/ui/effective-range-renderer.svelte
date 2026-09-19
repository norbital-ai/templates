<script lang="ts">
	/**
	 * An `effective_range` as an HR reader expects it: "from 13 Mar 2023" while the contract is
	 * open, "13 Mar 2023 – 30 Sep 2026" once it has closed.
	 *
	 * An open range is stored with the `9999-12-31` sentinel (what the exclusion constraint and the
	 * seed loader want), and the platform's range renderer prints that bound as "Dec 31, 9999".
	 * Reading folds the sentinel; editing is the platform's own picker, untouched.
	 */
	import { DataRenderer } from '@norbital-ai/ui/data-renderer';
	import type { CollectionFormRendererProps } from '@norbital-ai/ui/collection-form';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { formatTermsDates } from './display-formatters.js';

	let props: CollectionFormRendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
</script>

{#if props.mode === 'display'}
	<span class={props.class}>{formatTermsDates({ effective_range: props.value }, t)}</span>
{:else}
	<DataRenderer {...props} renderer={undefined} />
{/if}
