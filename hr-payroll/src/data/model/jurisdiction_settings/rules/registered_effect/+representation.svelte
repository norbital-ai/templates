<script lang="ts">
	import {
		Field,
		Form,
		RecordShell,
		Section,
		type FieldEditor,
		type RecordView
	} from '@norbital-ai/ui';
	import { Columns, Stack } from '@norbital-ai/ui/layout';
	import CodeField from '../../../../../lib/ui/settings/code_field.svelte';
	import ReadsView from '../../../../../lib/ui/settings/reads_view.svelte';

	let { view }: { view: RecordView<'registered_effect'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

{#snippet readsView(field: Pick<FieldEditor, 'value'>)}
	<ReadsView value={field.value} />
{/snippet}

<RecordShell
	of="registered_effect"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		of="registered_effect"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
	>
		{#snippet children()}
			<Stack gap="md">
				<Section name="definition" title="Definition" icon="lucide:file-text" first>
					<Stack gap="md">
						<Field name="description" />
						<Columns count={2} gap="md">
							<Field name="code" />
							<Field name="name" />
							<Field name="source_collection" />
							<Field name="events" />
							<Field name="target_collection" />
							<Field name="target_action" />
							<Field name="settings_id" />
						</Columns>
					</Stack>
				</Section>
				<Section
					name="reads"
					title="Reads"
					icon="lucide:database"
					hint="The rows this effect loads before it runs, shown with the same filter builder as the tables."
					defaultOpen={false}
				>
					<Field name="reads" view={readsView} />
				</Section>
				<Section
					name="effect"
					title="Effect"
					icon="lucide:code"
					hint="The condition and the rows the effect writes."
				>
					<CodeField name="condition" />
					<CodeField name="effects" />
					<Field name="lookup" />
					<Field name="references" />
				</Section>
			</Stack>
		{/snippet}
	</Form>
</RecordShell>
