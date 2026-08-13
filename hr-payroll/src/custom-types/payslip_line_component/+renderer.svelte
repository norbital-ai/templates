<script lang="ts">
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$pod/i18n-keys';
	import { payslipLineComponentSchema, type PayslipLineComponent } from './+definition.js';
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
	const parsed = $derived(payslipLineComponentSchema.safeParse(props.value));
	const summary = $derived.by(() => {
		if (!parsed.success) return '—';
		const { kind } = parsed.data;
		const key = catalogueKey(kind);
		return key != null && has(key) ? t(key) : kind.replaceAll('_', ' ').toLowerCase();
	});

	function catalogueKey(kind: PayslipLineComponent['kind']): TenantI18nKeys | null {
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
			case 'OVERTIME':
			case 'OVERTIME_EXCESS':
			case 'DERIVED':
			case 'LEGACY_COMPONENT':
				return null;
			default: {
				const _exhaustive: never = kind;
				return _exhaustive;
			}
		}
	}
</script>

<span class="block truncate" title={summary}>{summary}</span>
