<script lang="ts">
	/** One claim component. The form is `lib/ui/catalogue-form.svelte`, shared by the three money catalogues. */
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

<CatalogueForm collection="claim_catalogue" {record} {close} />
