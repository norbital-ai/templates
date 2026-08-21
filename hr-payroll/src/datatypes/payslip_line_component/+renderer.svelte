<script lang="ts">
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { payslipLineComponentSchema, type PayslipLineComponent } from './+definition.js';
	import { formatOvertimeLineBand } from '../../lib/ui/display-formatters.js';
	import type { RendererProps } from './$types.js';

	/**
	 * What kind of thing a settled line links to — and only that.
	 *
	 * Each arm of the union carries the uuid of the record it links to, and this renderer used to
	 * print it: every payslip breakdown row read `single-use entry · 130b9e77-…`. The uuid is the
	 * link, not the answer. The surrounding table already resolves the linked record to its
	 * `code · name` through the physical projections beside this column, so all this cell owes the
	 * operator is the kind of link.
	 */
	let props: RendererProps = $props();
	const { t, has } = useI18n<TenantI18nKeys>();
	const parsed = $derived(Schema.decodeUnknownResult(payslipLineComponentSchema)(props.value));
	const summary = $derived.by(() => {
		if (!Result.isSuccess(parsed)) return '—';
		const component = parsed.success;
		// The two overtime arms are the exception to the paragraph above: they link to no record, so
		// the surrounding table has nothing to resolve beside them and the cell is the only place the
		// statutory band that priced the line can be read.
		if (component.kind === 'OVERTIME' || component.kind === 'OVERTIME_EXCESS')
			return formatOvertimeLineBand(
				{ ...component, excess: component.kind === 'OVERTIME_EXCESS' },
				t
			);
		const key = catalogueKey(component.kind);
		return key != null && has(key) ? t(key) : component.kind.replaceAll('_', ' ').toLowerCase();
	});

	function catalogueKey(
		kind: Exclude<PayslipLineComponent['kind'], 'OVERTIME' | 'OVERTIME_EXCESS'>
	): TenantI18nKeys | null {
		switch (kind) {
			case 'COMPONENT_ENTRY_ONCE':
				return 'renderer.payslip_line_component.entry_once';
			case 'COMPONENT_ENTRY_RECURRING':
				return 'renderer.payslip_line_component.entry_recurring';
			case 'STATUTORY_EMPLOYEE':
				return 'renderer.payslip_line_component.statutory_employee';
			case 'STATUTORY_EMPLOYER':
				return 'renderer.payslip_line_component.statutory_employer';
			case 'SCHEDULE':
			case 'FORMULA':
			case 'LEAVE_UNPAID':
			case 'LOAN_INSTALMENT':
			case 'DERIVED':
				return null;
			default: {
				const _exhaustive: never = kind;
				return _exhaustive;
			}
		}
	}
</script>

<span class="block truncate" title={summary}>{summary}</span>
