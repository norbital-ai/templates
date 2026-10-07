<script lang="ts">
	/**
	 * A jurisdiction version as its lifecycle, its input schemas, one accordion per behaviour rule and its
	 * reference data. The rules edit through their own editor; everything else is the platform's fields.
	 */
	import { bolt } from '$bolt';
	import {
		Field,
		Form,
		Input,
		openRecord,
		RecordShell,
		Section,
		type Json,
		type RecordView
	} from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
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
	{...record == null
		? { values: view.mode === 'create' ? view.values : {} }
		: { id: record.id, subtitle: ['name'] }}
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
				<Section first name="identity" title={t('section.identity')}>
					<Grid minimum="card">
						<Field name="code" />
						<Field name="jurisdiction_code" />
						<Field name="name" />
						<Field name="change_summary" />
					</Grid>
				</Section>
				<Section name="lifecycle" title={t('section.lifecycle')}>
					<Grid minimum="card">
						<Field name="effective_range" />
						<Field name="sealed_at" />
						<Field name="voided_at" />
						<Field name="void_reason" />
					</Grid>
				</Section>
				<Section name="input_schemas" title={t('section.input_schemas')}>
					<Stack gap="md">
						<Field name="entity_input_schema">
							{#snippet editor(field)}
								<SchemaMatrix
									value={field.value}
									onChange={field.onChange}
									disabled={field.disabled}
								/>
							{/snippet}
						</Field>
						<Field name="employee_input_schema">
							{#snippet editor(field)}
								<SchemaMatrix
									value={field.value}
									onChange={field.onChange}
									disabled={field.disabled}
								/>
							{/snippet}
						</Field>
					</Stack>
				</Section>
				<Section name="behaviours" title={t('section.behaviours')}>
					<Field name="behaviours">
						{#snippet editor(field)}
							<BehavioursEditor
								value={field.value}
								onChange={field.onChange}
								disabled={field.disabled}
							/>
						{/snippet}
					</Field>
				</Section>
				<Section name="reference_data" title={t('section.reference_data')}>
					<Field name="reference_tables" />
				</Section>
				<Section name="payroll" title={t('section.payroll')}>
					<Field name="payroll">
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
					<Field name="sources" />
				</Section>
			{/snippet}
		</Form>
	{/key}
</RecordShell>
