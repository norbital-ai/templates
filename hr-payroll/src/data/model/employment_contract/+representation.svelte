<script lang="ts">
	/**
	 * One employment contract: who and which entity; the employment period with its departure (the last day, the exit
	 * ground the version governing it lists and its exit facts) and notes, all edited with Edit; the pay account; and
	 * its terms, one row per dated version, each naming what changed. A new dated version is Change terms on that
	 * section. Saving a departure asks first: the exit raises its final pay.
	 */
	import { bolt } from '$bolt';
	import * as Predicate from 'effect/Predicate';
	import {
		Combobox,
		EmptyState,
		enumText,
		Field,
		Form,
		StructuredData,
		openRecord,
		RecordShell,
		Section,
		Table,
		type FormConfirm,
		type RecordView
	} from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	import {
		allowancesOf,
		salaryOf,
		termsFromFacts
	} from '../../../lib/payroll_engine/contract_terms.js';
	import ChangeTerms from '../../../lib/ui/person/change_terms.svelte';
	import { kindsOf } from '../../../lib/payroll_engine/listed_kinds.js';
	import { isJsonObject } from '../../../lib/payroll_engine/foundation.js';
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
	/** The version governing the last day (today while open) lists the exit grounds and declares the exit facts. */
	const version = governingVersion(
		() => record?.company_id ?? null,
		() => (record?.effective_range.to == null ? todayKey() : String(record.effective_range.to))
	);
	const grounds = $derived.by(() =>
		version.current == null
			? null
			: bolt.query({
					rule_set: {
						where: {
							settings_id: { eq: version.current.id },
							family: { eq: 'PARAMETERS' },
							code: { eq: 'exit_grounds' }
						},
						fields: ['rules']
					}
				})
	);
	const groundOptions = $derived(
		(grounds?.current?.rule_set.rows ?? []).flatMap((row) =>
			kindsOf(row.rules).map((kind) => ({ value: kind.code, label: kind.name }))
		)
	);
	const lastDayOf = (range: unknown) =>
		isJsonObject(range) && typeof range.to === 'string' ? range.to : null;
	/** Writing a departure (a ground newly set, or its last day moved) raises its final pay: say so before saving. */
	const confirmDeparture: FormConfirm = ({ values: next, before }) => {
		const ground = typeof next.exit_ground === 'string' ? next.exit_ground : '';
		if (ground === '') return null;
		const day = lastDayOf(next.effective_range);
		// a ground without its last day is refused on save: nothing to confirm yet
		if (day === null) return null;
		if (ground === before.exit_ground && day === lastDayOf(before.effective_range)) return null;
		return {
			title: t('contract.confirm_departure_title'),
			body: t('contract.confirm_departure_body', { ground: exitName(ground), day }),
			confirmLabel: t('contract.confirm_departure'),
			destructive: true
		};
	};
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
	/** The keys a term changed from the one before it (its period aside): what makes it a version of its own. */
	const changedFrom = (
		term: (typeof terms)[number],
		previous: (typeof terms)[number] | undefined
	) =>
		previous === undefined
			? t('contract.first_terms')
			: [...new Set([...Object.keys(term), ...Object.keys(previous)])]
					.filter(
						(key) =>
							key !== 'id' &&
							key !== 'effective_range' &&
							JSON.stringify(term[key]) !== JSON.stringify(previous[key])
					)
					.map((key) => enumText(key.replace(/_id$/, '')))
					.join(', ') || '—';
	const history = $derived(
		terms
			.toSorted((left, right) =>
				left.effective_range.from.localeCompare(right.effective_range.from)
			)
			.map((term, index, ordered) => ({ term, changed: changedFrom(term, ordered[index - 1]) }))
			.toReversed()
			.map(({ term, changed }) => {
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
					classification: classification.map((value) => enumText(value)).join(' · ') || '—',
					changed
				};
			})
	);
</script>

<RecordShell
	of="employment_contract"
	mode={view.mode}
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
			confirm={confirmDeparture}
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
					{#if record}
						<!-- a departure: the ground from the version's exit_grounds list, written with the last day -->
						<Field name="exit_ground">
							{#snippet view(field)}
								<p class="text-sm font-medium">
									{typeof field.value === 'string' && field.value !== ''
										? exitName(field.value)
										: '—'}
								</p>
							{/snippet}
							{#snippet editor(field)}
								<Combobox
									id={field.id}
									class="w-full"
									clearable
									options={groundOptions}
									value={typeof field.value === 'string' && field.value !== '' ? field.value : null}
									disabled={field.disabled}
									placeholder={t('contract.still_employed')}
									onChange={(next) => field.onChange(next)}
								/>
							{/snippet}
						</Field>
					{/if}
				</Grid>
				{#if record && exitSchema != null}
					<Field name="exit_facts">
						{#snippet view(field)}
							<StructuredData
								mode="view"
								schema={exitSchema}
								value={field.value ?? {}}
								name={field.name}
								id={field.id}
							/>
						{/snippet}
						{#snippet editor(field)}
							<StructuredData
								mode="edit"
								schema={exitSchema}
								value={field.value ?? {}}
								onChange={field.onChange}
								name={field.name}
								id={field.id}
								disabled={field.disabled}
							/>
						{/snippet}
					</Field>
				{/if}
				<Field name="comments" />
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
					{#snippet actions()}
						{#if record}
							<ChangeTerms id={record.id} companyId={record.company_id} {terms} ended={exited} />
						{/if}
					{/snippet}
					{#if history.length === 0}
						<EmptyState title={t('contract.no_terms')} />
					{:else}
						<Table
							of={history}
							key="contract-terms"
							columns={[
								{ field: 'period', label: t('component.effective_period') },
								{ field: 'changed', label: t('contract.changed') },
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
			{/if}
		</Form>
	{/key}
</RecordShell>
