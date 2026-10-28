<script lang="ts">
	/**
	 * One employment contract: who and which entity, the employment period, the pay account, the history of its terms
	 * (read here, changed only through Change terms), and departure (an early exit of a fixed term too), moved or undone.
	 */
	import { bolt } from '$bolt';
	import * as Predicate from 'effect/Predicate';
	import {
		EmptyState,
		enumText,
		Field,
		Form,
		StructuredData,
		openRecord,
		RecordShell,
		Section,
		Table,
		type RecordView
	} from '@norbital-ai/ui';
	import { Cluster, Grid } from '@norbital-ai/ui/layout';
	import {
		allowancesOf,
		salaryOf,
		termsFromFacts
	} from '../../../lib/payroll_engine/contract_terms.js';
	import ChangeTerms from '../../../lib/ui/person/change_terms.svelte';
	import Offboarding from '../../../lib/ui/person/offboarding.svelte';
	import { governingVersion } from '../../../lib/ui/person/governing_version.svelte.js';
	import { schemaAt } from '../../../lib/ui/person/input_schema.js';
	import { formSchema } from '../../../lib/ui/person/form_schema.js';
	import { listedKindNames } from '../../../lib/ui/format/listed_kind_names.svelte.js';
	import { formatNumeric, formatTermsDates } from '../../../lib/ui/format/display_formatters.js';
	import { todayKey } from '../../../lib/ui/format/calendar.js';

	let { view }: { view: RecordView<'employment_contract'> } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
	const t = bolt.t;
	const exited = $derived(record?.exit_ground != null && record.exit_ground !== '');
	const exitName = listedKindNames('exit_grounds');
	/** The version governing the last day declares the exit facts the departure recorded. */
	const version = governingVersion(
		() => (exited && record ? record.company_id : null),
		() => (record?.effective_range.to == null ? todayKey() : String(record.effective_range.to))
	);
	const exitSchema = $derived(formSchema(schemaAt(version.schema, 'exit_facts')));
	const terms = $derived(record == null ? [] : termsFromFacts(record.facts));
	const allowanceCodes = $derived([
		...new Set(terms.flatMap((term) => allowancesOf(term).map((line) => line.code)))
	]);
	/** An allowance line reads as its catalogue item's name, else its code in words. */
	const allowances = $derived.by(() =>
		allowanceCodes.length === 0
			? null
			: bolt.query({
					allowance_catalog: { where: { code: { in: allowanceCodes } }, fields: ['code', 'name'] }
				})
	);
	const allowanceName = $derived(
		new Map(
			(allowances?.current?.allowance_catalog.rows ?? []).map(
				(row) => [row.code, row.name] as const
			)
		)
	);
	const history = $derived(
		terms
			.toSorted((left, right) =>
				right.effective_range.from.localeCompare(left.effective_range.from)
			)
			.map((term) => {
				const salary = salaryOf(term);
				const classification = [term.work_classification, term.employment_type].filter(
					(value): value is string => Predicate.isString(value) && value !== ''
				);
				return {
					id: String(term.effective_range.from),
					period: formatTermsDates(term, t),
					salary: salary == null ? '—' : formatNumeric(salary.value, salary.currency),
					allowances:
						allowancesOf(term)
							.map(
								(line) =>
									`${allowanceName.get(line.code) ?? enumText(line.code)} ${formatNumeric(line.amount, salary?.currency)}`
							)
							.join(', ') || '—',
					classification: classification.map((value) => enumText(value)).join(' · ') || '—'
				};
			})
	);
</script>

{#snippet actions()}
	{#if record}
		<Cluster gap="sm">
			<ChangeTerms id={record.id} companyId={record.company_id} {terms} ended={exited} />
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
			mode={view.mode === 'create' ? 'create' : 'update'}
			{...record ? { id: record.id } : {}}
			{record}
			{values}
			onOutcome={(outcome) => {
				if (outcome.kind !== 'committed' || record) return;
				const created = outcome.records.find((row) => row.model === 'employment_contract');
				if (created) openRecord('employment_contract', created.id);
			}}
		>
			<!-- who, where and the number are fixed once a contract exists (its title names it): only a new one asks -->
			{#if !record}
				<Section first name="identity" title={t('section.identity')}>
					<Grid minimum="card">
						<Field name="employee_number" />
						<Field name="company_id" />
						<Field name="employee_id" />
					</Grid>
				</Section>
			{/if}
			<Section first={!!record} name="period" title={t('contract.employment_period')}>
				<Grid minimum="card">
					<Field name="effective_range" />
					<Field name="signed_contract_end" />
					<Field name="prior_service_months" />
					<Field name="engagement" />
				</Grid>
			</Section>
			<Section name="pay" title={t('contract.pay_and_bank')}>
				<Field name="bank" />
			</Section>
			{#if record == null}
				<!-- a new contract states its first terms here; afterwards Change terms writes every term -->
				<Section name="terms" title={t('contract.first_terms')}>
					<Field name="facts" />
				</Section>
			{:else}
				<Section name="terms" title={t('contract.terms_history')}>
					{#if history.length === 0}
						<EmptyState title={t('contract.no_terms')} />
					{:else}
						<Table
							of={history}
							key="contract-terms"
							columns={[
								{ field: 'period', label: t('component.effective_period') },
								{ field: 'salary', label: t('component.base_salary'), align: 'end' },
								{ field: 'allowances', label: t('component.allowances') },
								{ field: 'classification', label: t('contract.classification') }
							]}
							toolbar={{
								new: false,
								actions: false,
								search: false,
								filter: false,
								export: false,
								delete: false,
								select: false
							}}
						/>
					{/if}
				</Section>
				<Section name="departure" title={t('contract.departure')} defaultOpen={exited}>
					<Grid minimum="card">
						<!-- the ground is chosen from the version's exit_grounds list in End employment, never typed -->
						<Field name="exit_ground" readonly>
							{#snippet view(field)}
								<p class="text-sm font-medium">
									{typeof field.value === 'string' && field.value !== ''
										? exitName(field.value)
										: '—'}
								</p>
							{/snippet}
						</Field>
						{#if exitSchema == null}
							<Field name="exit_facts" readonly />
						{:else}
							<Field name="exit_facts" readonly>
								{#snippet view(field)}
									<StructuredData
										mode="view"
										schema={exitSchema}
										value={field.value}
										onChange={() => {}}
										name={field.name}
										id={field.id}
										readonly
									/>
								{/snippet}
							</Field>
						{/if}
					</Grid>
				</Section>
			{/if}
			<Section name="notes" title={t('contract.notes')}>
				<Field name="comments" />
			</Section>
		</Form>
	{/key}
</RecordShell>
