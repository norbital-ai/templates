<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { Id } from '@norbital-ai/bolt';
	import { Field, Form, RecordShell } from '@norbital-ai/ui';
	import LeaveEntryDays from './leave_entry_days.svelte';
	let {
		ctx,
		entityId = null,
		employmentId = null,
		entry = null,
		catalogCode = null,
		person = false,
		locked = false,
		onDone
	}: {
		ctx: PageContext;
		entityId?: Id<'entity'> | null;
		employmentId?: Id<'employment'> | null;
		entry?: Id<'leave_catalog_entry'> | null;
		catalogCode?: string | null;
		person?: boolean;
		locked?: boolean;
		onDone?: () => void;
	} = $props();
</script>

<RecordShell
	{ctx}
	of="leave_catalog_entry"
	mode={entry === null ? 'create' : 'view'}
	{...entry === null ? {} : { id: entry }}
	on_done={(outcome) => {
		if (outcome.kind === 'committed' || outcome.kind === 'pending_approval') onDone?.();
	}}
>
	<Form
		{ctx}
		of="leave_catalog_entry"
		mode={entry === null ? 'create' : 'update'}
		{...entry === null
			? {
					values: {
						...(entityId === null ? {} : { entity_id: entityId }),
						...(employmentId == null ? {} : { employment_id: employmentId }),
						...(catalogCode === null ? {} : { catalog_code: catalogCode })
					}
				}
			: { id: entry }}
		readonly={locked}
	>
		{#snippet children(form)}
			{@const entity = form.id<'entity'>('entity_id')}
			{#if entityId === null}<Field {ctx} name="entity_id" />{/if}
			{#if entity !== null}<LeaveEntryDays
					{ctx}
					entityId={entity}
					{employmentId}
					{entry}
					{catalogCode}
					{person}
					{locked}
				/>{/if}
		{/snippet}
	</Form>
</RecordShell>
