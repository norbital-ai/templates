<script lang="ts">
	/** Simple polymorphic activity form: title, timestamp, optional plain-text description and documents. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import {
		Field,
		RecordForm,
		Section,
		Textarea,
		type FieldEditor,
		type RecordView
	} from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'activities'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const fixedAbout = $derived(
		record !== null || (view.mode === 'create' && view.values.about != null)
	);
</script>

{#snippet descriptionEditor(field: FieldEditor)}
	<Textarea
		id={field.id}
		rows={4}
		value={typeof field.value === 'string' ? field.value : ''}
		disabled={field.disabled}
		aria-invalid={field.error !== undefined ? 'true' : undefined}
		oninput={(e) => field.on_change(e.currentTarget.value === '' ? null : e.currentTarget.value)}
	/>
{/snippet}

<RecordForm {ctx} {view} subtitle={['author', 'occurred_at']}>
	<Section icon="lucide:activity" first name="activity" title={ctx.t('section.activity')}>
		<Grid minimum="compact">
			{#if !fixedAbout}
				<Column span="all"><Field {ctx} name="about" /></Column>
			{/if}
			<Column span="all"><Field {ctx} name="title" /></Column>
			<Field {ctx} name="occurred_at" />
			{#if record?.source_message_id != null}
				<Field {ctx} name="source_message_id" readonly />
			{/if}
			<Column span="all">
				<Field {ctx} name="description" editor={descriptionEditor} />
			</Column>
			<Column span="all"><Field {ctx} name="attachments" /></Column>
		</Grid>
	</Section>
</RecordForm>
