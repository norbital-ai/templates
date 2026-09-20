<script lang="ts">
	/**
	 * The hire: one employment contract for a person at an entity. The employments record shows
	 * it when opened with no record; the person's own profile opens it from the Employment
	 * contracts tab with the person prefilled. The first terms row follows on the contract
	 * itself (`ContractDetail`), where a contract with no terms offers its first revision.
	 */
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { client } from '../../workspace-client.js';
	import EffectiveRangeRenderer from '../effective-range-renderer.svelte';
	import { hrCreateScope } from '../create-scope.js';

	let {
		askCompany = false,
		onDone
	}: {
		/** Offer the entity even under a scope: a person may hold a contract at any entity. */
		readonly askCompany?: boolean;
		readonly onDone?: () => void;
	} = $props();
	/**
	 * Who and where come from the page's scope, not props: a person's profile scopes the person,
	 * an entity's page scopes the entity, and the framework keeps system ids out of authored props.
	 */
	const scope = hrCreateScope();
	const employeeId = $derived(scope?.employeeId?.());
	const companyId = $derived(askCompany ? undefined : scope?.companyId());
	const { t } = useI18n<TenantI18nKeys>();
	const defaults = $derived({
		...(employeeId == null ? {} : { employee_id: employeeId }),
		...(companyId == null ? {} : { company_id: companyId })
	});
</script>

<CollectionForm
	{client}
	collection="employments"
	defaultValues={Object.keys(defaults).length === 0 ? undefined : defaults}
	submitLabel={t('component.create_employment')}
	onAfterSubmit={onDone}
>
	{#snippet children({ Field })}
		<Grid gap="md" minimum="panel">
			{#if employeeId != null}
				<Field name="employee_id" hidden />
			{:else}
				<Field
					name="employee_id"
					label={t('component.person')}
					relationOptions={{
						label: (person) =>
							person.name != null && person.name !== '' ? String(person.name) : '—',
						orderBy: { name: 'asc' },
						limit: 10_000
					}}
				/>
			{/if}
			{#if companyId != null}
				<Field name="company_id" hidden />
			{:else}
				<Field
					name="company_id"
					label={t('component.legal_entity')}
					relationOptions={{
						label: (company) =>
							company.name != null && company.name !== '' ? String(company.name) : '—',
						orderBy: { name: 'asc' },
						limit: 500
					}}
				/>
			{/if}
			<Field name="employee_number" label={t('component.employee_number')} />
			<Column span="all"><Field name="bank" label={t('component.pay_destination')} /></Column>
			<Column span="all">
				<Field
					name="effective_range"
					renderer={EffectiveRangeRenderer}
					label={t('component.effective_period')}
				/>
			</Column>
			<Field name="exit_reason" hidden />
			<Field name="exit_facts" hidden />
			<Field name="comments" hidden />
		</Grid>
	{/snippet}
</CollectionForm>
