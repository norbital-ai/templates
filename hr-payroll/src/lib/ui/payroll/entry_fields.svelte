<script lang="ts">
	/**
	 * A captured entry's fields (inside its `Form`): the person from the opening page's entity only, and the class from
	 * the catalogue of the employment's lineage version governing the entry day, not every lineage's identical "Bonus".
	 * Opened from no scoped page (self-service), the person is not narrowed; the class still follows the employment. A
	 * leave class is narrowed further to those the employee is eligible for (the balances the leave write lists). An entry a
	 * payslip consumed shows its lock and opens that payslip; its `Form` is readonly. The entry's `facts` are asked for
	 * as the version's `employee_input_schema` declares them (`<family>_facts`; a loan class's own version's
	 * `loan_facts`); a version declaring none leaves them a plain field (a leave event's `event_id`).
	 */
	import * as Predicate from 'effect/Predicate';
	import { Schema } from 'effect';
	import { inputSchema } from '@norbital-ai/std/kind';
	import { isPlainDate, PlainDate } from '@norbital-ai/std/date';
	import {
		Button,
		Field,
		Icon,
		StructuredData,
		Picker,
		openRecord,
		type FormState
	} from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { observeOnce } from '@norbital-ai/ui/effect';
	import { leaveBalancesOn, pageRead } from '../../leave_reads.js';
	import { pageEntity } from '../scopes/company_scope.svelte.js';
	import { todayKey } from '../format/calendar.js';
	import { jsonSchemaOf, schemaAt } from '../person/input_schema.js';
	import { formSchema } from '../person/form_schema.js';

	let {
		catalog,
		form,
		fields
	}: {
		catalog: 'adhoc_catalog' | 'claim_catalog' | 'leave_catalog' | 'loan_catalog';
		form: FormState;
		fields: readonly string[];
	} = $props();

	const page = pageEntity();
	const payslip = $derived(form.row['payslip_id']);
	const loanCatalogId = inputSchema({ kind: 'id', of: 'loan_catalog' });
	const isLoanCatalogId = (value: unknown): value is Id<'loan_catalog'> =>
		Schema.is(loanCatalogId)(value);
	const employmentContractId = inputSchema({ kind: 'id', of: 'employment_contract' });
	const isEmploymentId = (value: unknown): value is Id<'employment_contract'> =>
		Schema.is(employmentContractId)(value);
	const employmentId = $derived.by(() => {
		// the form's `get` is untyped: the picked id is decoded as a row id of `employment_contract`
		const held = form.get('employment_id');
		return isEmploymentId(held) && held !== '' ? held : null;
	});
	const employment = $derived.by(() => {
		const id = employmentId;
		return id == null
			? null
			: bolt.query({
					employment_contract: { where: { id: { eq: id } }, fields: ['company_id'], limit: 1 }
				});
	});
	const employer = $derived.by(() => {
		const company = employment?.current?.employment_contract.rows[0]?.company_id;
		return company == null
			? null
			: bolt.query({
					entity: { where: { id: { eq: company } }, fields: ['settings_code'], limit: 1 }
				});
	});
	const lineage = $derived(
		employer?.current?.entity.rows[0]?.settings_code ?? page?.company?.settings_code ?? null
	);
	const loan = $derived.by(() => {
		const id = form.get('catalog_id');
		return catalog !== 'loan_catalog' || !isLoanCatalogId(id)
			? null
			: bolt.query({
					loan_catalog: {
						where: { id: { eq: id } },
						fields: ['eligibility', 'settings_id'],
						limit: 1
					}
				});
	});
	const loanVersion = $derived.by(() => {
		const settings = loan?.current?.loan_catalog.rows[0]?.settings_id;
		return settings == null
			? null
			: bolt.query({
					jurisdiction_settings: {
						where: { id: { eq: settings } },
						fields: ['employee_input_schema'],
						limit: 1
					}
				});
	});
	/** The loan class's own rule names the agreement facts it reads; only those are asked for. */
	const loanReads = $derived(loan?.current?.loan_catalog.rows[0]?.eligibility ?? '');
	/** The `employee_input_schema` property declaring each family's entry `facts`. */
	const FACTS = {
		adhoc_catalog: 'adhoc_facts',
		claim_catalog: 'claim_facts',
		leave_catalog: 'leave_facts',
		loan_catalog: 'loan_facts'
	} as const;
	const day = $derived.by(() => {
		if (catalog === 'loan_catalog') {
			const period = form.get('repayment_period');
			if (Predicate.isObject(period)) {
				const from = Reflect.get(period, 'from');
				if (isPlainDate(from)) return from;
			}
		}
		const held = form.get('occurred_on');
		return Predicate.isString(held) && held !== '' ? held : todayKey();
	});
	/** The leave classes the employee may take on the day: the leave write's listing, eligibility applied. */
	const read = pageRead(bolt.query);
	const balances = observeOnce(() =>
		catalog !== 'leave_catalog' || employmentId == null
			? null
			: leaveBalancesOn(read, employmentId, day)
	);
	const eligible = $derived(
		balances.current == null
			? {}
			: { id: { in: [...new Set(balances.current.map((row) => row.catalog_id))] } }
	);
	const governs = $derived({
		sealed_at: { isNull: false },
		voided_at: { isNull: true },
		effective_range: { contains: PlainDate(day) },
		...(lineage == null ? {} : { code: { eq: lineage } })
	} as const);
	/** The version of the employment's lineage governing the entry day. */
	const version = $derived.by(() =>
		catalog === 'loan_catalog' || lineage == null
			? null
			: bolt.query({
					jurisdiction_settings: { where: governs, fields: ['employee_input_schema'], limit: 1 }
				})
	);
	/** The entry inputs the governing version declares (a loan: its class's own version): its `facts`. */
	const factsSchema = $derived(
		formSchema(
			schemaAt(
				jsonSchemaOf(
					catalog === 'loan_catalog'
						? loanVersion?.current?.jurisdiction_settings.rows[0]?.employee_input_schema
						: version?.current?.jurisdiction_settings.rows[0]?.employee_input_schema
				),
				FACTS[catalog]
			)
		)
	);
