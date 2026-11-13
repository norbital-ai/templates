<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Field, Form, RecordShell, Section, type RecordView } from '@norbital-ai/ui';
	import { Columns, Stack } from '@norbital-ai/ui/layout';
	import CodeField from '../../../../../../lib/ui/settings/code_field.svelte';

	let { view, ctx }: { view: RecordView<'leave_catalog'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

<RecordShell
	{ctx}
	of="leave_catalog"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		{ctx}
		of="leave_catalog"
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
					hint="The leave type, its identity and how it is paid."
					first
				>
					<Field {ctx} name="code" />
					<Field {ctx} name="description" />
				</Section>
				<Section
					name="rule"
					title="Rule"
					icon="lucide:code"
					hint="Eligibility, the share of a normal day a slot pays and what a cashed-out entry pays."
				>
					<Columns count={2} gap="md">
						<CodeField {ctx} name="eligibility" />
						<CodeField {ctx} name="paid_share" />
						<CodeField {ctx} name="payout" />
					</Columns>
				</Section>
				<Section
					name="posting"
					title="Posting"
					icon="lucide:arrow-down-up"
					hint="The subtotal that receives a payout."
					default_open={false}
				>
					<Columns count={2} gap="md">
						<Field {ctx} name="subtotal_id" />
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
