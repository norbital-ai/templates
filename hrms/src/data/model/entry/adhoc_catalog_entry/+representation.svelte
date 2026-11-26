<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { RecordView } from '@norbital-ai/ui';
	import CatalogEntryShell from '../../../../lib/ui/person/catalog_entry_shell.svelte';

	let { view, ctx }: { view: RecordView<'adhoc_catalog_entry'>; ctx: PageContext } = $props();
</script>

<CatalogEntryShell
	{ctx}
	target={{ of: 'adhoc_catalog_entry', view }}
	gridFields={['quantity', 'unit', 'incurred_on']}
	bodyFields={['description', 'evidence_file']}
/>
