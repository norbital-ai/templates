<script lang="ts">
	/** One legal entity's captured leave entries for a pay period and the payroll capture that settled each. */
	import { bolt } from '$bolt';
	import PayRequests from '../../../lib/ui/payroll/pay_requests.svelte';
</script>

<PayRequests
	collection="leave_catalog_entry"
	dateLabel={bolt.t('component.day')}
	title={bolt.t('app.leave.title')}
	description={bolt.t('app.leave.description')}
	icon="lucide:calendar-check-2"
/>
