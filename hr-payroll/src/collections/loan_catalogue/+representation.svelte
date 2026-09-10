<script lang="ts">
	/** One loan component. Its own form: a loan row is no longer a subset of the money row. */
	import type { RepresentationProps } from './$types.js';
	import LoanCatalogueForm from '../../lib/ui/loan-catalogue-form.svelte';

	let { record, close }: RepresentationProps = $props();
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/record-media/pay_components-banner.svg"
	/>
</svelte:head>

<LoanCatalogueForm {record} {close} />
