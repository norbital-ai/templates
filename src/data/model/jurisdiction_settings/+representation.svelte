<script lang="ts">
	/**
	 * A jurisdiction version: who it is and when it governs, what changed, its payroll settings by topic, then the
	 * admin-level parts kept closed — the inputs it asks of entities and employees, its automatic rules, its suspension
	 * kinds, research sources and reference tables. Sealing and voiding are the settings page's buttons, not fields.
	 */
	import * as Predicate from 'effect/Predicate';
	import { bolt } from '$bolt';
	import { isMasked, type MessageKey } from '@norbital-ai/bolt';
	import {
		Field,
		Form,
		openRecord,
		RecordShell,
		Section,
		StructuredData,
		isJsonSchema,
		Table,
		Textarea,
		type FieldEditor,
		type Json,
		type Kind,
		type RecordView
	} from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { isJsonObject } from '../../../lib/payroll_engine/foundation.js';
	import { isJsonList, isJsonRecord } from '../../../lib/ui/records/json_object.js';
	import { RESEARCH_AGENT_NAMES } from '../../../lib/payroll_engine/research_agents.js';
	import { STATUTORY_FIELDS } from '../../../lib/payroll_engine/statutory_fields.js';
	import { SUSPENSION_KIND } from '../../../lib/payroll_engine/suspension_kinds.js';
	import BehavioursEditor from '../../../lib/ui/settings/behaviours_editor.svelte';
	import JsonFields from '../../../lib/ui/settings/json_fields.svelte';
	import { labelled } from '../../../lib/ui/settings/labelled.js';

	let { view }: { view: RecordView<'jurisdiction_settings'> } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
	const t = bolt.t;
	/** A new version's input schema starts as an empty object schema: its matrix adds the fields. */
	const EMPTY_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' };
	/** The live pages each research agent reads, by agent: its page links with what to read there, then its own notes. */
	const sourcesByAgent = (value: unknown) => {
		const held = isJsonObject(value) ? value : {};
		const entries = Array.isArray(held.entries) ? held.entries.filter(isJsonObject) : [];
		const notes = isJsonObject(held.agents) ? held.agents : {};
		return RESEARCH_AGENT_NAMES.map((agent) => ({
			agent,
			pages: entries.filter((entry) => entry.agent === agent),
			note: Predicate.isString(notes[agent]) ? notes[agent] : ''
		})).filter((group) => group.pages.length > 0 || group.note !== '');
	};

	const PAYROLL = STATUTORY_FIELDS.settings.payroll.shape.fields;
	type PayrollKey = keyof typeof PAYROLL;
	/** The one `payroll` object by topic: each section shows and writes its own keys and keeps the rest. */
	const PAYROLL_SECTIONS = [
		{
			name: 'payroll_calendar',
			title: 'section.currency_and_calendar',
			open: true,
			keys: ['currency', 'minor_units', 'timezone', 'tax_year_start_month', 'week_start']
		},
		{
			name: 'pay_periods',
			title: 'section.pay_periods',
			open: true,
			keys: [
				'semi_monthly_split',
				'ten_day_splits',
				'history_months',
				'base_salary_required',
				'off_cycle_families'
			]
		},
		{
			name: 'attendance',
			title: 'section.attendance_and_overtime',
			open: true,
			keys: ['attendance', 'roster_week', 'rolling_hours_months']
		},
		{
			name: 'leavers',
			title: 'section.leavers',
			open: true,
			keys: ['exit_raise_when', 'exit_overpayment', 'negative_net']
		},
		{
			name: 'payroll_rules',
			title: 'section.advanced_rules',
			open: false,
			keys: ['pay_date', 'monthly_wage', 'permanent_when']
		}
	] as const satisfies readonly {
		name: string;
		title: MessageKey;
		open: boolean;
		keys: readonly PayrollKey[];
	}[];
	const payrollSections = PAYROLL_SECTIONS.map((section) => ({
		...section,
		kinds: Object.fromEntries(
			section.keys.map((key) => [
				key,
				labelled(bolt, 'jurisdiction_settings', `payroll.${key}`, PAYROLL[key])
			])
		)
	}));
	const SUSPENSION_FIELDS: Readonly<Record<string, Kind>> = Object.fromEntries(
		Object.entries(SUSPENSION_KIND.fields).map(([name, kind]) => [
			name,
			labelled(bolt, 'suspension_kind', name, kind)
		])
	);
	const SUSPENSION_LIST = {
		kind: 'list',
		of: { kind: 'object', fields: SUSPENSION_FIELDS }
	} as const;
	/** A reference table as rows: a keyed lookup one row per key, a list of values one row per value. */
	const tableRows = (table: Json): Json => {
		const code = t('component.code');
		const meaning = t('component.value');
		if (isJsonRecord(table))
			return Object.entries(table).map(([key, held]) => ({ [code]: key, [meaning]: held }));
		if (isJsonList(table) && !table.every(isJsonRecord))
			return table.map((held) => ({ [meaning]: held }));
		return table;
	};
</script>

