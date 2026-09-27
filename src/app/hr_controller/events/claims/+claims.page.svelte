<script lang="ts">
	/** Claims raised against the pay catalogue by the people of one legal entity, and the payroll capture that settled each. */
	import { bolt } from '$bolt';
	import PayRequests from '../../../../lib/ui/PayRequests.svelte';
</script>

<PayRequests
	collection="claim_requests"
	dateLabel={bolt.t('component.incurred_on')}
	title={bolt.t('app.claims.title')}
	description="Expenses people paid for and are claiming back, with the payroll capture that settled each"
	icon="lucide:receipt-text"
/>
