<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Field, Form, RecordShell, Section, type RecordView } from '@norbital-ai/ui';
	import { Columns, Stack } from '@norbital-ai/ui/layout';
	import CodeField from '../../../../../../lib/ui/settings/code_field.svelte';

	let { view, ctx }: { view: RecordView<'workplace_case_catalog'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

<RecordShell
	{ctx}
	of="workplace_case_catalog"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		{ctx}
		of="workplace_case_catalog"
		mode={view.mode}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
	>
		{#snippet children()}
			<Stack gap="md">
				<Section
					name="definition"
					title="Definition"
					icon="lucide:file-text"
					hint="The case type, its identity and what it does."
					first
				>
					<Field {ctx} name="code" />
					<Field {ctx} name="description" />
				</Section>
				<Section
					name="configuration"
					title="Configuration"
					icon="lucide:database"
					hint="Events, lookup values and source references used by the workflow."
				>
					<Columns count={2} gap="md">
						<Field {ctx} name="events" />
						<Field {ctx} name="lookup" />
						<Field {ctx} name="references" />
					</Columns>
				</Section>
				<Section
					name="posting"
					title="Posting"
					icon="lucide:arrow-down-up"
					hint="The subtotal that receives a priced case outcome, where one exists."
					default_open={false}
				>
					<Columns count={2} gap="md">
						<Field {ctx} name="subtotal_id" />
					</Columns>
				</Section>
			</Stack>
		{/snippet}
	</Form>
</RecordShell>
