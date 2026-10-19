<script lang="ts">
	/** One legal entity's captured loan entries for a pay period and the payroll capture that settled each. */
	import { bolt } from '$bolt';
	import PayRequests from '../../../lib/ui/payroll/pay_requests.svelte';
</script>

<PayRequests
	collection="loan_catalog_entry"
	dateLabel={bolt.t('component.day')}
	title={bolt.t('app.loans.title')}
	description={bolt.t('app.loans.description')}
	icon="lucide:landmark"
/>
