<script lang="ts">
	/** The contracted amounts a payslip starts from: read-only, taken from the terms when the run is built. */
	import { t } from '../../../lib/ui/t.js';
	import { formatNumeric } from '../../../lib/ui/display-formatters.js';
	import type { PayslipBase } from '../../../lib/datatypes/payslip_base.js';
	import type { CustomFieldView } from '@norbital-ai/ui';

	let { view }: { view: CustomFieldView<readonly PayslipBase[]> } = $props();

	const amounts = $derived(view.value ?? []);
	const summary = $derived(
		amounts.length === 0
			? t('renderer.payslip_base.none')
			: t('renderer.payslip_base.summary', {
					count: amounts.length,
					total: formatNumeric(amounts.reduce((sum, entry) => sum + entry.amount, 0))
				})
	);
</script>

<span class="block truncate" title={summary}>{summary}</span>
