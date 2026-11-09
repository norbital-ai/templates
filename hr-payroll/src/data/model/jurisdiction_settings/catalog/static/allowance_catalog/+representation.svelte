<script lang="ts">
	import { Field, Form, RecordShell, Section, type RecordView } from '@norbital-ai/ui';
	import { Columns, Stack } from '@norbital-ai/ui/layout';
	import CodeField from '../../../../../../lib/ui/settings/code_field.svelte';

	let { view }: { view: RecordView<'allowance_catalog'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

<RecordShell
	of="allowance_catalog"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		of="allowance_catalog"
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
					hint="The catalog row: its identity and the agreement it prices."
					first
				>
					<Columns count={2} gap="md">
						<Field name="code" />
						<Field name="name" />
					</Columns>
					<Field name="description" />
				</Section>
				<Section
					name="rule"
					title="Rule"
					icon="lucide:code"
					hint="Who is eligible, how much is paid, and the economic date of the ledger line."
				>
					<Columns count={2} gap="md">
						<CodeField name="eligibility" />
						<CodeField name="conversion" />
					</Columns>
				</Section>
				<Section
					name="posting"
					title="Posting"
					icon="lucide:arrow-down-up"
					hint="Where the amount lands and whether it is rated."
					defaultOpen={false}
				>
					<Columns count={2} gap="md">
						<Field name="subtotal_id" />
						<Field name="include_in_rate" />
					</Columns>
				</Section>
				<Section
					name="configuration"
					title="Configuration"
					icon="lucide:database"
					hint="Lookup values and source references used by the rule."
					defaultOpen={false}
				>
					<Columns count={2} gap="md">
						<Field name="lookup" />
						<Field name="references" />
					</Columns>
				</Section>
			</Stack>
		{/snippet}
	</Form>
</RecordShell>
