<script lang="ts">
	/** A workplace case: its kind from the lineage catalogue, its entity and optional employment, and its dates. */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Field, Form, Picker, RecordShell, Section, type RecordView } from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	import KindPicker from '../../../../lib/ui/compliance/kind_picker.svelte';

	let { view }: { view: RecordView<'workplace_case'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
	const t = bolt.t;
	// The kind is picked under the form's entity and the record's own day.
	let company = $state<Id<'entity'> | null>(null);
	const companyId = $derived(company ?? record?.company_id ?? values.company_id ?? null);
	const kindDay = $derived(String(record?.opened_on ?? values.opened_on ?? '') || null);
</script>

<RecordShell
	of="workplace_case"
	mode={view.mode}
	{...record == null ? { values } : { id: record.id }}
>
	<Form of="workplace_case" mode={view.mode} {...record ? { id: record.id } : {}} {record} {values}>
		{#snippet children()}
			<Section first name="case" title={t('section.case')}>
				<Grid minimum="card">
					<Field name="kind">
						{#snippet editor(field)}
							<KindPicker
								{companyId}
								day={kindDay}
								source="case"
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
					<Field name="employment_id" />
					<Field name="opened_on" />
					<Field name="closed_on" />
				</Grid>
			</Section>
			<Section name="facts" title={t('section.facts')}>
				<Field name="facts" />
			</Section>
		{/snippet}
	</Form>
</RecordShell>