</script>

{#if Predicate.isString(payslip)}
	<Button
		type="button"
		variant="ghost"
		size="sm"
		class="w-fit"
		data-entry-payslip
		onclick={() => openRecord('payslip', payslip)}
	>
		<Icon name="lucide:lock-keyhole" class="size-3.5" />{bolt.t('entry.included_in_payroll')}
	</Button>
{/if}
<Grid minimum="card">
	<Field name="employment_id">
		{#snippet editor(field)}
			<Picker
				of="employment_contract"
				id={field.id}
				where={page?.id == null ? {} : { company_id: { eq: page.id } }}
				value={Predicate.isString(field.value) ? field.value : null}
				disabled={field.disabled}
				onChange={field.onChange}
			/>
		{/snippet}
	</Field>
	<Field name="catalog_id">
		{#snippet editor(field)}
			{#if catalog === 'adhoc_catalog'}
				<Picker
					of="adhoc_catalog"
					id={field.id}
					where={{ settings_id: { is: governs } }}
					value={Predicate.isString(field.value) ? field.value : null}
					disabled={field.disabled}
					onChange={field.onChange}
				/>
			{:else if catalog === 'leave_catalog'}
				<Picker
					of="leave_catalog"
					id={field.id}
					where={{ settings_id: { is: governs }, ...eligible }}
					value={Predicate.isString(field.value) ? field.value : null}
					disabled={field.disabled}
					onChange={field.onChange}
				/>
			{:else if catalog === 'claim_catalog'}
				<Picker
					of="claim_catalog"
					id={field.id}
					where={{ settings_id: { is: governs } }}
					value={Predicate.isString(field.value) ? field.value : null}
					disabled={field.disabled}
					onChange={field.onChange}
				/>
			{:else}
				<Picker
					of="loan_catalog"
					id={field.id}
					where={{ settings_id: { is: governs } }}
					value={Predicate.isString(field.value) ? field.value : null}
					disabled={field.disabled}
					onChange={field.onChange}
				/>
			{/if}
		{/snippet}
	</Field>
	{#each fields.filter((name) => name !== 'facts' || factsSchema == null) as name (name)}
		<Field {name} />
	{/each}
	{#if catalog === 'loan_catalog' && loanReads.includes('advance_made_on')}
		<Field name="advance_made_on" />
	{/if}
	{#if factsSchema != null && (catalog === 'loan_catalog' || fields.includes('facts'))}
		<Field name="facts">
			{#snippet editor(field)}
				<StructuredData
					mode="edit"
					schema={factsSchema}
					value={field.value}
					onChange={field.onChange}
					name={field.name}
					id={field.id}
					disabled={field.disabled}
				/>
			{/snippet}
			{#snippet view(field)}
				<StructuredData
					mode="view"
					schema={factsSchema}
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
