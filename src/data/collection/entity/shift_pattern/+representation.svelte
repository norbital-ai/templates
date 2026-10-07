<script lang="ts">
	/**
	 * One roster cycle as its identity and its days: each day names its shift definition, resolved to
	 * codes on the strip. Unassigned days stay empty for the roster to project.
	 */
	import { bolt } from '$bolt';
	import {
		Field,
		Form,
		openRecord,
		RecordShell,
		Section,
		type RecordView,
		type Json
	} from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	import { Schema } from 'effect';
	import { liveRows } from '../../../../lib/ui/state/live.svelte.js';
	import ShiftCycle from '../../../../lib/ui/entity/shift_cycle.svelte';

	let { view }: { view: RecordView<'shift_pattern'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
	const t = bolt.t;
	const definitions = liveRows(() =>
		record?.company_id == null
			? null
			: bolt.read('shift_definition', {
					where: { company_id: { eq: record.company_id } },
					select: { id: true, code: true },
					all: true
				})
	);
	const daysOf = (value: unknown): readonly Json[] => {
		const obj = Schema.is(Schema.Record(Schema.String, Schema.Json))(value) ? value : null;
		const days = obj?.['days'];
		return Array.isArray(days) ? days : [];
	};
	const withDays = (value: unknown, days: Json[]): Json => ({
		...(Schema.is(Schema.Record(Schema.String, Schema.Json))(value) ? value : {}),
		days
	});
</script>

<RecordShell
	of="shift_pattern"
	mode={view.mode}
	{...record == null
		? { values: view.mode === 'create' ? view.values : {} }
		: { id: record.id, subtitle: ['code'] }}
>
	{#key record?.revision}
		<Form
			of="shift_pattern"
			mode={view.mode}
			{...record ? { id: record.id } : {}}
			{record}
			{values}
			onOutcome={(outcome) => {
				if (outcome.kind !== 'committed' || record) return;
				const created = outcome.records.find((row) => row.collection === 'shift_pattern');
				if (created) openRecord('shift_pattern', created.id);
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
				<Section name="cycle" title={t('shift_pattern.cycle')}>
					<Field name="pattern">
						{#snippet editor(field)}
							<ShiftCycle
								days={daysOf(field.value)}
								definitions={(definitions.current ?? []).map((row) => ({
									id: row.id,
									code: row.code ?? undefined
								}))}
								onChange={(days) => field.onChange(withDays(field.value, [...days]))}
								disabled={field.disabled}
							/>
						{/snippet}
					</Field>
				</Section>
			{/snippet}
		</Form>
	{/key}
</RecordShell>