{#snippet inputSchema(field: FieldEditor)}
	{#if isMasked(field.value)}
		<p class="text-meta">{t('component.error')}</p>
	{:else}
		<StructuredData
			mode="schema"
			schema={isJsonSchema(field.value) ? field.value : EMPTY_SCHEMA}
			onChange={field.onChange}
			name={field.name}
			id={field.id}
			disabled={field.disabled}
		/>
	{/if}
{/snippet}

{#snippet sources({ value, id }: Pick<FieldEditor, 'value' | 'id'>)}
	<Grid
		as="dl"
		{id}
		tracks="minmax(8rem, 14rem) minmax(0, 1fr)"
		gap="lg"
		rowGap="md"
		class="text-sm"
	>
		{#each sourcesByAgent(value) as group (group.agent)}
			<dt class="font-medium">{t(`sources.agent.${group.agent}`)}</dt>
			<dd class="min-w-0">
				<Stack gap="sm">
					{#each group.pages as page, index (index)}
						<p class="min-w-0">
							<a
								class="font-medium break-all underline-offset-2 hover:underline"
								href={String(page.url ?? '')}
								target="_blank"
								rel="noreferrer">{String(page.url ?? '')}</a
							>
							<span class="block text-muted-foreground">{String(page.instructions ?? '')}</span>
						</p>
					{/each}
					{#if group.note}<p class="text-muted-foreground italic">{group.note}</p>{/if}
				</Stack>
			</dd>
		{:else}
			<p class="text-meta">—</p>
		{/each}
	</Grid>
{/snippet}

{#snippet inputSchemaView({ value, id, name }: Pick<FieldEditor, 'value' | 'id' | 'name'>)}
	{#if isMasked(value)}
		<p class="text-meta">{t('component.error')}</p>
	{:else if isJsonSchema(value)}
		<StructuredData schema={value} mode="schema" {id} {name} />
	{:else}
		<StructuredData {value} mode="view" {id} {name} />
	{/if}
{/snippet}

{#snippet suspensionKinds({ value, id, name }: Pick<FieldEditor, 'value' | 'id' | 'name'>)}
	<StructuredData kind={SUSPENSION_LIST} {value} mode="view" {id} {name} />
{/snippet}

{#snippet referenceTables({ value, id }: Pick<FieldEditor, 'value' | 'id'>)}
	{@const tables = isJsonObject(value) ? Object.entries(value) : []}
	<Stack {id} gap="md">
		{#each tables as [name, table] (name)}
			<Stack gap="xs">
				<span class="text-sm font-medium">{name}</span>
				<StructuredData value={tableRows(table)} mode="view" {name} />
			</Stack>
		{:else}
			<p class="text-meta">—</p>
		{/each}
	</Stack>
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
					<Grid minimum="card">
						<Field name="name" />
						<Field name="code" />
						<Field name="jurisdiction_code" />
						<Field name="effective_range" />
						{#if record?.voided_at != null}
							<Field name="void_reason" readonly />
						{/if}
					</Grid>
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
				{#each payrollSections as section (section.name)}
					<Section name={section.name} title={t(section.title)} defaultOpen={section.open}>
						<Field name="payroll" label="">
							{#snippet view(field)}
								<JsonFields
									readonly
									value={field.value}
									kinds={section.kinds}
									name={field.name}
									id={field.id}
								/>
							{/snippet}
							{#snippet editor(field)}
								<JsonFields
									value={field.value}
									onChange={field.onChange}
									kinds={section.kinds}
									name={field.name}
									id={field.id}
									disabled={field.disabled}
								/>
							{/snippet}
						</Field>
					</Section>
				{/each}
				<Section
					name="input_schemas"
					title={t('section.information_collected')}
					defaultOpen={false}
				>
					<Stack gap="lg">
						<Field name="entity_input_schema" editor={inputSchema} view={inputSchemaView} />
						<Field name="employee_input_schema" editor={inputSchema} view={inputSchemaView} />
					</Stack>
				</Section>
				<Section name="behaviours" title={t('section.automatic_rules')} defaultOpen={false}>
					<Field name="behaviours" label="">
						{#snippet view(field)}
							<BehavioursEditor readonly value={field.value} />
						{/snippet}
						{#snippet editor(field)}
							<BehavioursEditor
								value={field.value}
								onChange={field.onChange}
								disabled={field.disabled}
							/>
						{/snippet}
					</Field>
				</Section>
				<Section
					name="suspension_kinds"
					title={t('models.suspension_kind.label')}
					defaultOpen={false}
				>
					<Field name="suspension_kinds" label="" view={suspensionKinds}>
						{#snippet editor(field)}
							<StructuredData
								mode="edit"
								kind={SUSPENSION_LIST}
								name={field.name}
								id={field.id}
								value={field.value ?? []}
								onChange={field.onChange}
								disabled={field.disabled}
							/>
						{/snippet}
					</Field>
				</Section>
				{#if record}
					<Section name="rule_sets" title={t('section.rule_sets')}>
						<Table
							of="rule_set"
							key="settings-rule-sets"
							toolbar={{ new: false }}
							where={{ settings_id: { eq: record.id } }}
							orderBy={{ family: 'asc' }}
							columns={['family', 'code', 'name']}
						/>
					</Section>
				{/if}
				<Section name="reference_data" title={t('section.research_sources')} defaultOpen={false}>
					<Field name="sources" label="" view={sources} />
				</Section>
				<Section name="reference_tables" title={t('section.reference_tables')} defaultOpen={false}>
					<Field name="reference_tables" label="" view={referenceTables} />
				</Section>
			{/snippet}
		</Form>
	{/key}
</RecordShell>
