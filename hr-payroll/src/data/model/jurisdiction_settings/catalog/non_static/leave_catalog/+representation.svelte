<script lang="ts">
	import { Field, Form, RecordShell, Section, type RecordView } from '@norbital-ai/ui';
	import { Columns, Stack } from '@norbital-ai/ui/layout';
	import CodeField from '../../../../../../lib/ui/settings/code_field.svelte';

	let { view }: { view: RecordView<'leave_catalog'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

<RecordShell
	of="leave_catalog"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		of="leave_catalog"
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
					hint="The leave type, its identity and how it is paid."
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
					hint="Eligibility, the share of a normal day a slot pays and what a cashed-out entry pays."
				>
					<Columns count={2} gap="md">
						<CodeField name="eligibility" />
						<CodeField name="paid_share" />
						<CodeField name="payout" />
					</Columns>
				</Section>
				<Section
					name="posting"
					title="Posting"
					icon="lucide:arrow-down-up"
					hint="The subtotal that receives a payout and a reversal's refund."
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
