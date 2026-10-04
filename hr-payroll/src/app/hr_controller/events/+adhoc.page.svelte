<script lang="ts">
	/** Ad hoc payments (bonus, back pay, ex-gratia, separation pay, claw-backs) and the payroll capture that settled each. */
	import { bolt } from '$bolt';
	import PayRequests from '../../../lib/ui/payroll/PayRequests.svelte';
</script>

<PayRequests
	collection="adhoc_requests"
	dateLabel={bolt.t('component.adhoc_event_date')}
	title={bolt.t('app.adhoc.title')}
	description={bolt.t('app.adhoc.description')}
	icon="lucide:hand-coins"
/>
