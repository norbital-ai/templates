<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Field, Form, RecordShell, Section, type RecordView } from '@norbital-ai/ui';
	import { Columns, Stack } from '@norbital-ai/ui/layout';
	import CodeField from '../../../../../../lib/ui/settings/code_field.svelte';

	let { view, ctx }: { view: RecordView<'allowance_catalog'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

<RecordShell
	{ctx}
	of="allowance_catalog"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		{ctx}
		of="allowance_catalog"
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
					hint="The catalog row: its identity and the agreement it prices."
					first
				>
					<Field {ctx} name="code" />
					<Field {ctx} name="description" />
				</Section>
				<Section
					name="rule"
					title="Rule"
					icon="lucide:code"
					hint="Who is eligible, how much is paid, and the economic date of the ledger line."
				>
					<Columns count={2} gap="md">
						<CodeField {ctx} name="eligibility" />
						<CodeField {ctx} name="conversion" />
					</Columns>
				</Section>
				<Section
					name="posting"
					title="Posting"
					icon="lucide:arrow-down-up"
					hint="Where the amount lands and whether it is rated."
					default_open={false}
				>
					<Columns count={2} gap="md">
						<Field {ctx} name="subtotal_id" />
						<Field {ctx} name="include_in_rate" />
					</Columns>
				</Section>
				<Section
					name="configuration"
					title="Configuration"
					icon="lucide:database"
					hint="Lookup values and source references used by the rule."
					default_open={false}
				>
					<Columns count={2} gap="md">
						<Field {ctx} name="lookup" />
						<Field {ctx} name="references" />
					</Columns>
				</Section>
			</Stack>
		{/snippet}
	</Form>
</RecordShell>
