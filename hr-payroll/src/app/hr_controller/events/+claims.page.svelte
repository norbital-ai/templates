<script lang="ts">
	/** Claims raised against the pay catalogue by the people of one legal entity, and the payroll capture that settled each. */
	import { bolt } from '$bolt';
	import PayRequests from '../../../lib/ui/payroll/PayRequests.svelte';
</script>

<PayRequests
	collection="claim_requests"
	dateLabel={bolt.t('component.incurred_on')}
	title={bolt.t('app.claims.title')}
	description={bolt.t('app.claims.description')}
	icon="lucide:receipt-text"
/>
