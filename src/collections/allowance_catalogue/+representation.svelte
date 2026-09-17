<script lang="ts">
	/** One allowance component. Its own form: the recurrence facts are not on the claim row. */
	import type { RepresentationProps } from './$types.js';
	import AllowanceCatalogueForm from '../../lib/ui/allowance-catalogue-form.svelte';

	let { record, close }: RepresentationProps = $props();
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/record-media/catalogue-banner.svg"
	/>
</svelte:head>

<AllowanceCatalogueForm {record} {close} />
