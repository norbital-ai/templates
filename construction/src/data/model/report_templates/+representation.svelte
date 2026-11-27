<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Combobox,
		Field,
		open_record,
		RecordForm,
		Section,
		Textarea,
		type FieldEditor,
		type InsertOf,
		type RecordView,
		use_enum_text
	} from '@norbital-ai/ui';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { createValues } from '../../../services/ui/create-values.js';

	let { view, ctx }: { view: RecordView<'report_templates'>; ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const words = use_enum_text(() => ctx);
	const published = $derived(view.mode !== 'create' && view.record.status === 'published');
	const preset = createValues<'report_templates'>();
	const values: Partial<InsertOf<'report_templates'>> = $derived(
		view.mode === 'create' ? { ...preset, ...view.values } : {}
	);
	let added = $state(0);
</script>

{#snippet longBody(field: FieldEditor)}
	<Textarea
		id={field.id}
		value={typeof field.value === 'string' ? field.value : ''}
		rows={8}
		disabled={field.disabled}
		aria-invalid={Boolean(field.error)}
		oninput={(event) => field.on_change(event.currentTarget.value)}
	/>
{/snippet}

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

{#key added}
	<RecordForm
		{ctx}
		on_done={(o) => {
			if (view.mode !== 'create' || o.kind !== 'committed' || !o.records[0]) return;
			if (Object.keys(values).length > 0) added++;
			else open_record(view.model, o.records[0].id);
		}}
		view={view.mode === 'create' ? { ...view, values } : view}
		subtitle={['kind', 'locale', 'version', 'status']}
	>
		<Section
			first
			name="template"
			icon="lucide:file-spreadsheet"
			title={t('section.report_template')}
		>
			<Stack gap="md">
				<Grid gap="md" minimum="compact">
					{#if values.kind == null}<Field {ctx} name="kind" />{/if}
					{#if values.locale == null}<Field {ctx} name="locale" />{/if}
					<Field {ctx} name="title" />
					<Field {ctx} name="standard_ref" />
					{#if view.mode === 'create'}
						<Field {ctx} name="status" />
					{:else}
						<Field {ctx} name="status" editor={statusMoves} />
					{/if}
					<Column span="all"><Field {ctx} name="body" editor={longBody} /></Column>
					<Column span="all"><Field {ctx} name="print_layout" /></Column>
					<Field {ctx} name="letterhead" />
					<Field {ctx} name="company_stamp" />
				</Grid>
				{#if !published}
					<Stack gap="xs">
						<p class="text-xs text-muted-foreground">
							{t('reports.template_body_help')} <code>{'{report}'}</code> ·
							<code>{'{reference}'}</code> · <code>{'{title}'}</code> ·
							<code>{'{version}'}</code> · <code>{'{standard}'}</code>
						</p>
						<p class="text-xs text-muted-foreground">{t('reports.print_layout_help')}</p>
					</Stack>
				{/if}
			</Stack>
		</Section>
	</RecordForm>
{/key}
