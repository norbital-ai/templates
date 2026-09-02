<script lang="ts">
	/**
	 * The contracted amounts a payslip starts from.
	 *
	 * Read-only in every mode: base is taken from the employment terms when the run is built.
	 *
	 * The component is shown by its id and not by its code, for the same reason the statutory
	 * renderer shows a band rather than a scheme name — resolving it is a query, and this renderer is
	 * drawn once per payslip in a table of them. The payslip's own screen names the components, from
	 * one query, where every id is already in hand.
	 */
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import { formatNumeric } from '../../lib/ui/display-formatters.js';
	import { payslipBaseValueSchema } from './+definition.js';
	import type { RendererProps } from './$types.js';

	const { t } = useI18n<TenantI18nKeys>();
	const amountsSchema = Schema.Array(payslipBaseValueSchema);

	let props: RendererProps = $props();

	const parsed = $derived(
		Schema.decodeUnknownResult(amountsSchema)(Array.isArray(props.value) ? props.value : [])
	);
	const amounts = $derived(Result.isSuccess(parsed) ? parsed.success : []);
	const total = $derived(amounts.reduce((sum, entry) => sum + entry.amount, 0));
	const summary = $derived(
		!Result.isSuccess(parsed)
			? t('renderer.payslip_base.invalid')
			: amounts.length === 0
				? t('renderer.payslip_base.none')
				: t('renderer.payslip_base.summary', {
						count: amounts.length,
						total: formatNumeric(total)
					})
	);
</script>

{#if props.mode === 'display' || amounts.length === 0}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="xs">
		<p class="text-meta">{t('renderer.payslip_base.identity')}</p>
		<Stack as="ul" gap="none" class="text-sm tabular-nums">
			{#each amounts as entry, index (`${entry.component_code}:${index}`)}
				<Inline as="li" justify="between" gap="sm" class="border-t border-border py-1">
					<span class="truncate font-mono text-xs">{entry.component_code}</span>
					<span class="font-medium">{formatNumeric(entry.amount)}</span>
				</Inline>
			{/each}
		</Stack>
	</Stack>
{/if}
