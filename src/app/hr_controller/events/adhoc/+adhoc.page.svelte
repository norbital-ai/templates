<script lang="ts">
	/** Ad hoc payments (bonus, back pay, ex-gratia, separation pay, claw-backs) and the payroll capture that settled each. */
	import { bolt } from '$bolt';
	import PayRequests from '../../../../lib/ui/PayRequests.svelte';
</script>

<PayRequests
	collection="adhoc_requests"
	dateLabel={bolt.t('component.adhoc_event_date')}
	title={bolt.t('app.adhoc.title')}
	description="One-off payments and deductions — bonus, back pay, separation pay, claw-backs — with the payroll capture that settled each"
	icon="lucide:hand-coins"
/>
