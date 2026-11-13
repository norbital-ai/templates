<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
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

	let { view, ctx }: { view: RecordView<'registered_rule'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

{#snippet readsView(field: Pick<FieldEditor, 'value'>)}
	<ReadsView {ctx} value={field.value} />
{/snippet}

<RecordShell
	{ctx}
	of="registered_rule"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		{ctx}
		of="registered_rule"
		mode={view.mode}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
	>
		{#snippet children()}
			<Stack gap="md">
				<Section name="definition" title="Definition" icon="lucide:file-text" first>
					<Stack gap="md">
						<Field {ctx} name="description" />
						<Columns count={2} gap="md">
							<Field {ctx} name="code" />
							<Field {ctx} name="target_collection" />
							<Field {ctx} name="events" />
							<Field {ctx} name="order" />
							<Field {ctx} name="settings_id" />
						</Columns>
					</Stack>
				</Section>
				<Section
					name="reads"
					title="Reads"
					icon="lucide:database"
					hint="The rows this rule loads before it runs. Each root is the same filter builder the tables use."
				>
					<Field {ctx} name="reads" view={readsView} />
				</Section>
				<Section
					name="rule"
					title="Rule"
					icon="lucide:code"
					hint="The condition and validation the rule runs."
				>
					<CodeField {ctx} name="condition" />
					<CodeField {ctx} name="validate" />
					<Field {ctx} name="lookup" />
					<Field {ctx} name="references" />
				</Section>
			</Stack>
		{/snippet}
	</Form>
</RecordShell>
