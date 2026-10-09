<script lang="ts">
	/**
	 * One employment contract: who and which entity, the effective period and terms, and departure (an early exit of a fixed term too), moved or undone.
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
				ended={record.exit_ground != null && record.exit_ground !== ''}
			/>
			<Offboarding
				id={record.id}
				companyId={record.company_id}
				hireFrom={String(record.effective_range.from)}
				lastDay={record.effective_range.to == null ? null : String(record.effective_range.to)}
				exitGround={record.exit_ground ?? null}
				exitFacts={record.exit_facts ?? null}
				plannedEnd={record.signed_contract_end == null ? null : String(record.signed_contract_end)}
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
