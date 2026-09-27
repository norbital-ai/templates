<script lang="ts">
	/** One claim request: the shared pay-request form over this family's collection and catalogue. */
	import type { RecordView } from '@norbital-ai/ui';
	import PayRequestForm from '../../../lib/ui/pay-request-form.svelte';

	let { view }: { view: RecordView<'claim_requests'> } = $props();
</script>

<PayRequestForm {view} family="claim" />
