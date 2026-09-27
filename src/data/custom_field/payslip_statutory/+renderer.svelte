<script lang="ts">
	/** What each statutory scheme charged: read-only, calculated when the run is built. */
	import { t } from '../../../lib/ui/t.js';
	import { formatNumeric } from '../../../lib/ui/display-formatters.js';
	import type { PayslipStatutory } from '../../../lib/datatypes/payslip_statutory.js';
	import type { CustomFieldView } from '@norbital-ai/ui';

	let { view }: { view: CustomFieldView<readonly PayslipStatutory[]> } = $props();

	const charges = $derived(view.value ?? []);
	const summary = $derived(
		charges.length === 0
			? t('renderer.payslip_statutory.none')
			: t('renderer.payslip_statutory.summary', {
					count: charges.length,
					employee: formatNumeric(charges.reduce((sum, charge) => sum + charge.employee_amount, 0)),
					employer: formatNumeric(charges.reduce((sum, charge) => sum + charge.employer_amount, 0))
				})
	);
</script>

<span class="block truncate" title={summary}>{summary}</span>
