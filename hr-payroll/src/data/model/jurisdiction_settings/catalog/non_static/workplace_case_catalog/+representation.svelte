<script lang="ts">
	import { Field, Form, RecordShell, Section, type RecordView } from '@norbital-ai/ui';
	import { Columns, Stack } from '@norbital-ai/ui/layout';
	import CodeField from '../../../../../../lib/ui/settings/code_field.svelte';

	let { view }: { view: RecordView<'workplace_case_catalog'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

<RecordShell
	of="workplace_case_catalog"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		of="workplace_case_catalog"
		mode={view.mode === 'create' ? 'create' : 'update'}
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
					<Field name="code" />
					<Field name="description" />
				</Section>
				<Section
					name="configuration"
					title="Configuration"
					icon="lucide:database"
					hint="Events, lookup values and source references used by the workflow."
				>
					<Columns count={2} gap="md">
						<Field name="events" />
						<Field name="lookup" />
						<Field name="references" />
					</Columns>
				</Section>
				<Section
					name="posting"
					title="Posting"
					icon="lucide:arrow-down-up"
					hint="The subtotal that receives a priced case outcome, where one exists."
					defaultOpen={false}
				>
					<Columns count={2} gap="md">
						<Field name="subtotal_id" />
					</Columns>
				</Section>
			</Stack>
		{/snippet}
	</Form>
</RecordShell>
