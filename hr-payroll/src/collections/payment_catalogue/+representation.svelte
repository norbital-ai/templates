<script lang="ts">
	/** One payment component. The form is `lib/ui/catalogue-form.svelte`, shared by the four money catalogues. */
	import type { RepresentationProps } from './$types.js';
	import CatalogueForm from '../../lib/ui/catalogue-form.svelte';

	let { record, close }: RepresentationProps = $props();
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/record-media/pay_components-banner.svg"
	/>
</svelte:head>

<CatalogueForm collection="payment_catalogue" {record} {close} />
