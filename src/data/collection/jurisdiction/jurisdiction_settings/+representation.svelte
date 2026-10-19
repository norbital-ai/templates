<script lang="ts">
	/**
	 * A jurisdiction version: who it is and when it governs, what changed, the inputs it asks of entities and
	 * employees, its behaviour rules and the rule sets it owns. Sealing and voiding are the settings page's buttons,
	 * not fields; sources and reference tables are kept closed.
	 */
	import { bolt } from '$bolt';
	import { isMasked } from '@norbital-ai/bolt';
	import {
		Field,
		Form,
		JsonSchemaForm,
		openRecord,
		RecordShell,
		Section,
		Table,
		Textarea,
		type FieldEditor,
		type JsonSchema,
		type RecordView
	} from '@norbital-ai/ui';
	import { Bound, Grid, Stack } from '@norbital-ai/ui/layout';
	import {
		FIELD_TYPES,
		rowsOf,
		schemaFrom
	} from '../../../../lib/ui/settings/input_schema_rows.js';
	import BehavioursEditor from '../../../../lib/ui/settings/behaviours_editor.svelte';

	let { view }: { view: RecordView<'jurisdiction_settings'> } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
	const t = bolt.t;
	/** An input schema edits as its field list: one row per property path. */
	const fieldRows = $derived<JsonSchema>({
		type: 'array',
		items: {
			type: 'object',
			additionalProperties: false,
			required: ['path', 'type'],
			properties: {
				path: {
					type: 'string',
					title: t('schema_matrix.property'),
					description: t('schema_matrix.path_help')
				},
				type: { type: 'string', enum: [...FIELD_TYPES], title: t('schema_matrix.type') },
				label: { type: 'string', title: t('schema_matrix.label') },
				required: { type: 'boolean', title: t('schema_matrix.required') },
				values: {
					type: 'string',
					title: t('schema_matrix.enum'),
					description: t('schema_matrix.enum_help')
				},
				help: { type: 'string', title: t('schema_matrix.help') }
			}
		}
	});
</script>

{#snippet inputSchema(field: FieldEditor)}
	{#if isMasked(field.value)}
		<p class="text-meta">{t('component.error')}</p>
	{:else}
		<JsonSchemaForm
			schema={fieldRows}
			value={rowsOf(field.value)}
			onChange={(next) => field.onChange(schemaFrom(next, field.value))}
			name={field.name}
			id={field.id}
			disabled={field.disabled}
		/>
	{/if}
{/snippet}

<RecordShell
	of="jurisdiction_settings"
	mode={view.mode}
	{...record == null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#key record?.revision}
		<Form
			of="jurisdiction_settings"
			mode={view.mode === 'create' ? 'create' : 'update'}
			{...record ? { id: record.id } : {}}
			{record}
			{values}
			onOutcome={(outcome) => {
				if (outcome.kind !== 'committed' || record) return;
				const created = outcome.records.find((row) => row.collection === 'jurisdiction_settings');
				if (created) openRecord('jurisdiction_settings', created.id);
			}}
		>
			{#snippet children()}
				<Section first name="identity" title={t('section.identity_and_period')}>
					<Stack gap="md">
						<Grid minimum="card">
							<Field name="name" />
							<Field name="code" />
							<Field name="jurisdiction_code" />
							<Field name="effective_range" />
						</Grid>
						<Field name="payroll" label={t('section.payroll')} />
						{#if record?.voided_at != null}
							<Field name="void_reason" readonly />
						{/if}
					</Stack>
				</Section>
				<Section name="suspension_kinds" title={t('models.suspension_kind.label')}>
					<Field name="suspension_kinds" label="" />
				</Section>
				<Section name="change_summary" title={t('section.change_summary')}>
					<Field name="change_summary" label="">
						{#snippet editor(field)}
							<Textarea
								id={field.id}
								rows={3}
								value={typeof field.value === 'string' ? field.value : ''}
								disabled={field.disabled}
								oninput={(event) =>
									field.onChange(
										event.currentTarget.value === '' ? null : event.currentTarget.value
									)}
							/>
						{/snippet}
					</Field>
				</Section>
				<Section name="input_schemas" title={t('section.input_schemas')}>
					<Stack gap="lg">
						<Field name="entity_input_schema" editor={inputSchema} />
						<Field name="employee_input_schema" editor={inputSchema} />
					</Stack>
				</Section>
				<Section name="behaviours" title={t('section.behaviours')}>
					<Field name="behaviours" label={t('section.behaviour_rules')}>
						{#snippet editor(field)}
							<BehavioursEditor
								value={field.value}
								onChange={field.onChange}
								disabled={field.disabled}
							/>
						{/snippet}
					</Field>
				</Section>
				{#if record}
					<Section name="rule_sets" title={t('section.rule_sets')}>
						<Bound size="standard">
							<Table
								of="rule_set"
								key="settings-rule-sets"
								toolbar={{ new: false }}
								where={{ settings_id: { eq: record.id } }}
								orderBy={{ family: 'asc' }}
								columns={['family', 'code', 'name']}
							/>
						</Bound>
					</Section>
				{/if}
				<Section
					name="reference_data"
					title={t('section.sources_and_reference')}
					defaultOpen={false}
				>
					<Stack gap="md">
						<Field name="sources" />
						<Field name="reference_tables" />
					</Stack>
				</Section>
			{/snippet}
		</Form>
	{/key}
</RecordShell>
