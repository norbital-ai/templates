<script lang="ts">
	/** One ad hoc class. Its own form: who raises it and the schemes it counts toward. */
	import type { RepresentationProps } from './$types.js';
	import AdhocCatalogueForm from '../../lib/ui/adhoc-catalogue-form.svelte';

	let { record, close }: RepresentationProps = $props();
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/record-media/catalogue-banner.svg"
	/>
</svelte:head>

<AdhocCatalogueForm {record} {close} />
