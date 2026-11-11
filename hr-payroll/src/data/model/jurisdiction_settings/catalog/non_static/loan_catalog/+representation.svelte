<script lang="ts">
	import { Field, Form, RecordShell, Section, type RecordView } from '@norbital-ai/ui';
	import { Columns, Stack } from '@norbital-ai/ui/layout';
	import CodeField from '../../../../../../lib/ui/settings/code_field.svelte';

	let { view }: { view: RecordView<'loan_catalog'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

<RecordShell
	of="loan_catalog"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		of="loan_catalog"
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
					hint="The loan or salary-advance type and its identity."
					first
				>
					<Field name="code" />
					<Field name="description" />
				</Section>
				<Section
					name="rule"
					title="Rule"
					icon="lucide:code"
					hint="Who may be given this loan. Checked when a loan is recorded; a loan it refuses is not saved."
				>
					<CodeField name="eligibility" />
				</Section>
				<Section
					name="posting"
					title="Posting"
					icon="lucide:arrow-down-up"
					hint="The subtotal that receives advances and repayments."
					defaultOpen={false}
				>
					<Columns count={2} gap="md">
						<Field name="subtotal_id" />
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
