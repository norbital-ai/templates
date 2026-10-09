<script lang="ts">
	/** A work suspension: its kind from the version catalogue, its entity, days, worksite and the employments it names. */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Field, Form, Picker, RecordShell, Section, type RecordView } from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	import KindPicker from '../../../../lib/ui/compliance/kind_picker.svelte';

	let { view }: { view: RecordView<'work_suspension'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
	const t = bolt.t;
	// The kind is picked under the form's entity and the record's own day.
	let company = $state<Id<'entity'> | null>(null);
	const companyId = $derived(company ?? record?.company_id ?? values.company_id ?? null);
	const kindDay = $derived(String(record?.starts_on ?? values.starts_on ?? '') || null);
</script>

<RecordShell
	of="work_suspension"
	mode={view.mode}
	{...record == null ? { values } : { id: record.id }}
>
	<Form
		of="work_suspension"
		mode={view.mode}
		{...record ? { id: record.id } : {}}
		{record}
		{values}
	>
		{#snippet children()}
			<Section first name="suspension" title={t('section.suspension')}>
				<Grid minimum="card">
					<Field name="kind">
						{#snippet editor(field)}
							<KindPicker
								{companyId}
								day={kindDay}
								source="suspension"
								id={field.id}
								value={typeof field.value === 'string' ? field.value : null}
								disabled={field.disabled}
								onChange={field.onChange}
							/>
						{/snippet}
					</Field>
					<Field name="company_id">
						{#snippet editor(field)}
							<Picker
								of="entity"
								id={field.id}
								value={typeof field.value === 'string' ? field.value : null}
								disabled={field.disabled}
								onChange={(next) => {
									company = next;
									field.onChange(next);
								}}
							/>
						{/snippet}
					</Field>
					<Field name="starts_on" />
					<Field name="ends_on" />
					<Field name="worksite" />
					<Field name="employment_ids" />
				</Grid>
			</Section>
			<Section name="facts" title={t('section.facts')}>
				<Field name="facts" />
			</Section>
		{/snippet}
	</Form>
</RecordShell>
