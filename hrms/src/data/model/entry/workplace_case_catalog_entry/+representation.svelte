<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Field,
		Form,
		Picker,
		RecordShell,
		StructuredData,
		is_json_schema,
		use_record_controller,
		type FieldEditor,
		type FieldView,
		type JsonSchema,
		type RecordView
	} from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { watch } from '@norbital-ai/ui/behaviors';
	import { isJsonObject } from '../../../../lib/foundation.js';
	import { idOf } from '../../../../lib/reads.js';
	import { pageLaws } from '../../../../lib/ui/law.svelte.js';
	import CatalogField from '../../../../lib/ui/settings/catalog_field.svelte';

	let { view, ctx }: { view: RecordView<'workplace_case_catalog_entry'>; ctx: PageContext } =
		$props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const sealed = $derived(record?.payroll_run_id != null);
	const clock = ctx.clock('day');
	const controller = use_record_controller();
	const liveForm = $derived(controller?.current ?? null);

	const fixedEntity = $derived(
		record?.entity_id ??
			(view.mode === 'create' && typeof view.values.entity_id === 'string'
				? view.values.entity_id
				: null)
	);
	const fixedEmployment = $derived(
		view.mode === 'create' && typeof view.values.employment_id === 'string'
			? view.values.employment_id
			: null
	);
	const scopedEntity = $derived.by(() => {
		const raw = liveForm?.get('entity_id');
		return typeof raw === 'string' ? raw : fixedEntity;
	});

	// Keep `kind` aligned with the picked `catalog_code` so HR never types the same code twice.
	watch(
		() => {
			if (liveForm === null || liveForm.mode === 'view') return null;
			const code = liveForm.get('catalog_code');
			const kind = liveForm.get('kind');
			if (typeof code !== 'string' || code === '' || kind === code) return null;
			// On edit, only overwrite an existing differing kind when the user actively changes catalog_code.
			if (record !== null && code === record.catalog_code && kind === record.kind) return null;
			return { form: liveForm, code };
		},
		(next) => {
			if (next !== null) next.form.set('kind', next.code);
		}
	);

	const companyQuery = $derived(
		scopedEntity === null
			? null
			: ctx.query({
					entity: {
						where: { id: { eq: idOf('entity', scopedEntity) } },
						fields: ['settings_code'],
						limit: 1
					}
				})
	);
	const settingsCode = $derived(companyQuery?.current?.entity.rows[0]?.settings_code);
	const laws = pageLaws(ctx, () => (settingsCode === undefined ? [] : [settingsCode]));
	const openedDay = $derived.by(() => {
		const on = liveForm?.get('opened_on') ?? record?.opened_on;
		return typeof on === 'string' && on !== '' ? on : String(clock.today);
	});
	const selectedCode = $derived.by(() => {
		const raw = liveForm?.get('catalog_code') ?? record?.catalog_code;
		return typeof raw === 'string' && raw !== '' ? raw : null;
	});
	const inputSchema = $derived.by<JsonSchema | undefined>(() => {
		if (settingsCode === undefined || selectedCode === null) return undefined;
		const row = laws
			.on(settingsCode, openedDay)
			?.rows.workplace_case_catalog.find((held) => held.code === selectedCode);
		const candidate = isJsonObject(row?.lookup) ? row.lookup.input_schema : undefined;
		return is_json_schema(candidate) ? candidate : undefined;
	});
</script>

{#snippet employmentEditor(field: FieldEditor)}
	<Picker
		{ctx}
		of="employment"
		id={field.id}
		{...scopedEntity === null ? {} : { where: { entity_id: { eq: idOf('entity', scopedEntity) } } }}
		value={typeof field.value === 'string' ? field.value : null}
		disabled={field.disabled}
		invalid={field.error !== undefined}
		on_change={(next) => field.on_change(next)}
	/>
{/snippet}

{#snippet inputsEditor(field: FieldEditor)}
	<StructuredData
		{ctx}
		{...inputSchema === undefined ? {} : { schema: inputSchema }}
		value={field.value}
		mode="edit"
		name={field.name}
		id={field.id}
		disabled={field.disabled}
		on_change={field.on_change}
	/>
{/snippet}

{#snippet inputsView(field: FieldView)}
	<StructuredData
		{ctx}
		{...inputSchema === undefined ? {} : { schema: inputSchema }}
		value={field.value}
		mode="view"
		name={field.name}
		id={field.id}
		readonly
	/>
{/snippet}

<RecordShell
	{ctx}
	of="workplace_case_catalog_entry"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
	{...sealed ? { badge: ctx.t('entry.included_in_payroll') } : {}}
>
	<Form
		{ctx}
		of="workplace_case_catalog_entry"
		mode={view.mode}
		size="content"
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
	>
		{#snippet children(form)}
			{@const inputsVal = form.get('inputs')}
			{@const hasInputs = isJsonObject(inputsVal) && Object.keys(inputsVal).length > 0}
			<Stack gap="md">
				<Grid minimum="card">
					{#if record === null && fixedEntity === null}<Field {ctx} name="entity_id" />{/if}
					<CatalogField {ctx} of="workplace_case_catalog" dated="opened_on" />
					<Field
						{ctx}
						name="employment_id"
						disabled={fixedEmployment !== null}
						editor={employmentEditor}
					/>
					{#each ['severity', 'opened_on', 'occurred_on', 'scheduled_on', 'closed_on', 'location', 'reference'] as name (name)}<Field
							{ctx}
							{name}
						/>{/each}
				</Grid>
				<Field {ctx} name="description" />
				{#if inputSchema !== undefined || hasInputs}
					<Field
						{ctx}
						name="inputs"
						{...inputSchema === undefined ? {} : { editor: inputsEditor, view: inputsView }}
					/>
				{/if}
				<Field {ctx} name="evidence_file" />
			</Stack>
		{/snippet}
	</Form>
</RecordShell>
