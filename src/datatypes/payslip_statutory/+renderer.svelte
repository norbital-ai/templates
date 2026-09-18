<script lang="ts">
	/**
	 * What each statutory scheme charged, and on what.
	 *
	 * Read-only in every mode: statutory is calculated from base and proration when the run is built,
	 * and a settled payslip does not get corrected in place.
	 *
	 * Employee and employer are one row here rather than two, which is the point of the shape — they
	 * are produced by one pass over one scheme against one wage, and splitting them made every reader
	 * re-pair them and hope neither half was missing.
	 *
	 * The scheme is named by its code; the rule that governed and the lines that fed it are the
	 * payslip's own derivation affordance, never a wall of text in a table cell.
	 */
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import { schemeLabel } from '../../lib/payroll/scheme-label.js';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Scroll, Stack } from '@norbital-ai/ui/layout';
	import { formatNumeric } from '../../lib/ui/display-formatters.js';
	import { payslipStatutoryValueSchema } from './+definition.js';
	import type { RendererProps } from './$types.js';

	const { t } = useI18n<TenantI18nKeys>();
	const chargesSchema = Schema.Array(payslipStatutoryValueSchema);

	let props: RendererProps = $props();

	const parsed = $derived(
		Schema.decodeUnknownResult(chargesSchema)(Array.isArray(props.value) ? props.value : [])
	);
	const charges = $derived(Result.isSuccess(parsed) ? parsed.success : []);
	const employee = $derived(charges.reduce((sum, charge) => sum + charge.employee_amount, 0));
	const employer = $derived(charges.reduce((sum, charge) => sum + charge.employer_amount, 0));
	const summary = $derived(
		!Result.isSuccess(parsed)
			? t('renderer.payslip_statutory.invalid')
			: charges.length === 0
				? t('renderer.payslip_statutory.none')
				: t('renderer.payslip_statutory.summary', {
						count: charges.length,
						employee: formatNumeric(employee),
						employer: formatNumeric(employer)
					})
	);
</script>

{#if props.mode === 'display' || charges.length === 0}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="xs">
		<p class="text-meta">{t('renderer.payslip_statutory.identity')}</p>
		<Scroll axis="x" name={t('renderer.payslip_statutory.identity')}>
			<table class="w-full text-sm tabular-nums">
				<thead>
					<tr class="text-meta text-left">
						<th class="py-1 pr-3 font-normal">{t('component.code')}</th>
						<th class="py-1 pr-3 text-right font-normal"
							>{t('renderer.payslip_statutory.employee_amount')}</th
						>
						<th class="py-1 pr-3 text-right font-normal"
							>{t('renderer.payslip_statutory.employer_amount')}</th
						>
					</tr>
				</thead>
				<tbody>
					{#each charges as charge, index (`${charge.scheme_code}:${index}`)}
						<tr class="border-t border-border">
							<td class="py-1 pr-3">{schemeLabel(charge)}</td>
							<td class="py-1 pr-3 text-right font-medium"
								>{formatNumeric(charge.employee_amount)}</td
							>
							<td class="py-1 pr-3 text-right">{formatNumeric(charge.employer_amount)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</Scroll>
	</Stack>
{/if}
