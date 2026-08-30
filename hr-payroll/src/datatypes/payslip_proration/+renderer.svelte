<script lang="ts">
	/**
	 * What the calendar did to base, segment by segment.
	 *
	 * Read-only in every mode. Proration is written by the payroll engine when the run is built and
	 * a settled payslip is a frozen statement of what was paid; there is no edit path to offer, and
	 * offering one would suggest the arithmetic could be corrected in place rather than by a new run.
	 *
	 * Every input is shown beside its result — `days / denominator` is the fraction and
	 * `contract_amount × fraction` is `prorated_amount` — because that is the whole reason the
	 * segment is stored instead of recomputed: a payslip has to stay re-readable years after the
	 * jurisdiction's proration basis changed.
	 *
	 * `proration` is `custom('payslip_proration', { multiple: true })`, so the column value is an
	 * array while the generated `Value` names one element; `field.array` is how the runtime says so.
	 */
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Scroll, Stack } from '@norbital-ai/ui/layout';
	import { formatCalendarDate, formatNumeric } from '../../lib/ui/display-formatters.js';
	import type { ProrationBasis } from '../proration_basis/+definition.js';
	import { payslipProrationValueSchema } from './+definition.js';
	import type { RendererProps } from './$types.js';

	const { t } = useI18n<TenantI18nKeys>();
	const segmentsSchema = Schema.Array(payslipProrationValueSchema);

	let props: RendererProps = $props();

	const parsed = $derived(
		Schema.decodeUnknownResult(segmentsSchema)(Array.isArray(props.value) ? props.value : [])
	);
	const segments = $derived(Result.isSuccess(parsed) ? parsed.success : []);
	const total = $derived(segments.reduce((sum, segment) => sum + segment.prorated_amount, 0));
	function prorationBasisLabel(basis: ProrationBasis): string {
		return basis.by === 'FIXED_DAYS' ? `${basis.by} · ${basis.days}` : basis.by;
	}

	const summary = $derived(
		!Result.isSuccess(parsed)
			? t('renderer.payslip_proration.invalid')
			: segments.length === 0
				? t('renderer.payslip_proration.none')
				: t('renderer.payslip_proration.summary', {
						count: segments.length,
						total: formatNumeric(total)
					})
	);
</script>

{#if props.mode === 'display' || segments.length === 0}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="xs">
		<p class="text-meta">{t('renderer.payslip_proration.identity')}</p>
		<Scroll axis="x" name={t('renderer.payslip_proration.identity')}>
			<table class="w-full text-sm tabular-nums">
				<thead>
					<tr class="text-meta text-left">
						<th class="py-1 pr-3 font-normal">{t('renderer.payslip_proration.segment')}</th>
						<th class="py-1 pr-3 font-normal">{t('renderer.payslip_proration.basis')}</th>
						<th class="py-1 pr-3 text-right font-normal"
							>{t('renderer.payslip_proration.fraction')}</th
						>
						<th class="py-1 pr-3 text-right font-normal"
							>{t('renderer.payslip_proration.contract_amount')}</th
						>
						<th class="py-1 text-right font-normal"
							>{t('renderer.payslip_proration.prorated_amount')}</th
						>
					</tr>
				</thead>
				<tbody>
					{#each segments as segment (`${segment.term_key}:${segment.from}`)}
						<tr class="border-t border-border">
							<td class="py-1 pr-3 whitespace-nowrap"
								>{formatCalendarDate(segment.from)} → {formatCalendarDate(segment.to)}</td
							>
							<td class="py-1 pr-3">{prorationBasisLabel(segment.basis)}</td>
							<td class="py-1 pr-3 text-right">{segment.days} / {segment.denominator}</td>
							<td class="py-1 pr-3 text-right">{formatNumeric(segment.contract_amount)}</td>
							<td class="py-1 text-right font-medium">{formatNumeric(segment.prorated_amount)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</Scroll>
	</Stack>
{/if}
