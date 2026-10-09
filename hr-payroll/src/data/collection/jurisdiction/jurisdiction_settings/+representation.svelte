<script lang="ts">
	/**
	 * A jurisdiction version: who it is and when it governs, what changed, the inputs it asks of entities and
	 * employees, its behaviour rules and the rule sets it owns. Sealing and voiding are the settings page's buttons,
	 * not fields; sources and reference tables are kept closed.
	 */
	import { bolt } from '$bolt';
	import {
		Field,
		Form,
		Input,
		openRecord,
		RecordShell,
		Section,
		Table,
		Textarea,
		type Json,
		type RecordView
	} from '@norbital-ai/ui';
	import { Bound, Grid, Stack } from '@norbital-ai/ui/layout';
	import SchemaMatrix from '../../../../lib/ui/settings/schema_matrix.svelte';
	import BehavioursEditor from '../../../../lib/ui/settings/behaviours_editor.svelte';
	import { asObject, numberOf, textOf } from '../../../../lib/ui/records/json_object.js';

	let { view }: { view: RecordView<'jurisdiction_settings'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
	const t = bolt.t;
</script>

<RecordShell
	of="jurisdiction_settings"
	mode={view.mode}
	{...record == null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#key record?.revision}
		<Form
			of="jurisdiction_settings"
			mode={view.mode}
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
						<Field name="payroll" label={t('section.payroll')}>
							{#snippet editor(field)}
								{@const cfg = asObject(field.value) ?? {}}
								{@const set = (patch: Record<string, Json>) => field.onChange({ ...cfg, ...patch })}
								<Grid minimum="card">
									<Stack gap="xs">
										<span class="text-xs font-medium text-muted-foreground"
											>{t('settings.payroll.currency')}</span
										>
										<Input
											aria-label={t('settings.payroll.currency')}
											value={textOf(cfg, 'currency')}
											disabled={field.disabled}
											onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
												set({ currency: event.currentTarget.value })}
										/>
									</Stack>
									<Stack gap="xs">
										<span class="text-xs font-medium text-muted-foreground"
											>{t('settings.payroll.timezone')}</span
										>
										<Input
											aria-label={t('settings.payroll.timezone')}
											value={textOf(cfg, 'timezone')}
											disabled={field.disabled}
											onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
												set({ timezone: event.currentTarget.value })}
										/>
									</Stack>
									<Stack gap="xs">
										<span class="text-xs font-medium text-muted-foreground"
											>{t('settings.payroll.tax_year_start_month')}</span
										>
										<Input
											aria-label={t('settings.payroll.tax_year_start_month')}
											type="number"
											value={numberOf(cfg, 'tax_year_start_month') ?? ''}
											disabled={field.disabled}
											onchange={(event: Event & { currentTarget: HTMLInputElement }) => {
												const next = event.currentTarget.valueAsNumber;
												if (Number.isFinite(next)) set({ tax_year_start_month: next });
											}}
										/>
									</Stack>
								</Grid>
							{/snippet}
						</Field>
						{#if record?.voided_at != null}
							<Field name="void_reason" readonly />
						{/if}
					</Stack>
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
						<Field name="entity_input_schema">
							{#snippet editor(field)}
								<SchemaMatrix
									name="entity-input-schema"
									value={field.value}
									onChange={field.onChange}
									disabled={field.disabled}
								/>
							{/snippet}
						</Field>
						<Field name="employee_input_schema">
							{#snippet editor(field)}
								<SchemaMatrix
									name="employee-input-schema"
									value={field.value}
									onChange={field.onChange}
									disabled={field.disabled}
								/>
							{/snippet}
						</Field>
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
								where={{ settings_id: { eq: record.id }, approval_id: { isNull: true } }}
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
