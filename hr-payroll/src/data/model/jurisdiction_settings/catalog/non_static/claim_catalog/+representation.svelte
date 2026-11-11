<script lang="ts">
	import { Field, Form, RecordShell, Section, type RecordView } from '@norbital-ai/ui';
	import { Columns, Stack } from '@norbital-ai/ui/layout';
	import CodeField from '../../../../../../lib/ui/settings/code_field.svelte';

	let { view }: { view: RecordView<'claim_catalog'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

<RecordShell
	of="claim_catalog"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		of="claim_catalog"
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
					hint="The claim type, its identity and the entry it prices."
					first
				>
					<Field name="code" />
					<Field name="description" />
				</Section>
				<Section
					name="rule"
					title="Rule"
					icon="lucide:code"
					hint="Eligibility and the claim conversion; the entry owns the economic date."
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
					hint="The subtotal that receives the reimbursement."
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
