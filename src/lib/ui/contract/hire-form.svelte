<script lang="ts">
	/**
	 * The hire: one employment contract for a person at an entity. The employments record shows it when opened with no
	 * record; the person's own profile opens it with the person prefilled. The first terms row follows on the contract
	 * itself (`ContractDetail`), where a contract with no terms offers its first revision.
	 */
	import { t } from '../t.js';
	import { Field, Form } from '@norbital-ai/ui';
	import { Picker } from '@norbital-ai/ui';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { hrCreateScope } from '../create-scope.js';
	import * as Predicate from 'effect/Predicate';

	let {
		askCompany = false,
		onDone
	}: {
		/** Offer the entity even under a scope: a person may hold a contract at any entity. */
		readonly askCompany?: boolean;
		readonly onDone?: () => void;
	} = $props();
	/** Who and where come from the page's scope: a person's profile scopes the person, an entity's page the entity. */
	const scope = hrCreateScope();
	const employeeId = $derived(scope?.employeeId?.());
	const companyId = $derived(askCompany ? undefined : scope?.companyId());
	const values = $derived({
		...(employeeId == null ? {} : { employee_id: employeeId }),
		...(companyId == null ? {} : { company_id: companyId })
	});
	const text = (value: unknown) => (Predicate.isString(value) ? value : null);
</script>

<Form
	of="employments"
	mode="create"
	{values}
	submit={t('component.create_employment')}
	onOutcome={(outcome) => {
		if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') onDone?.();
	}}
>
	<Grid gap="md" minimum="panel">
		{#if employeeId == null}
			<Field name="employee_id" label={t('component.person')}>
				{#snippet editor(field)}
					<Picker
						of="employees"
						label={['name']}
						orderBy={{ name: 'asc' }}
						value={text(field.value)}
						onChange={field.onChange}
						disabled={field.disabled}
					/>
				{/snippet}
			</Field>
		{/if}
		{#if companyId == null}
			<Field name="company_id" label={t('component.legal_entity')}>
				{#snippet editor(field)}
					<Picker
						of="companies"
						label={['name']}
						orderBy={{ name: 'asc' }}
						value={text(field.value)}
						onChange={field.onChange}
						disabled={field.disabled}
					/>
				{/snippet}
			</Field>
		{/if}
		<Field name="employee_number" label={t('component.employee_number')} />
		<Column span="all"><Field name="bank" label={t('component.pay_destination')} /></Column>
		<Column span="all"
			><Field name="effective_range" label={t('component.effective_period')} /></Column
		>
		<Field
			name="signed_contract_end"
			label={t('component.signed_contract_end')}
			help={t('component.signed_contract_end_hint')}
		/>
	</Grid>
</Form>
