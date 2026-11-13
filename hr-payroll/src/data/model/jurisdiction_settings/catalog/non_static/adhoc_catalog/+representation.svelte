<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Field, Form, RecordShell, Section, type RecordView } from '@norbital-ai/ui';
	import { Columns, Stack } from '@norbital-ai/ui/layout';
	import CodeField from '../../../../../../lib/ui/settings/code_field.svelte';

	let { view, ctx }: { view: RecordView<'adhoc_catalog'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

<RecordShell
	{ctx}
	of="adhoc_catalog"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		{ctx}
		of="adhoc_catalog"
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
					hint="The one-off payment or deduction and its identity."
					first
				>
					<Field {ctx} name="code" />
					<Field {ctx} name="description" />
				</Section>
				<Section
					name="rule"
					title="Rule"
					icon="lucide:code"
					hint="Eligibility, conversion and off-cycle eligibility; the entry owns the economic date."
				>
					<Columns count={2} gap="md">
						<CodeField {ctx} name="eligibility" />
						<CodeField {ctx} name="conversion" />
						<Field {ctx} name="off_cycle_eligible" />
					</Columns>
				</Section>
				<Section
					name="posting"
					title="Posting"
					icon="lucide:arrow-down-up"
					hint="The subtotal, direction and party of the posting."
					default_open={false}
				>
					<Columns count={2} gap="md">
						<Field {ctx} name="subtotal_id" />
						<Field {ctx} name="direction" />
						<Field {ctx} name="party" />
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
