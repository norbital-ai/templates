<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Combobox,
		Field,
		open_record,
		RecordForm,
		Section,
		type FieldEditor,
		type InsertOf,
		type RecordView,
		use_enum_text
	} from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	import LongText from '../../../../lib/ui/long-text.svelte';
	import { createValues } from '../../../../lib/ui/create-values.js';
	let {
		view,
		ctx
	}: {
		view: RecordView<'document_templates'>;
		ctx: PageContext;
	} = $props();
	const words = use_enum_text(() => ctx);
	const published = $derived(view.mode !== 'create' && view.record.status === 'published');
	// a revision opened from the documents page (`openCreate`) carries what orders print now: fixed, not asked
	const preset = createValues<'document_templates'>();
	const values: Partial<InsertOf<'document_templates'>> = $derived(
		view.mode === 'create' ? { ...preset, ...view.values } : {}
	);
	let added = $state(0);
</script>

{#snippet longText(field: FieldEditor)}<LongText {field} />{/snippet}
<!-- a state moves along its edges: the stored state and the moves out of it -->
{#snippet statusMoves(field: FieldEditor)}
	{@const from = view.mode === 'create' ? '' : view.record.status}
	<Combobox
		options={[
			from,
			...(field.kind.kind === 'state' ? (field.kind.states[from]?.to ?? []) : [])
		].map((s) => ({ value: s, label: words(s, 'status') }))}
		value={String(field.value)}
		disabled={field.disabled}
		on_change={(s) => s !== null && field.on_change(s)}
	/>
{/snippet}
<!-- a published layout is locked by the model's own constraint -->
{#key added}
	<RecordForm
		{ctx}
		on_done={(o) => {
			if (view.mode !== 'create' || o.kind !== 'committed' || !o.records[0]) return;
			// a create its opener scopes stays open for the next one
			if (Object.keys(values).length > 0) added++;
			else open_record(view.model, o.records[0].id);
		}}
		view={view.mode === 'create' ? { ...view, values } : view}
		subtitle={['kind', 'locale', 'version']}
	>
		<Section first name="template">
			<Grid gap="md" minimum="compact">
				{#if values.kind == null}<Field {ctx} name="kind" />{/if}
				{#if values.locale == null}<Field {ctx} name="locale" />{/if}
				{#if values.title == null}<Field {ctx} name="title" />{/if}
				{#if values.layout == null}<Field {ctx} name="layout" />{/if}
				{#if view.mode === 'create'}<Field {ctx} name="status" />
				{:else}<Field {ctx} name="status" editor={statusMoves} />{/if}
				{#if values.body == null}<Field {ctx} name="body" wide editor={longText} />{/if}
				{#if values.print_layout == null}<Field {ctx} name="print_layout" wide />{/if}
				{#if values.print_fields == null}<Field {ctx} name="print_fields" wide />{/if}
				{#if values.letterhead == null}<Field {ctx} name="letterhead" wide />{/if}
				{#if values.contract_stamp == null}<Field {ctx} name="contract_stamp" wide />{/if}
			</Grid>
			{#if !published}<p class="text-sm text-muted-foreground">
					{ctx.t('component.template_help')} <code>{'{agreement}'}</code> ·
					<code>{'{reference}'}</code>
					· <code>{'{title}'}</code> · <code>{'{version}'}</code>
				</p>
				<p class="text-sm text-muted-foreground">
					{ctx.t('component.print_layout_help')}
				</p>{/if}
		</Section>
	</RecordForm>{/key}
