<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../lib/record-form.svelte';

	let { view, ctx }: { view: RecordView<'quotes'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const revCount = $derived(record?.revisions?.length ?? 0);
</script>

<RecordForm {ctx} {view} subtitle={['quote_number', 'direction', 'status']}>
	<Section icon="lucide:file-spreadsheet" first name="quote" title={ctx.t('section.quote')}>
		<Grid minimum="compact">
			<Field {ctx} name="title" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<Field {ctx} name="project_id" />
			{/if}
			<Field {ctx} name="direction" />
			<Field {ctx} name="status" />
			<Field {ctx} name="current_revision" readonly />
			<Field {ctx} name="contact_id" />
			<Field {ctx} name="cost_item_id" />
			<Field {ctx} name="issued_date" />
			<Field {ctx} name="valid_until" />
			<Column span="all"><Field {ctx} name="notes" /></Column>
		</Grid>
	</Section>

	<Section icon="lucide:banknote" name="totals" title={ctx.t('section.quote_totals')}>
		<Grid minimum="compact">
			<Field {ctx} name="currency" />
			<Field {ctx} name="tax_rate" />
			<Field {ctx} name="subtotal" readonly />
			<Field {ctx} name="tax_amount" readonly />
			<Field {ctx} name="total_amount" readonly />
			<Column span="all"><Field {ctx} name="lines" /></Column>
			<Column span="all"><Field {ctx} name="attachments" /></Column>
		</Grid>
	</Section>

	{#if record && revCount > 0}
		<Section
			icon="lucide:history"
			name="revisions"
			title={ctx.t('quotes.revision_history')}
			default_open={false}
			summary={ctx.t('quotes.revision_count', { count: revCount })}
		>
			<Field {ctx} name="revisions" readonly />
		</Section>
	{/if}
</RecordForm>
