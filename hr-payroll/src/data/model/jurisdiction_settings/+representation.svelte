<script lang="ts">
	/**
	 * A jurisdiction version: who it is and when it governs, what changed, its payroll settings by topic, then the
	 * admin-level parts kept closed — its time pay lines, the inputs it asks of entities and employees, its automatic rules, its suspension
	 * catalogue and research sources. Its rule sets are the settings page's own tab. Sealing and voiding are
	 * the settings page's buttons, not fields.
	 */
	import * as Predicate from 'effect/Predicate';
	import { bolt } from '$bolt';
	import type { MessageKey } from '@norbital-ai/bolt';
	import {
		Field,
		Form,
		openRecord,
		RecordShell,
		Section,
		StructuredData,
		isJsonSchema,
		Textarea,
		type FieldEditor,
		type RecordView
	} from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { isJsonObject, PAYROLL_DEFAULTS } from '../../../lib/payroll_engine/foundation.js';
	import { RESEARCH_AGENT_NAMES } from '../../../lib/payroll_engine/research_agents.js';
	import { STATUTORY_FIELDS } from '../../../lib/payroll_engine/statutory_fields.js';
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
			keys: ['exit_overpayment', 'negative_net']
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
	/** `time_pay` by reserved kind: each kind lists its lines (a table), a kind the version omits stays blank. */
	const timePayKinds = Object.fromEntries(
		Object.entries(STATUTORY_FIELDS.settings.time_pay.shape.fields).map(([key, kind]) => [
			key,
			labelled(bolt, 'jurisdiction_settings', `time_pay.${key}`, kind)
		])
	);
	const payrollSections = PAYROLL_SECTIONS.map((section) => ({
		...section,
		kinds: Object.fromEntries(
			section.keys.map((key) => [
				key,
				labelled(bolt, 'jurisdiction_settings', `payroll.${key}`, PAYROLL[key])
			])
		)
	}));
</script>

{#snippet inputSchema(field: FieldEditor)}
	<StructuredData
		mode="schema"
		schema={isJsonSchema(field.value) ? field.value : EMPTY_SCHEMA}
		onChange={field.onChange}
		name={field.name}
		id={field.id}
		disabled={field.disabled}
	/>
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
	{#if isJsonSchema(value)}
		<StructuredData schema={value} mode="schema" {id} {name} />
	{:else}
		<StructuredData {value} mode="view" {id} {name} />
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
				const created = outcome.records.find((row) => row.model === 'jurisdiction_settings');
				if (created) openRecord('jurisdiction_settings', created.id);
			}}
		>
			{#snippet children()}
				<Section first name="identity" title={t('section.identity_and_period')}>
					<Grid minimum="card">
						<Field name="name" />
						<Field name="code" />
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
								<!-- the effective values: a key the version omits shows the engine default -->
								<JsonFields
									readonly
									value={isJsonObject(field.value)
										? { ...PAYROLL_DEFAULTS, ...field.value }
										: field.value}
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
				<Section name="time_pay" title={t('section.time_pay')} defaultOpen={false}>
					<Field name="time_pay" label="">
						{#snippet view(field)}
							<JsonFields
								readonly
								value={field.value}
								kinds={timePayKinds}
								name={field.name}
								id={field.id}
							/>
						{/snippet}
						{#snippet editor(field)}
							<JsonFields
								value={field.value}
								onChange={field.onChange}
								kinds={timePayKinds}
								name={field.name}
								id={field.id}
								disabled={field.disabled}
							/>
						{/snippet}
					</Field>
				</Section>
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
				<Section name="reference_data" title={t('section.research_sources')} defaultOpen={false}>
					<Field name="sources" label="" view={sources} />
				</Section>
			{/snippet}
		</Form>
	{/key}
</RecordShell>
