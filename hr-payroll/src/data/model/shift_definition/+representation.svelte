<script lang="ts">
	/**
	 * One named shift: its code, its hours (day type, clock times and break, one flat row of the `variant` object) and
	 * its range. Roster codes on pattern days and roster entries name these.
	 */
	import { bolt } from '$bolt';
	import {
		Editor,
		Field,
		Form,
		Label,
		openRecord,
		RecordShell,
		Section,
		type FieldEditor,
		type Fields,
		type RecordView
	} from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { createValues } from '../../../lib/ui/scopes/create_values.js';
	import { isJsonObject, type JsonObject } from '../../../lib/payroll_engine/foundation.js';

	let { view }: { view: RecordView<'shift_definition'> } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const t = bolt.t;
	// opened from an entity: its shift is that entity's
	const preset = createValues();
	const values = $derived(view.mode === 'create' ? { ...preset, ...view.values } : {});
	const HOURS = [
		{ key: 'day_type', label: 'shift_definition.day_type' },
		{ key: 'start_time', label: 'shift_definition.start_time' },
		{ key: 'end_time', label: 'shift_definition.end_time' },
		{ key: 'break_minutes', label: 'shift_definition.break_minutes' }
	] as const;
	const membersOf = (kind: FieldEditor['kind']): Fields =>
		kind.kind === 'json' && kind.shape?.kind === 'object' ? kind.shape.fields : {};
	const objectOf = (value: unknown): JsonObject => (isJsonObject(value) ? value : {});
</script>

<!-- the `variant` object's members side by side, each in its own kind's editor -->
{#snippet hours(
	field: Pick<FieldEditor, 'value' | 'kind' | 'name' | 'id'>,
	onChange?: FieldEditor['onChange']
)}
	{@const shape = membersOf(field.kind)}
	{@const held = objectOf(field.value)}
	<Grid minimum="card">
		{#each HOURS as part (part.key)}
			{@const kind = shape[part.key]}
			{#if kind}
				<Stack gap="xs">
					<Label for={`${field.id}-${part.key}`} class="text-xs font-medium text-muted-foreground"
						>{t(part.label)}</Label
					>
					<Editor
						{kind}
						value={held[part.key] ?? null}
						name={`${field.name}.${part.key}`}
						id={`${field.id}-${part.key}`}
						readonly={onChange == null}
						onChange={(next) => onChange?.({ ...held, [part.key]: next })}
					/>
				</Stack>
			{/if}
		{/each}
	</Grid>
{/snippet}

<RecordShell
	of="shift_definition"
	mode={view.mode}
	{...record == null ? { values } : { id: record.id, subtitle: ['code'] }}
>
	{#key record?.revision}
		<Form
			of="shift_definition"
			mode={view.mode === 'create' ? 'create' : 'update'}
			{...record ? { id: record.id } : {}}
			{record}
			{values}
			onOutcome={(outcome) => {
				if (outcome.kind !== 'committed' || record) return;
				const created = outcome.records.find((row) => row.model === 'shift_definition');
				if (created) openRecord('shift_definition', created.id);
			}}
		>
			{#snippet children()}
				<Section first name="identity" title={t('section.identity')}>
					<Grid minimum="card">
						<Field name="code" />
						<Field name="name" />
						<Field name="effective_range" />
					</Grid>
				</Section>
				<Section name="hours" title={t('shift_definition.hours')}>
					<Field name="variant" label="">
						{#snippet editor(field)}{@render hours(field, field.onChange)}{/snippet}
						{#snippet view(field)}{@render hours(field)}{/snippet}
					</Field>
				</Section>
			{/snippet}
		</Form>
	{/key}
</RecordShell>
