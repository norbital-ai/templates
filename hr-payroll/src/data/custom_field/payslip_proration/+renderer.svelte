<script lang="ts">
	/** What the calendar did to base, segment by segment: read-only, written when the run is built. */
	import { t } from '../../../lib/ui/t.js';
	import { formatNumeric } from '../../../lib/ui/display-formatters.js';
	import type { PayslipProration } from '../../../lib/datatypes/payslip_proration.js';
	import type { CustomFieldView } from '@norbital-ai/ui';

	let { view }: { view: CustomFieldView<readonly PayslipProration[]> } = $props();

	const segments = $derived(view.value ?? []);
	const summary = $derived(
		segments.length === 0
			? t('renderer.payslip_proration.none')
			: t('renderer.payslip_proration.summary', {
					count: segments.length,
					total: formatNumeric(segments.reduce((sum, segment) => sum + segment.prorated_amount, 0))
				})
	);
</script>

<span class="block truncate" title={summary}>{summary}</span>
