<script lang="ts">
	/**
	 * One employment contract: who and which entity, the effective period and terms, and departure when the range closes.
	 */
	import { bolt } from '$bolt';
	import { Field, Form, openRecord, RecordShell, Section, type RecordView } from '@norbital-ai/ui';
	import { Cluster, Grid } from '@norbital-ai/ui/layout';
	import { termsFromFacts } from '../../../../lib/payroll_engine/contract_terms.js';
	import ChangeTerms from '../../../../lib/ui/person/change_terms.svelte';
	import Offboarding from '../../../../lib/ui/person/offboarding.svelte';

	let { view }: { view: RecordView<'employment_contract'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
	const t = bolt.t;
</script>

{#snippet actions()}
	{#if record}
		<Cluster gap="sm">
			<ChangeTerms
				id={record.id}
				companyId={record.company_id}
				terms={termsFromFacts(record.facts)}
				ended={record.effective_range.to != null}
			/>
			<Offboarding
				id={record.id}
				hireFrom={String(record.effective_range.from)}
				ended={record.effective_range.to != null}
			/>
		</Cluster>
	{/if}
{/snippet}

<RecordShell
	of="employment_contract"
	mode={view.mode}
	{actions}
	{...record == null
		? { values: view.mode === 'create' ? view.values : {} }
		: { id: record.id, subtitle: ['employee_number'] }}
>
	{#key record?.revision}
		<Form
			of="employment_contract"
			mode={view.mode}
			{...record ? { id: record.id } : {}}
			{record}
			{values}
			onOutcome={(outcome) => {
				if (outcome.kind !== 'committed' || record) return;
				const created = outcome.records.find((row) => row.collection === 'employment_contract');
				if (created) openRecord('employment_contract', created.id);
			}}
		>
			<Section first name="identity" title={t('section.identity')}>
				<Grid minimum="card">
					<Field name="employee_number" />
					<Field name="company_id" />
					<Field name="employee_id" />
				</Grid>
			</Section>
			<Section name="terms" title={t('section.lifecycle')}>
				<Grid minimum="card">
					<Field name="effective_range" />
					<Field name="signed_contract_end" />
					<Field name="prior_service_months" />
					<Field name="bank" />
					<Field name="facts" />
					<Field name="comments" />
					<Field name="exit_ground" />
					<Field name="exit_facts" />
				</Grid>
			</Section>
		</Form>
	{/key}
</RecordShell>
