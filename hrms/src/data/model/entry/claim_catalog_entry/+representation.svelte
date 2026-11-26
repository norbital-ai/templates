<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { RecordView } from '@norbital-ai/ui';
	import CatalogEntryShell from '../../../../lib/ui/person/catalog_entry_shell.svelte';

	let { view, ctx }: { view: RecordView<'claim_catalog_entry'>; ctx: PageContext } = $props();
</script>

<CatalogEntryShell
	{ctx}
	target={{ of: 'claim_catalog_entry', view }}
	gridFields={['quantity', 'incurred_on']}
	bodyFields={['evidence_file']}
/>
